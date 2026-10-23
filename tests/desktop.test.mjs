import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { DAY, validateState, dueReminders, createStore, createScheduler } = require('../electron/state.cjs');
const { trustedPage, assertSender } = require('../electron/security.cjs');
const base = () => ({ settings: { motion: 'roll', city: '厦门' }, reminders: [{ id: 'a', date: '2026-10-22', time: '10:00', title: '设计评审', done: false }] });
function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'time3-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'state.json');
  return { filename, store: createStore(filename) };
}
test('state validates real calendar dates, times, titles, duplicate IDs and settings', () => {
  for (const change of [r => r.date = '2026-02-30', r => r.time = '24:00', r => r.title = ' ', r => r.id = '../../file', r => r.done = 1]) {
    const data = base(); change(data.reminders[0]); assert.throws(() => validateState(data));
  }
  const duplicate = base(); duplicate.reminders.push({ ...duplicate.reminders[0] }); assert.throws(() => validateState(duplicate));
  const invalid = base(); invalid.settings.alwaysOnTop = 'yes'; assert.throws(() => validateState(invalid));
  assert.equal(validateState(base()).settings.miniMode, false);
});
test('scheduler catches up only 24h, ignores future, done, and delivered reminders', () => {
  const state = base(); const current = new Date('2026-10-22T10:00:00');
  assert.equal(dueReminders(state, current).length, 1);
  assert.equal(dueReminders(state, new Date(current.getTime() - 1)).length, 0);
  assert.equal(dueReminders(state, new Date(current.getTime() + DAY)).length, 1);
  assert.equal(dueReminders(state, new Date(current.getTime() + DAY + 1)).length, 0);
  state.reminders[0].done = true; assert.equal(dueReminders(state, current).length, 0);
  state.reminders[0].done = false; state.reminders[0].notifiedAt = current.toISOString(); assert.equal(dueReminders(state, current).length, 0);
});

test('old saved settings migrate without losing reminders or enabling location', t => {
  const { filename } = tempStore(t);
  fs.writeFileSync(filename, JSON.stringify(base()));
  const state = createStore(filename).get();
  assert.deepEqual(state.reminders, base().reminders);
  assert.equal(state.settings.useLocation, false);
  assert.equal(state.settings.language, 'zh');
  assert.equal(state.settings.palette, 'butter');
  assert.equal(state.settings.bgEnabled, true);
  assert.equal(state.settings.bgOpacity, .92);
  assert.equal(state.settings.textMode, 'dark');
  assert.equal(state.settings.soundEnabled, true);
  assert.equal(state.settings.windowPosition, 'center');
  assert.equal(state.settings.sedentaryEnabled, false);
  assert.equal(state.settings.eyeEnabled, false);
});

test('appearance and language settings persist and reject invalid values', t => {
  const { filename, store } = tempStore(t);
  const state = base();
  Object.assign(state.settings, { palette: 'garden', language: 'en', bgEnabled: false, bgColor: '#354968', bgOpacity: .37, useLocation: true });
  const saved = store.save(state);
  assert.equal(saved.settings.palette, 'rose');
  assert.deepEqual(createStore(filename).get().settings, saved.settings);
  for (const patch of [{ palette: 'unknown' }, { language: 'xx' }, { bgEnabled: 0 }, { useLocation: 'yes' }, { bgColor: 'red' }, { bgOpacity: -1 }, { bgOpacity: 1.1 }, { bgOpacity: NaN }]) {
    assert.throws(() => validateState({ ...state, settings: { ...state.settings, ...patch } }));
  }
  for (const opacity of [0, 1]) assert.equal(validateState({ ...state, settings: { ...state.settings, bgOpacity: opacity } }).settings.bgOpacity, opacity);
});

test('new settings validate supported health intervals, positions, text modes and migrated palettes', () => {
  const state = base();
  for (const [legacy, current] of Object.entries({ macaron: 'butter', garden: 'rose', dusk: 'lavender' })) {
    assert.equal(validateState({ ...state, settings: { ...state.settings, palette: legacy } }).settings.palette, current);
  }
  for (const patch of [{ soundEnabled: 'yes' }, { textMode: 'auto' }, { windowPosition: 'left' }, { sedentaryEnabled: 1 }, { sedentaryMinutes: 20 }, { eyeEnabled: 'false' }, { eyeMinutes: 60 }]) {
    assert.throws(() => validateState({ ...state, settings: { ...state.settings, ...patch } }));
  }
  for (const windowPosition of ['center', 'top-left', 'bottom-left', 'top-right', 'bottom-right']) {
    const settings = validateState({ ...state, settings: { ...state.settings, windowPosition, textMode: 'dark', palette: 'lavender', soundEnabled: false, sedentaryEnabled: true, sedentaryMinutes: 60, eyeEnabled: true, eyeMinutes: 30 } }).settings;
    assert.equal(settings.windowPosition, windowPosition);
    assert.equal(settings.sedentaryMinutes, 60);
    assert.equal(settings.eyeMinutes, 30);
  }
});
test('atomic store survives restart and stale UI cannot replay an already delivered reminder', t => {
  const { filename, store } = tempStore(t); assert.equal(store.get(), null);
  const stale = base(); store.save(stale); const now = new Date('2026-10-22T10:00:00');
  store.markDelivered(stale.reminders[0], now); store.save(stale);
  assert.equal(createStore(filename).get().reminders[0].notifiedAt, now.toISOString());
  stale.reminders[0].time = '11:00'; store.save(stale); assert.equal(store.get().reminders[0].notifiedAt, undefined);
  assert.deepEqual(fs.readdirSync(path.dirname(filename)), ['state.json']);
});
test('renderer cannot inject delivered markers; unchanged markers persist and rescheduled items rearm', t => {
  const { store } = tempStore(t); const input = base(); input.reminders[0].notifiedAt = new Date().toISOString();
  assert.equal(store.save(input).reminders[0].notifiedAt, undefined);
  const now = new Date('2026-10-22T10:00:00'); store.markDelivered(input.reminders[0], now);
  input.reminders[0].title = '修改后的会议'; assert.equal(store.save(input).reminders[0].notifiedAt, now.toISOString());
  input.reminders[0].date = '2026-10-23'; assert.equal(store.save(input).reminders[0].notifiedAt, undefined);
});
test('corrupted state is preserved for recovery', t => {
  const { filename } = tempStore(t); fs.writeFileSync(filename, '{broken');
  assert.equal(createStore(filename).get(), null);
  const backup = fs.readdirSync(path.dirname(filename)).find(name => name.startsWith('state.json.corrupt-'));
  assert.ok(backup); assert.equal(fs.readFileSync(path.join(path.dirname(filename), backup), 'utf8'), '{broken');
});
test('concurrent ticks dispatch once and failed delivery is retried', async t => {
  const { store } = tempStore(t); store.save(base()); let count = 0;
  const tick = createScheduler({ store, clock: () => new Date('2026-10-22T10:01:00'), deliver: async () => { count++; await new Promise(resolve => setTimeout(resolve, 8)); if (count === 1) throw new Error('Popup failed'); } });
  await Promise.all([tick(), tick()]); assert.equal(count, 1); assert.equal(store.get().reminders[0].notifiedAt, undefined);
  await tick(); await tick(); assert.equal(count, 2); assert.ok(store.get().reminders[0].notifiedAt);
});
test('editing a reminder during delivery does not overwrite newer state', async t => {
  const { store } = tempStore(t); store.save(base());
  const tick = createScheduler({ store, clock: () => new Date('2026-10-22T10:01:00'), deliver: async () => { const changed = store.get(); changed.reminders[0].time = '11:00'; store.save(changed); } });
  await tick(); assert.equal(store.get().reminders[0].time, '11:00'); assert.equal(store.get().reminders[0].notifiedAt, undefined);
});

test('skipped queued reminder is not recorded as delivered', async t => {
  const { store } = tempStore(t); store.save(base());
  const tick = createScheduler({ store, clock: () => new Date('2026-10-22T10:01:00'), deliver: async () => false });
  await tick();
  assert.equal(store.get().reminders[0].notifiedAt, undefined);
});
test('IPC rejects remote pages, sibling files, subframes, unknown windows and wrong roles', () => {
  const index = path.resolve('index.html'); const url = pathToFileURL(index).href;
  assert.equal(trustedPage(`${url}?mode=mini`, index), true);
  assert.equal(trustedPage('https://example.com/index.html', index), false);
  assert.equal(trustedPage(pathToFileURL(path.resolve('elsewhere/index.html')).href, index), false);
  const frame = { url }, sender = { id: 1, mainFrame: frame }, event = { sender, senderFrame: frame };
  const known = new Map([[1, { win: { isDestroyed: () => false }, role: 'mini' }]]);
  assert.doesNotThrow(() => assertSender(event, known, index, ['mini']));
  assert.throws(() => assertSender(event, known, index, ['main']));
  assert.throws(() => assertSender({ ...event, senderFrame: { url } }, known, index, ['mini']));
  assert.throws(() => assertSender(event, new Map(), index, ['mini']));
});
