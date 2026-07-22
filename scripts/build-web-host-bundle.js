const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const rootPackage = require(path.join(root, 'package.json'));
const version = rootPackage.version;
const bundleName = `naiqi-web-host-${version}-windows-x64`;
const outputDir = path.join(root, 'dist-web-host');
const bundleDir = path.join(outputDir, bundleName);
const archivePath = path.join(outputDir, `${bundleName}.zip`);

if (process.platform !== 'win32') {
  throw new Error('Windows Web 主机包必须在 Windows 上构建');
}
if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
  throw new Error('缺少 client/dist，请先运行 npm run build:web');
}

fs.rmSync(bundleDir, { recursive: true, force: true });
fs.mkdirSync(path.join(bundleDir, 'server'), { recursive: true });
fs.cpSync(path.join(root, 'server', 'game'), path.join(bundleDir, 'server', 'game'), { recursive: true });
fs.copyFileSync(path.join(root, 'server', 'index.js'), path.join(bundleDir, 'server', 'index.js'));
fs.cpSync(path.join(root, 'client', 'dist'), path.join(bundleDir, 'client', 'dist'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts', 'web-host.js'), path.join(bundleDir, 'web-host.js'));
fs.copyFileSync(process.execPath, path.join(bundleDir, 'node.exe'));

const dependencies = {};
for (const name of ['bonjour-service', 'cors', 'express', 'socket.io']) {
  dependencies[name] = rootPackage.dependencies[name];
}
fs.writeFileSync(path.join(bundleDir, 'package.json'), `${JSON.stringify({
  name: 'naiqi-web-host',
  version,
  private: true,
  main: 'web-host.js',
  dependencies,
}, null, 2)}\n`);

fs.writeFileSync(path.join(bundleDir, '启动奶棋Web主机.cmd'), [
  '@echo off',
  'chcp 65001 >nul',
  'title 奶棋 Web 局域网主机',
  'cd /d "%~dp0"',
  'node.exe web-host.js',
  'echo.',
  'echo 主机已停止。按任意键关闭窗口。',
  'pause >nul',
  '',
].join('\r\n'));

fs.writeFileSync(path.join(bundleDir, '使用说明.txt'), [
  '奶棋 Web 局域网主机',
  '',
  '1. 双击“启动奶棋Web主机.cmd”。',
  '2. Windows 防火墙询问时，允许“专用网络”。',
  '3. 主机浏览器会自动打开；其他设备连接同一 Wi-Fi 或热点。',
  '4. 在其他设备浏览器中打开窗口显示的局域网地址。',
  '5. 奶棋 App 也会自动扫描到该主机；扫描失败时可手动输入 IP。',
  '',
  '默认端口为 3030。关闭命令窗口即停止主机。',
  '',
].join('\r\n'));

console.log(`Installing Web host runtime dependencies in ${bundleDir}`);
const npmArgs = ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath && fs.existsSync(npmExecPath)
  ? [process.execPath, [npmExecPath, ...npmArgs]]
  : [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${npmArgs.join(' ')}`]];
execFileSync(npmCommand[0], npmCommand[1], {
  cwd: bundleDir,
  stdio: 'inherit',
});

fs.mkdirSync(outputDir, { recursive: true });
if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
const escapedBundle = bundleDir.replace(/'/g, "''");
const escapedArchive = archivePath.replace(/'/g, "''");
execFileSync('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Compress-Archive -Path '${escapedBundle}\\*' -DestinationPath '${escapedArchive}' -CompressionLevel Optimal -Force`,
], { stdio: 'inherit' });

console.log(`Created ${archivePath}`);
