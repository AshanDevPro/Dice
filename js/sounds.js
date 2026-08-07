'use strict';

(function () {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master = null;
  let effectsGain = null;
  let musicGain = null;
  let unlocked = false;
  const legacyMuted = localStorage.getItem('pignusMuted') === 'true';
  let effectsMuted = localStorage.getItem('pignusEffectsMuted') === null
    ? legacyMuted
    : localStorage.getItem('pignusEffectsMuted') === 'true';
  let musicMuted = localStorage.getItem('pignusMusicMuted') === null
    ? legacyMuted
    : localStorage.getItem('pignusMusicMuted') === 'true';
  let volume = Number(localStorage.getItem('pignusVolume') || '0.7');
  let musicTimer = null;
  let musicStep = 0;
  const effectFiles = {
    click: 'assets/audio/click.wav',
    roll: 'assets/audio/roll.wav',
    lock: 'assets/audio/lock.wav',
    yourTurn: 'assets/audio/yourTurn.wav',
    phase2: 'assets/audio/phase2.wav',
    bet: 'assets/audio/bet.wav',
    token: 'assets/audio/token.wav',
    reward: 'assets/audio/reward.wav',
    roundWin: 'assets/audio/roundWin.wav',
    roundLose: 'assets/audio/roundLose.wav',
    gameWin: 'assets/audio/gameWin.wav',
    gameLose: 'assets/audio/gameLose.wav',
  };
  const effectBuffers = {};
  const effectLoading = {};
  const effectMissing = {};

  if (!Number.isFinite(volume)) volume = 0.7;
  volume = Math.max(0, Math.min(1, volume));

  function resume() {
    if (!AudioCtor) return null;
    if (!ctx) {
      ctx = new AudioCtor();
      master = ctx.createGain();
      effectsGain = ctx.createGain();
      musicGain = ctx.createGain();
      effectsGain.connect(master);
      musicGain.connect(master);
      master.connect(ctx.destination);
      applyVolume();
    }
    if (ctx.state === 'suspended') {
      const resumed = ctx.resume();
      if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
    }
    return ctx;
  }

  function applyVolume() {
    if (!master) return;
    const t = ctx ? ctx.currentTime : 0;
    master.gain.setTargetAtTime(volume, t, 0.015);
    if (effectsGain) effectsGain.gain.setTargetAtTime(effectsMuted ? 0 : 1, t, 0.015);
    if (musicGain) musicGain.gain.setTargetAtTime(musicMuted ? 0 : 1, t, 0.015);
  }

  function destination(channel) {
    const c = resume();
    if (!c || !master) return null;
    return { c, out: channel === 'music' ? musicGain : effectsGain };
  }

  function decodeAudio(c, data) {
    return new Promise((resolve, reject) => {
      const result = c.decodeAudioData(data, resolve, reject);
      if (result && typeof result.then === 'function') result.then(resolve, reject);
    });
  }

  function loadEffect(name) {
    if (!effectFiles[name] || effectMissing[name]) return Promise.resolve(null);
    if (effectBuffers[name]) return Promise.resolve(effectBuffers[name]);
    if (effectLoading[name]) return effectLoading[name];
    const c = resume();
    if (!c || typeof fetch !== 'function') return Promise.resolve(null);
    effectLoading[name] = fetch(effectFiles[name])
      .then(response => {
        if (!response.ok) throw new Error('Sound file not found');
        return response.arrayBuffer();
      })
      .then(data => decodeAudio(c, data))
      .then(buffer => {
        effectBuffers[name] = buffer;
        return buffer;
      })
      .catch(() => {
        effectMissing[name] = true;
        return null;
      })
      .finally(() => {
        delete effectLoading[name];
      });
    return effectLoading[name];
  }

  function preloadEffects() {
    Object.keys(effectFiles).forEach(loadEffect);
  }

  function playFileEffect(name) {
    if (effectsMuted) return true;
    const audio = destination('effects');
    if (!audio) return false;
    const buffer = effectBuffers[name];
    if (!buffer) {
      loadEffect(name);
      return false;
    }
    const src = audio.c.createBufferSource();
    const g = audio.c.createGain();
    src.buffer = buffer;
    g.gain.setValueAtTime(0.95, audio.c.currentTime);
    src.connect(g);
    g.connect(audio.out);
    src.start();
    return true;
  }

  function playEffect(name, fallback) {
    if (playFileEffect(name)) return;
    if (typeof fallback === 'function') fallback();
  }

  function tone(freq, type, dur, vol, when, channel) {
    if (channel === 'music' ? musicMuted : effectsMuted) return;
    vol = vol || 0.22;
    when = when || 0;
    const audio = destination(channel);
    if (!audio) return;
    const t = audio.c.currentTime + when;
    const o = audio.c.createOscillator();
    const g = audio.c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(audio.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, when) {
    if (effectsMuted) return;
    vol = vol || 0.18;
    when = when || 0;
    const audio = destination('effects');
    if (!audio) return;
    const t = audio.c.currentTime + when;
    const n = Math.ceil(audio.c.sampleRate * dur);
    const buf = audio.c.createBuffer(1, n, audio.c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = audio.c.createBufferSource();
    const g = audio.c.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g);
    g.connect(audio.out);
    src.start(t);
  }

  function musicPhrase() {
    if (musicMuted || !unlocked) return;
    const bass = [196, 196, 220, 247][musicStep % 4];
    const lead = [392, 330, 440, 494][musicStep % 4];
    tone(bass, 'triangle', 1.2, 0.035, 0.00, 'music');
    tone(bass * 1.5, 'sine', 0.8, 0.018, 0.08, 'music');
    tone(lead, 'sine', 0.18, 0.035, 0.18, 'music');
    tone(lead * 1.25, 'sine', 0.22, 0.026, 0.54, 'music');
    musicStep++;
  }

  function startBackground() {
    if (musicMuted || musicTimer) return;
    resume();
    musicPhrase();
    musicTimer = window.setInterval(musicPhrase, 3200);
  }

  function stopBackground() {
    if (!musicTimer) return;
    window.clearInterval(musicTimer);
    musicTimer = null;
  }

  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    resume();
    preloadEffects();
    startBackground();
  }

  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
  document.addEventListener('click', event => {
    if (event.target && event.target.closest && event.target.closest('button, a, input[type="range"]')) {
      window.SFX.click();
    }
  }, true);

  window.SFX = {
    isMuted: function () { return effectsMuted && musicMuted; },
    isEffectsMuted: function () { return effectsMuted; },
    isMusicMuted: function () { return musicMuted; },
    isUnlocked: function () { return unlocked; },
    getVolume: function () { return volume; },

    setVolume: function (value) {
      const next = Math.max(0, Math.min(1, Number(value)));
      if (!Number.isFinite(next)) return volume;
      volume = next;
      localStorage.setItem('pignusVolume', String(volume));
      if (volume > 0 && effectsMuted && musicMuted) {
        effectsMuted = false;
        musicMuted = false;
        localStorage.setItem('pignusEffectsMuted', 'false');
        localStorage.setItem('pignusMusicMuted', 'false');
        localStorage.setItem('pignusMuted', 'false');
      }
      resume();
      applyVolume();
      startBackground();
      return volume;
    },

    toggleMute: function () {
      const nextMuted = !(effectsMuted && musicMuted);
      effectsMuted = nextMuted;
      musicMuted = nextMuted;
      localStorage.setItem('pignusEffectsMuted', String(effectsMuted));
      localStorage.setItem('pignusMusicMuted', String(musicMuted));
      localStorage.setItem('pignusMuted', String(nextMuted));
      resume();
      applyVolume();
      if (musicMuted) stopBackground();
      else startBackground();
      return nextMuted;
    },

    toggleEffects: function () {
      effectsMuted = !effectsMuted;
      localStorage.setItem('pignusEffectsMuted', String(effectsMuted));
      localStorage.setItem('pignusMuted', String(effectsMuted && musicMuted));
      resume();
      applyVolume();
      return effectsMuted;
    },

    toggleMusic: function () {
      musicMuted = !musicMuted;
      localStorage.setItem('pignusMusicMuted', String(musicMuted));
      localStorage.setItem('pignusMuted', String(effectsMuted && musicMuted));
      resume();
      applyVolume();
      if (musicMuted) stopBackground();
      else startBackground();
      return musicMuted;
    },

    startBackground,
    stopBackground,
    unlock: unlockAudio,

    click: function () {
      playEffect('click', function () {
        tone(820, 'triangle', 0.045, 0.055, 0.00);
        tone(1240, 'triangle', 0.055, 0.035, 0.035);
      });
    },

    roll: function () {
      playEffect('roll', function () {
        noise(0.04, 0.20, 0.00);
        noise(0.04, 0.18, 0.06);
        noise(0.04, 0.16, 0.12);
        noise(0.04, 0.14, 0.18);
      });
    },

    lock: function () {
      playEffect('lock', function () {
        tone(700, 'square', 0.06, 0.18, 0.00);
        tone(950, 'square', 0.04, 0.14, 0.05);
      });
    },

    yourTurn: function () {
      playEffect('yourTurn', function () {
        tone(880, 'sine', 0.30, 0.18, 0.00);
        tone(1100, 'sine', 0.28, 0.14, 0.09);
      });
    },

    phase2: function () {
      playEffect('phase2', function () {
        tone(440, 'sine', 0.26, 0.18, 0.00);
        tone(550, 'sine', 0.26, 0.18, 0.12);
        tone(660, 'sine', 0.32, 0.20, 0.24);
      });
    },

    bet: function () {
      playEffect('bet', function () {
        tone(1200, 'triangle', 0.14, 0.20, 0.00);
        tone(800, 'triangle', 0.18, 0.16, 0.08);
      });
    },

    token: function () {
      playEffect('token', function () {
        tone(1180, 'triangle', 0.12, 0.18, 0.00);
        tone(1480, 'triangle', 0.12, 0.14, 0.07);
        tone(1760, 'triangle', 0.16, 0.12, 0.14);
      });
    },

    reward: function () {
      playEffect('reward', function () {
        [523, 659, 784, 988].forEach(function (f, i) {
          tone(f, 'sine', 0.22, 0.18, i * 0.08);
        });
      });
    },

    roundWin: function () {
      playEffect('roundWin', function () {
        [523, 659, 784, 1047].forEach(function (f, i) {
          tone(f, 'sine', 0.28, 0.22, i * 0.10);
        });
      });
    },

    roundLose: function () {
      playEffect('roundLose', function () {
        tone(350, 'sawtooth', 0.28, 0.18, 0.00);
        tone(250, 'sawtooth', 0.32, 0.16, 0.16);
      });
    },

    gameWin: function () {
      playEffect('gameWin', function () {
        [523, 659, 784, 659, 784, 1047].forEach(function (f, i) {
          tone(f, 'sine', 0.34, 0.22, i * 0.12);
        });
      });
    },

    gameLose: function () {
      playEffect('gameLose', function () {
        [330, 294, 247].forEach(function (f, i) {
          tone(f, 'sawtooth', 0.32, 0.15, i * 0.14);
        });
      });
    },
  };
})();
