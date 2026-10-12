/**
 * Audio Engine — Sons e efeitos do GameHub
 * Usa Web Audio API para gerar sons procedurais (sem arquivos externos)
 */

const AudioEngine = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function playTone(freq, duration = 0.15, type = 'sine', volume = 0.3) {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      gain.gain.setValueAtTime(volume, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(c.currentTime);
      osc.stop(c.currentTime + duration);
    } catch (e) { /* silently fail */ }
  }

  return {
    // Efeitos de UI
    click() { playTone(800, 0.08, 'sine', 0.15); },
    hover() { playTone(600, 0.05, 'sine', 0.08); },
    success() {
      playTone(523, 0.15, 'sine', 0.2);
      setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 100);
      setTimeout(() => playTone(784, 0.2, 'sine', 0.25), 200);
    },
    error() { playTone(200, 0.3, 'square', 0.15); },
    notification() {
      playTone(880, 0.1, 'sine', 0.2);
      setTimeout(() => playTone(1100, 0.15, 'sine', 0.2), 120);
    },

    // Efeitos de jogo
    tap() { playTone(400, 0.08, 'triangle', 0.25); },
    beat(freq = 200) {
      playTone(freq, 0.12, 'triangle', 0.4);
      playTone(freq * 2, 0.08, 'sine', 0.15);
    },
    countdown(n) {
      playTone(440 + n * 100, 0.2, 'sine', 0.2);
    },
    gameStart() {
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.15, 'sine', 0.25), i * 120);
      });
    },
    gameEnd() {
      [784, 659, 523, 440].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.2, 'sine', 0.2), i * 150);
      });
    },
    correct() {
      playTone(880, 0.1, 'sine', 0.2);
      setTimeout(() => playTone(1100, 0.2, 'sine', 0.25), 80);
    },
    wrong() {
      playTone(300, 0.15, 'sawtooth', 0.15);
      setTimeout(() => playTone(200, 0.3, 'sawtooth', 0.1), 100);
    },
    hit() {
      const c = getCtx();
      try {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, c.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, c.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + 0.15);
      } catch (e) {}
    },
    powerHit() {
      const c = getCtx();
      try {
        // Low thud
        const osc1 = c.createOscillator();
        const gain1 = c.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(200, c.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(50, c.currentTime + 0.2);
        gain1.gain.setValueAtTime(0.4, c.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.2);
        osc1.connect(gain1);
        gain1.connect(c.destination);
        osc1.start(c.currentTime);
        osc1.stop(c.currentTime + 0.2);
        // High ping
        const osc2 = c.createOscillator();
        const gain2 = c.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1200, c.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(800, c.currentTime + 0.1);
        gain2.gain.setValueAtTime(0.15, c.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
        osc2.connect(gain2);
        gain2.connect(c.destination);
        osc2.start(c.currentTime);
        osc2.stop(c.currentTime + 0.1);
      } catch (e) {}
    },
    explosion() {
      const c = getCtx();
      try {
        // Noise burst
        const bufSize = c.sampleRate * 0.15;
        const buf = c.createBuffer(1, bufSize, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
        const noise = c.createBufferSource();
        noise.buffer = buf;
        const nGain = c.createGain();
        nGain.gain.setValueAtTime(0.4, c.currentTime);
        nGain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
        noise.connect(nGain);
        nGain.connect(c.destination);
        noise.start(c.currentTime);
        // Deep rumble
        const osc = c.createOscillator();
        const oGain = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, c.currentTime);
        osc.frequency.exponentialRampToValueAtTime(20, c.currentTime + 0.3);
        oGain.gain.setValueAtTime(0.3, c.currentTime);
        oGain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
        osc.connect(oGain);
        oGain.connect(c.destination);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + 0.3);
      } catch (e) {}
    },
    reveal() {
      [400, 500, 600, 800].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.1, 'sine', 0.15), i * 80);
      });
    },
    tick() { playTone(1000, 0.03, 'sine', 0.1); },

    // Percussão multi-instrumentos do Ritmo
    drumKick() {
      const c = getCtx();
      try {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(36, now + 0.16);
        gain.gain.setValueAtTime(0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      } catch (e) {}
    },

    drumSnare() {
      const c = getCtx();
      try {
        const now = c.currentTime;
        // Punch tonal
        const osc = c.createOscillator();
        const oscGain = c.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.1);
        oscGain.gain.setValueAtTime(0.4, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(oscGain);
        oscGain.connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.12);

        // Estalo de ruído (Snare crack)
        const bufSize = c.sampleRate * 0.08;
        const buf = c.createBuffer(1, bufSize, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.45;
        const noise = c.createBufferSource();
        noise.buffer = buf;
        const nGain = c.createGain();
        nGain.gain.setValueAtTime(0.5, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        noise.connect(nGain);
        nGain.connect(c.destination);
        noise.start(now);
      } catch (e) {}
    },

    drumHiHat() {
      const c = getCtx();
      try {
        const now = c.currentTime;
        const bufSize = c.sampleRate * 0.045;
        const buf = c.createBuffer(1, bufSize, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.35;
        const noise = c.createBufferSource();
        noise.buffer = buf;

        // Filtro passa-alta para o estalo metálico agudo
        const filter = c.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(6500, now);

        const gain = c.createGain();
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(c.destination);
        noise.start(now);
      } catch (e) {}
    },

    drumTom() {
      const c = getCtx();
      try {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(290, now);
        osc.frequency.exponentialRampToValueAtTime(95, now + 0.18);
        gain.gain.setValueAtTime(0.55, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.2);
      } catch (e) {}
    },

    drumPlay(inst = 'kick') {
      if (inst === 'snare') this.drumSnare();
      else if (inst === 'hihat') this.drumHiHat();
      else if (inst === 'tom') this.drumTom();
      else this.drumKick();
    },

    // Compatibilidade reversa
    drumBeat(inst) {
      this.drumPlay(inst || 'kick');
    },

    // Death Ball FX
    clash() {
      const c = getCtx();
      try {
        const now = c.currentTime;
        // Punch grave
        const oscBass = c.createOscillator();
        const gainBass = c.createGain();
        oscBass.type = 'sawtooth';
        oscBass.frequency.setValueAtTime(180, now);
        oscBass.frequency.exponentialRampToValueAtTime(35, now + 0.22);
        gainBass.gain.setValueAtTime(0.4, now);
        gainBass.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        oscBass.connect(gainBass);
        gainBass.connect(c.destination);
        oscBass.start(now);
        oscBass.stop(now + 0.22);

        // Clang metálico agudo
        const oscMetal = c.createOscillator();
        const gainMetal = c.createGain();
        oscMetal.type = 'triangle';
        oscMetal.frequency.setValueAtTime(1450, now);
        oscMetal.frequency.exponentialRampToValueAtTime(920, now + 0.15);
        gainMetal.gain.setValueAtTime(0.35, now);
        gainMetal.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        oscMetal.connect(gainMetal);
        gainMetal.connect(c.destination);
        oscMetal.start(now);
        oscMetal.stop(now + 0.15);
      } catch (e) {}
    },

    whiff() {
      const c = getCtx();
      try {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.12);
      } catch (e) {}
    },

    wallBounce() {
      const c = getCtx();
      try {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.09);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.09);
      } catch (e) {}
    },

    lockOn() {
      try {
        playTone(1100, 0.06, 'sine', 0.15);
        setTimeout(() => playTone(1500, 0.08, 'sine', 0.2), 65);
      } catch (e) {}
    },

    dash() {
      const c = getCtx();
      try {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.16);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.16);
      } catch (e) {}
    },

    perfectParry() {
      const c = getCtx();
      try {
        const now = c.currentTime;
        // Thunder sub-bass
        const oscBass = c.createOscillator();
        const gainBass = c.createGain();
        oscBass.type = 'sawtooth';
        oscBass.frequency.setValueAtTime(240, now);
        oscBass.frequency.exponentialRampToValueAtTime(28, now + 0.35);
        gainBass.gain.setValueAtTime(0.5, now);
        gainBass.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        oscBass.connect(gainBass);
        gainBass.connect(c.destination);
        oscBass.start(now);
        oscBass.stop(now + 0.35);

        // Sharp bell ping
        const oscPing = c.createOscillator();
        const gainPing = c.createGain();
        oscPing.type = 'sine';
        oscPing.frequency.setValueAtTime(2200, now);
        oscPing.frequency.exponentialRampToValueAtTime(1100, now + 0.25);
        gainPing.gain.setValueAtTime(0.4, now);
        gainPing.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        oscPing.connect(gainPing);
        gainPing.connect(c.destination);
        oscPing.start(now);
        oscPing.stop(now + 0.25);
      } catch (e) {}
    },

    heartbeat() {
      try {
        playTone(90, 0.08, 'sine', 0.3);
        setTimeout(() => playTone(80, 0.08, 'sine', 0.25), 120);
      } catch (e) {}
    }
  };
})();
