const os = require('os');
const { spawn } = require('child_process');
const { Bonjour } = require('bonjour-service');
const { createServer, getLanAddresses, DEFAULT_PORT } = require('./server/index.js');

function readPort() {
  const index = process.argv.indexOf('--port');
  const raw = index >= 0 ? process.argv[index + 1] : process.env.PORT;
  const port = raw ? Number(raw) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`无效端口：${raw}`);
  }
  return port;
}

function openBrowser(url) {
  if (process.argv.includes('--no-open')) return;
  const command = `start "" "${url}"`;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function main() {
  const port = readPort();
  const suffix = (os.hostname() || 'Windows').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
  const hostName = process.env.NAIQI_HOST_NAME || `奶棋-Web-${suffix}`;
  const server = createServer({ port, hostName });
  const bonjour = new Bonjour();

  server.httpServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n端口 ${port} 已被占用。请关闭其他奶棋主机，或运行：`);
      console.error(`node.exe web-host.js --port 3031`);
    } else {
      console.error('\n主机启动失败：', error.message);
    }
    process.exitCode = 1;
  });

  await new Promise((resolve, reject) => {
    server.httpServer.once('error', reject);
    server.httpServer.listen(port, '0.0.0.0', resolve);
  });
  server.advertise(bonjour);

  const urls = getLanAddresses().map((address) => `http://${address}:${port}`);
  console.log('\n========================================');
  console.log(' 奶棋 Web 局域网主机已启动');
  console.log('========================================');
  console.log(`本机： http://localhost:${port}`);
  for (const url of urls) console.log(`局域网：${url}`);
  console.log('\n其他设备需连接同一 Wi-Fi / 个人热点。');
  console.log('Windows 防火墙询问时，请允许“专用网络”。');
  console.log('按 Ctrl+C 停止主机。\n');

  openBrowser(`http://localhost:${port}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\n正在停止主机...');
    try { bonjour.destroy(); } catch (_) { /* ignore */ }
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error('\n无法启动奶棋 Web 主机：', error.message);
  process.exit(1);
});
