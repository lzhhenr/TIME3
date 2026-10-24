const fs = require('node:fs');
const path = require('node:path');

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_SETTINGS = Object.freeze({ motion: 'roll', alwaysOnTop: false, miniMode: false, city: '厦门', palette: 'butter', blockShape: 'classic', language: 'en', useLocation: false, bgEnabled: true, bgColor: '#f0e9e2', bgOpacity: 0.92, textMode: 'dark', soundEnabled: true, windowPosition: 'center', sedentaryEnabled: false, sedentaryMinutes: 30, eyeEnabled: false, eyeMinutes: 20, codexEnabled:false, codexMinutes:300 });
const LEGACY_PALETTES = Object.freeze({ macaron: 'butter', garden: 'rose', dusk: 'lavender' });
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
function dateIsValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return year >= 2020 && year <= 2200 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
function timeIsValid(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validateState(input, previous = null, trusted = false) {
  if (!isRecord(input) || !Array.isArray(input.reminders) || input.reminders.length > 2000 || !isRecord(input.settings)) throw new Error('日历数据格式无效');
  const old = new Map((previous?.reminders || []).map(r => [r.id, r]));
  const ids = new Set();
  const reminders = input.reminders.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^[\w-]{1,100}$/.test(item.id) || ids.has(item.id) || !dateIsValid(item.date) || !timeIsValid(item.time) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300 || typeof item.done !== 'boolean') throw new Error('提醒日期、时间或内容无效');
    ids.add(item.id);
    const clean = { id: item.id, date: item.date, time: item.time, title: item.title.trim(), done: item.done };
    const earlier = old.get(item.id);
    const marker = trusted ? item.notifiedAt : earlier?.date === item.date && earlier?.time === item.time ? earlier.notifiedAt : undefined;
    if (typeof marker === 'string' && Number.isFinite(Date.parse(marker))) clean.notifiedAt = marker;
    return clean;
  });
  const s = input.settings;
  if (s.motion !== undefined && !['roll', 'smooth'].includes(s.motion)) throw new Error('提醒动画无效');
  if (s.alwaysOnTop !== undefined && typeof s.alwaysOnTop !== 'boolean') throw new Error('置顶设置无效');
  if (s.miniMode !== undefined && typeof s.miniMode !== 'boolean') throw new Error('悬浮方块设置无效');
  if (s.city !== undefined && (typeof s.city !== 'string' || !s.city.trim() || s.city.length > 80)) throw new Error('城市设置无效');
  if(s.blockShape!==undefined&&!['classic','slab'].includes(s.blockShape))throw new Error('方块造型无效');
  if (s.palette !== undefined && !['butter', 'rose', 'lavender', 'monochrome', 'green', 'klein', ...Object.keys(LEGACY_PALETTES)].includes(s.palette)) throw new Error('配色预设无效');
  if (s.language !== undefined && !['zh', 'en'].includes(s.language)) throw new Error('语言设置无效');
  for (const key of ['useLocation', 'bgEnabled', 'soundEnabled', 'sedentaryEnabled', 'eyeEnabled','codexEnabled']) if (s[key] !== undefined && typeof s[key] !== 'boolean') throw new Error('设置值无效');
  if (s.bgColor !== undefined && (typeof s.bgColor !== 'string' || !/^#[a-f\d]{6}$/i.test(s.bgColor))) throw new Error('背景颜色无效');
  if (s.bgOpacity !== undefined && (typeof s.bgOpacity !== 'number' || !Number.isFinite(s.bgOpacity) || s.bgOpacity < 0 || s.bgOpacity > 1)) throw new Error('背景透明度无效');
  if (s.textMode !== undefined && !['light', 'dark'].includes(s.textMode)) throw new Error('文字颜色无效');
  if (s.windowPosition !== undefined && !['center', 'top-left', 'bottom-left', 'top-right', 'bottom-right'].includes(s.windowPosition)) throw new Error('界面位置无效');
  if (s.sedentaryMinutes !== undefined && ![30, 60].includes(s.sedentaryMinutes)) throw new Error('久坐提醒间隔无效');
  if (s.eyeMinutes !== undefined && ![20, 30].includes(s.eyeMinutes)) throw new Error('远眺提醒间隔无效');
  if(s.codexMinutes!==undefined&&s.codexMinutes!==300)throw new Error('Codex interval is fixed at 5 hours');
  const clean = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) clean[key] = s[key] ?? DEFAULT_SETTINGS[key];
  clean.palette = LEGACY_PALETTES[clean.palette] || clean.palette;
  clean.city = clean.city.trim();
  return { reminders, settings: clean };
}
function dueReminders(state, now = new Date()) {
  const current = now.getTime();
  return (state?.reminders || []).filter(r => {
    if (r.done || r.notifiedAt || !dateIsValid(r.date) || !timeIsValid(r.time)) return false;
    const stamp = new Date(`${r.date}T${r.time}:00`).getTime();
    return stamp <= current && current - stamp <= DAY;
  }).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}
function createStore(filename) {
  let state = null;
  if (fs.existsSync(filename)) {
    try { state = validateState(JSON.parse(fs.readFileSync(filename, 'utf8')), null, true); }
    catch (error) {
      // Keep damaged data recoverable instead of silently overwriting it.
      fs.renameSync(filename, `${filename}.corrupt-${Date.now()}`);
      console.error('State was corrupt; preserved a backup:', error.message);
    }
  }
  function commit(next) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temp = `${filename}.${process.pid}.tmp`;
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(next, null, 2), 'utf8'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, filename);
    state = next;
    return structuredClone(state);
  }
  return {
    get: () => state ? structuredClone(state) : null,
    save: input => commit(validateState(input, state)),
    markDelivered: (reminder, now) => {
      if (!state) return null;
      const next = structuredClone(state);
      const item = next.reminders.find(r => r.id === reminder.id && r.date === reminder.date && r.time === reminder.time);
      if (!item || item.done || item.notifiedAt) return state;
      item.notifiedAt = now.toISOString();
      return commit(next);
    },
  };
}
function createScheduler({ store, deliver, changed = () => {}, clock = () => new Date() }) {
  let running = false;
  return async function tick() {
    if (running) return;
    running = true;
    try {
      for (const reminder of dueReminders(store.get(), clock())) {
        // Re-check after an asynchronous popup in case a user changed this reminder.
        const current = dueReminders(store.get(), clock()).find(r => r.id === reminder.id && r.date === reminder.date && r.time === reminder.time);
        if (!current) continue;
        try {
          if (await deliver(current) === false) continue;
          changed(store.markDelivered(current, clock()));
        } catch (error) { console.error('Reminder delivery failed; will retry:', error.message); }
      }
    } finally { running = false; }
  };
}
module.exports = { DAY, DEFAULT_SETTINGS, dateIsValid, timeIsValid, validateState, dueReminders, createStore, createScheduler };
