/* Preserve the desktop contract used by the shared Electron/browser interface. */
(() => {
  'use strict';
  const tauri = window.__TAURI__;
  if (window.desktop || !tauri?.core?.invoke || !tauri?.event?.listen) return;

  const invoke = (method, ...args) => tauri.core.invoke('desktop', { method, args });
  let calibrated;
  const calibrate = () => {
    if (!document.getElementById('roller') && !['mini','toast'].includes(new URLSearchParams(location.search).get('mode'))) return Promise.resolve();
    return calibrated ||= invoke('window:viewport', devicePixelRatio).then(async expected => {
      for (let i=0;i<30 && Math.abs(innerHeight-expected.height)>1;i++) await new Promise(resolve=>setTimeout(resolve,20));
    });
  };
  const subscribe = (channel, callback) => {
    if (typeof callback !== 'function') throw new TypeError('Callback required');
    let disposed = false, unlisten;
    tauri.event.listen(channel, event => {
      if (!disposed) callback(event.payload);
    }).then(stop => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(error => console.error(`Unable to subscribe to ${channel}`, error));
    return () => { disposed = true; unlisten?.(); unlisten = null; };
  };

  window.desktop = Object.freeze({
    runtime: 'tauri',
    getSystemClock: () => invoke('system:get-clock'),
    onSystemClock: callback => subscribe('system:clock', callback),
    getState: async () => { await calibrate(); return invoke('calendar:get-state'); },
    getLocation: () => invoke('location:get'),
    saveState: state => invoke('calendar:save-state', state),
    hide: () => invoke('window:hide'),
    show: date => invoke('window:show', date),
    setAlwaysOnTop: enabled => invoke('window:top', enabled),
    setMini: enabled => invoke('window:mini', enabled),
    beginMiniDrag: () => invoke('mini:begin-drag'),
    endMiniDrag: cancel => invoke('mini:end-drag', cancel),
    getMiniState: () => invoke('mini:get-state'),
    onMiniAlert: callback => subscribe('mini:alert', callback),
    onMiniState: callback => subscribe('mini:state', callback),
    getWellnessStatus: () => invoke('wellness:get-status'),
    acknowledgeWellness: (kind, id) => invoke('wellness:acknowledge', kind, id),
    redisplayWellness: kind => invoke('wellness:redisplay', kind),
    testWellness: kind => invoke('wellness:test', kind),
    onWellnessState: callback => subscribe('wellness:state', callback),
    testNotification: reminder => invoke('reminder:test', reminder),
    getVersion: () => invoke('app:version'),
    getToast: async () => { await calibrate(); return invoke('reminder:get-toast'); },
    dismissToast: () => invoke('reminder:dismiss'),
    acknowledgeReminder: () => invoke('reminder:acknowledge'),
    setReminderInteractive: enabled => invoke('reminder:interactive', enabled),
    openReminder: date => invoke('reminder:open', date),
    onReminder: callback => subscribe('reminder:fired', callback),
    onOpenDate: callback => subscribe('calendar:open-date', callback),
    onStateChanged: callback => subscribe('calendar:state-changed', callback),
  });

  // A reminder is consumed only after its UI has rendered successfully.
  if (document.getElementById('roller') || new URLSearchParams(location.search).get('mode') === 'toast') {
    const readyTimer = setInterval(() => {
      const rendered = document.getElementById('roller')?.dataset.phase ||
        (new URLSearchParams(location.search).get('mode') === 'toast' && !document.getElementById('toastView')?.hidden && document.getElementById('toastTitle')?.textContent?.trim());
      if (rendered) { clearInterval(readyTimer); invoke('app:ready').catch(console.error); }
    }, 100);
    setTimeout(() => clearInterval(readyTimer), 10000);
  }

  // WebView2 does not implement Electron's CSS -webkit-app-region dragging.
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.calendar-header') ||
        target.closest('button,input,select,textarea,a,[role="button"],[contenteditable="true"]')) return;
    event.preventDefault();
    invoke('window:drag').catch(error => console.error('Unable to move the window', error));
  });

  // A transparent WebView2 window does not forward mouse motion while ignored.
  // Native cursor polling uses these CSS-pixel bounds to restore input only over
  // the moving cube and its visible controls, leaving the rest of the desktop usable.
  if (document.getElementById('roller')) {
    let pending = false, previous = '', stopped = false;
    const reportRegions = async () => {
      if (pending || stopped) return;
      const regions = document.hidden ? [] : ['cubeHit', 'dismiss', 'hint']
        .map(id => document.getElementById(id))
        .filter(node => {
          if (!node || node.hidden) return false;
          const style = getComputedStyle(node);
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            Number(style.opacity) > 0 && style.pointerEvents !== 'none';
        })
        .map(node => node.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0)
        .map(({ x, y, width, height }) => ({ x, y, width, height }));
      const serialized = JSON.stringify(regions);
      if (serialized === previous) return;
      pending = true;
      try { await invoke('reminder:hit-regions', regions, {width: innerWidth, height: innerHeight}); previous = serialized; }
      catch (error) { console.error('Unable to update reminder input regions', error); }
      finally { pending = false; }
    };
    const timer = setInterval(reportRegions, 50);
    reportRegions();
    window.addEventListener('pagehide', () => { stopped = true; clearInterval(timer); }, { once: true });
  }
})();
