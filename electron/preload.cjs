const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('Callback required');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  getSystemClock: () => ipcRenderer.invoke('system:get-clock'),
  onSystemClock: callback => subscribe('system:clock',callback),
  getState: () => ipcRenderer.invoke('calendar:get-state'),
  getLocation: () => ipcRenderer.invoke('location:get'),
  saveState: state => ipcRenderer.invoke('calendar:save-state', state),
  hide: () => ipcRenderer.invoke('window:hide'),
  show: date => ipcRenderer.invoke('window:show', date),
  setAlwaysOnTop: enabled => ipcRenderer.invoke('window:top', enabled),
  setMini: enabled => ipcRenderer.invoke('window:mini', enabled),
  beginMiniDrag: () => ipcRenderer.invoke('mini:begin-drag'),
  endMiniDrag: cancel => ipcRenderer.invoke('mini:end-drag', cancel),
  getMiniState: () => ipcRenderer.invoke('mini:get-state'),
  onMiniAlert: callback => subscribe('mini:alert', callback),
  onMiniState: callback => subscribe('mini:state', callback),
  getWellnessStatus: () => ipcRenderer.invoke('wellness:get-status'),
  acknowledgeWellness: (kind,id) => ipcRenderer.invoke('wellness:acknowledge', kind, id),
  redisplayWellness: kind => ipcRenderer.invoke('wellness:redisplay', kind),
  testWellness: kind => ipcRenderer.invoke('wellness:test', kind),
  onWellnessState: callback => subscribe('wellness:state', callback),
  testNotification: reminder => ipcRenderer.invoke('reminder:test', reminder),
  getVersion: () => ipcRenderer.invoke('app:version'),
  getToast: () => ipcRenderer.invoke('reminder:get-toast'),
  dismissToast: () => ipcRenderer.invoke('reminder:dismiss'),
  acknowledgeReminder: () => ipcRenderer.invoke('reminder:acknowledge'),
  setReminderInteractive: enabled => ipcRenderer.invoke('reminder:interactive', enabled),
  openReminder: date => ipcRenderer.invoke('reminder:open', date),
  onReminder: callback => subscribe('reminder:fired', callback),
  onOpenDate: callback => subscribe('calendar:open-date', callback),
  onStateChanged: callback => subscribe('calendar:state-changed', callback),
}));
