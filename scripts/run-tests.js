// 测试编排：在临时端口启动服务器，依次运行所有测试套件，最后汇总并关闭服务器。
const { spawn, fork } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 3099; // 与各测试脚本约定的端口（test_*.js 硬编码 3099）
const TEST_URL = `http://127.0.0.1:${PORT}`;
process.env.TEST_PORT = String(PORT);

function waitForServer(url, timeout = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url + '/__chess_info__', (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (Date.now() - start > timeout) reject(new Error('server unhealthy'));
        else setTimeout(tick, 200);
      }).on('error', () => {
        if (Date.now() - start > timeout) reject(new Error('server timeout'));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function runTest(file) {
  return new Promise((resolve) => {
    const child = fork(path.join(__dirname, '..', file), [], {
      env: { ...process.env, TEST_PORT: String(PORT) },
      stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => resolve({ file, code, out }));
  });
}

const SUITES = [
  'test_three.js',
  'test_elimination.js',
  'test_capture_general.js',
  'test_networked.js',
  'test_fixes.js',
];

(async () => {
  // 启动临时服务器
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stderr.write(`[server] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  let exitCode = 0;
  try {
    await waitForServer(TEST_URL);
    console.log(`\n# 测试服务器已启动：${TEST_URL}\n`);
    const results = [];
    for (const file of SUITES) {
      console.log(`\n===== 运行 ${file} =====`);
      const r = await runTest(file);
      // 打印每个套件的尾部摘要
      const lines = (r.out || '').split('\n').filter(Boolean);
      console.log(lines.slice(-3).join('\n'));
      results.push({ file, code: r.code, out: r.out || '' });
      if (r.code !== 0) exitCode = 1;
    }

    console.log('\n========== 测试汇总 ==========');
    let totalOk = 0, totalFail = 0;
    for (const r of results) {
      const m = (r.out || '').match(/通过\s*(\d+)\s*\/\s*失败\s*(\d+)/);
      if (m) { totalOk += Number(m[1]); totalFail += Number(m[2]); }
      console.log(`${r.code === 0 ? '✓' : '✗'} ${r.file}`);
    }
    console.log(`\n总计：通过 ${totalOk} / 失败 ${totalFail}`);
    console.log(totalFail === 0 ? '\n🎉 全部通过' : '\n❌ 有失败项');
  } catch (e) {
    console.error('测试启动失败：', e.message);
    exitCode = 1;
  } finally {
    server.kill();
    process.exit(exitCode);
  }
})();
