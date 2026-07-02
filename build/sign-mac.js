const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

module.exports = async function signMac(configuration) {
  if (process.platform !== 'darwin') return;

  const appPath = configuration.app;
  if (!appPath) throw new Error('Missing macOS app path for signing');

  const options = { maxBuffer: 1024 * 1024 * 10 };
  await execFileAsync('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    appPath,
  ], options);
  await execFileAsync('codesign', [
    '--verify',
    '--deep',
    '--strict',
    appPath,
  ], options);
};
