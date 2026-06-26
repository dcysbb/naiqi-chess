const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');
const { Bonjour } = require('bonjour-service');
const { createServer } = require('../server/index.js');

// Diagnostics: write startup logs to a file next to the app, for debugging.
const LOG_FILE = path.join(app.getPath('temp'), 'chess-desktop.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) { /* ignore */ }
  console.log(...args);
}
log('=== desktop app starting ===');

let mainWindow = null;
let serverHandle = null;
let bonjour = null;

/** Find a free TCP port between lo and hi (inclusive). */
function findFreePort(lo = 3030, hi = 3040) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > hi) return reject(new Error('No free port found in range'));
      const tester = net.createServer();
      tester.once('error', () => tryPort(port + 1));
      tester.once('listening', () => {
        tester.once('close', () => resolve(port));
        tester.close();
      });
      tester.listen(port, '0.0.0.0');
    };
    tryPort(lo);
  });
}

async function startEmbeddedServer() {
  const port = await findFreePort();
  const clientDir = app.isPackaged
    ? path.join(process.resourcesPath, 'client-dist')
    : path.join(__dirname, '..', 'client', 'dist');
  log(`free port: ${port}, clientDir: ${clientDir}, packaged: ${app.isPackaged}`);

  serverHandle = createServer({ port, clientDir });
  bonjour = new Bonjour();
  serverHandle.advertise(bonjour);

  await new Promise((resolve, reject) => {
    serverHandle.httpServer.on('error', reject);
    serverHandle.httpServer.listen(port, '0.0.0.0', resolve);
  });

  log(`server listening on http://0.0.0.0:${port}, advertising as "${serverHandle.hostInfo.hostName}"`);
  return port;
}

// --- mDNS discovery bridge for the renderer (find OTHER hosts on the LAN) ---
let mdnsBrowser = null;
const mdnsCallbacks = new Set();

ipcMain.handle('discovery:start', () => {
  if (!bonjour) return;
  if (mdnsBrowser) return;
  mdnsBrowser = bonjour.find({ type: 'chess' });
  mdnsBrowser.on('up', (service) => {
    // Skip our own advertised service.
    if (service.name === serverHandle?.hostInfo.hostName) return;
    const address = (service.addresses && service.addresses[0]) || service.host;
    const host = {
      address,
      port: service.port,
      hostName: service.name,
      hostId: (service.txt && service.txt.hostId) || service.name,
    };
    for (const cb of mdnsCallbacks) cb(host);
  });
});

ipcMain.handle('discovery:stop', () => {
  if (mdnsBrowser) {
    try { mdnsBrowser.stop(); } catch (_) { /* ignore */ }
    mdnsBrowser = null;
  }
});

ipcMain.on('discovery:onHost', (event, cbId) => {
  // Renderer registers a callback id; we forward hosts via webContents.send.
  mdnsCallbacks.add((host) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`discovery:host:${cbId}`, host);
    }
  });
});

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#16213e',
    title: '暗棋象棋',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Pass the embedded server port to the client so it connects to the right place.
  mainWindow.loadFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'), {
    query: { serverPort: String(port) },
  });
}

app.whenReady().then(async () => {
  try {
    const port = await startEmbeddedServer();
    createWindow(port);
    log('window created');
  } catch (e) {
    log('FAILED to start:', e && e.stack ? e.stack : e);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
      createWindow(serverHandle.hostInfo.port);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  if (serverHandle) {
    e.preventDefault();
    try {
      if (mdnsBrowser) mdnsBrowser.stop();
      if (bonjour) bonjour.destroy();
      await serverHandle.stop();
    } catch (_) { /* ignore */ }
    serverHandle = null;
    app.exit(0);
  }
});
