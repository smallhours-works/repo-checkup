'use strict';

const { spawnSync } = require('child_process');

/**
 * Returns true if `bin` is found on PATH. Works cross-platform by trying
 * the POSIX `command -v` and falling back to Windows `where`.
 */
function isOnPath(bin) {
  const probe = process.platform === 'win32'
    ? spawnSync('where', [bin], { stdio: 'ignore' })
    : spawnSync('command', ['-v', bin], { stdio: 'ignore', shell: true });
  return probe.status === 0;
}

module.exports = { isOnPath };
