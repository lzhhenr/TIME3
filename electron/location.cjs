const { execFile } = require('node:child_process');
const path = require('node:path');
let pending = null;
// No IP lookup or location history. The operating system controls permission.
function getLocation(language = 'zh') {
  const english = language === 'en';
  if (process.platform !== 'win32') return Promise.reject(new Error(english ? 'System location is available on Windows only.' : '系统定位仅支持 Windows。'));
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'location.ps1')], { windowsHide: true, timeout: 25000, maxBuffer: 8192, encoding: 'utf8' }, (error, stdout) => {
      if (error) return reject(new Error(english ? 'Windows could not provide a location. Enable Location services and desktop app access in Windows Settings, or choose a city manually.' : 'Windows 未能提供位置。请在系统设置中开启定位服务及桌面应用访问，或手动选择城市。'));
      try {
        const value = JSON.parse(stdout.trim());
        if (!Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) throw new Error('Invalid location');
        resolve({ latitude: value.latitude, longitude: value.longitude });
      } catch { reject(new Error(english ? 'Windows location is unavailable. Choose a city manually.' : 'Windows 定位暂不可用，请手动选择城市。')); }
    });
  }).finally(() => { pending = null; });
  return pending;
}
module.exports = { getLocation };
