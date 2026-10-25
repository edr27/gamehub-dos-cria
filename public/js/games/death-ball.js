/**
 * Death Ball v2 — cliente
 *
 * Rede:
 *  - Relógio sincronizado com o servidor (ping/pong, menor RTT vence).
 *  - A bola é PREVISTA com a mesma física do servidor (deathball/shared.js) até o "agora" do
 *    servidor; correções chegam a 30 Hz e são suavizadas (sem teleporte).
 *  - Adversários são interpolados ~70 ms no passado (movimento liso mesmo com jitter).
 *  - Parry é julgado pelo servidor no instante do clique (compensação de lag) e mostrado na
 *    hora aqui (feedback otimista + hitstop enquanto a confirmação chega).
 *
 * Input: e.code (independe de layout/Shift), sem auto-repeat, teclas zeradas ao perder foco,
 * um único handler por botão (pointerdown), botões nunca recebem foco, número de sequência
 * para o servidor descartar duplicados.
 *
 * Render: 1 loop rAF, arena pré-renderizada, brilhos via sprites (sem shadowBlur), pools sem
 * alocação, HUD em DOM só atualizado quando muda, qualidade automática se o FPS cair.
 */
(() => {
  'use strict';
  const { socket, DOM } = GameHub;
  const S = window.DeathBallShared;
  if (!S) { console.error('[DeathBall] shared.js não carregado'); return; }
  const { C, PHASE, EV } = S;
  const esc = (t) => GameHub.escapeHtml(String(t == null ? '' : t));

  const SUB_DT = 1 / (C.TICK_HZ * C.SUB_STEPS);
  const SUB_MS = SUB_DT * 1000;
  const INTERP_MS = 75;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const EMOTES = ['😂', '🔥', '💀', '👋', '😤', '🫡'];
  const PARRY_KEYS = new Set(['Space', 'KeyF', 'KeyJ', 'KeyK', 'Enter', 'NumpadEnter']);
  const DASH_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'KeyE', 'KeyL']);
  const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };

  // =====================================================================
  // PERFIL LOCAL (XP / NÍVEL / RECORDES)
  // =====================================================================
  const PROFILE_KEY = 'gh_deathball_profile';
  const TITLES = ['Novato', 'Aprendiz', 'Rebatedor', 'Duelista', 'Gladiador', 'Veterano', 'Carrasco', 'Mestre', 'Lenda', 'Imortal'];
  const Profile = {
    load() {
      let p = null;
      try { p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { p = null; }
      return Object.assign({ xp: 0, level: 1, bestKmh: 0, bestRally: 0, wins: 0, matches: 0, perfects: 0, clutches: 0 }, p || {});
    },
    save(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* aba privada */ } },
    need(level) { return 120 + (level - 1) * 80; },
    title(level) { return TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 3))]; },
  };

  // =====================================================================
  // ÁUDIO (efeitos + trilha dinâmica, tudo procedural)
  // =====================================================================
  const Sfx = (() => {
    let ac = null, master = null, sfx = null, music = null, noiseBuf = null;
    let muted = false;
    try { muted = localStorage.getItem('gh_db_muted') === '1'; } catch (e) { /* */ }
    const last = {};

    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        master = ac.createGain(); master.gain.value = muted ? 0 : 0.85;
        sfx = ac.createGain(); sfx.gain.value = 0.9;
        music = ac.createGain(); music.gain.value = 0;
        sfx.connect(master); music.connect(master); master.connect(comp); comp.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function gate(name, ms) {
      const n = performance.now();
      if (last[name] && n - last[name] < ms) return false;
      last[name] = n; return true;
    }
    function tone(f, dur, type, vol, opts = {}) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + (opts.delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t);
      if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(opts.dest || sfx);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, ftype, f0, f1, opts = {}) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + (opts.delay || 0);
      const src = c.createBufferSource(); src.buffer = noiseBuf;
      const f = c.createBiquadFilter(); f.type = ftype || 'bandpass'; f.Q.value = opts.q || 1;
      f.frequency.setValueAtTime(f0, t);
      if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(opts.dest || sfx);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    }

    // ---------- trilha: kick/hat/baixo, BPM sobe com a velocidade da bola ----------
    const mus = { on: false, next: 0, step: 0, intensity: 0, duel: false, level: 0 };
    const BASS = [55, 55, 65.4, 55, 49, 55, 73.4, 65.4];
    function musicUpdate() {
      if (!ac || !mus.on) return;
      const bpm = 98 + mus.intensity * 74 + (mus.duel ? 8 : 0);
      const stepDur = 60 / bpm / 4;
      if (mus.next < ac.currentTime - 0.2) mus.next = ac.currentTime + 0.05;
      while (mus.next < ac.currentTime + 0.12) {
        const s = mus.step % 16, t = mus.next, dl = t - ac.currentTime;
        if (s % 4 === 0) { tone(120, 0.16, 'sine', 0.55, { to: 42, delay: dl, dest: music }); }
        if (s % 2 === 1 && mus.intensity > 0.08) noise(0.04, 0.12 + mus.intensity * 0.12, 'highpass', 7000, 0, { delay: dl, dest: music });
        if ((s === 4 || s === 12) && (mus.duel || mus.intensity > 0.45)) noise(0.12, 0.28, 'bandpass', 1800, 900, { delay: dl, dest: music, q: 0.8 });
        if (s % 2 === 0) {
          const n = BASS[(mus.step >> 1) % BASS.length] * (mus.duel ? 1.06 : 1);
          tone(n, stepDur * 1.8, 'sawtooth', 0.09 + mus.intensity * 0.05, { delay: dl, dest: music, attack: 0.01 });
        }
        mus.next += stepDur; mus.step++;
      }
    }
    function musicTarget(level) {
      if (!ac) return;
      mus.level = level;
      music.gain.cancelScheduledValues(ac.currentTime);
      music.gain.setTargetAtTime(level, ac.currentTime, 0.25);
    }

    return {
      unlock() { ensure(); },
      isMuted: () => muted,
      toggleMute() {
        muted = !muted;
        try { localStorage.setItem('gh_db_muted', muted ? '1' : '0'); } catch (e) { /* */ }
        if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, ac.currentTime, 0.03);
        return muted;
      },
      parry(perfect, smash) {
        noise(0.07, 0.6, 'highpass', 2500, 0);
        tone(1320, 0.12, 'square', 0.12); tone(1980, 0.09, 'triangle', 0.12);
        tone(160, 0.14, 'sine', 0.6, { to: 60 });
        if (perfect) {
          [1568, 2093, 2637].forEach((f, k) => tone(f, 0.45, 'sine', 0.13, { delay: 0.015 * k }));
          tone(90, 0.3, 'sine', 0.55, { to: 40 });
        }
        if (smash) { noise(0.5, 0.5, 'lowpass', 3000, 200); tone(70, 0.5, 'sawtooth', 0.25, { to: 30 }); }
      },
      clash() { if (gate('clash', 40)) { noise(0.05, 0.35, 'bandpass', 3500, 0, { q: 2 }); tone(2400, 0.06, 'square', 0.06); } },
      whiff() { noise(0.18, 0.3, 'bandpass', 1400, 300, { q: 0.7 }); },
      deny() { if (gate('deny', 120)) tone(180, 0.08, 'square', 0.08); },
      lock() { tone(880, 0.06, 'square', 0.08); tone(1320, 0.08, 'square', 0.08, { delay: 0.07 }); },
      tick(urg) { tone(900 + urg * 900, 0.03, 'square', 0.05 + urg * 0.07); },
      bounce() { if (gate('bounce', 60)) { tone(420, 0.08, 'triangle', 0.18, { to: 260 }); noise(0.04, 0.15, 'bandpass', 1200, 0); } },
      launch() { noise(0.35, 0.25, 'bandpass', 300, 2400, { q: 1.2 }); tone(220, 0.35, 'sawtooth', 0.06, { to: 880 }); },
      charge() { tone(110, 1.1, 'sawtooth', 0.07, { to: 440, attack: 0.3 }); },
      dash() { if (gate('dash', 80)) noise(0.2, 0.35, 'bandpass', 600, 2600, { q: 1.4 }); },
      kill(big) {
        noise(0.9, 0.8, 'lowpass', 4000, 80);
        tone(140, 0.7, 'sine', 0.8, { to: 30 });
        if (big) tone(55, 1.2, 'sawtooth', 0.18, { to: 28 });
      },
      count(n) { tone(n > 0 ? 660 : 990, n > 0 ? 0.12 : 0.35, 'square', 0.12); if (n === 0) tone(1320, 0.35, 'triangle', 0.1); },
      duel() { tone(73, 1.4, 'sawtooth', 0.2, { to: 55 }); noise(1.0, 0.25, 'lowpass', 900, 100); },
      win() { [523, 659, 784, 1047, 1319].forEach((f, k) => tone(f, 0.28, 'triangle', 0.14, { delay: k * 0.09 })); },
      lose() { [392, 330, 262].forEach((f, k) => tone(f, 0.3, 'triangle', 0.12, { delay: k * 0.12 })); },
      emote() { if (gate('emote', 150)) tone(1200, 0.05, 'sine', 0.08); },
      levelUp() { [784, 988, 1175, 1568].forEach((f, k) => tone(f, 0.3, 'sine', 0.14, { delay: k * 0.08 })); },
      music: {
        start() { if (!ensure()) return; mus.on = true; musicTarget(0.55); },
        stop() { mus.on = false; musicTarget(0); },
        duck(on) { musicTarget(on ? 0.15 : 0.55); },
        set(intensity, duel) { mus.intensity = intensity; mus.duel = duel; },
        update: musicUpdate,
      },
    };
  })();

  // =====================================================================
  // RELÓGIO DO SERVIDOR
  // =====================================================================
  const clock = { offset: 0, rtt: 0, samples: [], synced: false, pingTimer: null, pings: 0 };
  const serverNow = () => performance.now() + clock.offset;
  function sendPing() {
    socket.emit('game:action', { action: 'ping', c: performance.now(), rtt: Math.round(clock.rtt) });
  }
  socket.on('game:deathball:pong', (d) => {
    const n = performance.now();
    const rtt = n - d.c;
    if (!(rtt >= 0) || rtt > 3000) return;
    clock.samples.push({ rtt, off: d.s + rtt / 2 - n });
    if (clock.samples.length > 10) clock.samples.shift();
    let best = clock.samples[0];
    for (const s of clock.samples) if (s.rtt < best.rtt) best = s;
    if (!clock.synced) { clock.offset = best.off; clock.synced = true; }
    else clock.offset += (best.off - clock.offset) * 0.3;
    clock.rtt = clock.rtt ? clock.rtt * 0.75 + rtt * 0.25 : rtt;
  });
  function startPinging() {
    stopPinging();
    clock.pings = 0;
    const burst = () => {
      if (!G) return;
      sendPing();
      clock.pings++;
      clock.pingTimer = setTimeout(burst, clock.pings < 6 ? 150 : 1000);
    };
    burst();
  }
  function stopPinging() { if (clock.pingTimer) clearTimeout(clock.pingTimer); clock.pingTimer = null; }

  // =====================================================================
  // ESTADO DA PARTIDA
  // =====================================================================
  let G = null;

  function newLocal() {
    return {
      vx: 0, vy: 0, parryReadyAt: 0, dashReadyAt: 0, dashT: 0, dashDx: 0, dashDy: 0,
      armedUntil: 0, armedPerfect: false, seq: 0, buffered: 0, lastSend: 0, sentX: 1e9, sentY: 1e9, sentAx: 0, sentAy: 0,
    };
  }

  // ---------- pools de efeitos ----------
  const PARTS = 360;
  const parts = Array.from({ length: PARTS }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: '#fff', drag: 0.9 }));
  const RINGS = 24;
  const rings = Array.from({ length: RINGS }, () => ({ on: false, x: 0, y: 0, r0: 0, r1: 0, t: 0, dur: 1, color: '#fff', w: 2 }));
  const TEXTS = 12;
  const texts = Array.from({ length: TEXTS }, () => ({ on: false, x: 0, y: 0, t: 0, dur: 1, text: '', color: '#fff', size: 14 }));
  const TRAIL = 22;
  const trail = Array.from({ length: TRAIL }, () => ({ x: 0, y: 0, brk: true }));
  let trailHead = 0;

  function resetPools() {
    for (const p of parts) p.on = false;
    for (const r of rings) r.on = false;
    for (const t of texts) t.on = false;
    for (const t of trail) t.brk = true;
  }

  function burst(x, y, n, colors, spd = 30, life = 0.5, size = 0.5) {
    if (G && G.q === 0) n = Math.ceil(n / 2);
    let k = 0;
    for (let i = 0; i < PARTS && k < n; i++) {
      const p = parts[i];
      if (p.on) continue;
      const a = Math.random() * TAU, s = spd * (0.3 + Math.random() * 0.9);
      p.on = true; p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.max = p.life = life * (0.6 + Math.random() * 0.6);
      p.size = size * (0.6 + Math.random() * 0.9);
      p.color = colors[(Math.random() * colors.length) | 0];
      p.drag = 3.2;
      k++;
    }
  }
  function ring(x, y, r0, r1, dur, color, w = 2) {
    let best = rings[0];
    for (const r of rings) { if (!r.on) { best = r; break; } if (r.t / r.dur > best.t / best.dur) best = r; }
    Object.assign(best, { on: true, x, y, r0, r1, t: 0, dur, color, w });
  }
  function floatText(x, y, text, color, size = 14, dur = 0.9) {
    let best = texts[0];
    for (const t of texts) { if (!t.on) { best = t; break; } if (t.t / t.dur > best.t / best.dur) best = t; }
    Object.assign(best, { on: true, x, y, t: 0, dur, text, color, size });
  }

  // =====================================================================
  // SPRITES / CACHE
  // =====================================================================
  const glowCache = new Map();
  function glowSprite(color) {
    let c = glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, color);
    gr.addColorStop(0.25, hexA(color, 0.55));
    gr.addColorStop(0.6, hexA(color, 0.14));
    gr.addColorStop(1, hexA(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    glowCache.set(color, c);
    return c;
  }
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  const BALL_TIERS = [
    { kmh: 150, core: '#7dd3fc', glow: '#38bdf8', cls: 't1' },
    { kmh: 300, core: '#fcd34d', glow: '#f59e0b', cls: 't2' },
    { kmh: 480, core: '#fdba74', glow: '#f97316', cls: 't3' },
    { kmh: 680, core: '#fca5a5', glow: '#ef4444', cls: 't4' },
    { kmh: 1e9, core: '#f5d0fe', glow: '#d946ef', cls: 't5' },
  ];
  const tierFor = (kmh) => { for (const t of BALL_TIERS) if (kmh < t.kmh) return t; return BALL_TIERS[4]; };

  function makeTag(p) {
    const c = document.createElement('canvas');
    const fs = 12;
    const g = c.getContext('2d');
    const name = p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name;
    const lv = 'Lv' + (p.level || 1);
    g.font = `700 ${fs}px Outfit, "DM Sans", sans-serif`;
    const wN = g.measureText(name).width;
    g.font = `700 ${fs - 2}px "DM Sans", sans-serif`;
    const wL = g.measureText(lv).width;
    const pad = 6, w = Math.ceil(wN + wL + pad * 3 + 2), h = 18;
    const sc = 2;
    c.width = w * sc; c.height = h * sc;
    g.scale(sc, sc);
    g.fillStyle = p.isMe ? 'rgba(120,53,15,0.82)' : 'rgba(9,9,11,0.7)';
    roundRect(g, 0, 0, w, h, 9); g.fill();
    if (p.isMe) { g.strokeStyle = 'rgba(245,158,11,0.8)'; g.lineWidth = 1; roundRect(g, 0.5, 0.5, w - 1, h - 1, 8.5); g.stroke(); }
    g.textBaseline = 'middle';
    g.font = `700 ${fs}px Outfit, "DM Sans", sans-serif`;
    g.fillStyle = '#fafafa';
    g.fillText(name, pad, h / 2 + 0.5);
    g.font = `700 ${fs - 2}px "DM Sans", sans-serif`;
    g.fillStyle = p.color;
    g.fillText(lv, pad * 2 + wN, h / 2 + 0.5);
    p.tag = c; p.tagW = w; p.tagH = h;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // =====================================================================
  // INÍCIO DA PARTIDA
  // =====================================================================
  socket.on('game:deathball:start', (data) => {
    cleanup();
    const profile = Profile.load();
    const myId = socket.id;
    const isTouch = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);

    G = {
      players: data.players.map(p => ({
        i: p.i, id: p.id, name: p.name, color: p.color, isBot: p.isBot, level: p.level || 1,
        isMe: p.id === myId, x: 0, y: 0, ax: 0, ay: -1, rx: 0, ry: 0, alive: true,
        buf: [], swingAt: -1e9, swingOk: false, deadAt: 0, deadX: 0, deadY: 0, emote: -1, emoteUntil: 0,
        dashFx: 0, tag: null, tagW: 0, tagH: 0, wins: 0, score: 0, flashAt: -1e9,
      })),
      meI: -1, me: null, solo: !!data.solo, winsToWin: data.winsToWin || 3,
      round: 0, phase: 'countdown', goAt: 0, lastCount: 99, duel: false,
      ball: S.newBall(), prevX: 0, prevY: 0, ballT: 0, hasBall: false, offX: 0, offY: 0,
      renderBX: 0, renderBY: 0, sfxCursor: 0, localImpactT: 0, await: null, lastSnapT: 0,
      rally: 0, kmh: S.toKmh(C.BALL_START), meter: 0, myScore: 0,
      L: newLocal(), keys: new Set(), mouse: { x: 0, y: 0, has: false, moved: 0 },
      joy: { id: null, ox: 0, oy: 0, dx: 0, dy: 0 },
      shake: 0, punch: 0, flash: 0, flashColor: '#fff', slowmo: 0, vignette: 0,
      q: 1, dpr: 1, W: 0, H: 0, cx: 0, cy: 0, scale: 1, bg: null, bgDirty: true,
      ft: 16.7, slowFrames: 0, lastTs: 0, raf: 0, tickAcc: 0, hud: {}, isTouch, profile,
      perf: false, fps: 60, ro: null, handlers: [],
    };
    G.meI = G.players.findIndex(p => p.isMe);
    G.me = G.players[G.meI] || null;
    if (G.me) G.me.level = profile.level;
    G.players.forEach(makeTag);

    // relógio: estimativa inicial até o primeiro pong
    clock.samples = []; clock.synced = false; clock.rtt = 0;
    clock.offset = data.st - performance.now() + 30;
    startPinging();

    buildDom();
    bindInput();
    resize();
    resetPools();
    renderRoster();

    if (G.me) socket.emit('game:action', { action: 'profile', level: profile.level });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    Sfx.unlock();
    Sfx.music.start();
    G.lastTs = performance.now();
    G.raf = requestAnimationFrame(frame);
  });

  function buildDom() {
    if (DOM.resultsOverlay) DOM.resultsOverlay.classList.add('hidden');
    DOM.gameArea.classList.add('db2-host');
    const touch = G.isTouch;
    DOM.gameArea.innerHTML = `
      <div class="db2 ${touch ? 'is-touch' : ''}" id="db2">
        <div class="db2-stage" id="db2-stage">
          <canvas id="db2-canvas"></canvas>
          <div class="db2-top">
            <span class="db2-pill" id="db2-round">Rodada 1</span>
            <div class="db2-right">
              <span class="db2-pill db2-net" id="db2-net">-- ms</span>
              <button class="db2-iconbtn" id="db2-mute" tabindex="-1" title="Som (M)">${Sfx.isMuted() ? '🔇' : '🔊'}</button>
            </div>
          </div>
          <div class="db2-speed t1" id="db2-speed"><b>${G.kmh}</b><small>KM/H</small></div>
          <div class="db2-rally" id="db2-rally"></div>
          <div class="db2-roster" id="db2-roster"></div>
          <div class="db2-feed" id="db2-feed"></div>
          <div class="db2-announce" id="db2-announce"></div>
          <div class="db2-alert" id="db2-alert">⚠ VOCÊ É O ALVO</div>
          <div class="db2-spec" id="db2-spec" style="display:none">💀 Eliminado — assistindo. Emotes: 1–6</div>
          <div class="db2-abilities">
            <div class="db2-ab parry" id="db2-ab-parry"><span>PARRY</span><kbd>ESPAÇO</kbd></div>
            <div class="db2-ab dash" id="db2-ab-dash"><span>DASH</span><kbd>SHIFT</kbd></div>
            <div class="db2-smash" id="db2-smash"><div class="bars"><i></i><i></i><i></i></div><span>SMASH</span></div>
          </div>
          <div class="db2-help">
            <kbd>WASD</kbd> mover · <kbd>Mouse</kbd> mirar · <kbd>Clique</kbd>/<kbd>Espaço</kbd> parry ·
            <kbd>Shift</kbd>/<kbd>Botão direito</kbd> dash · <kbd>1-6</kbd> emotes · <kbd>M</kbd> som
          </div>
          <div class="db2-touch">
            <div class="db2-joy" id="db2-joy"><div class="db2-joy-base" id="db2-joy-base"><div class="db2-joy-knob" id="db2-joy-knob"></div></div></div>
            <button class="db2-tbtn db2-tparry" id="db2-tparry" tabindex="-1">PARRY</button>
            <button class="db2-tbtn db2-tdash" id="db2-tdash" tabindex="-1">DASH</button>
            <div class="db2-temotes">${EMOTES.slice(0, 4).map((e, k) => `<button tabindex="-1" data-e="${k}">${e}</button>`).join('')}</div>
          </div>
        </div>
      </div>`;
    const $ = (id) => document.getElementById(id);
    G.dom = {
      root: $('db2'), stage: $('db2-stage'), canvas: $('db2-canvas'), round: $('db2-round'), net: $('db2-net'),
      mute: $('db2-mute'), speed: $('db2-speed'), rally: $('db2-rally'), roster: $('db2-roster'), feed: $('db2-feed'),
      announce: $('db2-announce'), alert: $('db2-alert'), spec: $('db2-spec'), abParry: $('db2-ab-parry'),
      abDash: $('db2-ab-dash'), smash: $('db2-smash'), joy: $('db2-joy'), joyBase: $('db2-joy-base'),
      joyKnob: $('db2-joy-knob'), tParry: $('db2-tparry'), tDash: $('db2-tdash'),
    };
    G.ctx = G.dom.canvas.getContext('2d', { alpha: false, desynchronized: true });
    G.hud = { kmh: -1, tier: '', rally: -1, net: '', alert: null, parryP: -1, parryCls: '', dashP: -1, meter: -1, spec: null, tParry: '', tDash: '' };
  }

  // =====================================================================
  // INPUT
  // =====================================================================
  function on(target, ev, fn, opts) {
    target.addEventListener(ev, fn, opts);
    G.handlers.push(() => target.removeEventListener(ev, fn, opts));
  }

  function isTyping(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  function bindInput() {
    const d = G.dom;
    on(document, 'keydown', (e) => {
      if (!G || isTyping(e.target)) return;
      const code = e.code;
      const relevant = PARRY_KEYS.has(code) || DASH_KEYS.has(code) || MOVE_KEYS[code] || /^Digit[1-6]$/.test(code);
      if (relevant) e.preventDefault();
      if (e.repeat) return;
      Sfx.unlock();
      G.keys.add(code);
      if (PARRY_KEYS.has(code)) pressParry();
      else if (DASH_KEYS.has(code)) pressDash();
      else if (/^Digit[1-6]$/.test(code)) sendEmote(Number(code.slice(5)) - 1);
      else if (code === 'KeyM') toggleMute();
      else if (code === 'F3' || code === 'Backquote') { G.perf = !G.perf; e.preventDefault(); }
    });
    on(document, 'keyup', (e) => { if (G) G.keys.delete(e.code); });
    const clearAll = () => { if (!G) return; G.keys.clear(); G.joy.id = null; G.joy.dx = G.joy.dy = 0; if (G.dom.joyBase) G.dom.joyBase.classList.remove('active'); };
    on(window, 'blur', clearAll);
    on(document, 'visibilitychange', () => { if (document.hidden) clearAll(); });

    // mouse: mira + parry (esquerdo) + dash (direito)
    on(window, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      G.mouse.x = e.clientX; G.mouse.y = e.clientY; G.mouse.has = true;
    });
    on(d.stage, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.target.closest('button')) return;
      e.preventDefault();
      Sfx.unlock();
      G.mouse.x = e.clientX; G.mouse.y = e.clientY; G.mouse.has = true;
      if (e.button === 0) pressParry();
      else if (e.button === 2) pressDash();
    });
    on(d.stage, 'contextmenu', (e) => e.preventDefault());
    on(d.mute, 'pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); toggleMute(); });

    // toque: joystick dinâmico + botões (um único handler cada, pointerdown)
    on(d.joy, 'pointerdown', (e) => {
      if (G.joy.id !== null) return;
      e.preventDefault();
      Sfx.unlock();
      G.joy.id = e.pointerId;
      const r = d.stage.getBoundingClientRect();
      G.joy.ox = e.clientX; G.joy.oy = e.clientY;
      d.joyBase.style.left = (e.clientX - r.left) + 'px';
      d.joyBase.style.top = (e.clientY - r.top) + 'px';
      d.joyBase.style.bottom = 'auto';
      d.joyBase.classList.add('active');
      try { d.joy.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    });
    on(d.joy, 'pointermove', (e) => {
      if (e.pointerId !== G.joy.id) return;
      const dx = e.clientX - G.joy.ox, dy = e.clientY - G.joy.oy;
      const m = Math.hypot(dx, dy), R = 46;
      const k = m > R ? R / m : 1;
      d.joyKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const dead = 8;
      if (m < dead) { G.joy.dx = G.joy.dy = 0; } else { const s = Math.min(1, (m - dead) / (R - dead)); G.joy.dx = dx / m * s; G.joy.dy = dy / m * s; }
    });
    const joyEnd = (e) => {
      if (e.pointerId !== G.joy.id) return;
      G.joy.id = null; G.joy.dx = G.joy.dy = 0;
      d.joyKnob.style.transform = '';
      d.joyBase.classList.remove('active');
    };
    on(d.joy, 'pointerup', joyEnd);
    on(d.joy, 'pointercancel', joyEnd);
    on(d.tParry, 'pointerdown', (e) => { e.preventDefault(); d.tParry.classList.add('pressed'); pressParry(); });
    const unpress = () => d.tParry.classList.remove('pressed');
    on(d.tParry, 'pointerup', unpress); on(d.tParry, 'pointercancel', unpress); on(d.tParry, 'pointerleave', unpress);
    on(d.tDash, 'pointerdown', (e) => { e.preventDefault(); pressDash(); });
    G.dom.root.querySelectorAll('.db2-temotes button').forEach(b => on(b, 'pointerdown', (e) => { e.preventDefault(); sendEmote(Number(b.dataset.e)); }));

    // redimensionamento
    if (window.ResizeObserver) {
      G.ro = new ResizeObserver(() => resize());
      G.ro.observe(d.stage);
    }
    on(window, 'resize', resize);
  }

  function toggleMute() {
    const m = Sfx.toggleMute();
    if (G && G.dom.mute) G.dom.mute.textContent = m ? '🔇' : '🔊';
  }

  function sendEmote(e) {
    if (!G || !G.me || e < 0 || e >= EMOTES.length) return;
    if (performance.now() - (G.lastEmote || 0) < 700) return;
    G.lastEmote = performance.now();
    socket.emit('game:action', { action: 'emote', e });
  }

  // ---------- parry ----------
  function pressParry() {
    if (!G) return;
    const me = G.me;
    if (!me || !me.alive || G.phase !== 'live') return;
    const t = serverNow();
    const L = G.L;
    // Buffer de input: apertou um pouquinho antes de poder (recarga curta do clash ou
    // aguardando confirmação)? Guarda o comando e dispara no primeiro instante permitido.
    if (G.await || (t < L.parryReadyAt && L.parryReadyAt - t <= 130)) { L.buffered = performance.now(); return; }
    if (t < L.parryReadyAt) { Sfx.deny(); me.flashAt = performance.now(); return; }
    L.buffered = 0;
    const b = G.ball;
    const cliTti = (G.hasBall && b.target === G.meI) ? S.timeToImpact(b, me.x, me.y) : -1;
    L.seq++;
    socket.emit('game:action', {
      action: 'parry', t: Math.round(t * 10) / 10, seq: L.seq,
      x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100, ax: me.ax, ay: me.ay,
      tti: cliTti >= 0 && cliTti < 5 ? Math.round(cliTti * 1000) / 1000 : -1,
    });
    me.swingAt = performance.now(); me.swingOk = false;

    if (!G.hasBall || b.phase === PHASE.IDLE || b.target !== G.meI) { localWhiff(t, 'notarget'); return; }
    if (b.phase === PHASE.PENDING) {
      if (t <= G.localImpactT + C.LATE_TOL * 1000 + 15) localDeflect(false, true, t);
      else localWhiff(t, 'late');
      return;
    }
    const tti = S.timeToImpact(b, me.x, me.y);
    const eff = S.effSpeed(b);
    const win = S.parryWindow(eff);
    if (tti > win) { localWhiff(t, 'early'); return; }
    const perfect = tti <= S.perfectWindow(eff);
    const dist = Math.hypot(me.x - b.x, me.y - b.y);
    if (b.phase === PHASE.FLY && (dist <= C.DEFLECT_DIST || tti <= 0.03)) localDeflect(perfect, false, t);
    else { L.armedUntil = t + (win + 0.05) * 1000; L.armedPerfect = perfect; }
  }

  function localWhiff(t, reason) {
    const L = G.L, me = G.me;
    L.parryReadyAt = t + C.MISS_CD * 1000;
    L.armedUntil = 0;
    Sfx.whiff();
    const txt = reason === 'early' ? 'CEDO DEMAIS' : reason === 'late' ? 'TARDE DEMAIS' : 'SEM ALVO';
    floatText(me.x, me.y - 6, txt, '#f87171', 13);
    G.whiffShownSeq = L.seq;
  }

  function localDeflect(perfect, clutch, t) {
    const L = G.L, me = G.me, b = G.ball;
    L.armedUntil = 0;
    L.parryReadyAt = t + C.HIT_CD * 1000;
    G.await = { seq: L.seq, until: performance.now() + Math.max(250, clock.rtt * 2 + 120), perfect };
    // congela a bola no impacto (hitstop) até o servidor confirmar
    b.phase = PHASE.HOLD; b.holdLeft = 5;
    me.swingOk = true;
    const smash = G.meter >= C.SMASH_CHARGES;
    parryFx(me, b.x, b.y, perfect, clutch, smash, true);
  }

  function parryFx(p, bx, by, perfect, clutch, smash, mine) {
    Sfx.parry(perfect, smash);
    if (!mine) Sfx.clash();
    const col = smash ? '#fbbf24' : perfect ? '#fde68a' : p.color;
    ring(bx, by, 1, perfect ? 16 : 10, perfect ? 0.45 : 0.3, col, perfect ? 3 : 2);
    if (smash) ring(p.x, p.y, 2, 40, 0.6, '#fbbf24', 4);
    burst(bx, by, perfect ? 26 : 14, perfect ? ['#fde68a', '#fbbf24', '#ffffff'] : [p.color, '#ffffff', '#fcd34d'], perfect ? 42 : 30, 0.45, 0.55);
    G.shake = Math.min(1.6, G.shake + (smash ? 1.2 : perfect ? 0.8 : 0.4));
    G.punch = Math.max(G.punch, smash ? 0.06 : perfect ? 0.035 : 0.015);
    if (perfect || smash) { G.flash = Math.max(G.flash, smash ? 0.35 : 0.22); G.flashColor = smash ? '#fbbf24' : '#ffffff'; }
    if (mine) {
      if (smash) announce('SMASH!', 'gold', 0.9);
      else if (clutch) announce('NO LIMITE!', 'green', 0.9);
      else if (perfect) floatText(p.x, p.y - 7, 'PERFEITO!', '#fde68a', 16, 0.8);
    }
  }

  // ---------- dash ----------
  function pressDash() {
    if (!G) return;
    const me = G.me, L = G.L;
    if (!me || !me.alive || G.phase === 'roundEnd') return;
    const t = serverNow();
    if (t < L.dashReadyAt) { Sfx.deny(); return; }
    let dx = moveInputX(), dy = moveInputY();
    if (Math.hypot(dx, dy) < 0.1) { dx = me.ax; dy = me.ay; }
    const m = Math.hypot(dx, dy) || 1;
    L.dashDx = dx / m; L.dashDy = dy / m;
    L.dashT = C.DASH_TIME;
    L.dashReadyAt = t + C.DASH_CD * 1000;
    socket.emit('game:action', { action: 'dash', dx: L.dashDx, dy: L.dashDy });
    Sfx.dash();
    me.dashFx = performance.now();
    ring(me.x, me.y, 1, 7, 0.3, '#38bdf8', 2);
  }

  function moveInputX() {
    let x = 0;
    for (const k of G.keys) { const v = MOVE_KEYS[k]; if (v) x += v[0]; }
    return clamp(x, -1, 1) + G.joy.dx;
  }
  function moveInputY() {
    let y = 0;
    for (const k of G.keys) { const v = MOVE_KEYS[k]; if (v) y += v[1]; }
    return clamp(y, -1, 1) + G.joy.dy;
  }

  // =====================================================================
  // EVENTOS DE REDE
  // =====================================================================
  function P(i) { return G && G.players[i]; }

  const _tp = { x: 0, y: 0 };
  function targetPos(i) {
    const p = P(i);
    if (!p) return null;
    if (p.isMe) return p;
    const nb = p.buf[p.buf.length - 1];
    if (!nb) return p;
    _tp.x = nb.ex; _tp.y = nb.ey; // mesma posição extrapolada que o servidor usa para a bola
    return _tp;
  }

  /** Aplica um estado autoritativo da bola (com carimbo de tempo do servidor). */
  function applyBall(arr, t, smooth) {
    const hadBall = G.hasBall;
    const ox = G.renderBX, oy = G.renderBY;
    S.unpackBall(arr, G.ball);
    G.ballT = t;
    G.prevX = G.ball.x; G.prevY = G.ball.y;
    G.hasBall = G.ball.phase !== PHASE.IDLE;
    if (G.ball.phase === PHASE.PENDING) G.localImpactT = t;
    advanceBall(serverNow(), true);
    if (smooth && hadBall) {
      const ex = ox - G.ball.x, ey = oy - G.ball.y;
      if (Math.hypot(ex, ey) < 14) { G.offX = ex; G.offY = ey; }
      else { G.offX = G.offY = 0; breakTrail(); }
    } else { G.offX = G.offY = 0; breakTrail(); }
  }

  function breakTrail() { for (const t of trail) t.brk = true; }

  socket.on('game:deathball:s', (d) => {
    if (!G) return;
    if (d.t < G.lastSnapT) return;
    G.lastSnapT = d.t;
    const a = d.p;
    for (let k = 0; k + 7 < a.length; k += 8) {
      const p = P(a[k]);
      if (!p) continue;
      if (!a[k + 5] && p.alive && G.phase !== 'countdown') markDead(p, a[k + 1], a[k + 2]);
      if (p.isMe) continue;
      p.buf.push({ t: d.t, x: a[k + 1], y: a[k + 2], ax: a[k + 3], ay: a[k + 4], ex: a[k + 6], ey: a[k + 7] });
      if (p.buf.length > 12) p.buf.shift();
    }
    if (G.await) return; // segurando a bola até a confirmação do parry
    if (d.b) applyBall(d.b, d.t, true);
    else if (G.hasBall && G.phase !== 'live') { G.hasBall = false; G.ball.phase = PHASE.IDLE; }
  });

  socket.on('game:deathball:round', (d) => {
    if (!G) return;
    G.round = d.round; G.phase = 'countdown'; G.goAt = d.goAt; G.lastCount = 99; G.duel = !!d.duel;
    G.hasBall = false; G.ball = S.newBall(); G.await = null; G.rally = 0; G.meter = 0;
    G.L = Object.assign(newLocal(), { seq: G.L.seq });
    G.bgDirty = true;
    for (const [i, x, y, alive] of d.pos) {
      const p = P(i); if (!p) continue;
      p.x = p.rx = x; p.y = p.ry = y; p.alive = !!alive; p.buf.length = 0; p.deadAt = 0;
      p.ax = -x / (Math.hypot(x, y) || 1); p.ay = -y / (Math.hypot(x, y) || 1);
    }
    (d.wins || []).forEach((w, i) => { if (P(i)) P(i).wins = w; });
    renderRoster();
    breakTrail();
    G.dom.round.textContent = `Rodada ${d.round} · 1º a ${G.winsToWin}`;
    G.dom.round.classList.toggle('duel', G.duel);
    const mp = G.players.filter(p => p.wins === G.winsToWin - 1 && G.winsToWin > 1);
    const sub = mp.length ? `Match point: ${mp.map(p => p.name).join(', ')}` : (G.duel ? 'Duelo mortal' : 'Último de pé vence');
    announce(`RODADA ${d.round}`, mp.length ? 'red' : '', 1.4, sub);
    Sfx.music.duck(false);
    G.kmh = S.toKmh(C.BALL_START);
  });

  socket.on('game:deathball:launch', (d) => {
    if (!G) return;
    G.phase = 'live';
    G.await = null;
    G.rally = 0;
    if (G.lastCount !== -1) { G.lastCount = -1; announce('VAI!', 'green', 0.7); Sfx.count(0); }
    applyBall(d.ball, d.t, false);
    Sfx.charge();
    const tg = P(G.ball.target);
    if (tg && tg.isMe) setTimeout(() => G && Sfx.lock(), 300);
  });

  socket.on('game:deathball:retarget', (d) => { if (G) applyBall(d.ball, d.t, true); });

  socket.on('game:deathball:parry', (d) => {
    if (!G) return;
    const p = P(d.by); if (!p) return;
    const mine = p.isMe;
    const wasOptimistic = mine && G.await && G.await.seq === d.seq;
    if (wasOptimistic) {
      if (d.pf && !G.await.perfect) floatText(p.x, p.y - 7, 'PERFEITO!', '#fde68a', 16, 0.8);
      G.await = null;
    } else {
      // posição do impacto = posição do jogador que rebateu (mais estável que a bola prevista)
      parryFx(p, p.rx || p.x, p.ry || p.y, !!d.pf, !!d.cl, !!d.sm, mine);
      if (!mine) { p.swingAt = performance.now(); p.swingOk = true; }
    }
    if (mine) {
      G.L.parryReadyAt = d.t + C.HIT_CD * 1000; G.L.armedUntil = 0;
      G.meter = d.meter; G.myScore = d.score;
      if (d.pts > 1) floatText(p.x + 4, p.y - 2, '+' + d.pts, '#fbbf24', 12, 0.7);
    }
    if (d.sm && !mine) announce('SMASH!', 'gold', 0.7, `${p.name} soltou um smash`);
    G.rally = d.rally;
    applyBall(d.ball, d.t, true);
    const tg = P(d.tg);
    if (tg && tg.isMe) Sfx.lock();
    if ([10, 20, 30, 40, 50].includes(d.rally)) announce(`RALLY ${d.rally}!`, d.rally >= 30 ? 'red' : 'gold', 0.9, `${d.kmh} km/h`);
  });

  socket.on('game:deathball:whiff', (d) => {
    if (!G) return;
    const p = P(d.i); if (!p) return;
    if (p.isMe) {
      G.L.parryReadyAt = d.readyAt; G.L.armedUntil = 0;
      if (G.await && G.await.seq === d.seq) {
        G.await = null;
        G.lastSnapT = 0; // aceita o próximo snapshot imediatamente
        floatText(p.x, p.y - 6, 'NÃO PEGOU', '#f87171', 13);
      } else if (G.whiffShownSeq !== d.seq) {
        floatText(p.x, p.y - 6, d.r === 'early' ? 'CEDO DEMAIS' : d.r === 'late' ? 'TARDE DEMAIS' : 'SEM ALVO', '#f87171', 13);
      }
    } else {
      p.swingAt = performance.now(); p.swingOk = false;
    }
  });

  function markDead(p, x, y) {
    if (!p.alive) return;
    p.alive = false; p.deadAt = performance.now(); p.deadX = x; p.deadY = y;
    if (p.isMe) G.L.armedUntil = 0;
    renderRoster();
  }

  socket.on('game:deathball:kill', (d) => {
    if (!G) return;
    const v = P(d.i); if (!v) return;
    const by = P(d.by);
    markDead(v, d.x, d.y);
    G.hasBall = false; G.ball.phase = PHASE.IDLE; G.await = null;
    if (G.phase === 'live') G.phase = 'killpause';
    breakTrail();
    const big = d.alive <= 1;
    if (!d.left) {
      Sfx.kill(big);
      burst(d.x, d.y, 60, [v.color, '#ef4444', '#ffffff', '#fbbf24'], 55, 0.9, 0.7);
      ring(d.x, d.y, 2, 28, 0.6, '#ef4444', 4);
      ring(d.x, d.y, 1, 16, 0.4, '#ffffff', 2);
      G.shake = 2.2; G.flash = 0.4; G.flashColor = '#ef4444'; G.slowmo = 0.55; G.punch = 0.08;
    }
    addFeed(v, by, d.kmh, d.left);
    if (v.isMe) {
      announce('ELIMINADO', 'red', 1.5, d.kmh ? `${d.kmh} km/h${by && !by.isMe ? ' · por ' + by.name : ''}` : '');
      Sfx.music.duck(true);
    } else if (by && by.isMe) {
      announce(`ELIMINOU ${v.name.toUpperCase()}`, 'gold', 1.1, '+5 pontos');
    }
    renderRoster();
  });

  socket.on('game:deathball:duel', () => {
    if (!G) return;
    G.duel = true; G.bgDirty = true;
    G.dom.round.classList.add('duel');
    Sfx.duel();
    setTimeout(() => G && announce('DUELO MORTAL', 'red', 1.5, 'Só restam dois'), 650);
  });

  socket.on('game:deathball:roundEnd', (d) => {
    if (!G) return;
    G.phase = 'roundEnd'; G.hasBall = false; G.ball.phase = PHASE.IDLE; G.await = null;
    (d.wins || []).forEach((w, i) => { if (P(i)) P(i).wins = w; });
    (d.scores || []).forEach((s, i) => { if (P(i)) P(i).score = s; });
    renderRoster();
    const w = P(d.winner);
    Sfx.music.duck(true);
    if (!w) { announce('EMPATE', '', 1.6); return; }
    if (w.isMe) Sfx.win(); else Sfx.lose();
    if (d.matchOver) announce(w.isMe ? 'VOCÊ VENCEU!' : `${w.name.toUpperCase()} VENCEU!`, 'gold', 2.4, 'Fim de partida');
    else announce(w.isMe ? 'RODADA SUA!' : `${w.name.toUpperCase()} LEVOU`, w.isMe ? 'gold' : '', 2.2, `${w.wins}/${G.winsToWin} rodadas`);
    if (w.alive) { burst(w.x, w.y, 40, ['#fbbf24', '#fde68a', w.color], 40, 1.0, 0.6); ring(w.x, w.y, 2, 20, 0.8, '#fbbf24', 3); }
  });

  socket.on('game:deathball:dash', (d) => {
    const p = G && P(d.i); if (!p || p.isMe) return;
    p.dashFx = performance.now();
    ring(d.x, d.y, 1, 7, 0.3, '#38bdf8', 2);
  });

  socket.on('game:deathball:emote', (d) => {
    const p = G && P(d.i); if (!p) return;
    p.emote = d.e; p.emoteUntil = performance.now() + 1800;
    Sfx.emote();
  });

  socket.on('game:deathball:profile', (d) => {
    const p = G && P(d.i); if (!p || p.isMe) return;
    p.level = d.level; makeTag(p); renderRoster();
  });

  socket.on('game:deathball:correct', (d) => {
    if (!G || !G.me) return;
    G.me.x = d.x; G.me.y = d.y;
  });

  socket.on('game:deathball:gameover', (d) => {
    if (!G) return;
    G.phase = 'over';
    Sfx.music.stop();
    const snapshot = { meI: G.meI, players: G.players.map(p => ({ i: p.i, name: p.name, color: p.color, isMe: p.isMe })) };
    setTimeout(() => showResults(d, snapshot), 1300);
  });

  function dropResultsSkin() {
    const card = DOM.resultsOverlay && DOM.resultsOverlay.querySelector('.results-card');
    if (card) card.classList.remove('db2-results-card');
  }
  socket.on('game:starting', () => { if (G) cleanup(); dropResultsSkin(); });
  socket.on('game:ended', () => { if (G) cleanup(); dropResultsSkin(); });

  // =====================================================================
  // LOOP PRINCIPAL
  // =====================================================================
  function frame(ts) {
    if (!G) return;
    G.raf = requestAnimationFrame(frame);
    const rawDt = (ts - G.lastTs) / 1000;
    G.lastTs = ts;
    const dt = clamp(rawDt || 0.016, 0, 0.05);
    perfTrack(rawDt * 1000);

    const sNow = serverNow();
    if (G.phase === 'countdown') countdownTick(sNow);
    updateMe(dt, sNow);
    updateRemote(sNow);
    if (G.await && performance.now() > G.await.until) { G.await = null; G.lastSnapT = 0; }
    flushBufferedParry(sNow);
    if (!G.await) advanceBall(sNow, false);
    updateAudio(sNow);
    updateHud(sNow);
    render(dt, sNow);
  }

  function flushBufferedParry(sNow) {
    const L = G.L;
    if (!L.buffered) return;
    if (performance.now() - L.buffered > 150) { L.buffered = 0; return; }
    if (G.await || sNow < L.parryReadyAt) return;
    L.buffered = 0;
    // só dispara se a bola ainda vem em mim (senão seria punido por "sem alvo")
    if (G.hasBall && G.ball.target === G.meI) pressParry();
  }

  function countdownTick(sNow) {
    const left = G.goAt - sNow;
    const n = Math.ceil(left / 1000);
    if (n !== G.lastCount && n <= 3 && n >= 0) {
      G.lastCount = n;
      if (n > 0) { announce(String(n), n === 1 ? 'red' : n === 2 ? 'gold' : '', 0.85); Sfx.count(n); }
    }
    if (left <= 0 && G.lastCount !== -1) {
      G.lastCount = -1;
      announce('VAI!', 'green', 0.7);
      Sfx.count(0);
    }
  }

  function updateMe(dt, sNow) {
    const me = G.me;
    if (!me || !me.alive || G.phase === 'roundEnd' || G.phase === 'over') return;
    const L = G.L;
    let ix = moveInputX(), iy = moveInputY();
    const im = Math.hypot(ix, iy);
    if (im > 1) { ix /= im; iy /= im; }
    const k = 1 - Math.exp(-C.PLAYER_ACCEL * dt);
    L.vx += (ix * C.PLAYER_SPEED - L.vx) * k;
    L.vy += (iy * C.PLAYER_SPEED - L.vy) * k;
    me.x += L.vx * dt; me.y += L.vy * dt;
    if (L.dashT > 0) {
      const step = Math.min(dt, L.dashT);
      me.x += L.dashDx * (C.DASH_DIST / C.DASH_TIME) * step;
      me.y += L.dashDy * (C.DASH_DIST / C.DASH_TIME) * step;
      L.dashT -= step;
    }
    S.clampToArena(me);
    me.rx = me.x; me.ry = me.y;

    // mira: mouse (desktop) > joystick > direção do movimento
    if (G.mouse.has && !G.isTouch) {
      const r = G.rect;
      if (r) {
        const wx = (G.mouse.x - r.left - G.cx) / G.scale, wy = (G.mouse.y - r.top - G.cy) / G.scale;
        const ax = wx - me.x, ay = wy - me.y, am = Math.hypot(ax, ay);
        if (am > 0.5) { me.ax = ax / am; me.ay = ay / am; }
      }
    } else if (Math.hypot(G.joy.dx, G.joy.dy) > 0.2) {
      const m = Math.hypot(G.joy.dx, G.joy.dy); me.ax = G.joy.dx / m; me.ay = G.joy.dy / m;
    } else if (im > 0.2) {
      const m = Math.hypot(ix, iy); me.ax = ix / m; me.ay = iy / m;
    }

    // envio 30 Hz, só se algo mudou (volatile: pacote velho é descartado, nunca enfileira)
    if (sNow - L.lastSend >= 33) {
      const moved = Math.abs(me.x - L.sentX) + Math.abs(me.y - L.sentY) > 0.02;
      const aimed = Math.abs(me.ax - L.sentAx) + Math.abs(me.ay - L.sentAy) > 0.03;
      if (moved || aimed || sNow - L.lastSend > 500) {
        L.lastSend = sNow; L.sentX = me.x; L.sentY = me.y; L.sentAx = me.ax; L.sentAy = me.ay;
        socket.volatile.emit('game:action', {
          action: 'm', x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100,
          ax: Math.round(me.ax * 1000) / 1000, ay: Math.round(me.ay * 1000) / 1000,
          vx: Math.round((L.vx + (L.dashT > 0 ? L.dashDx * C.DASH_DIST / C.DASH_TIME : 0)) * 10) / 10,
          vy: Math.round((L.vy + (L.dashT > 0 ? L.dashDy * C.DASH_DIST / C.DASH_TIME : 0)) * 10) / 10,
        });
      }
    }
  }

  function updateRemote(sNow) {
    const rt = sNow - INTERP_MS;
    for (const p of G.players) {
      if (p.isMe) continue;
      const b = p.buf;
      if (!b.length) { p.rx = p.x; p.ry = p.y; continue; }
      let a = b[0], c = b[b.length - 1];
      if (rt >= c.t) { a = c; }
      else if (rt > a.t) {
        for (let k = b.length - 1; k > 0; k--) { if (b[k - 1].t <= rt) { a = b[k - 1]; c = b[k]; break; } }
      } else { c = a; }
      const span = c.t - a.t;
      const f = span > 0 ? clamp((rt - a.t) / span, 0, 1) : 0;
      p.rx = a.x + (c.x - a.x) * f; p.ry = a.y + (c.y - a.y) * f;
      p.ax = a.ax + (c.ax - a.ax) * f; p.ay = a.ay + (c.ay - a.ay) * f;
      p.x = c.x; p.y = c.y; // posição mais recente (usada pela física da bola)
    }
  }

  /** Avança a bola prevista até o tempo `target` (relógio do servidor). */
  function advanceBall(target, resim) {
    if (!G.hasBall) return;
    const b = G.ball;
    if (target - G.ballT > 1500) G.ballT = target - 1500;
    const L = G.L;
    while (G.ballT + SUB_MS <= target) {
      G.prevX = b.x; G.prevY = b.y;
      const tg = targetPos(b.target);
      const ev = S.stepBall(b, tg, SUB_DT);
      G.ballT += SUB_MS;
      const fresh = G.ballT > G.sfxCursor;
      if (ev === EV.BOUNCE && fresh && !resim) {
        Sfx.bounce();
        burst(b.x, b.y, 6, ['#ffffff', tierFor(S.toKmh(S.effSpeed(b))).glow], 25, 0.3, 0.4);
      } else if (ev === EV.LAUNCH && fresh) {
        Sfx.launch();
      }
      // parry armado (apertou um pouco antes): rebate quando a bola chega
      if (b.phase === PHASE.FLY && b.target === G.meI && L.armedUntil >= G.ballT && G.me && G.me.alive) {
        const d = Math.hypot(G.me.x - b.x, G.me.y - b.y);
        if (d <= C.DEFLECT_DIST || S.timeToImpact(b, G.me.x, G.me.y) <= 0.03) {
          localDeflect(L.armedPerfect, false, G.ballT);
          break;
        }
      }
      if (ev === EV.CONTACT) { b.phase = PHASE.PENDING; G.localImpactT = G.ballT; break; }
    }
    if (b.phase === PHASE.PENDING || b.phase === PHASE.HOLD || G.await) G.ballT = Math.max(G.ballT, target - SUB_MS);
    G.sfxCursor = Math.max(G.sfxCursor, G.ballT);
  }

  // ---------- áudio contínuo ----------
  function updateAudio(sNow) {
    Sfx.music.update();
    const eff = G.hasBall ? S.effSpeed(G.ball) : C.BALL_START;
    Sfx.music.set(S.speedFrac(eff), G.duel);
    const me = G.me;
    if (me && me.alive && G.hasBall && G.ball.target === G.meI && G.ball.phase === PHASE.FLY) {
      const tti = S.timeToImpact(G.ball, me.x, me.y);
      if (tti < 1.6) {
        const period = clamp(tti * 0.42, 0.055, 0.42) * 1000;
        const n = performance.now();
        if (!G.nextTickAt || n >= G.nextTickAt) {
          Sfx.tick(clamp(1 - tti / 1.6, 0, 1));
          G.nextTickAt = n + period;
        }
      }
    } else G.nextTickAt = 0;
  }

  // =====================================================================
  // HUD (DOM, só escreve quando muda)
  // =====================================================================
  function updateHud(sNow) {
    const h = G.hud, d = G.dom;
    const eff = G.hasBall ? S.effSpeed(G.ball) : C.BALL_START;
    const kmh = S.toKmh(eff);
    if (kmh !== h.kmh) {
      const bumped = kmh - h.kmh > 8;
      h.kmh = kmh;
      d.speed.firstChild.textContent = kmh;
      const tier = tierFor(kmh).cls;
      if (tier !== h.tier) { d.speed.classList.remove(h.tier || 't1'); d.speed.classList.add(tier); h.tier = tier; }
      if (bumped) { d.speed.classList.remove('bump'); void d.speed.offsetWidth; d.speed.classList.add('bump'); }
    }
    if (G.rally !== h.rally) {
      h.rally = G.rally;
      d.rally.textContent = G.rally >= 2 ? `RALLY ×${G.rally}` : '';
      d.rally.classList.toggle('on', G.rally >= 2);
    }
    if (clock.synced) {
      const ms = Math.round(clock.rtt);
      const txt = `${ms} ms`;
      if (txt !== h.net && (performance.now() - (h.netAt || 0) > 500)) {
        h.net = txt; h.netAt = performance.now();
        d.net.textContent = G.perf ? `${ms} ms · ${Math.round(G.fps)} fps` : txt;
        d.net.classList.remove('good', 'mid', 'bad');
        d.net.classList.add(ms < 80 ? 'good' : ms < 160 ? 'mid' : 'bad');
      }
    }
    const me = G.me;
    const targeted = !!(me && me.alive && G.hasBall && G.ball.target === G.meI && G.phase === 'live');
    if (targeted !== h.alert) { h.alert = targeted; d.alert.classList.toggle('on', targeted); }
    const spec = !!(me && !me.alive && G.phase !== 'roundEnd' && G.phase !== 'over' && G.phase !== 'countdown');
    if (spec !== h.spec) { h.spec = spec; d.spec.style.display = spec ? '' : 'none'; }

    // habilidades
    const L = G.L;
    const pLeft = Math.max(0, L.parryReadyAt - sNow);
    const pTot = pLeft > C.HIT_CD * 1000 + 5 ? C.MISS_CD * 1000 : C.HIT_CD * 1000;
    const pp = Math.round((pLeft / pTot) * 50) / 50;
    const armed = L.armedUntil >= sNow;
    const pCls = armed ? 'armed' : pLeft > 0 ? 'cd' : '';
    if (pp !== h.parryP) { d.abParry.style.setProperty('--p', pp); h.parryP = pp; }
    if (pCls !== h.parryCls) {
      d.abParry.classList.remove('cd', 'armed');
      if (pCls) d.abParry.classList.add(pCls);
      if (!pCls && h.parryCls === 'cd') { d.abParry.classList.remove('ready'); void d.abParry.offsetWidth; d.abParry.classList.add('ready'); }
      h.parryCls = pCls;
    }
    const dLeft = Math.max(0, L.dashReadyAt - sNow);
    const dp = Math.round((dLeft / (C.DASH_CD * 1000)) * 50) / 50;
    if (dp !== h.dashP) {
      d.abDash.style.setProperty('--p', dp);
      if (dp === 0 && h.dashP > 0) { d.abDash.classList.remove('ready'); void d.abDash.offsetWidth; d.abDash.classList.add('ready'); }
      h.dashP = dp;
    }
    if (G.meter !== h.meter) {
      h.meter = G.meter;
      d.smash.querySelectorAll('i').forEach((el, k) => el.classList.toggle('on', k < G.meter));
      d.smash.classList.toggle('full', G.meter >= C.SMASH_CHARGES);
    }
    if (G.isTouch) {
      const tp = pLeft > 0 ? 'cd' : '';
      if (tp !== h.tParry) { d.tParry.classList.toggle('cd', !!tp); h.tParry = tp; }
      const td = dLeft > 0 ? 'cd' : '';
      if (td !== h.tDash) { d.tDash.classList.toggle('cd', !!td); h.tDash = td; }
    }
    // destaque do alvo no roster
    const tg = G.hasBall ? G.ball.target : -1;
    if (tg !== h.rosterTarget) {
      h.rosterTarget = tg;
      d.roster.querySelectorAll('.db2-chip').forEach(el => el.classList.toggle('target', Number(el.dataset.i) === tg));
    }
  }

  function renderRoster() {
    if (!G || !G.dom) return;
    const pips = (w) => Array.from({ length: G.winsToWin }, (_, k) => `<i class="${k < w ? 'on' : ''}"></i>`).join('');
    G.dom.roster.innerHTML = G.players.map(p => `
      <div class="db2-chip ${p.isMe ? 'me' : ''} ${p.alive ? '' : 'dead'}" data-i="${p.i}">
        <span class="dot" style="background:${p.color}"></span>
        <span class="nm">${esc(p.name)}${p.isBot ? ' 🤖' : ''}</span>
        <span class="lv">Lv${p.level}</span>
        <span class="pips">${pips(p.wins)}</span>
      </div>`).join('');
    G.hud.rosterTarget = null;
  }

  function addFeed(v, by, kmh, left) {
    const el = document.createElement('div');
    if (left) el.innerHTML = `<b>${esc(v.name)}</b> saiu`;
    else if (by && by.i !== v.i) el.innerHTML = `<b style="color:${by.color}">${esc(by.name)}</b> ☠ <b style="color:${v.color}">${esc(v.name)}</b><span class="kmh">${kmh} km/h</span>`;
    else el.innerHTML = `☠ <b style="color:${v.color}">${esc(v.name)}</b><span class="kmh">${kmh} km/h</span>`;
    G.dom.feed.prepend(el);
    while (G.dom.feed.children.length > 4) G.dom.feed.lastChild.remove();
    setTimeout(() => el.remove(), 5200);
  }

  function announce(text, cls, dur = 1.2, sub = '') {
    if (!G || !G.dom) return;
    const box = G.dom.announce;
    box.innerHTML = '';
    const el = document.createElement('div');
    el.className = `db2-ann ${cls || ''} ${text.length <= 2 ? 'huge' : text.length > 16 ? 'small' : ''}`;
    el.style.setProperty('--dur', dur + 's');
    el.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    box.appendChild(el);
    setTimeout(() => el.remove(), dur * 1000 + 50);
  }

  // =====================================================================
  // RENDER
  // =====================================================================
  function resize() {
    if (!G || !G.dom) return;
    const st = G.dom.stage;
    // ocupa a altura disponível da janela
    const top = st.getBoundingClientRect().top;
    const avail = Math.max(320, window.innerHeight - top);
    G.dom.root.style.height = avail + 'px';
    const w = st.clientWidth, h = st.clientHeight;
    if (!w || !h) return;
    const dprMax = G.q === 1 ? 2 : 1;
    G.dpr = Math.min(window.devicePixelRatio || 1, dprMax);
    G.W = w; G.H = h;
    const c = G.dom.canvas;
    c.width = Math.round(w * G.dpr); c.height = Math.round(h * G.dpr);
    const hudTop = 64, hudBottom = G.isTouch ? 24 : 92;
    const usableH = h - hudTop - hudBottom;
    const R = Math.max(80, Math.min(w / 2 - 12, usableH / 2));
    G.scale = R / (C.ARENA_R + 1.5);
    G.cx = w / 2;
    G.cy = hudTop + usableH / 2;
    // celular em pé: sobe a arena (o espaço de baixo é dos botões de toque)
    if (h > w * 1.3) G.cy = Math.max(hudTop + R + 70, h * 0.42);
    if (G.cy - R < 8) G.cy = h / 2;
    G.rect = st.getBoundingClientRect();
    G.bgDirty = true;
  }

  function perfTrack(ms) {
    if (!(ms > 0) || ms > 250) return;
    G.ft = G.ft * 0.95 + ms * 0.05;
    G.fps = 1000 / G.ft;
    if (G.q === 1 && G.ft > 23) {
      G.slowFrames++;
      if (G.slowFrames > 120) {
        G.q = 0; G.slowFrames = 0; resize();
        if (GameHub.showToast) GameHub.showToast('Modo desempenho ativado para manter o FPS', 'info');
      }
    } else G.slowFrames = Math.max(0, G.slowFrames - 1);
  }

  function drawBackground() {
    const W = G.W, H = G.H, dpr = G.dpr;
    if (!G.bg) G.bg = document.createElement('canvas');
    const c = G.bg;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext('2d', { alpha: false });
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const duel = G.duel;
    const accent = duel ? '#ef4444' : '#f59e0b';
    const R = C.ARENA_R * G.scale, cx = G.cx, cy = G.cy;

    g.fillStyle = '#060608'; g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, Math.max(W, H) * 0.75);
    vg.addColorStop(0, duel ? '#1a0808' : '#121216'); vg.addColorStop(1, '#050506');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);

    // arquibancada: pontos em anel
    g.fillStyle = duel ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.05)';
    for (let k = 0; k < 3; k++) {
      const rr = R + 18 + k * 12, n = Math.floor(rr * 0.42);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + k * 0.1;
        g.fillRect(cx + Math.cos(a) * rr - 1, cy + Math.sin(a) * rr - 1, 2, 2);
      }
    }

    // piso
    const fg = g.createRadialGradient(cx, cy - R * 0.2, 0, cx, cy, R);
    fg.addColorStop(0, duel ? '#22100f' : '#1c1c21'); fg.addColorStop(1, duel ? '#120808' : '#0e0e12');
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fillStyle = fg; g.fill();

    // grade hexagonal recortada no círculo
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    g.strokeStyle = duel ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.035)';
    g.lineWidth = 1;
    const hs = Math.max(10, G.scale * 4.2), hw = hs * Math.sqrt(3);
    g.beginPath();
    for (let row = -1; row * hs * 1.5 < H + hs; row++) {
      for (let col = -1; col * hw < W + hw; col++) {
        const x = col * hw + (row % 2 ? hw / 2 : 0), y = row * hs * 1.5;
        for (let s = 0; s < 6; s++) {
          const a0 = Math.PI / 6 + s * Math.PI / 3, a1 = a0 + Math.PI / 3;
          g.moveTo(x + Math.cos(a0) * hs, y + Math.sin(a0) * hs);
          g.lineTo(x + Math.cos(a1) * hs, y + Math.sin(a1) * hs);
        }
      }
    }
    g.stroke();
    // anéis internos
    g.setLineDash([3, 7]);
    g.strokeStyle = duel ? 'rgba(239,68,68,0.14)' : 'rgba(255,255,255,0.07)';
    [0.36, 0.7].forEach(f => { g.beginPath(); g.arc(cx, cy, R * f, 0, TAU); g.stroke(); });
    g.setLineDash([]);
    // emblema
    g.strokeStyle = hexA(accent, 0.22); g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, R * 0.12, 0, TAU); g.stroke();
    g.fillStyle = hexA(accent, 0.12);
    g.font = `800 ${Math.max(10, R * 0.055)}px Outfit, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(duel ? 'DUELO' : 'DEATH BALL', cx, cy);
    g.restore();

    // parede
    g.lineWidth = 10; g.strokeStyle = hexA(accent, 0.08);
    g.beginPath(); g.arc(cx, cy, R + 2, 0, TAU); g.stroke();
    g.lineWidth = 2.5; g.strokeStyle = hexA(accent, 0.85);
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
    g.lineWidth = 2; g.strokeStyle = hexA(accent, 0.5);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU, l = i % 5 === 0 ? 9 : 4;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 4));
      g.lineTo(cx + Math.cos(a) * (R + 4 + l), cy + Math.sin(a) * (R + 4 + l));
      g.stroke();
    }
    G.bgDirty = false;
  }

  function render(dt, sNow) {
    const ctx = G.ctx;
    if (!ctx || !G.W) return;
    if (G.bgDirty || !G.bg) drawBackground();
    const now = performance.now();
    const fxDt = dt * (G.slowmo > 0 ? 0.35 : 1);
    if (G.slowmo > 0) G.slowmo -= dt;

    // efeitos de câmera
    G.shake *= Math.exp(-dt * 7);
    G.punch *= Math.exp(-dt * 9);
    G.flash *= Math.exp(-dt * 7);
    const sh = G.shake > 0.02 ? G.shake * 5 : 0;
    const ox = sh ? (Math.random() - 0.5) * sh : 0, oy = sh ? (Math.random() - 0.5) * sh : 0;
    const dpr = G.dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const zoom = 1 + G.punch;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (G.cx * (1 - zoom) + ox), dpr * (G.cy * (1 - zoom) + oy));
    ctx.drawImage(G.bg, 0, 0, G.W, G.H);

    // mundo: translada para o centro da arena, 1 unidade = scale px
    ctx.translate(G.cx, G.cy);
    const s = G.scale;

    const b = G.ball;
    // posição renderizada da bola (interp. entre subpassos + correção suavizada)
    G.offX *= Math.exp(-dt * 12); G.offY *= Math.exp(-dt * 12);
    let bx = b.x, by = b.y;
    if (G.hasBall) {
      if (b.phase === PHASE.FLY && !G.await) {
        const a = clamp((sNow - G.ballT) / SUB_MS, 0, 1);
        bx = G.prevX + (b.x - G.prevX) * a; by = G.prevY + (b.y - G.prevY) * a;
      }
      if (b.phase === PHASE.PENDING) {
        // grudada no alvo: desenha encostada na posição renderizada dele
        const tg = P(b.target);
        if (tg) { const dx = b.x - tg.x, dy = b.y - tg.y; bx = tg.rx + dx; by = tg.ry + dy; }
      }
      bx += G.offX; by += G.offY;
    }
    G.renderBX = bx; G.renderBY = by;
    const eff = G.hasBall ? S.effSpeed(b) : C.BALL_START;
    const kmh = S.toKmh(eff);
    const tier = tierFor(kmh);

    // marca de perigo sob o alvo
    const tgP = G.hasBall ? P(b.target) : null;
    if (tgP && tgP.alive) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 90);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 + pulse * 0.15;
      const gr = 14 * s;
      ctx.drawImage(glowSprite('#ef4444'), tgP.rx * s - gr, tgP.ry * s - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // rastro da bola
    if (G.hasBall && b.phase !== PHASE.IDLE) {
      const tr = trail[trailHead];
      const prev = trail[(trailHead - 1 + TRAIL) % TRAIL];
      tr.x = bx; tr.y = by; tr.brk = prev.brk ? false : Math.hypot(prev.x - bx, prev.y - by) > 12;
      trailHead = (trailHead + 1) % TRAIL;
      drawTrail(ctx, s, tier, eff);
    }

    drawPlayers(ctx, s, now, sNow);
    if (G.hasBall) drawBall(ctx, s, bx, by, tier, eff, now);
    drawMyGuides(ctx, s, now, sNow);
    drawFx(ctx, s, fxDt);

    // camada de tela
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const me = G.me;
    let vig = 0;
    if (me && me.alive && G.hasBall && b.target === G.meI && b.phase !== PHASE.IDLE) {
      const tti = S.timeToImpact(b, me.x, me.y);
      vig = clamp(1 - tti / 1.2, 0, 1);
    }
    G.vignette += (vig - G.vignette) * Math.min(1, dt * 10);
    if (G.vignette > 0.02) {
      if (!G.vigCanvas || G.vigW !== G.W || G.vigH !== G.H) makeVignette();
      ctx.globalAlpha = G.vignette * 0.85;
      ctx.drawImage(G.vigCanvas, 0, 0, G.W, G.H);
      ctx.globalAlpha = 1;
    }
    if (G.flash > 0.01) {
      ctx.globalAlpha = G.flash; ctx.fillStyle = G.flashColor; ctx.fillRect(0, 0, G.W, G.H); ctx.globalAlpha = 1;
    }
  }

  function makeVignette() {
    const c = G.vigCanvas || (G.vigCanvas = document.createElement('canvas'));
    c.width = Math.max(1, Math.round(G.W / 2)); c.height = Math.max(1, Math.round(G.H / 2));
    const g = c.getContext('2d');
    const w = c.width, h = c.height;
    const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
    gr.addColorStop(0, 'rgba(239,68,68,0)'); gr.addColorStop(1, 'rgba(220,38,38,0.75)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    G.vigW = G.W; G.vigH = G.H;
  }

  function drawTrail(ctx, s, tier, eff) {
    const n = Math.min(TRAIL, 6 + Math.floor(S.speedFrac(eff) * 16));
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const widths = [C.BALL_R * 2.6 * s, C.BALL_R * 0.9 * s];
    const cols = [hexA(tier.glow, 0.22), hexA(tier.core, 0.55)];
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      let started = false;
      for (let k = 0; k < n; k++) {
        const t = trail[(trailHead - 1 - k + TRAIL * 2) % TRAIL];
        if (t.brk && k > 0) break;
        if (!started) { ctx.moveTo(t.x * s, t.y * s); started = true; } else ctx.lineTo(t.x * s, t.y * s);
        if (t.brk) break;
      }
      ctx.strokeStyle = cols[pass]; ctx.lineWidth = widths[pass];
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBall(ctx, s, bx, by, tier, eff, now) {
    const b = G.ball;
    const x = bx * s, y = by * s;
    const r = C.BALL_R * s;
    const charging = b.phase === PHASE.HOLD && b.aimAtTarget;
    if (charging) {
      const k = 1 - clamp(b.holdLeft / C.CHARGE_T, 0, 1);
      ctx.strokeStyle = hexA(tier.glow, 0.5 + k * 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r * (6 - k * 4.5), 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    const gr = r * (4 + S.speedFrac(eff) * 3) * (b.phase === PHASE.PENDING ? 1.6 : 1);
    ctx.drawImage(glowSprite(tier.glow), x - gr, y - gr, gr * 2, gr * 2);
    ctx.globalCompositeOperation = 'source-over';
    // estica na direção do movimento
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(b.dy, b.dx));
    const st = b.phase === PHASE.FLY ? 1 + S.speedFrac(eff) * 0.7 : 1;
    ctx.scale(st, 1 / Math.sqrt(st));
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = tier.core; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
    if (b.smash > 0.05) {
      ctx.strokeStyle = 'rgba(251,191,36,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r * (2.2 + Math.sin(now / 40) * 0.3), 0, TAU); ctx.stroke();
    }
  }

  function drawPlayers(ctx, s, now, sNow) {
    const pr = C.PLAYER_R * s;
    // mortos primeiro (marca no chão)
    for (const p of G.players) {
      if (p.alive || !p.deadAt) continue;
      const age = (now - p.deadAt) / 1000;
      const a = clamp(1 - age / 6, 0.18, 1) * 0.6;
      const x = p.deadX * s, y = p.deadY * s;
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - pr * 0.6, y - pr * 0.6); ctx.lineTo(x + pr * 0.6, y + pr * 0.6);
      ctx.moveTo(x + pr * 0.6, y - pr * 0.6); ctx.lineTo(x - pr * 0.6, y + pr * 0.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const ballTarget = G.hasBall ? G.ball.target : -1;
    for (const p of G.players) {
      if (!p.alive) continue;
      const x = p.rx * s, y = p.ry * s;
      // sombra
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.ellipse(x, y + pr * 0.55, pr * 1.05, pr * 0.55, 0, 0, TAU); ctx.fill();
      // brilho
      if (G.q === 1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = p.isMe ? 0.5 : 0.32;
        const g = pr * 3.2;
        ctx.drawImage(glowSprite(p.color), x - g, y - g, g * 2, g * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      // rastro do dash
      const dashAge = (now - p.dashFx) / 1000;
      if (dashAge < 0.25) {
        ctx.globalAlpha = (1 - dashAge / 0.25) * 0.5;
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = pr * 0.8;
        ctx.beginPath(); ctx.arc(x, y, pr * 1.3, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // alvo: anel vermelho pulsante (mais rápido quanto mais perto)
      if (p.i === ballTarget) {
        const tti = S.timeToImpact(G.ball, p.x, p.y);
        const sp = clamp(tti, 0.08, 1.2);
        const ph = (now / (sp * 900)) % 1;
        ctx.strokeStyle = `rgba(239,68,68,${0.9 - ph * 0.7})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, pr * (1.5 + ph * 1.2), 0, TAU); ctx.stroke();
      }
      // corpo
      ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU);
      ctx.fillStyle = '#0b0b0f'; ctx.fill();
      ctx.lineWidth = p.isMe ? 3 : 2.2;
      const denied = now - p.flashAt < 160;
      ctx.strokeStyle = denied ? '#ef4444' : p.color; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, pr * 0.52, 0, TAU);
      ctx.fillStyle = p.color; ctx.fill();
      // seta de mira
      const ax = p.ax, ay = p.ay, am = Math.hypot(ax, ay) || 1;
      const ux = ax / am, uy = ay / am;
      const tipD = pr * 1.95, baseD = pr * 1.3, wv = pr * 0.45;
      ctx.beginPath();
      ctx.moveTo(x + ux * tipD, y + uy * tipD);
      ctx.lineTo(x + ux * baseD - uy * wv, y + uy * baseD + ux * wv);
      ctx.lineTo(x + ux * baseD + uy * wv, y + uy * baseD - ux * wv);
      ctx.closePath();
      ctx.fillStyle = p.isMe ? '#fafafa' : hexA(p.color, 0.9); ctx.fill();
      // swing de parry
      const swAge = (now - p.swingAt) / 1000;
      if (swAge < 0.22) {
        const k = swAge / 0.22;
        ctx.strokeStyle = p.swingOk ? `rgba(253,230,138,${1 - k})` : `rgba(161,161,170,${0.8 - k * 0.8})`;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(x, y, pr * (1.2 + k * 1.4), 0, TAU); ctx.stroke();
      }
      // pronto para smash
      if (p.isMe && G.meter >= C.SMASH_CHARGES) {
        ctx.strokeStyle = 'rgba(251,191,36,0.85)'; ctx.lineWidth = 2;
        ctx.setLineDash([4, 5]); ctx.lineDashOffset = -now / 30;
        ctx.beginPath(); ctx.arc(x, y, pr * 1.55, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      // etiqueta
      if (p.tag) ctx.drawImage(p.tag, x - p.tagW / 2, y + pr * 1.35 + 4, p.tagW, p.tagH);
      // emote
      if (p.emote >= 0 && now < p.emoteUntil) {
        const k = 1 - (p.emoteUntil - now) / 1800;
        ctx.globalAlpha = k > 0.8 ? (1 - k) * 5 : 1;
        ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(EMOTES[p.emote], x, y - pr * 1.6 - k * 8);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Guias de timing para mim: anel de aproximação (estilo ritmo) e mira do próximo alvo. */
  function drawMyGuides(ctx, s, now, sNow) {
    const me = G.me;
    if (!me || !me.alive) return;
    const x = me.rx * s, y = me.ry * s;
    const b = G.ball;
    const pr = C.PLAYER_R * s;

    // cooldown do parry (arco vermelho)
    const left = G.L.parryReadyAt - sNow;
    if (left > 0) {
      const tot = left > C.HIT_CD * 1000 + 5 ? C.MISS_CD * 1000 : C.HIT_CD * 1000;
      ctx.strokeStyle = 'rgba(239,68,68,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, pr * 1.3, -Math.PI / 2, -Math.PI / 2 + TAU * (left / tot)); ctx.stroke();
    }

    if (G.hasBall && b.target === G.meI && b.phase !== PHASE.IDLE && b.phase !== PHASE.PENDING && G.phase === 'live') {
      const tti = S.timeToImpact(b, me.x, me.y);
      const eff = S.effSpeed(b);
      const win = S.parryWindow(eff), pw = S.perfectWindow(eff);
      const K = 34; // unidades de raio por segundo de antecedência
      const base = C.PLAYER_R + 0.8;
      if (tti < 1.3) {
        // zona de parry (verde) e zona perfeita (dourada)
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(74,222,128,0.45)';
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(x, y, (base + win * K) * s, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(251,191,36,0.5)';
        ctx.beginPath(); ctx.arc(x, y, (base + pw * K) * s, 0, TAU); ctx.stroke();
        // anel que fecha
        const rr = (base + Math.min(tti, 1.3) * K) * s;
        const armed = G.L.armedUntil >= sNow;
        const col = armed ? '#4ade80' : tti <= pw ? '#fbbf24' : tti <= win ? '#4ade80' : 'rgba(250,250,250,0.55)';
        ctx.strokeStyle = col;
        ctx.lineWidth = tti <= win ? 3.5 : 2;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      }
    }

    // mira: quem recebe a próxima rebatida
    const tgI = S.chooseTarget(G.meI, me.x, me.y, me.ax, me.ay, G.players);
    const tg = P(tgI);
    if (tg && tg.alive && G.phase !== 'roundEnd') {
      const tx = tg.rx * s, ty = tg.ry * s, rr = pr * 2.1, l = pr * 0.8;
      const hot = G.hasBall && b.target === G.meI;
      ctx.strokeStyle = hot ? 'rgba(250,250,250,0.9)' : 'rgba(250,250,250,0.3)';
      ctx.lineWidth = hot ? 2 : 1.5;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + k * Math.PI / 2;
        const cxp = tx + Math.cos(a) * rr, cyp = ty + Math.sin(a) * rr;
        ctx.moveTo(cxp - Math.cos(a) * l * 0.0 + Math.cos(a + Math.PI / 2) * l * 0.5, cyp + Math.sin(a + Math.PI / 2) * l * 0.5);
        ctx.lineTo(cxp, cyp);
        ctx.lineTo(cxp + Math.cos(a - Math.PI / 2) * l * 0.5, cyp + Math.sin(a - Math.PI / 2) * l * 0.5);
      }
      ctx.stroke();
    }
  }

  function drawFx(ctx, s, dt) {
    // anéis
    for (const r of rings) {
      if (!r.on) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.on = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.color; ctx.lineWidth = r.w * (1 - k * 0.6);
      ctx.beginPath(); ctx.arc(r.x * s, r.y * s, (r.r0 + (r.r1 - r.r0) * e) * s, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // partículas (aditivas)
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.life / p.max;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      const sz = Math.max(1, p.size * s * (0.4 + k * 0.6));
      ctx.fillRect(p.x * s - sz / 2, p.y * s - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // textos
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of texts) {
      if (!t.on) continue;
      t.t += dt;
      const k = t.t / t.dur;
      if (k >= 1) { t.on = false; continue; }
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, (k - 0.12));
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `800 ${Math.round(t.size * pop)}px Outfit, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(t.text, t.x * s + 1, (t.y - k * 4) * s + 2);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x * s, (t.y - k * 4) * s);
    }
    ctx.globalAlpha = 1;
  }

  // =====================================================================
  // RESULTADOS + XP
  // =====================================================================
  function showResults(d, snap) {
    cleanup();
    const meRow = d.rankings.find(r => r.i === snap.meI);
    const winner = d.rankings.find(r => r.winner) || d.rankings[0];
    const isWin = meRow && meRow.winner;

    // ---- XP / recordes ----
    let xpHtml = '';
    if (meRow) {
      const st = meRow.stats;
      const prof = Profile.load();
      const parts = [
        ['Partida', 20], ['Parries', st.parries * 2], ['Perfeitos', st.perfects * 4], ['No limite', st.clutches * 6],
        ['Eliminações', st.kills * 10], ['Rodadas', meRow.wins * 25], ['Vitória', isWin ? 60 : 0],
      ].filter(p => p[1] > 0);
      const gain = parts.reduce((a, p) => a + p[1], 0);
      const lv0 = prof.level, xp0 = prof.xp;
      prof.xp += gain;
      let ups = 0;
      while (prof.xp >= Profile.need(prof.level)) { prof.xp -= Profile.need(prof.level); prof.level++; ups++; }
      const badges = [];
      const myKmh = S.toKmh(st.maxParrySpeed);
      if (myKmh > prof.bestKmh && st.parries > 0) { badges.push(`Recorde: parry a ${myKmh} km/h`); prof.bestKmh = myKmh; }
      if (st.bestRally > prof.bestRally && st.bestRally >= 5) { badges.push(`Recorde: rally ${st.bestRally}`); prof.bestRally = st.bestRally; }
      if (ups > 0) badges.unshift(`Subiu para o nível ${prof.level}!`);
      if (st.clutches >= 2) badges.push('Sangue frio');
      if (st.smashes >= 1) badges.push(`${st.smashes} smash${st.smashes > 1 ? 'es' : ''}`);
      prof.matches++; if (isWin) prof.wins++;
      prof.perfects += st.perfects; prof.clutches += st.clutches;
      Profile.save(prof);
      const from = ups > 0 ? 0 : (xp0 / Profile.need(lv0)) * 100;
      const to = (prof.xp / Profile.need(prof.level)) * 100;
      xpHtml = `
        <div class="db2-xp">
          <div class="db2-xp-row">
            <span class="db2-xp-lv">Nível ${prof.level}<em>${esc(Profile.title(prof.level))}</em></span>
            <span class="db2-xp-gain">+${gain} XP</span>
          </div>
          <div class="db2-xp-bar"><div class="db2-xp-fill" id="db2-xp-fill" style="width:${from}%" data-to="${to}"></div></div>
          <div class="db2-xp-break">${parts.map(p => `<span>${esc(p[0])} <b>+${p[1]}</b></span>`).join('')}</div>
          ${badges.length ? `<div class="db2-badges">${badges.map((b, k) => `<span class="db2-badge" style="animation-delay:${0.5 + k * 0.15}s">${esc(b)}</span>`).join('')}</div>` : ''}
        </div>`;
      if (ups > 0) setTimeout(() => Sfx.levelUp(), 900);
    }

    const rows = d.rankings.map((r, k) => {
      const st = r.stats;
      return `<tr class="${r.i === snap.meI ? 'me' : ''}">
        <td>${k === 0 ? '🏆' : k + 1}</td>
        <td><span class="sw" style="background:${r.color}"></span>${esc(r.name)}${r.isBot ? ' 🤖' : ''}</td>
        <td>${r.wins}</td>
        <td>${st.parries}</td>
        <td class="opt">${st.perfects}</td>
        <td class="opt">${st.kills}</td>
        <td class="opt">${S.toKmh(st.maxParrySpeed)}</td>
        <td class="pts">+${r.score}</td>
      </tr>`;
    }).join('');

    DOM.resultsTitle.textContent = '💀 Death Ball';
    const card = DOM.resultsOverlay.querySelector('.results-card');
    if (card) card.classList.add('db2-results-card');
    const host = GameHub.state && GameHub.state.isHost;
    DOM.resultsContent.innerHTML = `
      <div class="db2-res">
        <div class="db2-res-hero">
          <div class="db2-res-crown">${isWin ? '👑' : '🏆'}</div>
          <div class="db2-res-name">${esc(winner.name)}</div>
          <div class="db2-res-sub">${isWin ? 'Você é o último de pé!' : 'venceu a partida'}</div>
        </div>
        <div class="db2-res-highlights">
          <div class="db2-res-hl"><b>${d.maxKmh}</b><span>km/h máx.</span></div>
          <div class="db2-res-hl"><b>${d.bestRally}</b><span>maior rally</span></div>
          <div class="db2-res-hl"><b>${d.rounds}</b><span>rodadas</span></div>
        </div>
        <table class="db2-res-table">
          <thead><tr><th></th><th>Jogador</th><th>Rod.</th><th>Parry</th><th class="opt">Perf.</th><th class="opt">Elim.</th><th class="opt">km/h</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${xpHtml}
        ${host ? `<div class="db2-res-actions"><button class="btn btn-primary btn-lg" id="db2-rematch" style="flex:1">⚡ Revanche</button></div>` : ''}
      </div>`;
    DOM.resultsOverlay.classList.remove('hidden');
    const fill = document.getElementById('db2-xp-fill');
    if (fill) requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = fill.dataset.to + '%'; }));
    const rm = document.getElementById('db2-rematch');
    if (rm) rm.addEventListener('click', () => { rm.disabled = true; socket.emit('game:start', { gameId: 'death-ball' }); });
  }

  // diagnóstico (console: __deathball())
  window.__deathball = () => G;

  // =====================================================================
  // LIMPEZA
  // =====================================================================
  function cleanup() {
    if (!G) return;
    if (G.raf) cancelAnimationFrame(G.raf);
    G.handlers.forEach(off => off());
    if (G.ro) G.ro.disconnect();
    stopPinging();
    Sfx.music.stop();
    DOM.gameArea.classList.remove('db2-host');
    resetPools();
    G = null;
  }
})();
