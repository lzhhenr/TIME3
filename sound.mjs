/** Small synthesized foley: local, no audio downloads or background playback. */
export function createSoundEngine(enabled = true) {
  let context, output, active = Boolean(enabled), played = 0;
  function ready() {
    if (!active) return null;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return null;
      if (!context) { context = new Audio(); output = context.createGain(); output.gain.value = .50; output.connect(context.destination); }
      if (context.state === 'suspended') context.resume().catch(() => {});
      return context;
    } catch { return null; }
  }
  function tone(from, to, length, volume, delay = 0, wave = 'sine') {
    const audio = ready(); if (!audio) return;
    const start = audio.currentTime + delay, oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = wave; oscillator.frequency.setValueAtTime(from, start); oscillator.frequency.exponentialRampToValueAtTime(Math.max(30,to), start + length);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + .006); gain.gain.exponentialRampToValueAtTime(.001, start + length);
    oscillator.connect(gain); gain.connect(output); oscillator.start(start); oscillator.stop(start + length + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); }; played++;
  }
  const engine = {
    setEnabled(value) { active = Boolean(value); if (output) output.gain.setTargetAtTime(active ? .50 : 0, context.currentTime, .01); },
    unlock: ready,
    click() { tone(640, 390, .065, .20); },
    roll(step = 0) { tone(195 + step % 3 * 25, 90, .075, .28, 0, 'sine'); tone(880, 600, .025, .055); },
    jump() { tone(210, 530, .19, .18); },
    land() { tone(180, 70, .12, .25); },
    notify() { tone(660, 680, .17, .17); tone(880, 900, .24, .14, .11); },
    acknowledge() { tone(720, 740, .12, .19); tone(1060, 1080, .20, .16, .08); },
    getState: () => ({ enabled: active, played, contextState: context?.state || 'uninitialized' }),
    dispose() { context?.close().catch(() => {}); },
  };
  return engine;
}
