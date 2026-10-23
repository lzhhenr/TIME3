const {createTopLayer}=require('./top-layer.cjs');
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, powerMonitor, session } = require('electron');
const path = require('node:path');
const { DEFAULT_SETTINGS, dateIsValid, timeIsValid, dueReminders, createStore, createScheduler } = require('./state.cjs');
const { assertSender } = require('./security.cjs');
const { cubePng } = require('./icon.cjs');
const { getLocation } = require('./location.cjs');
const { createMiniBehavior, placeWindow, trackWindowSize, moveWindow } = require('./window-behavior.cjs');
const { createWellness, makeWellnessReminder } = require('./wellness.cjs');

const indexPath = path.join(__dirname, '..', 'index.html');
const windows = new Map();
let mainWindow, miniWindow, miniBehavior, tray, store, tick, tickTimer, wellness, wellnessTimer, quitting = false;
let wellnessClockOffset = 0;
let icon,topLayer;
let rollerQueue = Promise.resolve();
const smoke = process.env.TIME3_SMOKE === '1';
if (smoke) app.setPath('userData', process.env.TIME3_SMOKE_DATA || require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'time3-smoke-')));
app.setName('TIME3');
app.setAppUserModelId('studio.timecube.desktop');

function systemClock(){const d=new Date();return {epoch:d.getTime(),date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,time:`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,offset:d.getTimezoneOffset()};}
function broadcastClock(){broadcast('system:clock',systemClock());}
function settings() { return store.get()?.settings || DEFAULT_SETTINGS; }
function broadcast(channel, payload) {
  for (const { win } of windows.values()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}
function windowOptions(extra = {}) {
  return { frame: false, transparent: true, backgroundColor: '#00000000', icon,
    show: false, hasShadow: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: true, autoplayPolicy: 'no-user-gesture-required' }, ...extra };
}
function registerWindow(win, role) {
  windows.set(win.webContents.id, { win, role, payload: null });
  if (smoke) win.webContents.setAudioMuted(true);
  const id = win.webContents.id;
  win.on('closed', () => windows.delete(id));
  win.on('show',()=>topLayer?.refresh());
  win.on('blur',()=>topLayer?.refresh());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('render-process-gone', (_event, detail) => console.error(`${role} renderer exited:`, detail.reason));
  return win;
}
async function createMain() {
  const area = screen.getPrimaryDisplay().workArea;
  mainWindow = registerWindow(new BrowserWindow(windowOptions({
    width: Math.min(1180, area.width - 24), height: Math.min(820, area.height - 24),
    minWidth: Math.min(1000, area.width - 24), minHeight: Math.min(700, area.height - 24),
    resizable: true, maximizable: false, title: 'TIME³ · 方寸之间', alwaysOnTop: settings().alwaysOnTop,
  })), 'main');
  trackWindowSize(mainWindow,{width:Math.min(1180,area.width-24),height:Math.min(820,area.height-24)});
  mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); hideMain(); } });
  await mainWindow.loadFile(indexPath);
  placeWindow(mainWindow, screen, settings().windowPosition);
  if (!smoke) mainWindow.show();
}
function showMain(date) {
  if (date !== undefined && !dateIsValid(date)) throw new Error('日期无效');
  if (!mainWindow || mainWindow.isDestroyed()) return;
  miniWindow?.hide();
  if(mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.webContents.invalidate();
  mainWindow.show(); mainWindow.focus();
  topLayer?.refresh();
  mainWindow.webContents.send('calendar:open-date', date || null);
}
function hideMain() {
  mainWindow?.hide();
  if (settings().miniMode) showMini();
}
async function showMini() {
  if (!miniWindow || miniWindow.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    miniWindow = registerWindow(new BrowserWindow(windowOptions({ width: 112, height: 112, x: area.x + area.width - 144, y: area.y + area.height - 144, thickFrame: false, roundedCorners: false, resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: true, title: 'TIME³ 悬浮方块' })), 'mini');
    trackWindowSize(miniWindow,{width:112,height:112});
    miniBehavior = createMiniBehavior({ win: miniWindow, screen });
    await miniWindow.loadFile(indexPath, { query: { mode: 'mini' } });
  }
  if (!miniWindow.isVisible()) miniWindow.showInactive();
  const bounds = miniWindow.getBounds();
  moveWindow(miniWindow, bounds.x, bounds.y);
}
function alertMini(payload){
  topLayer?.refresh();
  if(settings().alwaysOnTop&&settings().miniMode&&miniWindow?.isVisible()){miniBehavior?.reveal(3200);miniWindow.webContents.send('mini:alert',payload);}
}
function updateTray() {
  if (!tray) return;
  const en = settings().language === 'en';
  tray.setToolTip(en ? 'TIME³ · Make time a little lighter' : 'TIME³ · 方寸之间');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: en ? 'Open TIME³' : '打开 TIME³', click: () => showMain() },
    { label: en ? 'Floating cube' : '悬浮方块', type: 'checkbox', checked: settings().miniMode, click: item => updateSettings({ miniMode: item.checked }).then(() => { if (item.checked) { hideMain(); } }) },
    { label: en ? 'Always on top' : '窗口置顶', type: 'checkbox', checked: settings().alwaysOnTop, click: item => updateSettings({ alwaysOnTop: item.checked }) },
    { type: 'separator' },
    { label: en ? 'Quit (stop reminders)' : '退出（停止提醒）', click: () => { quitting = true; app.quit(); } },
  ]));
}
async function updateSettings(patch) {
  const oldPosition = settings().windowPosition;
  const state = store.get() || { reminders: [], settings: { ...DEFAULT_SETTINGS } };
  state.settings = { ...state.settings, ...patch };
  const saved = store.save(state);
  syncNativeSettings(saved, oldPosition);
  mainWindow?.setAlwaysOnTop(saved.settings.alwaysOnTop,'screen-saver');topLayer?.refresh();
  if (!saved.settings.miniMode) miniWindow?.hide();
  broadcast('calendar:state-changed', saved); updateTray(); return saved;
}
function pruneWellnessWindows() {
  for (const entry of windows.values()) if (entry.payload?.kind === 'wellness' && !entry.payload.preview && !wellness?.isPending(entry.payload.wellnessType, entry.payload.id)) entry.win.close();
}
function syncNativeSettings(saved, oldPosition) {
  if (saved.settings.windowPosition !== oldPosition) placeWindow(mainWindow, screen, saved.settings.windowPosition);
  wellness?.syncSettings(); pruneWellnessWindows();
}
function acknowledgeEntry(entry) {
  if (entry.payload?.kind === 'wellness' && !entry.payload.preview) wellness.acknowledge(entry.payload.wellnessType, entry.payload.id);
  if (!entry.win.isDestroyed()) entry.win.close();
}
function deliver(reminder, preview = false) {
  const motion = settings().motion;
  if (motion !== 'roll') return presentReminder(reminder, preview, motion).then(Boolean);
  // Resolve delivery once shown, but reserve the strip until that cube closes.
  // Simultaneous alarms must each be visible instead of replacing each other.
  const shown = rollerQueue.then(() => presentReminder(reminder, preview, motion));
  rollerQueue = shown.then(win => new Promise(resolve => {
    if (!win || win.isDestroyed()) resolve();
    else win.once('closed', resolve);
  }), () => {});
  return shown.then(Boolean);
}
async function presentReminder(reminder, preview, motion) {
  if (quitting) return;
  if (!preview) {
    if (reminder.kind === 'wellness') {
      if (!wellness?.isPending(reminder.wellnessType, reminder.id)) return;
      reminder = makeWellnessReminder(reminder.wellnessType, settings(), new Date(), reminder.id);
    } else {
      const latest = dueReminders(store.get()).find(item => item.id === reminder.id && item.date === reminder.date && item.time === reminder.time);
      if (!latest) return;
      reminder = latest;
    }
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const roll = motion === 'roll';
  // Windows workArea is already in DIP. Its bottom edge is the taskbar top.
  // Keep the whole strip click-through; only the actual cube and dismiss button
  // temporarily accept input. A standalone cube can cross the desktop smoothly.
  if (roll) {
    const win = registerWindow(new BrowserWindow(windowOptions({ width: area.width, height: 360, x: area.x, y: area.y + area.height - 360, thickFrame: false, roundedCorners: false, resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, webPreferences: { ...windowOptions().webPreferences, backgroundThrottling: false }, title: settings().language === 'en' ? 'TIME³ reminder' : 'TIME³ 提醒' })), 'roller');
    const payload = { ...reminder, motion: 'roll', preview, language: settings().language, soundEnabled: settings().soundEnabled, deliveredAt: new Date().toISOString(), floor: area.y + area.height, area: { ...area } };
    windows.get(win.webContents.id).payload = payload;
    win.setIgnoreMouseEvents(true, { forward: true });
    try {
      await win.loadFile(path.join(__dirname, '..', 'roller.html'));
      win.showInactive();
      win.webContents.send('reminder:fired', payload);
      mainWindow?.webContents.send('reminder:fired', payload);
      alertMini(payload);
      const timer = setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 45000);
      win.once('closed', () => clearTimeout(timer));
      return win;
    } catch (error) { if (!win.isDestroyed()) win.destroy(); throw error; }
  }
  const existing = [...windows.values()].filter(w => w.role === 'toast');
  // Keep simultaneous reminders visible in a short stack.
  const offset = Math.min(existing.length, 3) * 164;
  const win = registerWindow(new BrowserWindow(windowOptions({ width: 420, height: 180, x: area.x + area.width - 442, y: area.y + area.height - 202 - offset, resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, title: 'TIME³ 提醒' })), 'toast');
  const payload = { ...reminder, motion, language: settings().language, soundEnabled: settings().soundEnabled, preview, deliveredAt: new Date().toISOString() };
  windows.get(win.webContents.id).payload = payload;
  try {
    await win.loadFile(indexPath, { query: { mode: 'toast' } });
    win.showInactive();
    win.webContents.send('reminder:fired', payload);
    mainWindow?.webContents.send('reminder:fired', payload);
    alertMini(payload);
    const timer = setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 18000);
    win.once('closed', () => clearTimeout(timer));
    return win;
  } catch (error) { if (!win.isDestroyed()) win.destroy(); throw error; }
}
function installIPC() {
  const all = ['main', 'mini', 'toast', 'roller'];
  function handle(channel, roles, callback) {
    ipcMain.handle(channel, (event, ...args) => callback(assertSender(event, windows, indexPath, roles), ...args));
  }
  handle('system:get-clock',all,()=>systemClock());
  handle('calendar:get-state', all, () => store.get());
  handle('location:get', ['main'], async () => {
    if (!settings().useLocation) throw new Error(settings().language === 'en' ? 'Location is disabled. Enable it in settings first.' : '定位已关闭，请先在设置中开启。');
    const result = await getLocation(settings().language);
    if (!settings().useLocation) throw new Error(settings().language === 'en' ? 'Location was turned off.' : '定位已关闭。');
    return result;
  });
  handle('calendar:save-state', ['main'], (_entry, state) => {
    const oldPosition = settings().windowPosition;
    const saved = store.save(state);
    syncNativeSettings(saved, oldPosition);
    mainWindow.setAlwaysOnTop(saved.settings.alwaysOnTop,'screen-saver');topLayer?.refresh();
    if (!saved.settings.miniMode) miniWindow?.hide();
    broadcast('calendar:state-changed', saved); updateTray();
    setImmediate(() => tick());
    return saved;
  });
  handle('window:hide', ['main'], () => hideMain());
  handle('window:show', ['main', 'mini'], (_entry, date) => showMain(date));
  handle('mini:begin-drag', ['mini'], () => miniBehavior?.startDrag());
  handle('mini:end-drag', ['mini'], (_entry, cancel = false) => { if(typeof cancel !== 'boolean') throw new Error('Invalid drag state'); return miniBehavior?.endDrag(cancel); });
  handle('mini:get-state', ['mini'], () => miniBehavior?.state());
  handle('wellness:get-status', ['main'], () => wellness.getStatus());
  handle('wellness:acknowledge', ['main'], (_entry, kind, id) => { if(!['sedentary','eye','codex'].includes(kind)||typeof id !== 'string') throw new Error('Invalid wellness acknowledgement'); const result = wellness.acknowledge(kind,id);pruneWellnessWindows();return result; });
  handle('wellness:redisplay', ['main'], (_entry, kind) => { if(!['sedentary','eye','codex'].includes(kind)) throw new Error('Invalid wellness kind');return wellness.redisplay(kind); });
  handle('wellness:test', ['main'], (_entry, kind) => { if(!['sedentary','eye','codex'].includes(kind)) throw new Error('Invalid wellness kind');return deliver(makeWellnessReminder(kind,settings()),true); });
  handle('window:top', ['main'], (_entry, value) => { if (typeof value !== 'boolean') throw new Error('置顶设置无效'); return updateSettings({ alwaysOnTop: value }); });
  handle('window:mini', ['main'], async (_entry, value) => {
    if (typeof value !== 'boolean') throw new Error('悬浮方块设置无效');
    const saved = await updateSettings({ miniMode: value });
    if (value) { mainWindow.hide(); await showMini(); }
    return saved;
  });
  handle('reminder:test', ['main'], (_entry, input) => {
    const now = new Date(), local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
    const reminder = { id: 'preview', date: local.slice(0, 10), time: local.slice(11, 16), title: settings().language === 'en' ? 'A little time, just for you.' : '留一点时间，给自己。', done: false };
    if (input !== undefined) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('提醒无效');
      if (input.title !== undefined) { if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300) throw new Error('提醒内容无效'); reminder.title = input.title.trim(); }
      if (input.date !== undefined) { if (!dateIsValid(input.date)) throw new Error('日期无效'); reminder.date = input.date; }
      if (input.time !== undefined) { if (!timeIsValid(input.time)) throw new Error('时间无效'); reminder.time = input.time; }
    }
    return deliver(reminder, true);
  });
  handle('reminder:get-toast', ['toast', 'roller'], entry => entry.payload);
  handle('reminder:dismiss', ['toast', 'roller'], entry => acknowledgeEntry(entry));
  handle('reminder:acknowledge', ['toast','roller'], entry => acknowledgeEntry(entry));
  handle('reminder:interactive', ['roller'], (entry, enabled) => { if (typeof enabled !== 'boolean') throw new Error('Invalid input mode'); entry.win.setIgnoreMouseEvents(!enabled, { forward: true }); });
  handle('reminder:open', ['toast', 'roller', 'main'], (entry, date) => { showMain(date ?? entry.payload?.date); if (entry.role !== 'main') entry.win.close(); });
  handle('app:version', all, () => app.getVersion());
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, args) => { if(args.includes('--quit-for-update')) { quitting=true;app.quit(); } else showMain(); });
  app.on('before-quit', () => { quitting = true; clearInterval(tickTimer); clearInterval(wellnessTimer);topLayer?.dispose(); });
  app.on('window-all-closed', () => { /* Tray remains responsible for scheduled reminders. */ });
  app.on('activate', () => showMain());
  app.whenReady().then(async () => {
    icon = nativeImage.createFromBuffer(cubePng(64));
    store = createStore(path.join(app.getPath('userData'), 'calendar-state.json'));
    topLayer=createTopLayer({entries:windows,getPinned:()=>settings().alwaysOnTop});
    wellness = createWellness({ getSettings: settings, deliver, filename: path.join(app.getPath('userData'),'wellness-state.json'), clock: () => new Date(Date.now()+wellnessClockOffset), onChange: status => { broadcast('wellness:state',status);pruneWellnessWindows(); } });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    tick = createScheduler({ store, deliver, changed: state => broadcast('calendar:state-changed', state) });
    installIPC();
    await createMain();
    tray = new Tray(icon.resize({ width: 32, height: 32 }));
    tray.setToolTip('TIME³ · 方寸之间');
    tray.on('click', () => mainWindow.isVisible() ? hideMain() : showMain());
    updateTray();
    tickTimer = setInterval(()=>{tick();broadcastClock();}, 1000);
    wellnessTimer = setInterval(() => wellness.tick(), 1000);
    powerMonitor.on('resume', ()=>{tick();broadcastClock();topLayer?.refresh();}); powerMonitor.on('unlock-screen', ()=>{tick();broadcastClock();topLayer?.refresh();});
    powerMonitor.on('resume', () => wellness.tick());
    if (!smoke) await tick();
    if (!smoke) wellness.tick();
    if (smoke) await require('./smoke.cjs').run({ app, mainWindow, windows, store, tick, deliver, showMini, screen, miniController:()=>miniBehavior, wellness, advanceWellness:ms=>{wellnessClockOffset+=ms;return wellness.tick();} });
  }).catch(error => { console.error(error); app.exit(1); });
}
