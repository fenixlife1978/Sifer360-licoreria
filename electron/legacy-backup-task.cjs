'use strict';

const { execFileSync } = require('child_process');
const TASK_NAME = 'SIFER360-GoogleDrive-Backup';

/**
 * Removes the scheduled task created by older SIFER360 versions.
 * It never reads user data, opens a network connection, or creates a task.
 */
function createLegacyBackupTaskRetirer({ execFile = execFileSync, platform = process.platform } = {}) {
  function remove() {
    if (platform !== 'win32') return { scheduled: false };
    try {
      execFile('schtasks.exe', ['/Delete', '/TN', TASK_NAME, '/F'], {
        windowsHide: true,
        stdio: 'pipe'
      });
    } catch (error) {
      const message = String(error && error.message || error);
      if (!/cannot find|cannot be found|not found|no se encuentra|no existe/i.test(message)) throw error;
    }
    return { scheduled: false };
  }
  return { remove };
}

module.exports = { createLegacyBackupTaskRetirer, TASK_NAME };
