const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const KINDS = ['sedentary', 'eye', 'codex'];
const MINUTE = 60 * 1000;
const DEFAULT_MINUTES = { sedentary: 30, eye: 20, codex: 300 };
const ALLOWED_MINUTES = { sedentary: [30, 60], eye: [20, 30], codex: [300] };
const COPY = {
  zh: {
    codex: 'codex复活，继续创造。',
    sedentary: '起身活动，舒展片刻；让身体与心情一起轻松。',
    eye: '用眼有度，光明在前；远眺片刻，视界清晰。',
  },
  en: {
    codex: 'Codex is back. Time to create again.',
    sedentary: 'Stand up, stretch a little, and give your body a refreshing break.',
    eye: 'Rest your eyes. Look into the distance and give your vision a moment to refresh.',
  },
};

const validKind = kind => KINDS.includes(kind);
const asTime = value => value instanceof Date ? value.getTime() : Number(value);
const pad = value => String(value).padStart(2, '0');
function makeWellnessReminder(kind, settings = {}, now = new Date(), id = `wellness-${kind}-${randomUUID()}`) {
  if (!validKind(kind)) throw new Error('Unknown wellness reminder');
  const date = now instanceof Date ? now : new Date(now);
  const language = settings.language === 'en' ? 'en' : 'zh';
  return {
    kind: 'wellness', wellnessType: kind, id,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    title: COPY[language][kind],
  };
}

const emptyTimer = kind => ({ enabled: false, minutes: DEFAULT_MINUTES[kind], dueAt: null, pending: null });
function readTimers(filename) {
  const fresh = () => Object.fromEntries(KINDS.map(kind => [kind, emptyTimer(kind)]));
  if (!filename || !fs.existsSync(filename)) return fresh();
  try {
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (data.version !== 1 || !data.timers) throw new Error('Invalid wellness state');
    const timers = fresh();
    for (const kind of KINDS) {
      const timer = data.timers[kind];
      if(!timer && kind==='codex')continue;
      if (!timer || typeof timer.enabled !== 'boolean' || !ALLOWED_MINUTES[kind].includes(timer.minutes)) throw new Error('Invalid wellness timer');
      if (timer.dueAt !== null && (!Number.isFinite(timer.dueAt) || timer.dueAt < 0)) throw new Error('Invalid wellness due date');
      if (timer.pending !== null && (!timer.pending || typeof timer.pending.id !== 'string' || !/^wellness-[\w-]{1,120}$/.test(timer.pending.id) || !Number.isFinite(timer.pending.raisedAt) || timer.pending.raisedAt < 0)) throw new Error('Invalid wellness acknowledgement');
      if (!timer.enabled && (timer.dueAt !== null || timer.pending !== null)) throw new Error('Disabled wellness timer has active state');
      timers[kind] = { enabled: timer.enabled, minutes: timer.minutes, dueAt: timer.pending ? null : timer.dueAt, pending: timer.pending ? { id: timer.pending.id, raisedAt: timer.pending.raisedAt } : null };
    }
    return timers;
  } catch (error) {
    // Retain bad timer data for diagnosis without affecting calendar reminders.
    fs.renameSync(filename, `${filename}.corrupt-${Date.now()}`);
    console.error('Wellness timer data was corrupt; kept a backup:', error.message);
    return fresh();
  }
}

function createWellness({ getSettings, deliver, filename, onChange = () => {}, clock = () => new Date() }) {
  if (typeof getSettings !== 'function' || typeof deliver !== 'function') throw new Error('Wellness controller needs settings and delivery functions');
  let timers = readTimers(filename);
  const delivered = new Set();
  const inFlight = new Map();

  const now = () => {
    const stamp = asTime(clock());
    if (!Number.isFinite(stamp) || stamp < 0) throw new Error('Invalid wellness clock');
    return stamp;
  };
  function getStatus() {
    const stamp = now();
    return Object.fromEntries(KINDS.map(kind => {
      const timer = timers[kind];
      return [kind, {
        enabled: timer.enabled, minutes: timer.minutes,
        phase: !timer.enabled ? 'off' : timer.pending ? 'awaiting' : 'counting',
        dueAt: timer.dueAt,
        remainingMs: timer.enabled && !timer.pending && timer.dueAt !== null ? Math.max(0, timer.dueAt - stamp) : null,
        pending: Boolean(timer.pending), pendingId: timer.pending?.id || null, raisedAt: timer.pending?.raisedAt ?? null,
      }];
    }));
  }
  function commit() {
    if (filename) {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const temp = `${filename}.${process.pid}.tmp`;
      const fd = fs.openSync(temp, 'w', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ version: 1, timers }, null, 2), 'utf8');
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(temp, filename);
    }
    onChange(getStatus());
  }
  function isPending(kind, id) {
    if (!validKind(kind)) return false;
    const timer = timers[kind];
    // Check live settings as well: queued popups must stop being valid as soon as disabled.
    const settings = getSettings() || {};
    return settings[`${kind}Enabled`] === true && timer.enabled && Boolean(timer.pending) && (id === undefined || timer.pending.id === id) && (settings[`${kind}Minutes`] ?? DEFAULT_MINUTES[kind]) === timer.minutes;
  }
  function syncSettings() {
    const settings = getSettings() || {};
    const stamp = now();
    let changed = false;
    for (const kind of KINDS) {
      const enabled = settings[`${kind}Enabled`] === true;
      const rawMinutes = settings[`${kind}Minutes`];
      const minutes = ALLOWED_MINUTES[kind].includes(rawMinutes) ? rawMinutes : DEFAULT_MINUTES[kind];
      const timer = timers[kind];
      if (enabled !== timer.enabled || minutes !== timer.minutes || (enabled && !timer.pending && timer.dueAt === null)) {
        if (timer.pending) delivered.delete(timer.pending.id);
        timers[kind] = { enabled, minutes, dueAt: enabled ? stamp + minutes * MINUTE : null, pending: null };
        changed = true;
      }
    }
    if (changed) commit();
    return getStatus();
  }
  async function dispatch(kind, id) {
    if (!isPending(kind, id) || delivered.has(id)) return false;
    if (inFlight.has(id)) return inFlight.get(id);
    const reminder = makeWellnessReminder(kind, getSettings() || {}, new Date(timers[kind].pending.raisedAt), id);
    const pending = Promise.resolve().then(async () => {
      try {
        if (!isPending(kind, id)) return false;
        const shown = await deliver(reminder);
        if (shown === false) return false;
        if (isPending(kind, id)) delivered.add(id);
        return true;
      } catch (error) {
        console.error('Wellness reminder delivery failed; will retry:', error.message);
        return false;
      } finally { inFlight.delete(id); }
    });
    inFlight.set(id, pending);
    return pending;
  }
  async function tick() {
    syncSettings();
    const stamp = now();
    let changed = false;
    for (const kind of KINDS) {
      const timer = timers[kind];
      if (timer.enabled && !timer.pending && timer.dueAt !== null && timer.dueAt <= stamp) {
        timer.pending = { id: `wellness-${kind}-${randomUUID()}`, raisedAt: stamp };
        timer.dueAt = null;
        changed = true;
      }
    }
    if (changed) commit();
    // Both clocks can reach their deadline while a previous native popup occupies the queue.
    await Promise.all(KINDS.map(kind => timers[kind].pending ? dispatch(kind, timers[kind].pending.id) : false));
    return getStatus();
  }
  function acknowledge(kind, id) {
    syncSettings();
    if (!isPending(kind, id)) return false;
    const timer = timers[kind];
    delivered.delete(timer.pending.id);
    timer.pending = null;
    timer.dueAt = now() + timer.minutes * MINUTE;
    commit();
    return true;
  }
  async function redisplay(kind) {
    syncSettings();
    if (!isPending(kind)) return false;
    const id = timers[kind].pending.id;
    if (inFlight.has(id)) return false;
    delivered.delete(id);
    return dispatch(kind, id);
  }

  syncSettings();
  return { syncSettings, tick, acknowledge, isPending, getStatus, redisplay };
}

module.exports = { createWellness, makeWellnessReminder, MINUTE };
