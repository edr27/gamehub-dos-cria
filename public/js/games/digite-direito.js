/**
 * Digite Direito v4 — cliente (battle royale de digitação, inspirado em "Final Sentence")
 *
 * - Corrida por ciclos: todos digitam o mesmo texto; quem fica por último é eliminado.
 * - Revólver de 6 câmaras por jogador: a cada N erros, puxa o gatilho (1/6, 1/5, 1/4...).
 *   O 1º lugar do ciclo recarrega o tambor.
 * - O servidor valida cada tecla; aqui só prevemos o resultado para a resposta ser instantânea.
 *
 * Input: um <textarea> invisível sempre focado. No teclado físico usamos keydown (e.key de 1
 * caractere, sem auto-repeat) e cancelamos o evento — assim nada entra duas vezes. Em teclados
 * virtuais (que mandam "Unidentified"/composição) lemos o próprio texto do campo. Colar é bloqueado.
 * Acentos são opcionais (á = a, ç = c); maiúsculas e pontuação contam.
 */
(() => {
  'use strict';
  const { socket, DOM } = GameHub;
  const esc = (t) => GameHub.escapeHtml(String(t == null ? '' : t));
  const P = 'game:digite:';

  // ==================== ÁUDIO ====================
  const Sfx = (() => {
    let ac = null, out = null, noiseBuf = null;
    let muted = false;
    try { muted = localStorage.getItem('gh_dd_muted') === '1'; } catch (e) { /* */ }
    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        out = ac.createGain(); out.gain.value = muted ? 0 : 0.8;
        const comp = ac.createDynamicsCompressor();
        out.connect(comp); comp.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(f, dur, type, vol, o = {}) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + (o.delay || 0);
      const os = c.createOscillator(), g = c.createGain();
      os.type = type; os.frequency.setValueAtTime(f, t);
      if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      os.connect(g); g.connect(out); os.start(t); os.stop(t + dur + 0.02);
    }
    function noise(dur, vol, type, f0, f1, o = {}) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + (o.delay || 0);
      const s = c.createBufferSource(); s.buffer = noiseBuf;
      const f = c.createBiquadFilter(); f.type = type; f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    }
    let lastKey = 0;
    return {
      unlock: ensure,
      isMuted: () => muted,
      toggle() {
        muted = !muted;
        try { localStorage.setItem('gh_dd_muted', muted ? '1' : '0'); } catch (e) { /* */ }
        if (out) out.gain.setTargetAtTime(muted ? 0 : 0.8, ac.currentTime, 0.02);
        return muted;
      },
      key() { // máquina de escrever
        const n = performance.now(); if (n - lastKey < 18) return; lastKey = n;
        noise(0.035, 0.32, 'bandpass', 2600 + Math.random() * 1400, 0, { q: 1.4 });
        tone(140 + Math.random() * 30, 0.04, 'triangle', 0.18);
      },
      space() { noise(0.05, 0.28, 'bandpass', 900, 0, { q: 1 }); tone(90, 0.06, 'sine', 0.25); },
      error() { tone(130, 0.14, 'square', 0.12, { to: 90 }); noise(0.08, 0.2, 'lowpass', 600, 0); },
      heartbeat() { tone(60, 0.12, 'sine', 0.55, { to: 40 }); tone(55, 0.14, 'sine', 0.45, { to: 38, delay: 0.17 }); },
      bell() { tone(1976, 0.9, 'sine', 0.2); tone(2637, 0.6, 'sine', 0.08, { delay: 0.01 }); },
      count(n) { tone(n > 0 ? 520 : 880, n > 0 ? 0.1 : 0.3, 'square', 0.1); },
      tick() { tone(1400, 0.03, 'square', 0.06); },
      cock() { noise(0.05, 0.4, 'highpass', 3000, 0); tone(900, 0.03, 'square', 0.1, { delay: 0.05 }); },
      spin(ms) { const n = Math.floor(ms / 55); for (let k = 0; k < n; k++) noise(0.02, 0.18 * (1 - k / n) + 0.05, 'bandpass', 4200, 0, { q: 3, delay: (k / n) ** 1.6 * ms / 1000 }); },
      click() { noise(0.03, 0.6, 'highpass', 4000, 0); tone(1800, 0.02, 'square', 0.15); },
      bang() { noise(1.0, 1.0, 'lowpass', 6000, 60); tone(110, 0.8, 'sine', 0.9, { to: 28 }); noise(0.15, 0.7, 'highpass', 2000, 0); },
      elim() { tone(98, 1.0, 'sawtooth', 0.14, { to: 49 }); tone(147, 1.0, 'sawtooth', 0.08, { to: 73 }); },
      win() { [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.3, 'triangle', 0.13, { delay: k * 0.09 })); },
      reload() { noise(0.05, 0.4, 'bandpass', 2500, 0, { q: 2 }); noise(0.05, 0.4, 'bandpass', 1800, 0, { q: 2, delay: 0.12 }); tone(1200, 0.08, 'triangle', 0.08, { delay: 0.25 }); },
    };
  })();

  // ==================== ESTADO ====================
  let G = null;
  const base = (() => {
    const m = new Map();
    return (ch) => { let r = m.get(ch); if (r === undefined) { r = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); m.set(ch, r); } return r; };
  })();
  const same = (a, b) => a === b || base(a) === base(b);

  function cylSvg(cls, chambers, total, opts = {}) {
    const spent = total - chambers;
    let holes = '';
    for (let k = 0; k < total; k++) {
      const a = -Math.PI / 2 + (k / total) * Math.PI * 2;
      const x = 50 + Math.cos(a) * 27, y = 50 + Math.sin(a) * 27;
      const used = k < spent;
      holes += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="${used ? '#0a0a0a' : (opts.brass ? '#a16207' : '#3f3f46')}" stroke="#18181b" stroke-width="2"/>`;
      if (used) holes += `<path d="M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}" stroke="#52525b" stroke-width="2"/>`;
    }
    return `<svg class="${cls}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="#27272a" stroke="#52525b" stroke-width="3"/>${holes}<circle cx="50" cy="50" r="7" fill="#18181b" stroke="#71717a" stroke-width="2"/></svg>`;
  }

  function revolverSvg(chambers, total) {
    let holes = '';
    for (let k = 0; k < total; k++) {
      const a = -Math.PI / 2 + (k / total) * Math.PI * 2;
      const x = 160 + Math.cos(a) * 26, y = 92 + Math.sin(a) * 26;
      holes += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9.5" fill="${k < total - chambers ? '#050505' : '#1f1f23'}" stroke="#0a0a0a" stroke-width="2"/>`;
    }
    return `
    <svg class="dd4-revolver" viewBox="0 0 360 230" aria-hidden="true">
      <defs>
        <linearGradient id="dd4steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#71717a"/><stop offset=".5" stop-color="#3f3f46"/><stop offset="1" stop-color="#18181b"/></linearGradient>
        <linearGradient id="dd4wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#78350f"/><stop offset="1" stop-color="#451a03"/></linearGradient>
      </defs>
      <rect x="12" y="78" width="130" height="22" rx="4" fill="url(#dd4steel)"/>
      <rect x="12" y="74" width="16" height="6" rx="2" fill="#52525b"/>
      <rect x="40" y="100" width="90" height="10" rx="3" fill="#27272a"/>
      <path d="M120 66 h120 l14 18 v34 l-24 10 h-100 z" fill="url(#dd4steel)" stroke="#09090b" stroke-width="2"/>
      <path class="hammer" d="M222 70 l22 -26 l10 6 l-14 26 z" fill="#3f3f46" stroke="#09090b" stroke-width="2"/>
      <path d="M222 124 c-6 16 -2 30 6 36" fill="none" stroke="#52525b" stroke-width="6" stroke-linecap="round"/>
      <path d="M230 118 l34 -6 c14 30 22 66 18 98 l-44 8 c-6 -34 -10 -66 -8 -100 z" fill="url(#dd4wood)" stroke="#1c0a02" stroke-width="2"/>
      <g class="cyl">
        <circle cx="160" cy="92" r="44" fill="url(#dd4steel)" stroke="#09090b" stroke-width="3"/>
        ${holes}
        <circle cx="160" cy="92" r="7" fill="#18181b" stroke="#a1a1aa" stroke-width="2"/>
      </g>
      <path d="M160 40 l-6 -10 h12 z" fill="#ef4444"/>
      <g class="muzzle" opacity="0"><path d="M12 89 l-14 -22 l2 18 l-14 -2 l12 10 l-14 8 l16 -2 l-2 18 z" fill="#fde68a"/><circle cx="6" cy="89" r="12" fill="#fbbf24" opacity=".7"/></g>
    </svg>`;
  }

  // ==================== INÍCIO ====================
  socket.on(P + 'start', (d) => {
    cleanup();
    const myId = socket.id;
    G = {
      players: d.players.map(p => ({ ...p, isMe: p.id === myId, alive: true, pos: 0, strike: 0, place: 0, chambers: d.chambers, pulling: false, lane: null })),
      meI: -1, me: null, solo: d.solo, total: d.chambers, strikeMax: d.strike,
      cycle: 0, text: '', chars: [], phase: 'waiting', startAt: 0, endAt: 0, limitMs: 1,
      pos: 0, strike: 0, locked: true, finished: false, keysThisCycle: 0, errThisCycle: 0,
      buf: '', flushT: 0, lastCd: 99, lastSec: 99, timers: [], handlers: [], raf: 0,
      ghosts: new Map(), lastCur: -1, dom: {}, composing: false, compBase: '',
      best: loadBest(),
    };
    G.meI = G.players.findIndex(p => p.isMe);
    G.me = G.players[G.meI] || null;
    buildDom();
    bindInput();
    G.raf = requestAnimationFrame(frame);
    Sfx.unlock();
    overlay(`
      <div class="dd4-kicker">Battle royale de digitação</div>
      <div class="dd4-big">DIGITE DIREITO</div>
      <div class="dd4-sub">Todos digitam o mesmo texto. <b>O último de cada ciclo é eliminado.</b><br>A cada ${d.strike} erros você puxa o gatilho.</div>
      <div class="dd4-rules"><span>🏁 1º lugar recarrega o tambor</span><span>🔫 1/6 → 1/5 → 1/4…</span><span>⏱ tempo esgotado = gatilho</span><span>á = a · acentos opcionais</span></div>`, 3300, true);
  });

  function buildDom() {
    if (DOM.resultsOverlay) DOM.resultsOverlay.classList.add('hidden');
    DOM.gameArea.classList.add('dd4-host');
    DOM.gameArea.innerHTML = `
      <div class="dd4" id="dd4">
        <div class="dd4-top">
          <span class="dd4-pill" id="dd4-cycle">Preparando…</span>
          <div class="dd4-fuse" id="dd4-fuse"><div class="dd4-fuse-fill" id="dd4-fuse-fill"></div></div>
          <span class="dd4-clock" id="dd4-clock">--</span>
          <button class="dd4-iconbtn" id="dd4-mute" tabindex="-1" title="Som">${Sfx.isMuted() ? '🔇' : '🔊'}</button>
        </div>
        <div class="dd4-stage">
          <div class="dd4-paper blur" id="dd4-paper">
            <div class="dd4-text" id="dd4-text"></div>
            <div class="dd4-paper-hint" id="dd4-hint">Clique aqui se o teclado parar de responder.</div>
            <div class="dd4-stamp" id="dd4-stamp"></div>
            <textarea class="dd4-input" id="dd4-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Digite aqui"></textarea>
          </div>
          <div class="dd4-me" id="dd4-me">
            <div class="dd4-gun"><div id="dd4-cyl"></div><div class="dd4-odds" id="dd4-odds"><b>1/6</b><span>chance de bala</span></div></div>
            <div><div class="dd4-strikes-label">Erros até o gatilho</div><div class="dd4-strikes" id="dd4-strikes"></div></div>
            <div class="dd4-stats">
              <div class="dd4-stat"><b id="dd4-wpm">0</b><span>PPM</span></div>
              <div class="dd4-stat"><b id="dd4-acc">100%</b><span>Precisão</span></div>
            </div>
          </div>
        </div>
        <div class="dd4-spec" id="dd4-spec" style="display:none"></div>
        <div class="dd4-lanes" id="dd4-lanes"></div>
      </div>
      <div class="dd4-toast" id="dd4-toast"></div>`;
    const $ = (id) => document.getElementById(id);
    G.dom = {
      root: $('dd4'), cycle: $('dd4-cycle'), fuse: $('dd4-fuse'), fuseFill: $('dd4-fuse-fill'), clock: $('dd4-clock'),
      mute: $('dd4-mute'), paper: $('dd4-paper'), text: $('dd4-text'), hint: $('dd4-hint'), stamp: $('dd4-stamp'),
      input: $('dd4-input'), cyl: $('dd4-cyl'), odds: $('dd4-odds'), strikes: $('dd4-strikes'), wpm: $('dd4-wpm'),
      acc: $('dd4-acc'), spec: $('dd4-spec'), lanes: $('dd4-lanes'), toast: $('dd4-toast'), me: $('dd4-me'),
    };
    if (!G.me) G.dom.me.style.display = 'none';
    G.dom.strikes.innerHTML = Array.from({ length: G.strikeMax }, () => '<i></i>').join('');
    renderLanes();
    renderMe();
  }

  function renderLanes() {
    G.dom.lanes.innerHTML = G.players.map(p => `
      <div class="dd4-lane ${p.isMe ? 'me' : ''}" data-i="${p.i}">
        <div class="dd4-lane-name"><span class="sw" style="background:${p.color}"></span><span class="nm">${esc(p.name)}${p.isBot ? ' 🤖' : ''}${p.isMe ? ' (você)' : ''}</span></div>
        <div class="dd4-track"><div class="dd4-track-fill" style="background:${p.color}"></div><div class="dd4-track-dot" style="background:${p.color}"></div></div>
        <div class="dd4-lane-status"></div>
      </div>`).join('');
    G.dom.lanes.querySelectorAll('.dd4-lane').forEach(el => {
      const p = G.players[Number(el.dataset.i)];
      p.lane = { el, fill: el.querySelector('.dd4-track-fill'), dot: el.querySelector('.dd4-track-dot'), status: el.querySelector('.dd4-lane-status'), last: '' };
    });
    G.players.forEach(updateLane);
  }

  function updateLane(p) {
    if (!p.lane) return;
    const len = G.text.length || 1;
    const f = Math.min(1, p.pos / len) * 100;
    p.lane.fill.style.width = f + '%';
    p.lane.dot.style.left = f + '%';
    let st;
    if (!p.alive) st = '💀';
    else if (p.pulling) st = cylSvg('dd4-minicyl', p.chambers, G.total) + '<span style="color:#fca5a5">GATILHO</span>';
    else if (p.place) st = `<span class="place ${p.place === 1 ? 'p1' : ''}">${p.place}º</span>`;
    else {
      const pips = Array.from({ length: G.strikeMax }, (_, k) => `<i class="${k < p.strike ? 'on' : ''}"></i>`).join('');
      st = `<span class="pips">${pips}</span><span class="odds ${p.chambers <= 3 ? 'hot' : ''}">1/${p.chambers}</span>`;
    }
    if (st !== p.lane.last) { p.lane.status.innerHTML = st; p.lane.last = st; }
    p.lane.el.classList.toggle('dead', !p.alive);
    p.lane.el.classList.toggle('pulling', !!p.pulling);
  }

  function renderMe() {
    if (!G.me) return;
    const me = G.me;
    G.dom.cyl.innerHTML = cylSvg('dd4-cyl', me.chambers, G.total, { brass: true });
    const odds = G.dom.odds;
    odds.querySelector('b').textContent = `1/${me.chambers}`;
    odds.classList.toggle('hot', me.chambers <= 3);
    odds.classList.toggle('warm', me.chambers === 4 || me.chambers === 5);
    renderStrikes();
  }

  function renderStrikes() {
    const pips = G.dom.strikes.children;
    for (let k = 0; k < pips.length; k++) pips[k].classList.toggle('on', k < G.strike);
    const last = G.strike === G.strikeMax - 1;
    G.dom.strikes.classList.toggle('last', last);
    G.dom.root.classList.toggle('danger', last && !G.locked);
  }

  // ==================== CICLO ====================
  socket.on(P + 'cycle', (d) => {
    if (!G) return;
    closeOverlay();
    G.cycle = d.n; G.text = d.text; G.limitMs = d.limitMs;
    G.startAt = performance.now() + d.startIn;
    G.endAt = G.startAt + d.limitMs;
    G.phase = 'intro'; G.lastCd = 99; G.lastSec = 99;
    G.pos = 0; G.strike = 0; G.finished = false; G.locked = true; G.keysThisCycle = 0; G.errThisCycle = 0;
    G.buf = '';
    G.players.forEach(p => { p.pos = 0; p.strike = 0; p.place = 0; p.pulling = false; p.alive = d.alive.includes(p.i); p.chambers = d.chambers[p.i]; });
    G.ghosts.clear();
    buildText();
    G.players.forEach(updateLane);
    renderMe();
    G.dom.cycle.textContent = d.duel ? 'Duelo final' : `Ciclo ${d.n}`;
    G.dom.cycle.classList.toggle('duel', !!d.duel);
    G.dom.paper.classList.add('blur'); G.dom.paper.classList.remove('locked', 'done');
    G.dom.stamp.className = 'dd4-stamp';
    const meAlive = G.me && G.me.alive;
    G.dom.spec.style.display = meAlive ? 'none' : '';
    if (!meAlive && G.me) G.dom.spec.textContent = '💀 Você foi eliminado — assistindo à corrida.';
    const secs = Math.round(d.limitMs / 1000);
    overlay(`
      <div class="dd4-kicker">${d.duel ? 'Duelo final' : 'Ciclo ' + d.n}</div>
      <div class="dd4-big ${d.duel ? 'red' : ''}">${d.duel ? 'QUEM TERMINAR PRIMEIRO VENCE' : d.alive.length + ' VIVOS'}</div>
      <div class="dd4-sub"><b>${d.text.length}</b> caracteres · <b>${secs}s</b> de pavio · o último é eliminado</div>`, Math.max(600, d.startIn - 3000 - 100), true);
  });

  function buildText() {
    const words = G.text.split(/( )/);
    let html = '', idx = 0;
    for (const w of words) {
      if (w === ' ') { html += `<span class="dd4-c" data-k="${idx}"> </span>`; idx++; continue; }
      if (!w) continue;
      html += '<span class="dd4-w">';
      for (const ch of w) { html += `<span class="dd4-c" data-k="${idx}">${esc(ch)}</span>`; idx++; }
      html += '</span>';
    }
    G.dom.text.innerHTML = html;
    G.chars = Array.from(G.dom.text.querySelectorAll('.dd4-c'));
    G.lastCur = -1;
    paintCursor();
  }

  function paintCursor() {
    const c = G.chars;
    if (G.lastCur >= 0 && c[G.lastCur]) c[G.lastCur].classList.remove('cur', 'bad');
    for (let k = Math.max(0, G.lastCur); k < G.pos && k < c.length; k++) c[k].classList.add('ok');
    if (c[G.pos] && !G.finished) c[G.pos].classList.add('cur');
    G.lastCur = G.pos;
  }

  function paintGhost(p) {
    const old = G.ghosts.get(p.i);
    if (old === p.pos) return;
    if (old !== undefined && G.chars[old]) { G.chars[old].classList.remove('gh'); G.chars[old].style.removeProperty('--ghc'); }
    if (p.alive && !p.place && G.chars[p.pos]) { G.chars[p.pos].classList.add('gh'); G.chars[p.pos].style.setProperty('--ghc', p.color); G.ghosts.set(p.i, p.pos); }
    else G.ghosts.delete(p.i);
  }

  // ==================== INPUT ====================
  function on(t, ev, fn, o) { t.addEventListener(ev, fn, o); G.handlers.push(() => t.removeEventListener(ev, fn, o)); }

  function bindInput() {
    const inp = G.dom.input;
    const focus = () => { if (G && !isTypingElsewhere()) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } } };
    G.focus = focus;
    on(G.dom.paper, 'pointerdown', (e) => { e.preventDefault(); Sfx.unlock(); focus(); });
    on(G.dom.mute, 'pointerdown', (e) => { e.preventDefault(); G.dom.mute.textContent = Sfx.toggle() ? '🔇' : '🔊'; });
    on(window, 'focus', focus);
    // teclado físico
    on(inp, 'keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); return; }
      if (e.key === 'Enter') { e.preventDefault(); return; }
      if (e.metaKey || (e.ctrlKey && !e.altKey)) return; // atalhos (Ctrl+R etc.); AltGr = Ctrl+Alt passa
      if (e.key && e.key.length === 1 && !e.isComposing) {
        e.preventDefault();
        if (e.repeat) return;
        Sfx.unlock();
        typed(e.key);
      }
    });
    // teclados virtuais / composição (Android, IME, teclas mortas)
    on(inp, 'beforeinput', (e) => {
      if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop' || e.inputType === 'insertReplacementText') e.preventDefault();
    });
    // Durante uma composição só processamos o que foi ACRESCENTADO (autocorretor reescrevendo é
    // ignorado) e paramos em acentos "soltos" de tecla morta (´ ` ^ ~ ¨), que ainda vão virar letra.
    const DEAD = /[´`^~¨˜ˆ]/;
    const takeAppended = (v, final) => {
      if (!v.startsWith(G.compBase)) { if (final && !G.compBase) for (const ch of v) typed(ch); return; }
      let add = '';
      for (const ch of v.slice(G.compBase.length)) { if (!final && DEAD.test(ch)) break; add += ch; }
      for (const ch of add) typed(ch);
      G.compBase += add;
    };
    on(inp, 'compositionstart', () => { G.composing = true; G.compBase = ''; });
    on(inp, 'input', () => {
      const v = inp.value;
      if (G.composing) { takeAppended(v, false); return; }
      inp.value = '';
      for (const ch of v) typed(ch);
    });
    on(inp, 'compositionend', () => {
      takeAppended(inp.value, true);
      G.composing = false; G.compBase = ''; inp.value = '';
    });
    // foco escapou do campo (clicou fora): captura a tecla mesmo assim e devolve o foco
    on(document, 'keydown', (e) => {
      if (!G || e.target === inp || isTypingElsewhere()) return;
      if (G.phase !== 'typing') return;
      if (e.key && e.key.length === 1 && !e.metaKey && !(e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        if (!e.repeat) typed(e.key);
      }
      focus();
    });
    on(inp, 'blur', () => { setTimeout(() => { if (G && G.phase === 'typing' && !G.locked) G.dom.hint.textContent = 'Clique no papel para continuar digitando.'; }, 50); });
    focus();
  }

  function isTypingElsewhere() {
    const a = document.activeElement;
    return a && a !== G.dom.input && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  /** Processa 1 caractere (previsão local idêntica à regra do servidor). */
  function typed(ch) {
    if (!G || G.locked || G.finished || !G.me || !G.me.alive || G.phase !== 'typing') return;
    if (ch === '\n' || ch === '\r') return;
    G.buf += ch;
    scheduleFlush();
    G.keysThisCycle++;
    const exp = G.text[G.pos];
    if (exp !== undefined && same(ch, exp)) {
      G.pos++;
      G.me.pos = G.pos;
      if (ch === ' ') Sfx.space(); else Sfx.key();
      paintCursor();
      if (G.pos >= G.text.length) {
        G.finished = true; G.locked = true;
        flush();
        G.dom.paper.classList.add('done');
        G.dom.root.classList.remove('danger');
      }
    } else {
      G.errThisCycle++;
      G.strike++;
      G.me.strike = G.strike;
      Sfx.error();
      const c = G.chars[G.pos];
      if (c) { c.classList.remove('bad'); void c.offsetWidth; c.classList.add('bad'); setTimeout(() => c && c.classList.remove('bad'), 260); }
      G.dom.paper.classList.remove('shake'); void G.dom.paper.offsetWidth; G.dom.paper.classList.add('shake');
      if (G.strike >= G.strikeMax) { G.locked = true; flush(); G.dom.paper.classList.add('locked'); }
      else if (G.strike === G.strikeMax - 1) Sfx.heartbeat();
      renderStrikes();
    }
    updateLane(G.me);
  }

  function scheduleFlush() {
    if (G.flushT) return;
    G.flushT = setTimeout(flush, 25);
  }
  function flush() {
    if (!G) return;
    if (G.flushT) { clearTimeout(G.flushT); G.flushT = 0; }
    if (!G.buf) return;
    socket.emit('game:action', { action: 'keys', s: G.buf });
    G.buf = '';
  }

  // ==================== EVENTOS ====================
  socket.on(P + 't', (d) => {
    if (!G) return;
    const a = d.p;
    for (let k = 0; k + 6 < a.length; k += 7) {
      const p = G.players[a[k]]; if (!p) continue;
      if (!p.isMe) { p.pos = a[k + 1]; p.strike = a[k + 2]; }
      p.chambers = a[k + 5];
      updateLane(p);
      if (!p.isMe) paintGhost(p);
    }
    // corrige o relógio local pelo servidor
    G.endAt = performance.now() + d.left;
  });

  socket.on(P + 'finish', (d) => {
    if (!G) return;
    const p = G.players[d.i]; if (!p) return;
    p.place = d.place; p.chambers = d.chambers; p.pos = G.text.length;
    paintGhost(p);
    updateLane(p);
    if (p.isMe) {
      Sfx.bell();
      const st = G.dom.stamp;
      st.textContent = d.place === 1 ? '1º LUGAR' : `${d.place}º · SALVO`;
      st.className = `dd4-stamp on ${d.place === 1 ? 'gold' : 'ok'}`;
      if (d.reload) { Sfx.reload(); toast('🔄 Tambor recarregado: de volta a 1/6', 'gold'); }
      toast(`${d.wpm} PPM · ${d.secs}s · +${d.pts} pts`, 'green');
      if (d.wpm > G.best) { G.best = d.wpm; saveBest(d.wpm); toast(`🏆 Novo recorde pessoal: ${d.wpm} PPM`, 'gold'); }
      renderMe();
    } else if (d.place === 1) {
      toast(`🏁 ${p.name} terminou em 1º (${d.wpm} PPM)`, d.reload ? 'gold' : '');
    }
  });

  socket.on(P + 'pull', (d) => {
    if (!G) return;
    const p = G.players[d.i]; if (!p) return;
    p.pulling = true; p.chambers = d.chambers;
    updateLane(p);
    if (p.isMe) {
      G.locked = true;
      G.dom.paper.classList.add('locked');
      G.dom.root.classList.remove('danger');
      const t = setTimeout(() => pullScene(d), d.delay || 0);
      G.timers.push(t);
    } else {
      toast(`🔫 ${p.name} puxa o gatilho… (1 em ${d.chambers})`, 'red');
    }
  });

  function pullScene(d) {
    if (!G) return;
    overlay(`
      <div class="dd4-kicker">${d.reason === 'tempo' ? 'O tempo acabou' : d.reason === 'errors' ? G.strikeMax + ' erros' : 'Gatilho'}</div>
      ${revolverSvg(d.chambers, G.total)}
      <div class="dd4-pull-odds" id="dd4-pull-odds">chance de bala: <b>1 em ${d.chambers}</b></div>`, 0, false);
    const ov = G.overlayEl;
    const gun = ov.querySelector('.dd4-revolver');
    const cyl = ov.querySelector('.cyl');
    const spinMs = Math.max(900, d.ms - 600);
    Sfx.cock();
    setTimeout(() => gun && gun.classList.add('cocked'), 120);
    const turns = 4 + Math.floor(Math.random() * 3);
    if (cyl.animate) cyl.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${turns * 360 + 60 * Math.floor(Math.random() * 6)}deg)` }],
      { duration: spinMs, easing: 'cubic-bezier(0.15, 0.6, 0.2, 1)', fill: 'forwards' });
    Sfx.spin(spinMs);
    G.pullOverlay = ov;
  }

  socket.on(P + 'pull-result', (d) => {
    if (!G) return;
    const p = G.players[d.i]; if (!p) return;
    p.pulling = false; p.strike = 0; p.chambers = d.chambers;
    if (d.died) p.alive = false;
    updateLane(p);
    if (p.isMe) {
      G.strike = 0;
      const ov = G.pullOverlay;
      const gun = ov && ov.querySelector('.dd4-revolver');
      if (gun) { gun.classList.remove('cocked'); gun.classList.add('fired'); }
      if (d.died) {
        Sfx.bang();
        flash('white'); setTimeout(() => flash('red'), 90);
        if (ov) {
          ov.classList.add('bang');
          const m = ov.querySelector('.muzzle'); if (m) m.setAttribute('opacity', '1');
          ov.querySelector('#dd4-pull-odds').innerHTML = '<span class="dd4-big red">BANG.</span>';
        }
        closeOverlayLater(1600);
      } else {
        Sfx.click();
        flash('green');
        if (ov) ov.querySelector('#dd4-pull-odds').innerHTML = `<span class="dd4-big green">*click*</span><div class="dd4-sub">Sobreviveu. Próximo gatilho: <b>1 em ${d.chambers}</b></div>`;
        closeOverlayLater(900, () => {
          if (!G || G.finished || G.phase !== 'typing') return;
          G.locked = false;
          G.dom.paper.classList.remove('locked');
          renderMe();
          G.focus && G.focus();
        });
      }
      renderMe();
    } else {
      toast(d.died ? `💥 BANG — ${p.name} não teve sorte` : `😮‍💨 *click* — ${p.name} sobreviveu (1 em ${d.chambers})`, d.died ? 'red' : '');
      if (d.died) Sfx.bang(); else Sfx.click();
    }
  });

  socket.on(P + 'timeup', (d) => {
    if (!G) return;
    G.phase = 'timeup';
    G.locked = true;
    flush();
    const mine = G.me && d.pullers.includes(G.meI);
    toast(mine ? '⏱ O PAVIO ACABOU — você vai puxar o gatilho' : `⏱ Tempo esgotado: ${d.pullers.map(i => G.players[i].name).join(', ')} puxam o gatilho`, 'red');
  });

  socket.on(P + 'eliminated', (d) => {
    if (!G) return;
    const p = G.players[d.i]; if (!p) return;
    p.alive = false; p.pulling = false;
    paintGhost(p);
    updateLane(p);
    const pct = Math.round((d.pos / (d.len || 1)) * 100);
    if (d.cause === 'ultimo') {
      Sfx.elim();
      if (p.isMe) {
        G.locked = true;
        G.dom.stamp.textContent = 'ÚLTIMO'; G.dom.stamp.className = 'dd4-stamp on dead';
        overlay(`<div class="dd4-kicker">Último lugar</div><div class="dd4-big red">ELIMINADO</div><div class="dd4-sub">Você chegou a ${pct}% do texto. Agora é assistir.</div>`, 2300, false);
      } else {
        overlay(`<div class="dd4-kicker">Último lugar</div><div class="dd4-big red">${esc(p.name.toUpperCase())}</div><div class="dd4-sub">eliminado com ${pct}% do texto</div>`, 1900, true);
      }
    } else if (d.cause === 'saiu') {
      toast(`🚪 ${p.name} saiu da partida`, '');
    }
    if (p.isMe) { G.dom.spec.style.display = ''; G.dom.spec.textContent = '💀 Você foi eliminado — assistindo à corrida.'; }
  });

  socket.on(P + 'cycle-end', (d) => {
    if (!G) return;
    G.phase = 'resolve';
    G.locked = true;
    G.dom.root.classList.remove('danger');
    if (d.over) return;
    const t = setTimeout(() => {
      if (!G || G.overlayEl) return;
      const alive = d.alive.map(i => G.players[i]);
      overlay(`<div class="dd4-kicker">Fim do ciclo ${d.n}</div><div class="dd4-big">${alive.length} ${alive.length === 1 ? 'SOBREVIVENTE' : 'SOBREVIVENTES'}</div>
        <div class="dd4-rules">${alive.map(p => `<span style="border-color:${p.color}">${esc(p.name)} · 1/${p.chambers}</span>`).join('')}</div>`, 1500, true);
    }, 2000);
    G.timers.push(t);
  });

  socket.on(P + 'gameover', (d) => {
    if (!G) return;
    const snap = { meI: G.meI };
    flush();
    G.phase = 'over';
    const w = d.rankings.find(r => r.i === d.winner);
    if (w && w.i === G.meI) Sfx.win(); else Sfx.elim();
    overlay(`<div class="dd4-kicker">Última frase escrita</div><div class="dd4-big gold">${esc(w ? w.name.toUpperCase() : '')}</div><div class="dd4-sub">sobreviveu a ${d.cycles} ciclo${d.cycles > 1 ? 's' : ''}</div>`, 1700, true);
    const t = setTimeout(() => showResults(d, snap), 1800);
    G.timers.push(t);
  });

  socket.on('game:starting', () => { if (G) cleanup(); dropSkin(); });
  socket.on('game:ended', () => { if (G) cleanup(); dropSkin(); });

  // ==================== LOOP (timer / contagem) ====================
  function frame() {
    if (!G) return;
    G.raf = requestAnimationFrame(frame);
    const n = performance.now();
    if (G.phase === 'intro') {
      const left = G.startAt - n;
      const c = Math.ceil(left / 1000);
      if (c <= 3 && c >= 1 && c !== G.lastCd) {
        G.lastCd = c;
        overlay(`<div class="dd4-big count ${c === 1 ? 'red' : ''}">${c}</div>`, 950, true);
        Sfx.count(c);
      }
      if (left <= 0) {
        G.phase = 'typing';
        closeOverlay();
        Sfx.count(0);
        G.dom.paper.classList.remove('blur');
        G.dom.hint.textContent = 'Digite! Acentos são opcionais. Clique no papel se o teclado parar.';
        G.dom.paper.scrollIntoView({ block: 'nearest' });
        if (G.me && G.me.alive) { G.locked = false; G.focus && G.focus(); }
      }
    }
    // pavio
    const rem = Math.max(0, (G.phase === 'intro' ? G.limitMs : G.endAt - n));
    const k = Math.min(1, rem / G.limitMs);
    G.dom.fuseFill.style.transform = `scaleX(${k})`;
    const sec = Math.ceil(rem / 1000);
    if (sec !== G.lastSec) {
      G.lastSec = sec;
      G.dom.clock.textContent = G.phase === 'typing' || G.phase === 'intro' ? sec + 's' : '--';
      const low = G.phase === 'typing' && sec <= 5;
      G.dom.clock.classList.toggle('low', low);
      G.dom.fuse.classList.toggle('low', low);
      if (low && sec > 0 && G.me && G.me.alive && !G.finished) Sfx.tick();
    }
    // estatísticas ao vivo
    if (G.phase === 'typing' && G.me && !G.finished && n > G.startAt) {
      const mins = (n - G.startAt) / 60000;
      const wpm = mins > 0.02 ? Math.round((G.pos / 5) / mins) : 0;
      if (wpm !== G.lastWpm) { G.lastWpm = wpm; G.dom.wpm.textContent = wpm; }
      const acc = G.keysThisCycle ? Math.round(((G.keysThisCycle - G.errThisCycle) / G.keysThisCycle) * 100) : 100;
      if (acc !== G.lastAcc) { G.lastAcc = acc; G.dom.acc.textContent = acc + '%'; }
    }
  }

  // ==================== OVERLAYS / TOASTS ====================
  function overlay(html, autoCloseMs, soft) {
    closeOverlay();
    const el = document.createElement('div');
    el.className = 'dd4-overlay' + (soft ? ' soft' : '');
    el.innerHTML = html;
    document.body.appendChild(el);
    G.overlayEl = el;
    if (autoCloseMs) closeOverlayLater(autoCloseMs);
    return el;
  }
  function closeOverlayLater(ms, after) {
    const el = G.overlayEl;
    const t = setTimeout(() => { if (G && G.overlayEl === el) closeOverlay(); if (after) after(); }, ms);
    G.timers.push(t);
  }
  function closeOverlay() {
    if (G && G.overlayEl) { G.overlayEl.remove(); G.overlayEl = null; G.pullOverlay = null; }
  }
  function flash(cls) {
    const f = document.createElement('div');
    f.className = 'dd4-flash ' + cls;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }
  function toast(text, cls) {
    if (!G) return;
    const el = document.createElement('div');
    el.className = cls || '';
    el.textContent = text;
    G.dom.toast.appendChild(el);
    while (G.dom.toast.children.length > 3) G.dom.toast.firstChild.remove();
    setTimeout(() => el.remove(), 2900);
  }

  // ==================== RESULTADOS ====================
  function loadBest() { try { return Number(localStorage.getItem('gh_dd_best_wpm')) || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem('gh_dd_best_wpm', String(v)); } catch (e) { /* */ } }
  const CAUSE = { ultimo: 'último', roleta: 'roleta', saiu: 'saiu', '': '' };

  function showResults(d, snap) {
    cleanup();
    const w = d.rankings.find(r => r.i === d.winner) || d.rankings[0];
    const me = d.rankings.find(r => r.i === snap.meI);
    const isWin = me && me.i === w.i;
    const badges = [];
    if (me) {
      if (me.acc >= 98 && me.wins > 0) badges.push('🎯 Mão firme');
      if (me.pulls >= 3 && (isWin || me.place <= 2)) badges.push(`🔫 Sobreviveu a ${me.pulls} gatilhos`);
      if (me.wins >= 2) badges.push(`🏁 ${me.wins}× primeiro lugar`);
      if (me.bestWpm >= 60) badges.push(`⚡ ${me.bestWpm} PPM`);
    }
    const rows = d.rankings.map(r => `
      <tr class="${r.i === snap.meI ? 'me' : ''}">
        <td>${r.place === 1 ? '🏆' : r.place + 'º'}</td>
        <td><span class="sw" style="background:${r.color}"></span>${esc(r.name)}${r.isBot ? ' 🤖' : ''}<span class="cause">${CAUSE[r.cause] || ''}</span></td>
        <td>${r.wpm}</td>
        <td class="opt">${r.bestWpm}</td>
        <td>${r.acc}%</td>
        <td class="opt">${r.pulls}</td>
        <td class="opt">${r.wins}</td>
        <td class="pts">+${r.score}</td>
      </tr>`).join('');
    DOM.resultsTitle.textContent = '⌨️ Digite Direito';
    const card = DOM.resultsOverlay.querySelector('.results-card');
    if (card) card.classList.add('dd4-results-card');
    const host = GameHub.state && GameHub.state.isHost;
    DOM.resultsContent.innerHTML = `
      <div class="dd4-res">
        <div class="dd4-res-hero">
          <div class="ico">${isWin ? '👑' : '🏆'}</div>
          <div class="nm">${esc(w.name)}</div>
          <div class="sb">${isWin ? 'Você escreveu a última frase.' : 'foi o último de pé'} · ${d.cycles} ciclo${d.cycles > 1 ? 's' : ''}</div>
        </div>
        ${badges.length ? `<div class="dd4-badges">${badges.map(b => `<span class="dd4-badge">${esc(b)}</span>`).join('')}</div>` : ''}
        <table class="dd4-res-table">
          <thead><tr><th></th><th>Jogador</th><th>PPM</th><th class="opt">Melhor</th><th>Prec.</th><th class="opt">Gatilhos</th><th class="opt">1º</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${host ? '<button class="btn btn-primary btn-lg" id="dd4-rematch" style="width:100%;margin-top:0">🔫 Jogar de novo</button>' : ''}
      </div>`;
    DOM.resultsOverlay.classList.remove('hidden');
    const rm = document.getElementById('dd4-rematch');
    if (rm) rm.addEventListener('click', () => { rm.disabled = true; socket.emit('game:start', { gameId: 'digite-direito' }); });
  }

  function dropSkin() {
    const card = DOM.resultsOverlay && DOM.resultsOverlay.querySelector('.results-card');
    if (card) card.classList.remove('dd4-results-card');
  }

  // diagnóstico (console: __digite())
  window.__digite = () => G;

  function cleanup() {
    if (!G) return;
    if (G.raf) cancelAnimationFrame(G.raf);
    if (G.flushT) clearTimeout(G.flushT);
    G.timers.forEach(clearTimeout);
    G.handlers.forEach(off => off());
    closeOverlay();
    DOM.gameArea.classList.remove('dd4-host');
    G = null;
  }
})();
