import { io } from 'socket.io-client';

const isLocalDev = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);

// In a packaged desktop app the renderer is loaded from the file system
// (origin "file://"), so window.location.origin is meaningless. The Electron
// main process passes the embedded server's port via ?serverPort=.
const isPackagedDesktop = window.location.protocol === 'file:';
const queryPort = new URLSearchParams(window.location.search).get('serverPort');

// Capacitor (Android) serves the app from a synthetic origin (https://localhost)
// and has NO local server — the phone must connect to a LAN host discovered via
// the discovery layer. We expose this so the UI can start on the host-picker.
export const isCapacitor = typeof window !== 'undefined'
  && (typeof window.Capacitor !== 'undefined' || window.location.protocol === ' capacitor'.trim());

// Default target: where this app's "own" server lives.
//   - packaged desktop app: localhost:<serverPort> (embedded server)
//   - dev: localhost:3030
//   - web served by a host: that host (window.location.origin)
//   - Capacitor (mobile): null — must pick a LAN host first
export const DEFAULT_URL = isPackagedDesktop
  ? `http://localhost:${queryPort || 3030}`
  : isLocalDev
    ? 'http://localhost:3030'
    : isCapacitor
      ? null
      : window.location.origin;

let currentUrl = DEFAULT_URL;

export const socket = io(currentUrl || 'http://0.0.0.0:0', {
  autoConnect: Boolean(currentUrl), // mobile (null) waits for an explicit host choice
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

/**
 * Re-point the socket at a different host (e.g. a LAN host discovered via mDNS
 * or IP scan) and reconnect. Returns a Promise that resolves once connected.
 */
export function connectTo(url) {
  const target = url || DEFAULT_URL;
  if (!target) return Promise.reject(new Error('No host selected'));
  if (target === currentUrl && socket.connected) return Promise.resolve();

  currentUrl = target;
  socket.io.uri = target; // socket.io v4: live-update the URI
  socket.disconnect();
  socket.connect();

  return new Promise((resolve, reject) => {
    const onOk = () => { cleanup(); resolve(); };
    const onErr = (err) => { cleanup(); reject(err); };
    const cleanup = () => {
      socket.off('connect', onOk);
      socket.off('connect_error', onErr);
    };
    socket.once('connect', onOk);
    socket.once('connect_error', onErr);
  });
}

export function getCurrentUrl() {
  return currentUrl;
}
