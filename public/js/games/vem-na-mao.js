/**
 * Vem na Mão — cliente
 *
 * Briga de rua vista de cima. PORRADA > AGARRÃO > PARRY > PORRADA.
 *
 * Rede:
 *  - Relógio sincronizado (ping/pong, menor RTT vence).
 *  - O próprio boneco é PREVISTO com o mesmo passo do servidor (vemnamao/shared.js): cada tick de 60 Hz vira
 *    um input numerado; a cada snapshot o cliente volta para a posição do servidor e reaplica os inputs que o
 *    servidor ainda não processou. O erro que sobra é suavizado (sem teleporte).
 *  - Adversários são interpolados 90 ms no passado. Projéteis e bombas são simulados aqui a partir do disparo.
 *
 * Input: e.code, sem auto-repeat, teclas zeradas ao perder o foco, um único pointerdown por botão,
 * botões sem foco (tabindex=-1). Cada aperto vai em exatamente um input numerado (nunca duplica).
 */
(() => {
  'use strict';
  const { socket, DOM } = GameHub;
  const S = window.VemNaMaoShared;
  if (!S) { console.error('[VemNaMao] shared.js não carregado'); return; }
  const { C, ST, BTN, WEAPONS, WEAPON_IDS, SPECIAL, ACT_KINDS } = S;
  const esc = (t) => GameHub.escapeHtml(String(t == null ? '' : t));
  const PREFIX = 'game:vemnamao:';
  const INTERP_MS = 90;
  const TICK_MS = 1000 / C.TICK_HZ;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const angLerp = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * k; };

  const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const KEY_BTN = {
    Space: BTN.PARRY, KeyK: BTN.PARRY,
    KeyE: BTN.GRAB, KeyL: BTN.GRAB,
    ShiftLeft: BTN.DASH, ShiftRight: BTN.DASH,
    KeyQ: BTN.SPECIAL, KeyI: BTN.SPECIAL,
    KeyR: BTN.SWAP, KeyF: BTN.SWAP,
    KeyJ: BTN.ATK,
  };
  const HOW = {
    atk: 'na mão', arremesso: 'arremessou', parede: 'jogou na parede', zona: 'a zona', sangue: 'sangrou', bomba: 'bombinha',
    voadora: 'voadora', homerun: 'home run', bote: 'bote', varrida: 'varrida', pedra: 'pedrada', chinelo: 'chinelada',
    panelaco: 'panelaço', boliche: 'boliche', saiu: 'saiu',
  };
  const W_ICON = { maos: '👊', chinelo: '🩴', taco: '🏏', peixeira: '🔪', frigideira: '🍳', estilingue: '🪃', vassoura: '🧹', bombinha: '🧨' };

  // =====================================================================
  // ÁUDIO (procedural)
  // =====================================================================
  const Sfx = (() => {
    let ac = null, master = null, noiseBuf = null, muted = false;
    try { muted = localStorage.getItem('gh_vm_muted') === '1'; } catch (e) { /* */ }
    const last = {};
    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
        master = ac.createGain(); master.gain.value = muted ? 0 : 0.8;
        master.connect(comp); comp.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    const gate = (n, ms) => { const t = performance.now(); if (last[n] && t - last[n] < ms) return false; last[n] = t; return true; };
    function tone(f, dur, type, vol, o = {}) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + (o.delay || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = type || 'sine'; osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.02);
    }
    function noise(dur, vol, ft, f0, f1, o = {}) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + (o.delay || 0);
      const src = c.createBufferSource(); src.buffer = noiseBuf;
      const f = c.createBiquadFilter(); f.type = ft || 'bandpass'; f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    }
    return {
      unlock() { ensure(); },
      isMuted: () => muted,
      toggleMute() {
        muted = !muted;
        try { localStorage.setItem('gh_vm_muted', muted ? '1' : '0'); } catch (e) { /* */ }
        if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ac.currentTime, 0.03);
        return muted;
      },
      swing(heavy) { if (gate('sw', 40)) noise(heavy ? 0.22 : 0.12, heavy ? 0.3 : 0.18, 'bandpass', heavy ? 500 : 900, heavy ? 1800 : 2600, { q: 1.2 }); },
      hit(big, near) {
        if (!gate('hit', 25)) return;
        const v = near ? 1 : 0.45;
        tone(big ? 110 : 160, big ? 0.22 : 0.12, 'sine', 0.7 * v, { to: 45 });
        noise(big ? 0.16 : 0.08, 0.5 * v, 'lowpass', big ? 2200 : 3200, 300);
      },
      parry(sup) {
        noise(0.06, 0.55, 'highpass', 3000, 0);
        tone(1400, 0.16, 'square', 0.1); tone(2100, 0.22, 'triangle', 0.12, { delay: 0.01 });
        if (sup) { tone(700, 0.4, 'square', 0.12, { to: 1400 }); noise(0.3, 0.3, 'bandpass', 1200, 4000); }
      },
      grab() { tone(300, 0.1, 'square', 0.12, { to: 180 }); noise(0.08, 0.25, 'bandpass', 700, 0); },
      throw() { noise(0.3, 0.35, 'bandpass', 400, 1600, { q: 0.8 }); tone(220, 0.25, 'sawtooth', 0.08, { to: 90 }); },
      clank() { tone(2600, 0.08, 'square', 0.1); tone(1800, 0.12, 'square', 0.08, { delay: 0.02 }); noise(0.05, 0.4, 'highpass', 4000, 0); },
      splat() { tone(70, 0.35, 'sine', 0.9, { to: 30 }); noise(0.25, 0.6, 'lowpass', 1600, 120); },
      boom() { noise(0.8, 0.9, 'lowpass', 2600, 60); tone(60, 0.6, 'sine', 0.9, { to: 25 }); },
      dash() { if (gate('dash', 60)) noise(0.14, 0.25, 'bandpass', 800, 3000, { q: 1.4 }); },
      shoot() { if (gate('shoot', 40)) { tone(600, 0.06, 'square', 0.05, { to: 300 }); noise(0.06, 0.2, 'highpass', 2000, 0); } },
      pick() { tone(660, 0.07, 'triangle', 0.12); tone(990, 0.1, 'triangle', 0.12, { delay: 0.06 }); },
      brk() { noise(0.2, 0.4, 'highpass', 1500, 0); tone(400, 0.2, 'sawtooth', 0.06, { to: 120 }); },
      eat() { [523, 659, 784].forEach((f, k) => tone(f, 0.12, 'sine', 0.1, { delay: k * 0.05 })); },
      ko(mine) { noise(0.7, 0.7, 'lowpass', 3000, 80); tone(120, 0.6, 'sine', 0.8, { to: 30 }); if (mine) [784, 988, 1319].forEach((f, k) => tone(f, 0.2, 'triangle', 0.12, { delay: 0.12 + k * 0.07 })); },
      count(n) { tone(n > 0 ? 520 : 880, n > 0 ? 0.1 : 0.4, 'square', 0.12); if (!n) { tone(1320, 0.4, 'triangle', 0.1); noise(0.3, 0.3, 'bandpass', 800, 3000); } },
      deny() { if (gate('deny', 150)) tone(160, 0.07, 'square', 0.06); },
      zone() { if (gate('zone', 400)) tone(90, 0.3, 'sawtooth', 0.08, { to: 70 }); },
      win() { [523, 659, 784, 1047, 1319].forEach((f, k) => tone(f, 0.28, 'triangle', 0.14, { delay: k * 0.09 })); },
      lose() { [392, 330, 262].forEach((f, k) => tone(f, 0.3, 'triangle', 0.12, { delay: k * 0.12 })); },
    };
  })();

  // =====================================================================
  // RELÓGIO
  // =====================================================================
  const clock = { offset: 0, rtt: 0, samples: [], synced: false, timer: null, n: 0 };
  const serverNow = () => performance.now() + clock.offset;
  function sendPing() { socket.emit('game:action', { action: 'ping', c: performance.now(), rtt: Math.round(clock.rtt) }); }
  socket.on(PREFIX + 'pong', (d) => {
    const n = performance.now(), rtt = n - d.c;
    if (!(rtt >= 0) || rtt > 3000) return;
    clock.samples.push({ rtt, off: d.s + rtt / 2 - n });
    if (clock.samples.length > 10) clock.samples.shift();
    let best = clock.samples[0];
    for (const s of clock.samples) if (s.rtt < best.rtt) best = s;
    if (!clock.synced) { clock.offset = best.off; clock.synced = true; } else clock.offset += (best.off - clock.offset) * 0.3;
    clock.rtt = clock.rtt ? clock.rtt * 0.75 + rtt * 0.25 : rtt;
  });
  function startPinging() {
    stopPinging(); clock.n = 0;
    const go = () => { if (!G) return; sendPing(); clock.n++; clock.timer = setTimeout(go, clock.n < 6 ? 150 : 1000); };
    go();
  }
  function stopPinging() { if (clock.timer) clearTimeout(clock.timer); clock.timer = null; }

  // =====================================================================
  // ESTADO
  // =====================================================================
  let G = null;

  // pools de efeitos
  const parts = [], texts = [], rings = [];
  function burst(x, y, n, color, spd = 260, life = 0.45, size = 4) {
    if (G && G.q === 0) n = Math.ceil(n / 2);
    for (let k = 0; k < n; k++) {
      if (parts.length > 400) parts.shift();
      const a = Math.random() * TAU, s = spd * (0.3 + Math.random() * 0.7);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: size * (0.6 + Math.random() * 0.8), color });
    }
  }
  function sparkDir(x, y, dx, dy, n, color, spd = 420) {
    for (let k = 0; k < n; k++) {
      const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.2, s = spd * (0.4 + Math.random() * 0.6);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3, max: 0.3, size: 3 + Math.random() * 3, color });
    }
  }
  function ring(x, y, r0, r1, dur, color, w = 4) { rings.push({ x, y, r0, r1, t: 0, dur, color, w }); }
  function floatText(x, y, text, color, size = 22, dur = 0.9, big = false) {
    if (texts.length > 40) texts.shift();
    texts.push({ x, y, text, color, size, t: 0, dur, big, dx: (Math.random() - 0.5) * 30 });
  }

  function newMirror() {
    return { act: null, stunT: 0, dashT: 0, dashX: 0, dashY: 0, forcedT: 0, fx: 0, fy: 0, slowT: 0, dashCh: C.DASH_CHARGES, dashRe: 0, cd: 0, buf: 0, bufT: 0, held: false };
  }

  socket.on(PREFIX + 'start', (data) => {
    cleanup();
    const myId = socket.id;
    const isTouch = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    G = {
      players: data.players.map(p => ({
        i: p.i, id: p.id, name: p.name, color: p.color, isBot: p.isBot, isMe: p.id === myId,
        buf: [], x: 0, y: 0, ang: 0, hp: C.HP, st: ST.IDLE, left: 0, w: 0, fl: 0, k: 0, alive: true,
        rx: 0, ry: 0, rang: 0, rst: ST.IDLE, rleft: 0, rk: 0, hitFlash: 0, wins: 0, score: 0, tag: null, lastHpShown: C.HP,
        swingT: -1, swingK: 0, kills: 0,
      })),
      meI: -1, me: null, solo: !!data.solo, winsToWin: data.winsToWin || 3,
      round: 0, phase: 'countdown', liveAt: 0, map: S.MAPS[0], zone: null, lastCount: 99,
      // previsão
      pred: { x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0 }, mm: newMirror(), myW: 'maos', myUses: -1, myHp: C.HP,
      seq: 0, hist: [], outBuf: [], pendBtn: 0, offX: 0, offY: 0, acc: 0, lastAck: -1, snapCount: 0, corrections: 0,
      ax: 1, ay: 0,
      // mundo
      ground: new Map(), items: new Map(), projs: new Map(), bombs: new Map(),
      // entrada
      keys: new Set(), mouse: { x: 0, y: 0, has: false, at: 0 }, joy: { id: null, ox: 0, oy: 0, dx: 0, dy: 0 },
      // câmera / render
      camX: 1100, camY: 1100, scale: 1, W: 0, H: 0, dpr: 1, q: 1, bg: null, bgKey: '', mini: null,
      shake: 0, hitstop: 0, flash: 0, flashColor: '#fff', spec: -1, specAt: 0,
      ft: 16.7, slowFrames: 0, fps: 60, lastTs: 0, raf: 0, handlers: [], ro: null, isTouch, hud: {}, perf: false,
      help: true, feed: [], decals: [], lastSnapT: 0,
    };
    G.meI = G.players.findIndex(p => p.isMe);
    G.me = G.players[G.meI] || null;
    try { G.help = (Number(localStorage.getItem('gh_vm_games') || 0) < 3); } catch (e) { /* */ }
    clock.samples = []; clock.synced = false; clock.rtt = 0;
    clock.offset = data.st - performance.now() + 30;
    startPinging();
    buildDom();
    bindInput();
    resize();
    parts.length = 0; texts.length = 0; rings.length = 0;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    Sfx.unlock();
    G.lastTs = performance.now();
    G.raf = requestAnimationFrame(frame);
  });

  function buildDom() {
    if (DOM.resultsOverlay) DOM.resultsOverlay.classList.add('hidden');
    DOM.gameArea.classList.add('vm-host');
    DOM.gameArea.innerHTML = `
      <div class="vm ${G.isTouch ? 'is-touch' : ''}" id="vm">
        <div class="vm-stage" id="vm-stage">
          <canvas id="vm-canvas"></canvas>
          <div class="vm-top">
            <div class="vm-left">
              <span class="vm-pill vm-alive" id="vm-alive">VIVOS —</span>
              <span class="vm-pill" id="vm-round">Rodada 1</span>
            </div>
            <div class="vm-right">
              <span class="vm-pill vm-net" id="vm-net">-- ms</span>
              <button class="vm-iconbtn" id="vm-mute" tabindex="-1" title="Som (M)">${Sfx.isMuted() ? '🔇' : '🔊'}</button>
            </div>
          </div>
          <canvas class="vm-mini" id="vm-mini" width="150" height="150"></canvas>
          <div class="vm-feed" id="vm-feed"></div>
          <div class="vm-announce" id="vm-announce"></div>
          <div class="vm-zonewarn" id="vm-zonewarn">⚠ FORA DA ZONA</div>
          <div class="vm-spec" id="vm-spec" style="display:none"></div>
          <div class="vm-hud" id="vm-hud">
            <div class="vm-hp"><div class="vm-hp-fill" id="vm-hp-fill"></div><b id="vm-hp-num">100</b></div>
            <div class="vm-weapon" id="vm-weapon">
              <span class="vm-w-ico" id="vm-w-ico">👊</span>
              <div class="vm-w-info"><b id="vm-w-name">Mãos</b><small id="vm-w-uses">∞</small></div>
              <div class="vm-sp" id="vm-sp"><span id="vm-sp-name">Voadora</span><kbd>Q</kbd><i id="vm-sp-cd"></i></div>
            </div>
            <div class="vm-dash" id="vm-dash"><i></i><i></i><span>DASH</span></div>
          </div>
          <div class="vm-rps" id="vm-rps" style="${G.help ? '' : 'display:none'}">
            <div class="vm-rps-tri">
              <span class="r-atk">PORRADA</span><em>vence</em><span class="r-grab">AGARRÃO</span><em>vence</em><span class="r-parry">PARRY</span><em>vence</em><span class="r-atk">PORRADA</span>
            </div>
            <div class="vm-rps-keys">${G.isTouch ? 'Joystick move · botões à direita' :
              '<kbd>WASD</kbd> mover · <kbd>Mouse</kbd> mirar · <kbd>Clique</kbd> porrada · <kbd>Dir.</kbd>/<kbd>Espaço</kbd> parry · <kbd>E</kbd> agarrão · <kbd>Shift</kbd> dash · <kbd>Q</kbd> especial · <kbd>R</kbd> pegar/largar · <kbd>H</kbd> ajuda'}</div>
          </div>
          <div class="vm-touch">
            <div class="vm-joy" id="vm-joy"><div class="vm-joy-base" id="vm-joy-base"><div class="vm-joy-knob" id="vm-joy-knob"></div></div></div>
            <div class="vm-tbtns">
              <button class="vm-tbtn t-atk" data-b="${BTN.ATK}" tabindex="-1">PORRADA</button>
              <button class="vm-tbtn t-parry" data-b="${BTN.PARRY}" tabindex="-1">PARRY</button>
              <button class="vm-tbtn t-grab" data-b="${BTN.GRAB}" tabindex="-1">AGARRA</button>
              <button class="vm-tbtn t-dash" data-b="${BTN.DASH}" tabindex="-1">DASH</button>
              <button class="vm-tbtn t-sp" data-b="${BTN.SPECIAL}" tabindex="-1" id="vm-tsp">ESPECIAL</button>
              <button class="vm-tbtn t-swap" data-b="${BTN.SWAP}" tabindex="-1" id="vm-tswap">PEGAR</button>
            </div>
          </div>
        </div>
      </div>`;
    const $ = (id) => document.getElementById(id);
    G.dom = {
      root: $('vm'), stage: $('vm-stage'), canvas: $('vm-canvas'), mini: $('vm-mini'), alive: $('vm-alive'), round: $('vm-round'),
      net: $('vm-net'), mute: $('vm-mute'), feed: $('vm-feed'), announce: $('vm-announce'), zonewarn: $('vm-zonewarn'), spec: $('vm-spec'),
      hpFill: $('vm-hp-fill'), hpNum: $('vm-hp-num'), wIco: $('vm-w-ico'), wName: $('vm-w-name'), wUses: $('vm-w-uses'),
      weapon: $('vm-weapon'), sp: $('vm-sp'), spName: $('vm-sp-name'), spCd: $('vm-sp-cd'), dash: $('vm-dash'), rps: $('vm-rps'), hud: $('vm-hud'),
      joy: $('vm-joy'), joyBase: $('vm-joy-base'), joyKnob: $('vm-joy-knob'), tsp: $('vm-tsp'), tswap: $('vm-tswap'),
    };
    G.ctx = G.dom.canvas.getContext('2d', { alpha: false, desynchronized: true });
    G.mctx = G.dom.mini.getContext('2d');
    G.hud = {};
  }

  // =====================================================================
  // INPUT
  // =====================================================================
  function on(t, ev, fn, o) { t.addEventListener(ev, fn, o); G.handlers.push(() => t.removeEventListener(ev, fn, o)); }
  const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  function press(b) {
    if (!G) return;
    Sfx.unlock();
    if (G.phase === 'over') return;
    G.pendBtn |= b;
  }

  function bindInput() {
    const d = G.dom;
    on(document, 'keydown', (e) => {
      if (!G || isTyping(e.target)) return;
      const code = e.code;
      if (MOVE_KEYS[code] || KEY_BTN[code] != null) e.preventDefault();
      if (e.repeat) return;
      G.keys.add(code);
      if (KEY_BTN[code] != null) {
        if (isDead() && (code === 'Space')) { cycleSpec(); return; }
        press(KEY_BTN[code]);
      } else if (code === 'KeyM') { const m = Sfx.toggleMute(); d.mute.textContent = m ? '🔇' : '🔊'; }
      else if (code === 'KeyH') { G.help = !G.help; d.rps.style.display = G.help ? '' : 'none'; }
      else if (code === 'F3' || code === 'Backquote') { G.perf = !G.perf; e.preventDefault(); }
      Sfx.unlock();
    });
    on(document, 'keyup', (e) => { if (G) G.keys.delete(e.code); });
    const clearAll = () => {
      if (!G) return;
      G.keys.clear(); G.joy.id = null; G.joy.dx = G.joy.dy = 0;
      d.joyBase.classList.remove('active'); d.joyKnob.style.transform = '';
    };
    on(window, 'blur', clearAll);
    on(document, 'visibilitychange', () => { if (document.hidden) clearAll(); });

    on(window, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      G.mouse.x = e.clientX; G.mouse.y = e.clientY; G.mouse.has = true; G.mouse.at = performance.now();
    });
    on(d.stage, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.target.closest('button')) return;
      e.preventDefault();
      G.mouse.x = e.clientX; G.mouse.y = e.clientY; G.mouse.has = true; G.mouse.at = performance.now();
      if (isDead()) { cycleSpec(); return; }
      if (e.button === 0) press(BTN.ATK);
      else if (e.button === 2) press(BTN.PARRY);
      else if (e.button === 1) press(BTN.GRAB);
    });
    on(d.stage, 'contextmenu', (e) => e.preventDefault());
    on(d.mute, 'pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); const m = Sfx.toggleMute(); d.mute.textContent = m ? '🔇' : '🔊'; });

    // joystick
    on(d.joy, 'pointerdown', (e) => {
      if (G.joy.id !== null) return;
      e.preventDefault(); Sfx.unlock();
      if (isDead()) { cycleSpec(); return; }
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
      const dx = e.clientX - G.joy.ox, dy = e.clientY - G.joy.oy, m = Math.hypot(dx, dy), R = 48;
      const k = m > R ? R / m : 1;
      d.joyKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      if (m < 8) { G.joy.dx = G.joy.dy = 0; } else { const s = Math.min(1, (m - 8) / (R - 8)); G.joy.dx = dx / m * s; G.joy.dy = dy / m * s; }
    });
    const joyEnd = (e) => {
      if (e.pointerId !== G.joy.id) return;
      G.joy.id = null; G.joy.dx = G.joy.dy = 0;
      d.joyKnob.style.transform = ''; d.joyBase.classList.remove('active');
    };
    on(d.joy, 'pointerup', joyEnd); on(d.joy, 'pointercancel', joyEnd);
    d.root.querySelectorAll('.vm-tbtn').forEach(b => {
      const bit = Number(b.dataset.b);
      on(b, 'pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        b.classList.add('pressed');
        if (isDead()) { cycleSpec(); return; }
        press(bit);
      });
      const up = () => b.classList.remove('pressed');
      on(b, 'pointerup', up); on(b, 'pointercancel', up); on(b, 'pointerleave', up);
    });

    if (window.ResizeObserver) { G.ro = new ResizeObserver(() => resize()); G.ro.observe(d.stage); }
    on(window, 'resize', resize);
  }

  function isDead() { return G && G.me && !G.me.alive; }

  function moveVec() {
    let x = 0, y = 0;
    for (const k of G.keys) { const v = MOVE_KEYS[k]; if (v) { x += v[0]; y += v[1]; } }
    if (G.joy.id !== null) { x += G.joy.dx; y += G.joy.dy; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return [x, y];
  }

  /** Mira: mouse (se mexeu nos últimos 2,5 s), senão direção do movimento com mira assistida. */
  function aimVec(mx, my) {
    const me = G.pred;
    const now = performance.now();
    if (G.mouse.has && !G.isTouch && now - G.mouse.at < 2500 && G.rect) {
      const sx = G.mouse.x - G.rect.left, sy = G.mouse.y - G.rect.top;
      const wx = (sx - G.W / 2) / G.scale + G.camX, wy = (sy - G.H / 2) / G.scale + G.camY;
      const dx = wx - (me.x + G.offX), dy = wy - (me.y + G.offY), dm = Math.hypot(dx, dy);
      if (dm > 4) return [dx / dm, dy / dm];
      return [G.ax, G.ay];
    }
    // assistida: inimigo mais perto dentro de 300u, preferindo o que está na direção do movimento
    let base = Math.hypot(mx, my) > 0.2 ? [mx, my] : [G.ax, G.ay];
    const bm = Math.hypot(base[0], base[1]) || 1; base = [base[0] / bm, base[1] / bm];
    let best = null, bs = -1e9;
    for (const p of G.players) {
      if (p.isMe || !p.alive) continue;
      const dx = p.rx - me.x, dy = p.ry - me.y, d = Math.hypot(dx, dy);
      if (d > 300 || d < 1) continue;
      const cos = (dx * base[0] + dy * base[1]) / d;
      if (cos < 0.15 && d > 120) continue;
      const sc = cos * 1.4 - d / 300;
      if (sc > bs) { bs = sc; best = [dx / d, dy / d]; }
    }
    return best || base;
  }

  // =====================================================================
  // PREVISÃO DO PRÓPRIO BONECO (espelha o servidor)
  // =====================================================================
  function mmState(mm) {
    if (G.me && !G.me.alive) return ST.DEAD;
    if (mm.held) return ST.HELD;
    if (mm.stunT > 0) return ST.STUN;
    if (mm.act) return S.actState(mm.act, G.myW);
    if (mm.dashT > 0) return ST.DASH;
    return ST.IDLE;
  }
  function mmBusy(mm) { return mm.stunT > 0 || mm.act || mm.held || (G.me && !G.me.alive); }

  /** Um tick de 60 Hz do próprio boneco (mesma ordem do servidor). */
  function simStep(p, mm, inp, live) {
    const b = inp.b;
    if (b && live) {
      if (b & BTN.DASH) {
        let ok = !mm.held && mm.stunT <= 0 && mm.dashCh > 0 && mm.dashT <= 0;
        if (ok && mm.act) { const st = mmState(mm); ok = st === ST.ATK_R || st === ST.GRAB_R || st === ST.PARRY_R; if (ok) mm.act = null; }
        if (ok) {
          let dx = inp.mx, dy = inp.my, dm = Math.hypot(dx, dy);
          if (dm < 0.2) { dx = inp.nax; dy = inp.nay; dm = 1; }
          mm.dashX = dx / dm; mm.dashY = dy / dm; mm.dashT = C.DASH_T;
          mm.dashCh--; if (mm.dashRe <= 0) mm.dashRe = C.DASH_RECHARGE;
        }
      }
      const act = b & (BTN.ATK | BTN.PARRY | BTN.GRAB | BTN.SPECIAL);
      if (act) { mm.buf = (act & BTN.PARRY) || (act & BTN.GRAB) || (act & BTN.SPECIAL) || (act & BTN.ATK); mm.bufT = C.BUFFER_T; }
    }
    if (mm.held) return;
    if (mm.dashRe > 0 && mm.dashCh < C.DASH_CHARGES) { mm.dashRe -= C.DT; if (mm.dashRe <= 0) { mm.dashCh++; mm.dashRe = mm.dashCh < C.DASH_CHARGES ? C.DASH_RECHARGE : 0; } }
    if (mm.cd > 0) mm.cd = Math.max(0, mm.cd - C.DT);
    if (mm.slowT > 0) mm.slowT -= C.DT;
    if (mm.stunT > 0) mm.stunT = Math.max(0, mm.stunT - C.DT);
    if (mm.act) { mm.act.t += C.DT; if (!mm.act.held && mm.act.t >= mm.act.dur) mm.act = null; }
    if (mm.bufT > 0) {
      mm.bufT -= C.DT;
      if (!mmBusy(mm) && mm.dashT <= 0) {
        const bb = mm.buf; mm.buf = 0; mm.bufT = 0;
        startLocalAct(mm, bb, inp);
      }
    }
    if (mm.dashT > 0) mm.dashT -= C.DT;
    if (mm.forcedT > 0) mm.forcedT -= C.DT;
    const st = mmState(mm);
    S.stepMove(p, { mx: inp.mx, my: inp.my }, C.DT, G.map, {
      st, special: mm.act && mm.act.k, slow: mm.slowT, dashT: mm.dashT, dashX: mm.dashX, dashY: mm.dashY, forcedT: mm.forcedT, fx: mm.fx, fy: mm.fy,
    });
  }

  function startLocalAct(mm, b, inp) {
    if (b === BTN.SPECIAL && mm.cd > 0) { if (inp.real) Sfx.deny(); return; }
    const plan = S.actPlan(b, G.myW);
    if (!plan) return;
    mm.act = { k: plan.k, t: 0, dur: plan.dur, win: plan.win, w: G.myW, held: false };
    if (b === BTN.SPECIAL) {
      mm.cd = plan.cd || 0;
      if (plan.forcedT) { mm.forcedT = plan.forcedT; mm.fx = inp.nax * plan.speed; mm.fy = inp.nay * plan.speed; }
    }
    if (inp.real && G.me) {
      // feedback imediato (só na primeira vez, não nas re-simulações)
      G.me.swingT = performance.now(); G.me.swingK = ACT_KINDS.indexOf(plan.k);
      if (plan.k === 'atk' || plan.k === 'homerun' || plan.k === 'varrida' || plan.k === 'voadora' || plan.k === 'bote') Sfx.swing(plan.k !== 'atk' || G.myW === 'taco');
      if (WEAPONS[G.myW].ranged && plan.k === 'atk') Sfx.shoot();
    }
  }

  function localTick() {
    const live = G.phase === 'live';
    const [mx, my] = (G.me && G.me.alive && G.phase !== 'countdown') ? moveVec() : [0, 0];
    const [ax, ay] = aimVec(mx, my);
    G.ax = ax; G.ay = ay;
    let b = G.pendBtn; G.pendBtn = 0;
    if (!G.me || !G.me.alive || G.phase !== 'live') b = 0;
    const inp = { seq: G.seq++, mx: +mx.toFixed(3), my: +my.toFixed(3), ax: +ax.toFixed(3), ay: +ay.toFixed(3), b };
    // a simulação usa a mira normalizada do valor arredondado (igual ao servidor)
    const am = Math.hypot(inp.ax, inp.ay) || 1;
    inp.nax = inp.ax / am; inp.nay = inp.ay / am;
    G.hist.push(inp);
    if (G.hist.length > 180) G.hist.shift();
    G.outBuf.push(inp);
    if (G.me && G.me.alive) {
      const before = G.mm.dashCh;
      simStep(G.pred, G.mm, { ...inp, real: true }, live);
      if (G.mm.dashCh < before) { Sfx.dash(); G.me.dashFx = performance.now(); }
    }
    if (G.outBuf.length >= C.INPUT_BATCH || b) flushInputs();
  }

  function flushInputs() {
    if (!G.outBuf.length || !G.me) return;
    const m = [];
    for (const i of G.outBuf) m.push(i.mx, i.my, i.ax, i.ay, i.b);
    socket.emit('game:action', { action: 'i', s: G.outBuf[0].seq, t: Math.round(serverNow()), m });
    G.outBuf.length = 0;
  }

  /** Snapshot do próprio boneco: volta ao estado do servidor e reaplica os inputs pendentes. */
  function reconcile(me) {
    const [ack, x, y, vx, vy, kx, ky, dashT, dashX, dashY, forcedT, fx, fy, slowT, dashCh, dashRe, cd, uses,
      ak, at, ad, aw, stunT, buf, bufT, held, holding, hp] = me;
    G.myUses = uses; G.myHp = hp;
    const oldX = G.pred.x + G.offX, oldY = G.pred.y + G.offY;
    const p = G.pred;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.kx = kx; p.ky = ky;
    const mm = G.mm;
    Object.assign(mm, { dashT, dashX, dashY, forcedT, fx, fy, slowT, dashCh, dashRe, cd, stunT, buf, bufT, held: !!held });
    mm.act = ak ? { k: ACT_KINDS[ak], t: at, dur: ad, win: aw, w: G.myW, held: !!holding } : null;
    G.lastAck = ack;
    // descarta inputs já aplicados e reaplica o resto
    let k = 0;
    while (k < G.hist.length && G.hist[k].seq <= ack) k++;
    if (k) G.hist.splice(0, k);
    const live = G.phase === 'live';
    for (const inp of G.hist) simStep(p, mm, inp, live);
    const ex = oldX - p.x, ey = oldY - p.y, e = Math.hypot(ex, ey);
    if (e > 160) { G.offX = 0; G.offY = 0; } else { G.offX = ex; G.offY = ey; }
    if (e > 6) { G.corrections++; if (G.dbg) G.dbg.push({ e: +e.toFixed(1), ack, n: G.hist.length, b: G.hist.map(i => i.b).join(''), act: mm.act && mm.act.k, ft: forcedT, dt: dashT, st: stunT }); }
  }

  // =====================================================================
  // EVENTOS DO SERVIDOR
  // =====================================================================
  const P = (i) => G && G.players[i];

  socket.on(PREFIX + 's', (d) => {
    if (!G) return;
    const pk = d.p;
    for (let k = 0; k + 9 < pk.length; k += 10) {
      const p = P(pk[k]); if (!p) continue;
      const e = { t: d.t, x: pk[k + 1], y: pk[k + 2], ang: pk[k + 3] / 100, hp: pk[k + 4], st: pk[k + 5], left: pk[k + 6] / 100, w: pk[k + 7], fl: pk[k + 8], k: pk[k + 9] };
      p.buf.push(e);
      if (p.buf.length > 30) p.buf.shift();
      p.hp = e.hp; p.w = e.w; p.fl = e.fl; p.st = e.st;
      if (p.isMe) {
        const nw = WEAPON_IDS[e.w] || 'maos';
        if (nw !== G.myW) G.myW = nw;
      }
    }
    G.lastSnapT = d.t;
    G.snapCount++;
    if (G.me && d.me && G.me.alive) reconcile(d.me);
  });

  socket.on(PREFIX + 'round', (d) => {
    if (!G) return;
    G.round = d.round; G.phase = 'countdown'; G.liveAt = d.liveAt; G.lastCount = 99;
    G.map = S.mapById(d.map); G.zone = d.zone; G.winsToWin = d.winsToWin || G.winsToWin;
    G.bgKey = ''; G.mini = null;
    G.projs.clear(); G.bombs.clear(); G.items.clear(); G.ground.clear();
    for (const g of d.ground) addGround(g);
    for (const [i, x, y, alive, wins] of d.players) {
      const p = P(i); if (!p) continue;
      p.buf = []; p.x = p.rx = x; p.y = p.ry = y; p.alive = !!alive; p.wins = wins; p.hp = C.HP; p.st = ST.IDLE; p.w = 0;
      p.lastHpShown = C.HP;
    }
    if (G.me) {
      Object.assign(G.pred, { x: G.me.x, y: G.me.y, vx: 0, vy: 0, kx: 0, ky: 0 });
      G.mm = newMirror(); G.myW = 'maos'; G.myUses = -1; G.myHp = C.HP; G.hist = []; G.offX = G.offY = 0;
      const dx = G.map.w / 2 - G.me.x, dy = G.map.h / 2 - G.me.y, dm = Math.hypot(dx, dy) || 1;
      G.ax = dx / dm; G.ay = dy / dm;
      G.camX = G.me.x; G.camY = G.me.y;
    }
    G.spec = -1;
    G.dom.spec.style.display = 'none';
    G.dom.round.textContent = `Rodada ${d.round} · ${G.map.name}`;
    G.feed = []; renderFeed();
    announce(`RODADA ${d.round}`, 'round', 1.4, G.map.name.toUpperCase());
  });

  socket.on(PREFIX + 'live', () => {
    if (!G) return;
    G.phase = 'live';
    announce('VEM NA MÃO!', 'go', 1.0);
    Sfx.count(0);
    G.shake = Math.max(G.shake, 6);
  });

  function addGround(g) { const [id, w, x, y, uses] = g; G.ground.set(id, { id, w: WEAPON_IDS[w], x, y, uses, born: performance.now() }); }
  socket.on(PREFIX + 'wspawn', (g) => { if (G) { addGround(g); const o = G.ground.get(g[0]); ring(o.x, o.y, 10, 60, 0.5, '#ffd400', 3); } });
  socket.on(PREFIX + 'pick', (d) => {
    if (!G) return;
    const g = d.id >= 0 ? G.ground.get(d.id) : null;
    if (g) G.ground.delete(d.id);
    const p = P(d.i);
    if (p && p.isMe) {
      G.myW = WEAPON_IDS[d.w] || 'maos'; G.myUses = d.u;
      if (d.id >= 0) { Sfx.pick(); const W = WEAPONS[G.myW]; floatText(G.pred.x, G.pred.y - 50, W.name.toUpperCase(), '#ffd400', 20, 1.1); }
    }
  });
  socket.on(PREFIX + 'break', (d) => {
    if (!G) return;
    burst(d.x, d.y, 12, '#cfc8bb', 220, 0.4, 3);
    const p = P(d.i);
    if (p && p.isMe) { G.myW = 'maos'; G.myUses = -1; Sfx.brk(); floatText(d.x, d.y - 50, 'QUEBROU!', '#ff3d8b', 20, 1); }
  });
  socket.on(PREFIX + 'item', (d) => { if (G) { const [id, x, y] = d; G.items.set(id, { id, x, y, born: performance.now() }); } });
  socket.on(PREFIX + 'eat', (d) => {
    if (!G) return;
    const it = G.items.get(d.id); G.items.delete(d.id);
    const p = P(d.i);
    if (it) { burst(it.x, it.y, 10, '#e8a33d', 160, 0.5, 4); floatText(it.x, it.y - 30, '+' + C.HEAL, '#19e36b', 22, 0.9); }
    if (p && p.isMe) Sfx.eat();
  });

  socket.on(PREFIX + 'act', (d) => {
    if (!G) return;
    const p = P(d.i); if (!p || p.isMe) return;
    p.swingT = performance.now(); p.swingK = ACT_KINDS.indexOf(d.k);
    if (near(p, 700)) Sfx.swing(d.k !== 'atk' && d.k !== 'grab');
  });

  function near(p, r) { const me = camTarget(); return Math.hypot(p.rx - me.x, p.ry - me.y) < r; }

  socket.on(PREFIX + 'hit', (d) => {
    if (!G) return;
    const a = P(d.a), v = P(d.v);
    const mine = a && a.isMe, onMe = v && v.isMe;
    const vx = onMe ? G.pred.x : (v ? v.rx : d.x), vy = onMe ? G.pred.y : (v ? v.ry : d.y);
    const big = d.dmg >= 16 || d.rip;
    sparkDir(vx, vy, d.dx, d.dy, big ? 16 : 9, d.rip ? '#ffd400' : '#efeee9', big ? 560 : 400);
    burst(vx, vy, big ? 10 : 5, v ? v.color : '#fff', 200, 0.35, 4);
    floatText(vx + (Math.random() - 0.5) * 16, vy - 34, (d.rip ? 'CONTRA! ' : '') + d.dmg, d.rip ? '#ffd400' : onMe ? '#ff3d8b' : '#efeee9', big ? 30 : 22, 0.8, big);
    if (d.k === 'homerun') floatText(vx, vy - 70, 'HOME RUN!', '#ffd400', 34, 1.2, true);
    if (v) v.hitFlash = performance.now();
    if (mine || onMe) { G.hitstop = big ? 0.075 : 0.045; G.shake = Math.max(G.shake, big ? 11 : 6); }
    if (onMe) { G.flash = 0.25; G.flashColor = '#ff3d8b'; }
    Sfx.hit(big, mine || onMe || (v && near(v, 600)));
  });

  socket.on(PREFIX + 'parry', (d) => {
    if (!G) return;
    const p = P(d.p), a = P(d.a);
    ring(d.x, d.y, 10, d.sup ? 120 : 80, 0.35, d.sup ? '#ffd400' : '#2de2e6', d.sup ? 7 : 5);
    burst(d.x, d.y, 14, '#2de2e6', 380, 0.35, 3);
    floatText(d.x, d.y - 46, d.sup ? 'PANELAÇO!' : 'PARRY!', d.sup ? '#ffd400' : '#2de2e6', d.sup ? 34 : 30, 1.0, true);
    const mine = p && p.isMe, onMe = a && a.isMe;
    if (mine) { G.hitstop = 0.09; G.shake = Math.max(G.shake, 7); G.flash = 0.18; G.flashColor = '#2de2e6'; floatText(G.pred.x, G.pred.y - 84, 'CONTRA-ATAQUE PRONTO', '#ffd400', 16, 1.2); }
    if (onMe) { G.flash = 0.2; G.flashColor = '#2de2e6'; G.shake = Math.max(G.shake, 5); G.mm.act = null; G.mm.stunT = d.sup ? SPECIAL.panelaco.stun : C.PARRY_STUN; }
    if (mine || onMe || (p && near(p, 700))) Sfx.parry(!!d.sup);
  });

  socket.on(PREFIX + 'grab', (d) => {
    if (!G) return;
    const a = P(d.a), v = P(d.v);
    const x = v ? (v.isMe ? G.pred.x : v.rx) : 0, y = v ? (v.isMe ? G.pred.y : v.ry) : 0;
    floatText(x, y - 50, 'AGARROU!', '#ff8a1f', 28, 0.9, true);
    ring(x, y, 8, 50, 0.25, '#ff8a1f', 4);
    if ((a && a.isMe) || (v && v.isMe)) { G.shake = Math.max(G.shake, 5); G.hitstop = 0.05; }
    if (v && v.isMe) { G.mm.held = true; G.mm.act = null; }
    if (a && a.isMe && G.mm.act && G.mm.act.k === 'grab') { G.mm.act.held = true; G.mm.act.t = 0; G.mm.act.dur = 0.3; }
    if (near(v || a, 700)) Sfx.grab();
  });
  socket.on(PREFIX + 'throw', (d) => {
    if (!G) return;
    const v = P(d.v);
    floatText(d.x, d.y - 40, String(d.dmg), '#ff8a1f', 28, 0.8, true);
    if (v && v.isMe) { G.mm.held = false; G.flash = 0.2; G.flashColor = '#ff8a1f'; G.shake = Math.max(G.shake, 9); }
    if (near(v, 800)) Sfx.throw();
  });
  socket.on(PREFIX + 'clank', (d) => {
    if (!G) return;
    floatText(d.x, d.y - 40, 'TOMA!', '#ffd400', 28, 0.9, true);
    burst(d.x, d.y, 10, '#ffd400', 300, 0.3, 3);
    const a = P(d.a);
    if (a && a.isMe) { G.mm.act = null; G.mm.stunT = C.CLANK_STUN; G.shake = Math.max(G.shake, 6); floatText(G.pred.x, G.pred.y - 80, 'ELE ESTAVA BATENDO', '#efeee9', 14, 1.1); }
    Sfx.clank();
  });
  socket.on(PREFIX + 'splat', (d) => {
    if (!G) return;
    floatText(d.x, d.y - 50, 'NA PAREDE!', '#ff3d8b', 32, 1.1, true);
    burst(d.x, d.y, 18, '#cfc8bb', 300, 0.5, 5);
    G.decals.push({ x: d.x, y: d.y, r: 26 + Math.random() * 10, a: Math.random() * TAU, t: performance.now() });
    if (near(P(d.i), 800)) { Sfx.splat(); G.shake = Math.max(G.shake, 8); }
  });
  socket.on(PREFIX + 'dodge', (d) => { if (G) { const p = P(d.i); if (p) floatText(p.isMe ? G.pred.x : p.rx, (p.isMe ? G.pred.y : p.ry) - 40, 'ESQUIVOU', '#efeee9', 16, 0.7); } });
  socket.on(PREFIX + 'dash', (d) => { if (G) { const p = P(d.i); if (p && !p.isMe) { p.dashFx = performance.now(); if (near(p, 600)) Sfx.dash(); } } });

  socket.on(PREFIX + 'proj', (d) => {
    if (!G) return;
    const [id, o, k, x, y, vx, vy, life] = d;
    G.projs.set(id, { id, o, k: k ? 'chinelo' : 'pedra', x0: x, y0: y, vx, vy, t0: serverNow() - clock.rtt / 2, life, x, y });
    const p = P(o);
    if (p && !p.isMe && near(p, 700)) Sfx.shoot();
  });
  socket.on(PREFIX + 'projEnd', (d) => {
    if (!G) return;
    const [id, x, y] = d;
    G.projs.delete(id);
    burst(x, y, 6, '#cfc8bb', 160, 0.25, 3);
  });
  socket.on(PREFIX + 'bomb', (d) => {
    if (!G) return;
    const [id, o, x, y, vx, vy] = d;
    G.bombs.set(id, { id, o, x, y, vx, vy, born: performance.now(), fuse: SPECIAL.bombinha.fuse });
  });
  socket.on(PREFIX + 'boom', (d) => {
    if (!G) return;
    const [id, x, y] = d;
    G.bombs.delete(id);
    const R = SPECIAL.bombinha.radius;
    ring(x, y, 20, R + 20, 0.4, '#ff8a1f', 10);
    ring(x, y, 10, R * 0.7, 0.3, '#ffd400', 6);
    burst(x, y, 30, '#ff8a1f', 520, 0.6, 6);
    burst(x, y, 16, '#3a3631', 260, 0.9, 8);
    G.decals.push({ x, y, r: R * 0.55, a: 0, t: performance.now(), scorch: true });
    const me = camTarget();
    const dd = Math.hypot(me.x - x, me.y - y);
    if (dd < 900) { Sfx.boom(); G.shake = Math.max(G.shake, 14 * (1 - dd / 900)); }
  });

  socket.on(PREFIX + 'kill', (d) => {
    if (!G) return;
    const v = P(d.i), k = d.by >= 0 ? P(d.by) : null;
    if (!v) return;
    v.alive = false; v.deadAt = performance.now(); v.deadX = v.isMe ? G.pred.x : (v.rx || d.x); v.deadY = v.isMe ? G.pred.y : (v.ry || d.y);
    burst(v.deadX, v.deadY, 26, v.color, 420, 0.8, 6);
    ring(v.deadX, v.deadY, 10, 110, 0.5, v.color, 6);
    G.decals.push({ x: v.deadX, y: v.deadY, r: 30, a: Math.random() * TAU, t: performance.now(), ko: v.color });
    if (k) k.kills++;
    addFeed(v, k, d.how);
    const mineKill = k && k.isMe, meDied = v.isMe;
    if (mineKill) { announce('NOCAUTE!', 'ko', 1.1, `${v.name} foi pro chão`); G.hitstop = 0.12; }
    if (meDied) {
      announce('NOCAUTEADO', 'dead', 1.8, k ? `por ${k.name}` : (d.how === 'zona' ? 'a zona te pegou' : ''));
      G.spec = k && k.alive ? k.i : -1;
      G.flash = 0.5; G.flashColor = '#191714';
    }
    G.shake = Math.max(G.shake, meDied ? 16 : mineKill ? 10 : 3);
    Sfx.ko(mineKill);
    if (!meDied && G.spec === v.i) G.spec = k && k.alive ? k.i : -1;
  });

  socket.on(PREFIX + 'roundEnd', (d) => {
    if (!G) return;
    G.phase = 'roundEnd';
    d.wins.forEach((w, i) => { const p = P(i); if (p) p.wins = w; });
    d.scores.forEach((s, i) => { const p = P(i); if (p) p.score = s; });
    const w = d.winner >= 0 ? P(d.winner) : null;
    const pips = w ? '●'.repeat(w.wins) + '○'.repeat(Math.max(0, G.winsToWin - w.wins)) : '';
    if (w && w.isMe) { announce(d.matchOver ? 'CAMPEÃO DA RUA!' : 'RODADA SUA!', 'win', 2.6, pips); Sfx.win(); }
    else if (w) { announce(`${w.name.toUpperCase()} LEVOU`, 'lose', 2.6, pips); if (G.me && !G.me.alive) Sfx.lose(); }
    else announce('NINGUÉM SOBROU', 'lose', 2.4, 'empate');
  });

  socket.on(PREFIX + 'gameover', (d) => {
    if (!G) return;
    G.phase = 'over';
    const snap = { meI: G.meI };
    try { localStorage.setItem('gh_vm_games', String(Number(localStorage.getItem('gh_vm_games') || 0) + 1)); } catch (e) { /* */ }
    setTimeout(() => showResults(d, snap), 1400);
  });

  function dropResultsSkin() {
    const card = DOM.resultsOverlay && DOM.resultsOverlay.querySelector('.results-card');
    if (card) card.classList.remove('vm-results-card');
  }
  socket.on('game:starting', () => { if (G) cleanup(); dropResultsSkin(); });
  socket.on('game:ended', () => { if (G) cleanup(); dropResultsSkin(); });

  // =====================================================================
  // LOOP
  // =====================================================================
  function frame(ts) {
    if (!G) return;
    G.raf = requestAnimationFrame(frame);
    const raw = (ts - G.lastTs) / 1000;
    G.lastTs = ts;
    const dt = clamp(raw || 0.016, 0, 0.05);
    perfTrack(raw * 1000);

    // ticks fixos de input/previsão
    G.acc += dt;
    let n = 0;
    while (G.acc >= C.DT && n < 5) { localTick(); G.acc -= C.DT; n++; }
    if (G.acc > C.DT * 5) G.acc = 0;

    const sNow = serverNow();
    if (G.phase === 'countdown') countdown(sNow);
    // suaviza a correção da previsão
    const k = Math.exp(-14 * dt);
    G.offX *= k; G.offY *= k;
    updateRemote(sNow);
    updateWorld(dt, sNow);
    updateHud(sNow);
    let rdt = dt;
    if (G.hitstop > 0) { G.hitstop -= dt; rdt = dt * 0.15; }
    render(rdt, sNow);
  }

  function countdown(sNow) {
    const left = (G.liveAt - sNow) / 1000;
    const c = Math.ceil(left);
    if (c !== G.lastCount && c >= 1 && c <= 3) { G.lastCount = c; announce(String(c), 'count', 0.8); Sfx.count(c); }
  }

  function updateRemote(sNow) {
    const rt = sNow - INTERP_MS;
    for (const p of G.players) {
      if (p.isMe) {
        p.rx = G.pred.x + G.offX; p.ry = G.pred.y + G.offY;
        p.rang = Math.atan2(G.ay, G.ax);
        p.rst = mmState(G.mm); p.rk = G.mm.act ? ACT_KINDS.indexOf(G.mm.act.k) : 0;
        p.rleft = G.mm.act ? G.mm.act.dur - G.mm.act.t : G.mm.stunT;
        p.ract = G.mm.act;
        continue;
      }
      const b = p.buf;
      if (!b.length) continue;
      let a = b[0], c = b[b.length - 1];
      if (rt <= a.t) { c = a; }
      else if (rt >= c.t) { a = c; }
      else {
        for (let k = b.length - 1; k > 0; k--) if (b[k - 1].t <= rt) { a = b[k - 1]; c = b[k]; break; }
      }
      const span = c.t - a.t;
      const f = span > 0 ? clamp((rt - a.t) / span, 0, 1) : 1;
      // extrapola no máximo 100 ms se o snapshot atrasar
      let ex = 0;
      if (rt > c.t && b.length >= 2) {
        const pb = b[b.length - 2], dtb = c.t - pb.t;
        if (dtb > 0) ex = Math.min(100, rt - c.t) / dtb;
        p.rx = c.x + (c.x - pb.x) * ex; p.ry = c.y + (c.y - pb.y) * ex;
      } else { p.rx = lerp(a.x, c.x, f); p.ry = lerp(a.y, c.y, f); }
      p.rang = angLerp(a.ang, c.ang, f);
      const src = f < 0.5 ? a : c;
      p.rst = src.st; p.rk = src.k; p.rleft = Math.max(0, src.left - (rt - src.t) / 1000);
      p.rfl = src.fl; p.rw = src.w;
    }
  }

  function camTarget() {
    if (!G.me) return { x: G.camX, y: G.camY };
    if (G.me.alive || G.phase === 'countdown') return { x: G.me.rx, y: G.me.ry };
    let sp = G.spec >= 0 ? P(G.spec) : null;
    if (!sp || !sp.alive) {
      sp = G.players.find(p => p.alive) || null;
      G.spec = sp ? sp.i : -1;
    }
    return sp ? { x: sp.rx, y: sp.ry } : { x: G.me.deadX || G.camX, y: G.me.deadY || G.camY };
  }
  function cycleSpec() {
    const alive = G.players.filter(p => p.alive);
    if (!alive.length) return;
    const k = alive.findIndex(p => p.i === G.spec);
    G.spec = alive[(k + 1) % alive.length].i;
  }

  function updateWorld(dt, sNow) {
    const rt = sNow - INTERP_MS;
    for (const pr of G.projs.values()) {
      const tt = Math.max(0, (rt - pr.t0) / 1000);
      pr.x = pr.x0 + pr.vx * tt; pr.y = pr.y0 + pr.vy * tt;
      if (tt > pr.life + 0.3 || S.solidAt(G.map, pr.x, pr.y, 2)) G.projs.delete(pr.id);
    }
    const sp = SPECIAL.bombinha;
    for (const b of G.bombs.values()) {
      const kf = Math.exp(-sp.friction * dt);
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      if (S.solidAt(G.map, nx, b.y, 8)) b.vx = -b.vx * 0.5; else b.x = nx;
      if (S.solidAt(G.map, b.x, ny, 8)) b.vy = -b.vy * 0.5; else b.y = ny;
      b.vx *= kf; b.vy *= kf;
    }
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k]; p.life -= dt;
      if (p.life <= 0) { parts.splice(k, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
    }
    for (let k = texts.length - 1; k >= 0; k--) { const t = texts[k]; t.t += dt; if (t.t >= t.dur) texts.splice(k, 1); }
    for (let k = rings.length - 1; k >= 0; k--) { const r = rings[k]; r.t += dt; if (r.t >= r.dur) rings.splice(k, 1); }
    if (G.decals.length > 40) G.decals.shift();
    // câmera
    const tgt = camTarget();
    const ck = 1 - Math.exp(-10 * dt);
    G.camX += (tgt.x - G.camX) * ck; G.camY += (tgt.y - G.camY) * ck;
    G.shake *= Math.exp(-9 * dt);
    if (G.flash > 0) G.flash -= dt;
  }

  // =====================================================================
  // HUD
  // =====================================================================
  function setText(el, key, v) { if (G.hud[key] !== v) { G.hud[key] = v; el.textContent = v; } }

  function updateHud(sNow) {
    const d = G.dom;
    const alive = G.players.filter(p => p.alive).length;
    setText(d.alive, 'alive', `VIVOS ${alive}/${G.players.length}`);
    setText(d.net, 'net', clock.synced ? `${Math.round(clock.rtt)} ms` : '-- ms');
    const hp = G.me ? (G.me.alive ? Math.max(0, Math.ceil(G.myHp)) : 0) : 0;
    if (G.hud.hp !== hp) {
      G.hud.hp = hp;
      d.hpFill.style.width = hp + '%';
      d.hpNum.textContent = hp;
      d.hpFill.classList.toggle('low', hp <= 30);
    }
    const W = WEAPONS[G.myW] || WEAPONS.maos;
    if (G.hud.w !== G.myW) {
      G.hud.w = G.myW;
      d.wIco.textContent = W_ICON[G.myW] || '👊';
      d.wName.textContent = W.name;
      d.spName.textContent = W.special.name;
      d.weapon.style.setProperty('--wc', W.color);
      d.weapon.classList.remove('swap'); void d.weapon.offsetWidth; d.weapon.classList.add('swap');
      if (d.tsp) d.tsp.textContent = W.special.name.split(' ')[0].toUpperCase();
    }
    const uses = G.myW === 'maos' ? '∞' : G.myW === 'bombinha' ? `${G.myUses} bombas` : `${G.myUses} usos`;
    setText(d.wUses, 'uses', uses);
    const cd = G.mm.cd, cdMax = W.special.cd || 1;
    const cdp = cd > 0 ? Math.round((cd / cdMax) * 100) : 0;
    if (G.hud.cd !== cdp) { G.hud.cd = cdp; d.spCd.style.height = cdp + '%'; d.sp.classList.toggle('ready', cdp === 0); if (d.tsp) d.tsp.classList.toggle('cool', cdp > 0); }
    const dc = G.mm.dashCh;
    if (G.hud.dash !== dc) { G.hud.dash = dc; d.dash.querySelectorAll('i').forEach((el, k) => el.classList.toggle('on', k < dc)); }
    // pegar arma perto
    let nearW = false;
    if (G.me && G.me.alive) for (const g of G.ground.values()) if (Math.hypot(g.x - G.pred.x, g.y - G.pred.y) < C.PICK_R) { nearW = true; break; }
    const swapLbl = nearW ? (G.myW === 'maos' ? 'PEGAR' : 'TROCAR') : (G.myW !== 'maos' ? 'LARGAR' : '');
    if (G.hud.swap !== swapLbl) { G.hud.swap = swapLbl; if (d.tswap) { d.tswap.textContent = swapLbl || 'PEGAR'; d.tswap.classList.toggle('hide', !swapLbl); } }
    // zona
    let out = false;
    if (G.zone && G.me && G.me.alive && G.phase === 'live') {
      const z = zoneNow(sNow);
      out = Math.hypot(G.pred.x - z.x, G.pred.y - z.y) > z.r;
      if (out) Sfx.zone();
    }
    if (G.hud.out !== out) { G.hud.out = out; d.zonewarn.classList.toggle('on', out); }
    const spec = G.me && !G.me.alive && G.phase !== 'over';
    const sp = spec && G.spec >= 0 ? P(G.spec) : null;
    const specTxt = spec ? `💀 Nocauteado — assistindo ${sp ? sp.name : '...'} · ${G.isTouch ? 'toque' : 'clique/espaço'} para trocar` : '';
    if (G.hud.spec !== specTxt) {
      G.hud.spec = specTxt; d.spec.style.display = spec ? '' : 'none'; d.spec.textContent = specTxt; d.hud.classList.toggle('dead', !!spec);
      d.rps.style.display = G.help && !spec ? '' : 'none';
    }
    // minimapa a ~12 Hz
    if (!G.miniAt || performance.now() - G.miniAt > 80) { G.miniAt = performance.now(); drawMini(sNow); }
  }

  function zoneNow(sNow) {
    const rt = Math.max(0, (sNow - G.liveAt) / 1000);
    return S.zoneAt(G.zone, (G.phase === 'countdown' ? 0 : rt) + G.zone.off);
  }

  function addFeed(v, k, how) {
    const verb = HOW[how] || how;
    G.feed.unshift({ v: v.name, vc: v.color, k: k ? k.name : null, kc: k ? k.color : null, verb, mine: (k && k.isMe) || v.isMe, at: performance.now() });
    if (G.feed.length > 5) G.feed.pop();
    renderFeed();
  }
  function renderFeed() {
    G.dom.feed.innerHTML = G.feed.map(f => `<div class="vm-feed-row ${f.mine ? 'mine' : ''}">${f.k ? `<b style="color:${f.kc}">${esc(f.k)}</b><em>${esc(f.verb)}</em>` : `<em>${esc(f.verb)}</em>`}<b style="color:${f.vc}">${esc(f.v)}</b></div>`).join('');
  }

  function announce(text, cls, dur = 1.2, sub = '') {
    const el = G.dom.announce;
    el.className = 'vm-announce show ' + cls;
    el.innerHTML = `<b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    clearTimeout(G.annT);
    G.annT = setTimeout(() => { if (G) el.className = 'vm-announce'; }, dur * 1000);
  }

  // =====================================================================
  // RENDER
  // =====================================================================
  function resize() {
    if (!G || !G.dom) return;
    const st = G.dom.stage;
    const top = st.getBoundingClientRect().top;
    const avail = Math.max(320, window.innerHeight - top);
    G.dom.root.style.height = avail + 'px';
    const w = st.clientWidth, h = st.clientHeight;
    if (!w || !h) return;
    G.dpr = Math.min(window.devicePixelRatio || 1, G.q === 1 ? 2 : 1);
    G.W = w; G.H = h;
    const c = G.dom.canvas;
    c.width = Math.round(w * G.dpr); c.height = Math.round(h * G.dpr);
    G.scale = Math.max(Math.min(w / 1120, h / 700), Math.min(w, h) / 820);
    G.rect = st.getBoundingClientRect();
    G.bgKey = '';
  }

  function perfTrack(ms) {
    if (!(ms > 0) || ms > 250) return;
    G.ft = G.ft * 0.95 + ms * 0.05; G.fps = 1000 / G.ft;
    if (G.q === 1 && G.ft > 23) {
      if (++G.slowFrames > 120) { G.q = 0; G.slowFrames = 0; resize(); if (GameHub.showToast) GameHub.showToast('Modo desempenho ativado para manter o FPS', 'info'); }
    } else G.slowFrames = Math.max(0, G.slowFrames - 1);
  }

  // ---------- mapa pré-renderizado ----------
  function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function buildBg() {
    const map = G.map;
    const k = Math.min(1, G.scale * G.dpr * 1.05);
    const key = map.id + ':' + k.toFixed(2);
    if (G.bgKey === key && G.bg) return;
    G.bgKey = key;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(map.w * k); cv.height = Math.ceil(map.h * k);
    const g = cv.getContext('2d');
    g.scale(k, k);
    // asfalto / chão
    g.fillStyle = map.ground; g.fillRect(0, 0, map.w, map.h);
    for (let n = 0; n < 2600; n++) {
      const x = hash(n) * map.w, y = hash(n + 9999) * map.h, s = 2 + hash(n + 5) * 5;
      g.fillStyle = hash(n + 3) > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)';
      g.fillRect(x, y, s, s);
    }
    if (map.id === 'feira') {
      // paralelepípedo
      g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 2;
      for (let y = 0; y < map.h; y += 34) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(map.w, y); g.stroke();
        const off = (y / 34) % 2 ? 0 : 26;
        for (let x = off; x < map.w; x += 52) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 34); g.stroke(); }
      }
      // praça central
      g.fillStyle = 'rgba(239,238,233,0.06)';
      g.beginPath(); g.arc(1100, 1100, 330, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,212,0,0.35)'; g.lineWidth = 6; g.setLineDash([26, 22]);
      g.beginPath(); g.arc(1100, 1100, 330, 0, TAU); g.stroke(); g.setLineDash([]);
    } else {
      // faixas das avenidas
      g.strokeStyle = 'rgba(255,212,0,0.55)'; g.lineWidth = 6; g.setLineDash([40, 34]);
      for (const c of [1100]) {
        g.beginPath(); g.moveTo(c, 0); g.lineTo(c, 880); g.moveTo(c, 1320); g.lineTo(c, map.h); g.stroke();
        g.beginPath(); g.moveTo(0, c); g.lineTo(780, c); g.moveTo(1420, c); g.lineTo(map.w, c); g.stroke();
      }
      g.setLineDash([]);
      // faixas de pedestre
      g.fillStyle = 'rgba(239,238,233,0.5)';
      for (let s = 0; s < 6; s++) { g.fillRect(1030 + s * 24, 860, 12, -60); g.fillRect(1030 + s * 24, 1340, 12, 60); g.fillRect(860, 1030 + s * 24, -60, 12); g.fillRect(1340, 1030 + s * 24, 60, 12); }
    }
    // quadra
    if (map.court) {
      const [x, y, w, h] = map.court;
      g.fillStyle = '#2f5d4a'; g.fillRect(x, y, w, h);
      g.fillStyle = '#9c4a3a'; g.fillRect(x + 30, y + 30, w - 60, h - 60);
      g.strokeStyle = 'rgba(239,238,233,0.85)'; g.lineWidth = 5;
      g.strokeRect(x + 30, y + 30, w - 60, h - 60);
      g.beginPath(); g.moveTo(x + w / 2, y + 30); g.lineTo(x + w / 2, y + h - 30); g.stroke();
      g.beginPath(); g.arc(x + w / 2, y + h / 2, 60, 0, TAU); g.stroke();
      g.strokeRect(x + 30, y + h / 2 - 70, 70, 140); g.strokeRect(x + w - 100, y + h / 2 - 70, 70, 140);
      g.fillStyle = 'rgba(255,61,139,0.85)';
      g.font = '900 54px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.save(); g.globalAlpha = 0.35; g.fillText('VEM NA MÃO', x + w / 2, y + h / 2 - 120); g.restore();
    }
    // calçadas ao redor das casas
    for (const r of map.rects) {
      if (r[4] !== 'casa') continue;
      g.fillStyle = '#5f5b54';
      g.fillRect(r[0] - 16, r[1] - 16, r[2] + 32, r[3] + 32);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let x = r[0] - 16; x < r[0] + r[2] + 16; x += 32) g.fillRect(x, r[1] - 16, 2, r[3] + 32);
    }
    // sombras
    g.fillStyle = 'rgba(0,0,0,0.38)';
    for (const r of map.rects) g.fillRect(r[0] + 10, r[1] + 12, r[2], r[3]);
    for (const c of map.circles) { g.beginPath(); g.arc(c[0] + 8, c[1] + 10, c[2], 0, TAU); g.fill(); }
    // obstáculos
    map.rects.forEach((r, n) => drawRect(g, r, n));
    map.circles.forEach((c, n) => drawCircle(g, c, n));
    // grafite de chão nos spawns
    g.font = '900 28px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    map.spawns.forEach(([x, y], n) => { g.fillStyle = ['#ff3d8b', '#ffd400', '#19e36b', '#4d6bff'][n % 4]; g.globalAlpha = 0.18; g.beginPath(); g.arc(x, y, 46, 0, TAU); g.fill(); g.globalAlpha = 1; });
    G.bg = cv; G.bgK = k;
    // minimapa
    const mc = document.createElement('canvas'); mc.width = 150; mc.height = 150;
    const mg = mc.getContext('2d'); const mk = 150 / map.w;
    mg.fillStyle = '#26231f'; mg.fillRect(0, 0, 150, 150);
    mg.fillStyle = '#58534b';
    for (const r of map.rects) mg.fillRect(r[0] * mk, r[1] * mk, Math.max(1, r[2] * mk), Math.max(1, r[3] * mk));
    for (const c of map.circles) { mg.beginPath(); mg.arc(c[0] * mk, c[1] * mk, Math.max(1, c[2] * mk), 0, TAU); mg.fill(); }
    G.mini = mc;
  }

  const ROOFS = ['#a8503a', '#8d8a84', '#b8663f', '#7b7a73', '#9b4434'];
  const CARS = ['#2448ff', '#ff3d8b', '#efeee9', '#19e36b', '#ffd400', '#1d1b18'];
  const AWN = [['#ffd400', '#191714'], ['#2448ff', '#efeee9'], ['#ff3d8b', '#efeee9'], ['#19e36b', '#191714']];
  function drawRect(g, r, n) {
    const [x, y, w, h, kind] = r;
    if (kind === 'casa') {
      const roof = ROOFS[n % ROOFS.length];
      g.fillStyle = roof; g.fillRect(x, y, w, h);
      if (roof === '#8d8a84' || roof === '#7b7a73') {
        // laje com caixa d'água
        g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 2;
        for (let yy = y + 20; yy < y + h; yy += 20) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
        g.fillStyle = '#2b5ea8'; g.beginPath(); g.arc(x + w * 0.72, y + h * 0.3, 18, 0, TAU); g.fill();
        g.fillStyle = '#3d7ad1'; g.beginPath(); g.arc(x + w * 0.72, y + h * 0.3, 12, 0, TAU); g.fill();
        g.fillStyle = '#5c5a55'; g.fillRect(x + 12, y + h - 40, 40, 28);
      } else {
        // telhado de duas águas
        g.fillStyle = 'rgba(0,0,0,0.16)';
        if (w > h) g.fillRect(x, y + h / 2, w, h / 2); else g.fillRect(x + w / 2, y, w / 2, h);
        g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2;
        if (w > h) for (let xx = x + 14; xx < x + w; xx += 14) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h); g.stroke(); }
        else for (let yy = y + 14; yy < y + h; yy += 14) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
      }
      g.strokeStyle = '#191714'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
      // lambe-lambe no muro
      const ink = ['#ff3d8b', '#ffd400', '#19e36b', '#2448ff'][n % 4];
      g.fillStyle = ink; g.fillRect(x + w - 46, y + h - 6, 34, 10);
    } else if (kind === 'carro') {
      const col = CARS[n % CARS.length];
      g.fillStyle = col; rr(g, x, y, w, h, 12); g.fill();
      g.strokeStyle = '#191714'; g.lineWidth = 3; g.stroke();
      g.fillStyle = 'rgba(25,23,20,0.75)';
      if (h > w) { rr(g, x + 7, y + h * 0.22, w - 14, h * 0.2, 4); g.fill(); rr(g, x + 7, y + h * 0.62, w - 14, h * 0.14, 4); g.fill(); }
      else { rr(g, x + w * 0.22, y + 7, w * 0.2, h - 14, 4); g.fill(); rr(g, x + w * 0.62, y + 7, w * 0.14, h - 14, 4); g.fill(); }
    } else if (kind === 'caixa') {
      g.fillStyle = '#a77a43'; g.fillRect(x, y, w, h);
      g.strokeStyle = '#5b3f1d'; g.lineWidth = 3; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
      g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + w - 4, y + h - 4); g.moveTo(x + w - 4, y + 4); g.lineTo(x + 4, y + h - 4); g.stroke();
    } else if (kind === 'barraca') {
      const [a, b] = AWN[n % AWN.length];
      const sw = 25;
      for (let k = 0; k * sw < w; k++) { g.fillStyle = k % 2 ? b : a; g.fillRect(x + k * sw, y, Math.min(sw, w - k * sw), h); }
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y + h - 14, w, 14);
      g.strokeStyle = '#191714'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
      // frutas na frente
      for (let k = 0; k < 8; k++) { g.fillStyle = ['#ff8a1f', '#19e36b', '#ff3d8b', '#ffd400'][k % 4]; g.beginPath(); g.arc(x + 20 + k * (w - 40) / 7, y + h + 8, 6, 0, TAU); g.fill(); }
    } else if (kind === 'palco') {
      g.fillStyle = '#7a5530'; g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2;
      for (let yy = y + 14; yy < y + h; yy += 14) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
      g.strokeStyle = '#191714'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
      g.fillStyle = '#ffd400'; g.font = '900 22px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('FORRÓ', x + w / 2, y + h / 2);
    } else {
      g.fillStyle = '#6b665e'; g.fillRect(x, y, w, h); g.strokeStyle = '#191714'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
    }
  }
  function drawCircle(g, c, n) {
    const [x, y, r, kind] = c;
    if (kind === 'arvore') {
      g.fillStyle = '#1f5e36'; g.beginPath(); g.arc(x, y, r + 16, 0, TAU); g.fill();
      g.fillStyle = '#2c7a46';
      for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + n; g.beginPath(); g.arc(x + Math.cos(a) * 12, y + Math.sin(a) * 12, r * 0.7, 0, TAU); g.fill(); }
      g.fillStyle = '#3b9a57'; g.beginPath(); g.arc(x - 6, y - 6, r * 0.55, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(25,23,20,0.6)'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r + 16, 0, TAU); g.stroke();
    } else {
      g.fillStyle = '#4c4943'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.fillStyle = '#8f8a80'; g.beginPath(); g.arc(x, y, r * 0.55, 0, TAU); g.fill();
      g.strokeStyle = '#191714'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      const grd = g.createRadialGradient(x, y, 4, x, y, 140);
      grd.addColorStop(0, 'rgba(255,212,0,0.12)'); grd.addColorStop(1, 'rgba(255,212,0,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, 140, 0, TAU); g.fill();
    }
  }

  function render(dt, sNow) {
    const g = G.ctx, W = G.W, H = G.H;
    if (!W) return;
    buildBg();
    g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    g.fillStyle = '#191714'; g.fillRect(0, 0, W, H);
    const sh = G.shake;
    const cx = G.camX + (sh ? (Math.random() - 0.5) * sh : 0), cy = G.camY + (sh ? (Math.random() - 0.5) * sh : 0);
    const sc = G.scale;
    g.save();
    g.translate(W / 2, H / 2); g.scale(sc, sc); g.translate(-cx, -cy);
    // mapa visível
    const vw = W / sc, vh = H / sc, x0 = cx - vw / 2, y0 = cy - vh / 2;
    const k = G.bgK;
    const sx = clamp(x0, 0, G.map.w), sy = clamp(y0, 0, G.map.h);
    const ex = clamp(x0 + vw, 0, G.map.w), ey = clamp(y0 + vh, 0, G.map.h);
    if (x0 < 0 || y0 < 0 || x0 + vw > G.map.w || y0 + vh > G.map.h) drawOutside(g, x0, y0, vw, vh);
    if (ex > sx && ey > sy) g.drawImage(G.bg, sx * k, sy * k, (ex - sx) * k, (ey - sy) * k, sx, sy, ex - sx, ey - sy);
    const now = performance.now();
    // marcas no chão
    for (const d of G.decals) {
      const a = clamp(1 - (now - d.t) / 20000, 0, 1) * 0.5;
      if (a <= 0) continue;
      g.globalAlpha = a;
      g.fillStyle = d.scorch ? '#14120f' : d.ko || '#efeee9';
      g.beginPath();
      if (d.scorch) g.arc(d.x, d.y, d.r, 0, TAU);
      else for (let n = 0; n < 8; n++) { const aa = d.a + n / 8 * TAU, rr2 = d.r * (0.6 + hash(n + d.x) * 0.6); g.lineTo(d.x + Math.cos(aa) * rr2, d.y + Math.sin(aa) * rr2); }
      g.fill();
    }
    g.globalAlpha = 1;
    // itens e armas no chão
    for (const it of G.items.values()) drawCoxinha(g, it.x, it.y + Math.sin(now / 300 + it.id) * 3, now - it.born);
    for (const gw of G.ground.values()) drawGroundWeapon(g, gw, now);
    // zona
    if (G.zone) drawZone(g, sNow, x0, y0, vw, vh);
    // bombas
    for (const b of G.bombs.values()) {
      const life = 1 - (now - b.born) / (b.fuse * 1000);
      const blink = Math.sin(now / (40 + life * 80)) > 0;
      g.fillStyle = 'rgba(255,138,31,0.22)'; g.beginPath(); g.arc(b.x, b.y, SPECIAL.bombinha.radius * (1 - Math.max(0, life) * 0.4), 0, TAU); g.fill();
      g.strokeStyle = blink ? '#ffd400' : '#ff3d8b'; g.lineWidth = 3; g.setLineDash([10, 8]);
      g.beginPath(); g.arc(b.x, b.y, SPECIAL.bombinha.radius, 0, TAU); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#d62f4c'; rr(g, b.x - 8, b.y - 13, 16, 26, 4); g.fill();
      g.strokeStyle = '#191714'; g.lineWidth = 3; g.stroke();
      g.fillStyle = blink ? '#ffd400' : '#fff'; g.beginPath(); g.arc(b.x + 6, b.y - 16, 4, 0, TAU); g.fill();
    }
    // projéteis
    for (const pr of G.projs.values()) {
      const a = Math.atan2(pr.vy, pr.vx);
      g.save(); g.translate(pr.x, pr.y); g.rotate(a);
      g.strokeStyle = 'rgba(239,238,233,0.35)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(-36, 0); g.lineTo(-6, 0); g.stroke();
      if (pr.k === 'chinelo') {
        g.rotate(now / 50);
        g.fillStyle = '#38bdf8'; rr(g, -14, -7, 28, 14, 7); g.fill(); g.strokeStyle = '#191714'; g.lineWidth = 2.5; g.stroke();
        g.strokeStyle = '#efeee9'; g.beginPath(); g.moveTo(-2, -6); g.lineTo(4, 0); g.lineTo(-2, 6); g.stroke();
      } else {
        g.fillStyle = '#a8a29a'; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill(); g.strokeStyle = '#191714'; g.lineWidth = 2.5; g.stroke();
      }
      g.restore();
    }
    // jogadores (de cima para baixo)
    const order = G.players.slice().sort((a, b) => a.ry - b.ry);
    for (const p of order) if (!p.alive && p.deadAt) drawDead(g, p, now);
    for (const p of order) if (p.alive) drawFighter(g, p, now, sNow);
    // partículas
    for (const p of parts) {
      g.globalAlpha = clamp(p.life / p.max, 0, 1);
      g.fillStyle = p.color; g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.globalAlpha = 1;
    for (const r of rings) {
      const f = r.t / r.dur;
      g.globalAlpha = 1 - f; g.strokeStyle = r.color; g.lineWidth = r.w * (1 - f * 0.6);
      g.beginPath(); g.arc(r.x, r.y, lerp(r.r0, r.r1, 1 - (1 - f) * (1 - f)), 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
    for (const p of order) if (p.alive) drawTag(g, p);
    for (const t of texts) {
      const f = t.t / t.dur;
      const pop = t.big ? (f < 0.15 ? 0.6 + f / 0.15 * 0.6 : 1.2 - Math.min(0.2, (f - 0.15))) : 1;
      g.globalAlpha = f > 0.7 ? (1 - f) / 0.3 : 1;
      g.font = `900 ${Math.round(t.size * pop / Math.max(0.7, sc))}px Archivo, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const yy = t.y - f * 46, xx = t.x + t.dx * f;
      g.lineWidth = 6 / Math.max(0.7, sc); g.strokeStyle = '#191714'; g.lineJoin = 'round';
      g.strokeText(t.text, xx, yy); g.fillStyle = t.color; g.fillText(t.text, xx, yy);
    }
    g.globalAlpha = 1;
    // minha mira
    if (G.me && G.me.alive && !G.isTouch) {
      const me = G.me;
      g.strokeStyle = 'rgba(239,238,233,0.4)'; g.lineWidth = 2; g.setLineDash([6, 8]);
      g.beginPath(); g.moveTo(me.rx + G.ax * 40, me.ry + G.ay * 40); g.lineTo(me.rx + G.ax * 120, me.ry + G.ay * 120); g.stroke(); g.setLineDash([]);
    }
    g.restore();
    // setas para adversários fora da tela
    drawOffscreen(g, cx, cy, sc);
    if (G.flash > 0) { g.globalAlpha = clamp(G.flash * 1.6, 0, 0.45); g.fillStyle = G.flashColor; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    if (G.me && !G.me.alive && G.phase !== 'countdown') { g.fillStyle = 'rgba(25,23,20,0.25)'; g.fillRect(0, 0, W, H); }
    if (G.perf) {
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(8, H - 74, 230, 66);
      g.fillStyle = '#19e36b'; g.font = '12px monospace'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(`FPS ${G.fps.toFixed(0)}  q${G.q}  rtt ${Math.round(clock.rtt)}`, 14, H - 68);
      g.fillText(`seq ${G.seq} ack ${G.lastAck} pend ${G.hist.length}`, 14, H - 52);
      g.fillText(`correções ${G.corrections}  off ${Math.hypot(G.offX, G.offY).toFixed(1)}`, 14, H - 36);
    }
  }

  /** Fora do mapa: muro de concreto com lambe-lambes. */
  function drawOutside(g, x0, y0, vw, vh) {
    const M = G.map;
    g.fillStyle = '#2b2824';
    g.fillRect(x0 - 10, y0 - 10, vw + 20, vh + 20);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
    const step = 60;
    for (let x = Math.floor(x0 / step) * step; x < x0 + vw; x += step) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + vh); g.stroke(); }
    for (let y = Math.floor(y0 / 30) * 30; y < y0 + vh; y += 30) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + vw, y); g.stroke(); }
    // cartazes colados no muro, só na faixa perto da borda
    const inks = ['#ff3d8b', '#ffd400', '#19e36b', '#2448ff', '#efeee9'];
    for (let n = 0; n < 44; n++) {
      const side = n % 4, f = (n >> 2) / 11;
      let px, py;
      if (side === 0) { px = f * M.w; py = -70; } else if (side === 1) { px = M.w + 40; py = f * M.h; }
      else if (side === 2) { px = f * M.w; py = M.h + 40; } else { px = -70; py = f * M.h; }
      if (px < x0 - 80 || px > x0 + vw + 80 || py < y0 - 80 || py > y0 + vh + 80) continue;
      g.save(); g.translate(px + 15, py + 15); g.rotate((hash(n) - 0.5) * 0.2);
      g.fillStyle = inks[n % inks.length]; g.globalAlpha = 0.55; g.fillRect(-26, -32, 52, 64); g.globalAlpha = 1;
      g.restore();
    }
    // borda do mapa (meio-fio)
    g.strokeStyle = '#191714'; g.lineWidth = 14; g.strokeRect(-7, -7, M.w + 14, M.h + 14);
    g.strokeStyle = '#ffd400'; g.lineWidth = 4; g.setLineDash([24, 24]); g.strokeRect(-14, -14, M.w + 28, M.h + 28); g.setLineDash([]);
  }

  function drawZone(g, sNow, x0, y0, vw, vh) {
    const z = zoneNow(sNow);
    g.save();
    g.beginPath();
    g.rect(x0 - 50, y0 - 50, vw + 100, vh + 100);
    g.arc(z.x, z.y, z.r, 0, TAU, true);
    g.fillStyle = 'rgba(255,61,139,0.2)';
    g.fill('evenodd');
    g.strokeStyle = '#ff3d8b'; g.lineWidth = 8; g.setLineDash([30, 18]);
    g.lineDashOffset = -(performance.now() / 30) % 48;
    g.beginPath(); g.arc(z.x, z.y, z.r, 0, TAU); g.stroke();
    g.setLineDash([]);
    // próximo círculo
    if (!z.shrinking && z.next > 0 && G.phase === 'live') {
      // raio final da próxima fase
      let tr = z.r, r = G.zone.r0;
      for (const ph of S.ZONE_PHASES) { if (Math.abs(r - z.r) < 1) { tr = ph.to; break; } r = ph.to; }
      g.strokeStyle = 'rgba(239,238,233,0.45)'; g.lineWidth = 3; g.setLineDash([12, 14]);
      g.beginPath(); g.arc(z.x, z.y, tr, 0, TAU); g.stroke(); g.setLineDash([]);
    }
    g.restore();
  }

  function drawCoxinha(g, x, y, age) {
    const s = Math.min(1, age / 300);
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = 'rgba(255,212,0,0.18)'; g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill();
    g.fillStyle = '#d98b2b'; g.beginPath(); g.moveTo(0, -18); g.quadraticCurveTo(16, 6, 12, 14); g.quadraticCurveTo(0, 20, -12, 14); g.quadraticCurveTo(-16, 6, 0, -18); g.fill();
    g.strokeStyle = '#191714'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#f0b65a'; g.beginPath(); g.arc(-4, 2, 4, 0, TAU); g.fill();
    g.restore();
  }

  function drawGroundWeapon(g, gw, now) {
    const bob = Math.sin(now / 260 + gw.id) * 4;
    const s = Math.min(1, (now - gw.born) / 250);
    const W = WEAPONS[gw.w];
    g.save(); g.translate(gw.x, gw.y + bob); g.scale(s, s);
    g.fillStyle = 'rgba(25,23,20,0.35)'; g.beginPath(); g.ellipse(0, 18 - bob, 22, 7, 0, 0, TAU); g.fill();
    g.strokeStyle = W.color; g.lineWidth = 3; g.globalAlpha = 0.5 + Math.sin(now / 200 + gw.id) * 0.25;
    g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.stroke(); g.globalAlpha = 1;
    g.rotate(-0.6);
    drawWeaponShape(g, gw.w, 1.15);
    g.restore();
  }

  /** Desenha a arma no sistema local (cabo na origem, apontando para +x). */
  function drawWeaponShape(g, w, s = 1) {
    g.save(); g.scale(s, s);
    g.lineJoin = 'round';
    const ink = '#191714';
    switch (w) {
      case 'chinelo':
        g.fillStyle = '#38bdf8'; rr(g, -6, -8, 30, 16, 8); g.fill(); g.strokeStyle = ink; g.lineWidth = 2.5; g.stroke();
        g.strokeStyle = '#efeee9'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(4, -6); g.lineTo(12, 0); g.lineTo(4, 6); g.stroke();
        break;
      case 'taco':
        g.fillStyle = '#d6a35c'; g.beginPath(); g.moveTo(-6, -3); g.lineTo(44, -7); g.quadraticCurveTo(50, 0, 44, 7); g.lineTo(-6, 3); g.closePath(); g.fill();
        g.strokeStyle = ink; g.lineWidth = 2.5; g.stroke();
        g.fillStyle = '#191714'; g.fillRect(-6, -3.5, 10, 7);
        break;
      case 'peixeira':
        g.fillStyle = '#5b3f1d'; g.fillRect(-6, -3.5, 12, 7);
        g.fillStyle = '#dfe5ec'; g.beginPath(); g.moveTo(6, -4); g.lineTo(34, -2); g.lineTo(40, 2); g.lineTo(6, 4); g.closePath(); g.fill();
        g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
        break;
      case 'frigideira':
        g.fillStyle = '#191714'; g.fillRect(-6, -3, 18, 6);
        g.fillStyle = '#71717a'; g.beginPath(); g.arc(24, 0, 13, 0, TAU); g.fill(); g.strokeStyle = ink; g.lineWidth = 3; g.stroke();
        g.fillStyle = '#3f3f46'; g.beginPath(); g.arc(24, 0, 8, 0, TAU); g.fill();
        break;
      case 'estilingue':
        g.strokeStyle = '#7a5530'; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-4, 0); g.lineTo(10, 0); g.lineTo(20, -9); g.moveTo(10, 0); g.lineTo(20, 9); g.stroke();
        g.strokeStyle = '#a3e635'; g.lineWidth = 2; g.beginPath(); g.moveTo(20, -9); g.lineTo(14, 0); g.lineTo(20, 9); g.stroke();
        break;
      case 'vassoura':
        g.strokeStyle = '#a77a43'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(-10, 0); g.lineTo(46, 0); g.stroke();
        g.fillStyle = '#facc15'; g.beginPath(); g.moveTo(44, -4); g.lineTo(62, -12); g.lineTo(62, 12); g.lineTo(44, 4); g.closePath(); g.fill();
        g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
        break;
      case 'bombinha':
        g.fillStyle = '#d62f4c'; rr(g, -2, -6, 20, 12, 3); g.fill(); g.strokeStyle = ink; g.lineWidth = 2.5; g.stroke();
        g.strokeStyle = '#ffd400'; g.lineWidth = 2; g.beginPath(); g.moveTo(18, 0); g.quadraticCurveTo(24, -6, 26, 2); g.stroke();
        break;
      default: break;
    }
    g.restore();
  }

  function drawDead(g, p, now) {
    const t = (now - p.deadAt) / 1000;
    if (t > 3) return;
    g.globalAlpha = clamp(1 - (t - 2) , 0, 1) * 0.8;
    g.fillStyle = p.color; g.beginPath(); g.ellipse(p.deadX, p.deadY, C.P_R * 1.2, C.P_R * 0.75, 0.4, 0, TAU); g.fill();
    g.strokeStyle = '#191714'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#191714'; g.font = '900 16px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('✕ ✕', p.deadX, p.deadY);
    g.globalAlpha = 1;
  }

  function drawFighter(g, p, now, sNow) {
    const x = p.rx, y = p.ry, a = p.rang, R = C.P_R;
    const st = p.rst, wId = p.isMe ? G.myW : (WEAPON_IDS[p.rw] || 'maos');
    const W = WEAPONS[wId] || WEAPONS.maos;
    const fl = p.isMe ? (p.fl || 0) : (p.rfl || 0);
    const kind = ACT_KINDS[p.rk] || '';
    const ca = Math.cos(a), sa = Math.sin(a);
    // telegrafia do golpe (ajuda a ler o adversário)
    if ((st === ST.ATK_S || (st === ST.SPECIAL && kind === 'homerun')) && !W.ranged) {
      const A = kind === 'homerun' ? SPECIAL.homerun : W.atk;
      const reach = (A.reach || 60) + R, arc = (A.arc || 100) * Math.PI / 180;
      g.fillStyle = p.isMe ? 'rgba(239,238,233,0.12)' : 'rgba(255,61,139,0.22)';
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, reach, a - arc / 2, a + arc / 2); g.closePath(); g.fill();
    }
    if (st === ST.GRAB && !(p.ract && p.ract.held)) {
      g.fillStyle = 'rgba(255,138,31,0.2)';
      const arc = C.GRAB_ARC * Math.PI / 180;
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, C.GRAB_RANGE + R, a - arc / 2, a + arc / 2); g.closePath(); g.fill();
    }
    if (st === ST.SPECIAL && kind === 'varrida') {
      g.strokeStyle = 'rgba(250,204,21,0.6)'; g.lineWidth = 6;
      g.beginPath(); g.arc(x, y, SPECIAL.varrida.radius, 0, TAU); g.stroke();
    }
    // dash
    if (p.dashFx && now - p.dashFx < 220) {
      const f = (now - p.dashFx) / 220;
      g.globalAlpha = (1 - f) * 0.5; g.fillStyle = p.color;
      g.beginPath(); g.arc(x - ca * 30 * (1 + f), y - sa * 30 * (1 + f), R * (1 - f * 0.4), 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
    // sombra
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x + 4, y + 7, R * 1.05, R * 0.9, 0, 0, TAU); g.fill();
    // corpo
    const hitF = now - p.hitFlash < 110;
    let bodyR = R;
    if (st === ST.HELD) bodyR = R * 0.92;
    g.fillStyle = hitF ? '#efeee9' : p.color;
    g.beginPath(); g.arc(x, y, bodyR, 0, TAU); g.fill();
    g.strokeStyle = '#191714'; g.lineWidth = 4; g.stroke();
    // boné/cabelo: faixa na direção da mira
    g.fillStyle = 'rgba(25,23,20,0.85)';
    g.beginPath(); g.arc(x - ca * 3, y - sa * 3, R * 0.62, a + Math.PI * 0.55, a + Math.PI * 1.45); g.closePath(); g.fill();
    // olhos
    g.fillStyle = '#191714';
    const ex = x + ca * 10, ey = y + sa * 10;
    if (st === ST.STUN) {
      g.font = '900 12px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('@ @', ex, ey);
    } else {
      g.beginPath(); g.arc(ex - sa * 6, ey + ca * 6, 3, 0, TAU); g.arc(ex + sa * 6, ey - ca * 6, 3, 0, TAU); g.fill();
    }
    // mãos / arma
    drawHands(g, p, x, y, a, st, kind, wId, now);
    // estados
    if (st === ST.PARRY || (fl & 16)) {
      const sup = (fl & 16) || kind === 'parry' && p.ract && p.ract.win > 0.5;
      g.strokeStyle = sup ? '#ffd400' : '#2de2e6'; g.lineWidth = 5;
      g.globalAlpha = 0.7 + Math.sin(now / 40) * 0.3;
      g.beginPath(); g.arc(x, y, R + 14, a - 1.1, a + 1.1); g.stroke();
      g.globalAlpha = 1;
    }
    if (st === ST.STUN) {
      for (let k = 0; k < 3; k++) {
        const aa = now / 180 + k * TAU / 3;
        g.fillStyle = '#ffd400';
        g.beginPath(); g.arc(x + Math.cos(aa) * 20, y - 26 + Math.sin(aa) * 6, 3.5, 0, TAU); g.fill();
      }
    }
    if (fl & 1) { // contra-ataque pronto
      g.strokeStyle = '#ffd400'; g.lineWidth = 2.5; g.globalAlpha = 0.6 + Math.sin(now / 70) * 0.4;
      g.beginPath(); g.arc(x, y, R + 6, 0, TAU); g.stroke(); g.globalAlpha = 1;
    }
    if (fl & 2) { if (Math.random() < 0.2) parts.push({ x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 20, vx: 0, vy: 40, life: 0.4, max: 0.4, size: 4, color: '#d6213f' }); }
    if (fl & 4) { g.strokeStyle = 'rgba(56,189,248,0.7)'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, R + 3, 0, TAU); g.stroke(); }
    if (p.isMe) {
      // marcador do próprio boneco
      g.fillStyle = '#efeee9';
      g.beginPath(); g.moveTo(x, y - R - 34); g.lineTo(x - 7, y - R - 44); g.lineTo(x + 7, y - R - 44); g.closePath(); g.fill();
    }
  }

  function drawHands(g, p, x, y, a, st, kind, wId, now) {
    const R = C.P_R;
    const W = WEAPONS[wId] || WEAPONS.maos;
    const side = (sgn) => [x + Math.cos(a + sgn * 0.85) * (R + 2), y + Math.sin(a + sgn * 0.85) * (R + 2)];
    let L = side(-1), Rh = side(1), swingA = 0, ext = 0;
    const fwd = (d, off = 0) => [x + Math.cos(a + off) * d, y + Math.sin(a + off) * d];
    switch (st) {
      case ST.ATK_S: // recua
        Rh = fwd(R - 2, 1.4); swingA = 1.1; break;
      case ST.ATK_A: // soca / golpeia
        Rh = fwd(R + (W.atk.reach || 50) * 0.55, 0.1); swingA = -0.9; ext = 1; break;
      case ST.ATK_R:
        Rh = fwd(R + 12, -0.5); swingA = -1.0; break;
      case ST.GRAB: case ST.GRAB_R:
        L = fwd(R + 16, -0.45); Rh = fwd(R + 16, 0.45); break;
      case ST.PARRY: case ST.PARRY_R:
        L = fwd(R + 6, -0.3); Rh = fwd(R + 6, 0.3); break;
      case ST.SPECIAL:
        if (kind === 'voadora' || kind === 'bote') { Rh = fwd(R + 18, 0); L = fwd(R + 4, -1.2); swingA = 0; ext = 1; }
        else if (kind === 'varrida') { const sp = now / 40; Rh = fwd(R + 10, sp); swingA = sp; }
        else if (kind === 'homerun') { Rh = fwd(R + 2, 1.9); swingA = 1.8; }
        else { Rh = fwd(R + 10, 0.2); }
        break;
      case ST.HELD:
        L = fwd(R - 4, -1.7); Rh = fwd(R - 4, 1.7); break;
      default: {
        const bob = Math.sin(now / 160 + p.i) * 2;
        L = [L[0] + Math.cos(a) * bob, L[1] + Math.sin(a) * bob];
      }
    }
    // rastro do golpe
    if (st === ST.ATK_A && !W.ranged) {
      const reach = (W.atk.reach || 60) + R, arc = (W.atk.arc || 100) * Math.PI / 180;
      g.strokeStyle = 'rgba(239,238,233,0.75)'; g.lineWidth = wId === 'taco' || wId === 'vassoura' ? 10 : 6; g.lineCap = 'round';
      g.beginPath(); g.arc(x, y, reach * 0.85, a - arc / 2, a + arc / 2); g.stroke();
    }
    if (st === ST.SPECIAL && kind === 'homerun' && p.rleft < SPECIAL.homerun.r + 0.05) {
      g.strokeStyle = 'rgba(255,212,0,0.85)'; g.lineWidth = 12; g.lineCap = 'round';
      g.beginPath(); g.arc(x, y, SPECIAL.homerun.reach * 0.9, a - 1.3, a + 1.3); g.stroke();
    }
    const fist = (hx, hy) => {
      g.fillStyle = p.color; g.beginPath(); g.arc(hx, hy, 8, 0, TAU); g.fill();
      g.strokeStyle = '#191714'; g.lineWidth = 3; g.stroke();
    };
    fist(L[0], L[1]);
    if (wId !== 'maos') {
      g.save(); g.translate(Rh[0], Rh[1]); g.rotate(a + swingA * 0.9 - (wId === 'taco' || wId === 'vassoura' ? 0.3 : 0));
      drawWeaponShape(g, wId, 0.95);
      g.restore();
    }
    fist(Rh[0], Rh[1]);
    if (ext && wId === 'maos' && st === ST.ATK_A) {
      g.strokeStyle = 'rgba(239,238,233,0.6)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(Rh[0] - Math.cos(a) * 24, Rh[1] - Math.sin(a) * 24); g.lineTo(Rh[0] - Math.cos(a) * 10, Rh[1] - Math.sin(a) * 10); g.stroke();
    }
  }

  function drawTag(g, p) {
    const x = p.rx, y = p.ry - C.P_R - 16;
    const sc = Math.max(0.75, G.scale);
    const hp = p.isMe ? G.myHp : p.hp;
    const w = 46;
    g.fillStyle = 'rgba(25,23,20,0.85)'; g.fillRect(x - w / 2 - 2, y - 2, w + 4, 8);
    g.fillStyle = hp > 50 ? '#19e36b' : hp > 25 ? '#ffd400' : '#ff3d8b';
    g.fillRect(x - w / 2, y, w * clamp(hp / C.HP, 0, 1), 4);
    if (!p.isMe) {
      g.font = `800 ${Math.round(13 / sc)}px Archivo, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.lineWidth = 4 / sc; g.strokeStyle = '#191714'; g.lineJoin = 'round'; g.strokeText(p.name, x, y - 4);
      g.fillStyle = '#efeee9'; g.fillText(p.name, x, y - 4);
    }
  }

  function drawOffscreen(g, cx, cy, sc) {
    if (!G.me) return;
    const W = G.W, H = G.H, pad = 34;
    const topIn = 64, botIn = G.isTouch ? 220 : 120;
    const from = camTarget();
    for (const p of G.players) {
      if (p.isMe || !p.alive) continue;
      const sx = (p.rx - cx) * sc + W / 2, sy = (p.ry - cy) * sc + H / 2;
      if (sx > -10 && sx < W + 10 && sy > -10 && sy < H + 10) continue;
      const dx = sx - W / 2, dy = sy - H / 2;
      const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad - 30) / Math.abs(dy || 1e-6));
      const ax = W / 2 + dx * k, ay = clamp(H / 2 + dy * k, topIn, H - botIn);
      const ang = Math.atan2(dy, dx);
      const dist = Math.round(Math.hypot(p.rx - from.x, p.ry - from.y) / 10);
      g.save(); g.translate(ax, ay);
      g.save(); g.rotate(ang);
      g.fillStyle = p.color; g.strokeStyle = '#191714'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(16, 0); g.lineTo(-8, -11); g.lineTo(-8, 11); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.font = '800 11px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#efeee9'; g.strokeStyle = '#191714'; g.lineWidth = 3; g.lineJoin = 'round';
      const ty = Math.sin(ang) > 0.3 ? -22 : 22;
      g.strokeText(`${dist}m`, 0, ty); g.fillText(`${dist}m`, 0, ty);
      g.restore();
    }
  }

  function drawMini(sNow) {
    const m = G.mctx; if (!m || !G.mini) return;
    const k = 150 / G.map.w;
    m.drawImage(G.mini, 0, 0);
    if (G.zone) {
      const z = zoneNow(sNow);
      m.save();
      m.beginPath(); m.rect(0, 0, 150, 150); m.arc(z.x * k, z.y * k, z.r * k, 0, TAU, true);
      m.fillStyle = 'rgba(255,61,139,0.3)'; m.fill('evenodd');
      m.strokeStyle = '#ff3d8b'; m.lineWidth = 1.5; m.beginPath(); m.arc(z.x * k, z.y * k, z.r * k, 0, TAU); m.stroke();
      m.restore();
    }
    for (const it of G.items.values()) { m.fillStyle = '#d98b2b'; m.fillRect(it.x * k - 1.5, it.y * k - 1.5, 3, 3); }
    for (const p of G.players) {
      if (!p.alive) continue;
      m.fillStyle = p.color;
      m.beginPath(); m.arc(p.rx * k, p.ry * k, p.isMe ? 4.5 : 3.5, 0, TAU); m.fill();
      if (p.isMe) { m.strokeStyle = '#efeee9'; m.lineWidth = 2; m.stroke(); }
    }
    // retângulo da câmera
    m.strokeStyle = 'rgba(239,238,233,0.5)'; m.lineWidth = 1;
    const vw = G.W / G.scale, vh = G.H / G.scale;
    m.strokeRect((G.camX - vw / 2) * k, (G.camY - vh / 2) * k, vw * k, vh * k);
  }

  // =====================================================================
  // RESULTADOS
  // =====================================================================
  function showResults(d, snap) {
    cleanup();
    const meRow = d.rankings.find(r => r.i === snap.meI);
    const winner = d.rankings.find(r => r.winner) || d.rankings[0];
    const isWin = meRow && meRow.winner;
    let prof = { matches: 0, wins: 0, kills: 0, bestKills: 0 };
    try { prof = Object.assign(prof, JSON.parse(localStorage.getItem('gh_vm_profile') || '{}')); } catch (e) { /* */ }
    const badges = [];
    if (meRow) {
      prof.matches++; if (isWin) prof.wins++;
      prof.kills += meRow.stats.kills;
      if (meRow.stats.kills > prof.bestKills && meRow.stats.kills >= 2) { badges.push(`Recorde: ${meRow.stats.kills} nocautes`); prof.bestKills = meRow.stats.kills; }
      if (meRow.stats.parries >= 5) badges.push(`Muralha: ${meRow.stats.parries} parries`);
      if (meRow.stats.throws >= 4) badges.push(`Lutador de luta-livre: ${meRow.stats.throws} arremessos`);
      if (meRow.stats.splats >= 2) badges.push(`Pintor de parede: ${meRow.stats.splats}`);
      try { localStorage.setItem('gh_vm_profile', JSON.stringify(prof)); } catch (e) { /* */ }
    }
    const rows = d.rankings.map((r, k) => {
      const s = r.stats;
      return `<tr class="${r.i === snap.meI ? 'me' : ''}">
        <td>${k === 0 ? '🏆' : k + 1}</td>
        <td><span class="sw" style="background:${r.color}"></span>${esc(r.name)}${r.isBot ? ' 🤖' : ''}</td>
        <td>${r.wins}</td><td>${s.kills}</td><td class="opt">${Math.round(s.dmg)}</td><td class="opt">${s.parries}</td><td class="opt">${s.throws}</td>
        <td class="pts">+${r.score}</td></tr>`;
    }).join('');
    DOM.resultsTitle.textContent = '👊 Vem na Mão';
    const card = DOM.resultsOverlay.querySelector('.results-card');
    if (card) card.classList.add('vm-results-card');
    const host = GameHub.state && GameHub.state.isHost;
    DOM.resultsContent.innerHTML = `
      <div class="vm-res">
        <div class="vm-res-hero">
          <div class="vm-res-crown">${isWin ? '👑' : '👊'}</div>
          <div class="vm-res-name">${esc(winner.name)}</div>
          <div class="vm-res-sub">${isWin ? 'Você é o dono da rua!' : 'é o dono da rua'}</div>
        </div>
        <table class="vm-res-table">
          <thead><tr><th></th><th>Jogador</th><th>Rod.</th><th>KO</th><th class="opt">Dano</th><th class="opt">Parry</th><th class="opt">Arrem.</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${meRow ? `<div class="vm-res-career"><span><b>${prof.matches}</b> partidas</span><span><b>${prof.wins}</b> vitórias</span><span><b>${prof.kills}</b> nocautes</span></div>` : ''}
        ${badges.length ? `<div class="vm-badges">${badges.map((b, k) => `<span class="vm-badge" style="animation-delay:${0.3 + k * 0.15}s">${esc(b)}</span>`).join('')}</div>` : ''}
        ${host ? `<div class="vm-res-actions"><button class="btn btn-primary btn-lg" id="vm-rematch" style="flex:1">👊 Revanche</button></div>` : ''}
      </div>`;
    DOM.resultsOverlay.classList.remove('hidden');
    if (isWin) Sfx.win();
    const rm = document.getElementById('vm-rematch');
    if (rm) rm.addEventListener('click', () => { rm.disabled = true; socket.emit('game:start', { gameId: 'vem-na-mao' }); });
  }

  window.__vemnamao = () => G;

  function cleanup() {
    if (!G) return;
    if (G.raf) cancelAnimationFrame(G.raf);
    clearTimeout(G.annT);
    G.handlers.forEach(off => off());
    if (G.ro) G.ro.disconnect();
    stopPinging();
    DOM.gameArea.classList.remove('vm-host');
    parts.length = 0; texts.length = 0; rings.length = 0;
    G = null;
  }
})();
