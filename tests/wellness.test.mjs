import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWellness, makeWellnessReminder, MINUTE } = require('../electron/wellness.cjs');

function setup(options = {}) {
  let stamp = new Date('2026-10-23T10:00:00').getTime();
  const settings = { language: 'zh', sedentaryEnabled: false, sedentaryMinutes: 30, eyeEnabled: false, eyeMinutes: 20, ...options.settings };
  const shown = [], changes = [];
  const args = { getSettings: () => settings, clock: () => new Date(stamp), deliver: async item => { shown.push(item); return true; }, onChange: status => changes.push(status), ...options, settings: undefined };
  return { settings, shown, changes, args, controller: createWellness(args), advance: milliseconds => { stamp += milliseconds; }, now: () => stamp };
}

test('health clocks stay off by default and enabling one starts a full interval', async () => {
  const fixture = setup(); const { controller, advance, settings, shown } = fixture;
  advance(90 * MINUTE); await controller.tick();
  assert.equal(shown.length, 0);
  assert.equal(controller.getStatus().sedentary.phase, 'off');
  settings.sedentaryEnabled = true; controller.syncSettings();
  assert.equal(controller.getStatus().sedentary.remainingMs, 30 * MINUTE);
  advance(30 * MINUTE - 1); await controller.tick(); assert.equal(shown.length, 0);
  advance(1); await controller.tick(); assert.equal(shown.length, 1);
  assert.equal(shown[0].wellnessType, 'sedentary');
  assert.equal(controller.getStatus().sedentary.phase, 'awaiting');
});

test('pending reminder never repeats or restarts until explicit acknowledgement', async () => {
  const { controller, shown, advance, now } = setup({ settings: { eyeEnabled: true } });
  advance(20 * MINUTE); await controller.tick(); const first = shown[0];
  advance(90 * MINUTE); await controller.tick(); await controller.tick();
  assert.equal(shown.length, 1);
  assert.equal(controller.isPending('eye', first.id), true);
  assert.equal(controller.getStatus().eye.dueAt, null);
  assert.equal(controller.acknowledge('eye', 'stale-id'), false);
  assert.equal(controller.acknowledge('eye', first.id), true);
  assert.equal(controller.getStatus().eye.dueAt, now() + 20 * MINUTE);
  assert.equal(controller.acknowledge('eye', first.id), false);
  advance(20 * MINUTE - 1); await controller.tick(); assert.equal(shown.length, 1);
  advance(1); await controller.tick(); assert.equal(shown.length, 2);
  assert.notEqual(shown[1].id, first.id);
});

test('automatically expired pending reminder can be deliberately redisplayed without resetting its clock', async () => {
  const { controller, shown, advance } = setup({ settings: { eyeEnabled: true } });
  advance(20 * MINUTE); await controller.tick(); const pending = controller.getStatus().eye;
  assert.equal(await controller.redisplay('eye'), true);
  assert.equal(shown.length, 2); assert.equal(shown[1].id, shown[0].id);
  assert.deepEqual(controller.getStatus().eye, pending);
  assert.equal(await controller.redisplay('sedentary'), false);
});

test('disabling or changing an interval invalidates queued reminders and restarts only enabled timers', async () => {
  const { controller, shown, advance, settings } = setup({ settings: { eyeEnabled: true } });
  advance(20 * MINUTE); await controller.tick(); const first = shown[0];
  settings.eyeEnabled = false;
  assert.equal(controller.isPending('eye', first.id), false);
  controller.syncSettings(); assert.equal(controller.getStatus().eye.phase, 'off');
  advance(60 * MINUTE); await controller.tick(); assert.equal(shown.length, 1);
  settings.eyeEnabled = true; controller.syncSettings();
  assert.equal(controller.getStatus().eye.remainingMs, 20 * MINUTE);
  advance(20 * MINUTE); await controller.tick(); const second = shown[1];
  settings.eyeMinutes = 30;
  assert.equal(controller.isPending('eye', second.id), false);
  controller.syncSettings();
  assert.equal(controller.getStatus().eye.remainingMs, 30 * MINUTE);
  assert.equal(controller.getStatus().eye.pending, false);
});

test('language and appearance changes do not reset active clocks', async () => {
  const { controller, settings, advance, shown } = setup({ settings: { sedentaryEnabled: true } });
  advance(10 * MINUTE); settings.language = 'en'; settings.palette = 'rose'; controller.syncSettings();
  assert.equal(controller.getStatus().sedentary.remainingMs, 20 * MINUTE);
  advance(20 * MINUTE); await controller.tick();
  assert.match(shown[0].title, /Stand up/);
});

test('a blocked delivery cannot prevent the other clock from reaching pending status', async () => {
  const callbacks = [], shown = [];
  const { controller, advance } = setup({ settings: { sedentaryEnabled: true, eyeEnabled: true, eyeMinutes: 30 }, deliver: item => { shown.push(item); return new Promise(resolve => callbacks.push(resolve)); } });
  advance(30 * MINUTE);
  const firstTick = controller.tick();
  await Promise.resolve();
  assert.equal(controller.getStatus().sedentary.pending, true);
  assert.equal(controller.getStatus().eye.pending, true);
  assert.equal(shown.length, 2);
  const secondTick = controller.tick(); await Promise.resolve(); assert.equal(shown.length, 2);
  callbacks.forEach(resolve => resolve(true)); await Promise.all([firstTick, secondTick]);
  await controller.tick(); assert.equal(shown.length, 2);
});

test('failed delivery retries without creating duplicate reminder identities', async () => {
  const calls = [];
  const { controller, advance } = setup({ settings: { eyeEnabled: true }, deliver: async item => { calls.push(item); return calls.length > 1; } });
  advance(20 * MINUTE); await controller.tick(); await controller.tick(); await controller.tick();
  assert.equal(calls.length, 2); assert.equal(calls[0].id, calls[1].id);
});

test('stale delivery completion cannot consume a newly scheduled reminder', async () => {
  let finish;
  const { controller, advance, settings } = setup({ settings: { eyeEnabled: true }, deliver: () => new Promise(resolve => { finish = resolve; }) });
  advance(20 * MINUTE); const work = controller.tick(); await Promise.resolve();
  settings.eyeEnabled = false; controller.syncSettings();
  settings.eyeEnabled = true; controller.syncSettings();
  finish(true); await work;
  assert.equal(controller.getStatus().eye.phase, 'counting');
  assert.equal(controller.getStatus().eye.remainingMs, 20 * MINUTE);
});

test('durable timers retain deadlines and restore unacknowledged reminders on restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'time3-wellness-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'wellness-state.json');
  const { controller, args, advance, shown } = setup({ filename, settings: { eyeEnabled: true } });
  const dueAt = controller.getStatus().eye.dueAt;
  advance(8 * MINUTE); const reopened = createWellness(args);
  assert.equal(reopened.getStatus().eye.dueAt, dueAt);
  assert.equal(reopened.getStatus().eye.remainingMs, 12 * MINUTE);
  advance(12 * MINUTE); await reopened.tick(); const id = shown[0].id;
  const restartedPending = createWellness(args); await restartedPending.tick();
  assert.equal(shown.length, 2); assert.equal(shown[1].id, id);
  await restartedPending.tick(); assert.equal(shown.length, 2);
  restartedPending.acknowledge('eye', id);
  assert.equal(createWellness(args).getStatus().eye.phase, 'counting');
  assert.deepEqual(fs.readdirSync(dir), ['wellness-state.json']);
});

test('overdue timers catch up once after sleep instead of queuing every elapsed interval', async () => {
  const { controller, advance, shown } = setup({ settings: { eyeEnabled: true } });
  advance(8 * 60 * MINUTE); await controller.tick(); await controller.tick();
  assert.equal(shown.length, 1);
  assert.equal(controller.getStatus().eye.phase, 'awaiting');
});

test('preview copy uses the requested exact Chinese eye message and localized reminder shape', () => {
  const eye = makeWellnessReminder('eye', { language: 'zh' }, new Date('2026-10-23T09:08:00'), 'preview-eye');
  assert.deepEqual(eye, { kind: 'wellness', wellnessType: 'eye', id: 'preview-eye', date: '2026-10-23', time: '09:08', title: '用眼有度，光明在前；远眺片刻，视界清晰。' });
  assert.match(makeWellnessReminder('eye', { language: 'en' }).title, /Rest your eyes/);
  assert.throws(() => makeWellnessReminder('other', {}));
});
test('Codex starts a fixed five-hour cycle and acknowledgement restarts it',async()=>{
 const {controller,shown,advance}=setup({settings:{codexEnabled:true}});
 advance(299*MINUTE);await controller.tick();assert.equal(shown.length,0);
 advance(MINUTE);await controller.tick();assert.equal(shown[0].wellnessType,'codex');
 assert.equal(controller.acknowledge('codex',shown[0].id),true);assert.equal(controller.getStatus().codex.remainingMs,300*MINUTE);
});
