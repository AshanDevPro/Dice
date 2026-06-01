'use strict';
(function () {
  let ctx = null;
  let muted = localStorage.getItem('pignusMuted') === 'true';

  function resume() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, type, dur, vol, when) {
    if (muted) return;
    vol  = vol  || 0.22;
    when = when || 0;
    const c = resume();
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.01);
  }

  function noise(dur, vol, when) {
    if (muted) return;
    vol  = vol  || 0.18;
    when = when || 0;
    const c = resume();
    const t = c.currentTime + when;
    const n = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g);
    g.connect(c.destination);
    src.start(t);
  }

  window.SFX = {
    isMuted: function () { return muted; },

    toggleMute: function () {
      muted = !muted;
      localStorage.setItem('pignusMuted', String(muted));
      return muted;
    },

    // Dice tumbling
    roll: function () {
      noise(0.04, 0.20, 0.00);
      noise(0.04, 0.18, 0.06);
      noise(0.04, 0.16, 0.12);
      noise(0.04, 0.14, 0.18);
    },

    // Satisfying snap when a die is locked
    lock: function () {
      tone(700, 'square', 0.06, 0.18, 0.00);
      tone(950, 'square', 0.04, 0.14, 0.05);
    },

    // Notification ping — it's your turn
    yourTurn: function () {
      tone(880,  'sine', 0.30, 0.18, 0.00);
      tone(1100, 'sine', 0.28, 0.14, 0.09);
    },

    // Phase 2 fanfare
    phase2: function () {
      tone(440, 'sine', 0.26, 0.18, 0.00);
      tone(550, 'sine', 0.26, 0.18, 0.12);
      tone(660, 'sine', 0.32, 0.20, 0.24);
    },

    // Coin clink for betting
    bet: function () {
      tone(1200, 'triangle', 0.14, 0.20, 0.00);
      tone(800,  'triangle', 0.18, 0.16, 0.08);
    },

    // Round win jingle
    roundWin: function () {
      var notes = [523, 659, 784, 1047];
      notes.forEach(function (f, i) { tone(f, 'sine', 0.28, 0.22, i * 0.10); });
    },

    // Round loss blip
    roundLose: function () {
      tone(350, 'sawtooth', 0.28, 0.18, 0.00);
      tone(250, 'sawtooth', 0.32, 0.16, 0.16);
    },

    // Game over — winner fanfare
    gameWin: function () {
      var notes = [523, 659, 784, 659, 784, 1047];
      notes.forEach(function (f, i) { tone(f, 'sine', 0.34, 0.22, i * 0.12); });
    },
  };
})();
