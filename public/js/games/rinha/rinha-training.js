/**
 * Rinha.io v2 — Modo de Treino Offline
 * ======================================
 * Dummy configurável (idle/attacking/guarding), hitbox toggle,
 * stats de sessão, cleanup explícito. Construtor com options object.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./rinha-config.js'), require('./rinha-engine.js'));
  } else {
    root.RinhaTraining = factory(root.RinhaConfig, root.RinhaEngine);
  }
}(typeof self !== 'undefined' ? self : this, function (Config, Engine) {
  'use strict';

  function TrainingMode(opts) {
    if (!opts || !opts.canvas) throw new Error('TrainingMode requer opts.canvas');
    this.canvas = opts.canvas;
    this.renderer = opts.renderer;
    this.onExit = opts.onExit || function () {};
    this.world = null;
    this.localId = 'train_local';
    this.dummyId = 'train_dummy';
    this.running = false;
    this.rafId = null;
    this.showDebug = true;
    this.dummyBehavior = 'idle';
    this.dummyTimer = 0;
    this.stats = { dmgDealt: 0, dmgTaken: 0, maxCombo: 0, parries: 0, breaks: 0, splats: 0 };
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseButtons = {};
    this._listeners = [];
    this.toolbar = null;
    this.statsEl = null;
  }

  TrainingMode.prototype.start = function (fighterId) {
    fighterId = fighterId || 'faísca';
    this.world = Engine.createWorld(12345);
    this.world.phase = 'fighting';
    this.world.players[this.localId] = Engine.createPlayer(this.localId, 'Você', fighterId, 300, 320, null);
    var dummyF = fighterId === 'golias' ? 'faísca' : 'golias';
    this.world.players[this.dummyId] = Engine.createPlayer(this.dummyId, 'Boneco', dummyF, 660, 320, null);
    this._buildToolbar();
    this._bindInputs();
    this._resetStats();
    if (this.renderer && this.renderer.setStates) this.renderer.setStates(Engine.States);
    this.running = true;
    this._loop();
  };

  TrainingMode.prototype._loop = function () {
    if (!this.running) return;
    var self = this;
    var input = this._sampleInput();
    var inputs = {};
    inputs[this.localId] = input;
    inputs[this.dummyId] = this._dummyAI();
    var events = Engine.step(this.world, inputs);
    this._trackEvents(events);
    var dummy = this.world.players[this.dummyId];
    if (dummy && dummy.hp <= 5 && dummy.alive) {
      dummy.hp = dummy.hpMax; dummy.posture = 0;
      dummy.state = Engine.States.NEUTRAL; dummy.stateTicks = 0;
    }
    if (this.renderer) {
      this.renderer.render(this.world, this.localId, { showDebug: this.showDebug, playerColors: [this.localId, this.dummyId] });
    }
    this._updateStats();
    this.rafId = requestAnimationFrame(function () { self._loop(); });
  };

  TrainingMode.prototype._bindInputs = function () {
    var self = this;
    var codes = ['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    var onKD = function (e) { if (codes.indexOf(e.code) >= 0) e.preventDefault(); self.keys[e.code] = true; };
    var onKU = function (e) { self.keys[e.code] = false; };
    var onMM = function (e) { var r = self.canvas.getBoundingClientRect(); self.mouseX = e.clientX - r.left; self.mouseY = e.clientY - r.top; };
    var onMD = function (e) { self.mouseButtons[e.button] = true; if (e.button === 2) e.preventDefault(); };
    var onMU = function (e) { self.mouseButtons[e.button] = false; };
    var onCtx = function (e) { e.preventDefault(); };
    var onBlur = function () { self.keys = {}; self.mouseButtons = {}; };
    window.addEventListener('keydown', onKD);
    window.addEventListener('keyup', onKU);
    window.addEventListener('blur', onBlur);
    this.canvas.addEventListener('mousemove', onMM);
    this.canvas.addEventListener('mousedown', onMD);
    this.canvas.addEventListener('mouseup', onMU);
    this.canvas.addEventListener('contextmenu', onCtx);
    this._listeners = [
      { t: window, e: 'keydown', f: onKD }, { t: window, e: 'keyup', f: onKU }, { t: window, e: 'blur', f: onBlur },
      { t: this.canvas, e: 'mousemove', f: onMM }, { t: this.canvas, e: 'mousedown', f: onMD },
      { t: this.canvas, e: 'mouseup', f: onMU }, { t: this.canvas, e: 'contextmenu', f: onCtx }
    ];
  };

  TrainingMode.prototype._sampleInput = function () {
    var mx = 0, my = 0;
    var km = { 'KeyW':{a:'y',v:-1},'KeyS':{a:'y',v:1},'KeyA':{a:'x',v:-1},'KeyD':{a:'x',v:1},
               'ArrowUp':{a:'y',v:-1},'ArrowDown':{a:'y',v:1},'ArrowLeft':{a:'x',v:-1},'ArrowRight':{a:'x',v:1} };
    for (var c in km) { if (this.keys[c]) { if (km[c].a==='x') mx+=km[c].v; else my+=km[c].v; } }
    var len = Math.sqrt(mx*mx+my*my);
    if (len > 1) { mx /= len; my /= len; }
    var btn = 0;
    if (this.mouseButtons[0]) btn |= 0x01;
    if (this.mouseButtons[2]) btn |= 0x02;
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) btn |= 0x04;
    if (this.keys['Space']) btn |= 0x08;
    if (this.keys['KeyE'] || this.keys['KeyQ']) btn |= 0x10;
    if (this.keys['KeyF']) btn |= 0x20;
    var scaleX = Config.ARENA.width / (this.canvas.clientWidth || 1);
    var scaleY = Config.ARENA.height / (this.canvas.clientHeight || 1);
    return { t: this.world.tick, mx: Math.round(mx*10), my: Math.round(my*10),
             ax: Math.round(this.mouseX * scaleX), ay: Math.round(this.mouseY * scaleY), btn: btn };
  };

  TrainingMode.prototype._dummyAI = function () {
    this.dummyTimer++;
    var btn = 0;
    var lp = this.world.players[this.localId];
    switch (this.dummyBehavior) {
      case 'attacking':
        if (this.dummyTimer % 75 === 0) btn |= 0x01;
        if (this.dummyTimer % 150 === 0) btn |= 0x02;
        if (lp) return { t: this.world.tick, mx: 0, my: 0, ax: Math.round(lp.x), ay: Math.round(lp.y), btn: btn };
        break;
      case 'guarding':
        btn |= 0x08;
        break;
    }
    return { t: this.world.tick, mx: 0, my: 0, ax: 0, ay: 0, btn: btn };
  };

  TrainingMode.prototype._trackEvents = function (events) {
    if (!events) return;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i], d = ev.data || ev;
      switch (ev.type || ev) {
        case 'hit':
          if (d.atkId === this.localId) { this.stats.dmgDealt += d.dmg || 0; if (d.combo > this.stats.maxCombo) this.stats.maxCombo = d.combo; }
          else { this.stats.dmgTaken += d.dmg || 0; }
          break;
        case 'parry': if (d.defId === this.localId) this.stats.parries++; break;
        case 'posture_break': if (d.playerId === this.dummyId) this.stats.breaks++; break;
        case 'wall_splat': this.stats.splats++; break;
      }
    }
  };

  TrainingMode.prototype._resetStats = function () {
    this.stats = { dmgDealt: 0, dmgTaken: 0, maxCombo: 0, parries: 0, breaks: 0, splats: 0 };
  };

  TrainingMode.prototype._updateStats = function () {
    if (!this.statsEl) return;
    this.statsEl.textContent = '⚔️ ' + this.stats.dmgDealt + ' | 💔 ' + this.stats.dmgTaken +
      ' | 🔥 Combo: ' + this.stats.maxCombo + ' | 🛡️ Parries: ' + this.stats.parries +
      ' | 💥 Breaks: ' + this.stats.breaks + ' | 🧱 Splats: ' + this.stats.splats;
  };

  TrainingMode.prototype._buildToolbar = function () {
    var self = this;
    var div = document.createElement('div');
    div.className = 'rinha-training-toolbar';
    div.innerHTML = '<div class="rt-title">🏋️ TREINO</div>' +
      '<div class="rt-controls">' +
      '<span class="rt-label">Boneco:</span>' +
      '<button class="rt-btn rt-bh active" data-bh="idle">Parado</button>' +
      '<button class="rt-btn rt-bh" data-bh="attacking">Atacando</button>' +
      '<button class="rt-btn rt-bh" data-bh="guarding">Guardando</button>' +
      '<span class="rt-sep">|</span>' +
      '<button class="rt-btn" id="rt-debug">Hitboxes: ON</button>' +
      '<button class="rt-btn" id="rt-reset">Reset</button>' +
      '<button class="rt-btn" id="rt-rstats">Reset Stats</button>' +
      '<span class="rt-sep">|</span>' +
      '<button class="rt-btn rt-exit" id="rt-exit">✕ Sair</button>' +
      '</div><div class="rt-stats" id="rt-stats"></div>';
    document.body.appendChild(div);
    this.toolbar = div;
    this.statsEl = div.querySelector('#rt-stats');
    var bhBtns = div.querySelectorAll('.rt-bh');
    for (var i = 0; i < bhBtns.length; i++) {
      bhBtns[i].addEventListener('click', function () {
        self.setBehavior(this.getAttribute('data-bh'));
        for (var j = 0; j < bhBtns.length; j++) bhBtns[j].classList.remove('active');
        this.classList.add('active');
      });
    }
    var dbgBtn = div.querySelector('#rt-debug');
    dbgBtn.addEventListener('click', function () {
      self.showDebug = !self.showDebug;
      dbgBtn.textContent = 'Hitboxes: ' + (self.showDebug ? 'ON' : 'OFF');
    });
    div.querySelector('#rt-reset').addEventListener('click', function () { self.resetPositions(); });
    div.querySelector('#rt-rstats').addEventListener('click', function () { self._resetStats(); });
    div.querySelector('#rt-exit').addEventListener('click', function () { self.stop(); });
  };

  TrainingMode.prototype.setBehavior = function (bh) {
    if (['idle','attacking','guarding'].indexOf(bh) >= 0) { this.dummyBehavior = bh; this.dummyTimer = 0; }
  };

  TrainingMode.prototype.resetPositions = function () {
    var l = this.world.players[this.localId], d = this.world.players[this.dummyId];
    if (l) { l.x=300; l.y=320; l.vx=0; l.vy=0; l.hp=l.hpMax; l.posture=0; l.stamina=l.staminaMax; l.momentum=0; l.state=Engine.States.NEUTRAL; l.stateTicks=0; l.comboCount=0; l.alive=true; l.punchHand=null; l.punchProgress=0; }
    if (d) { d.x=660; d.y=320; d.vx=0; d.vy=0; d.hp=d.hpMax; d.posture=0; d.stamina=d.staminaMax; d.momentum=0; d.state=Engine.States.NEUTRAL; d.stateTicks=0; d.comboCount=0; d.alive=true; d.punchHand=null; d.punchProgress=0; }
  };

  TrainingMode.prototype.stop = function () {
    this.running = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    for (var i = 0; i < this._listeners.length; i++) { var l = this._listeners[i]; l.t.removeEventListener(l.e, l.f); }
    this._listeners = []; this.keys = {}; this.mouseButtons = {};
    if (this.toolbar && this.toolbar.parentNode) this.toolbar.parentNode.removeChild(this.toolbar);
    this.toolbar = null; this.statsEl = null;
    this.onExit();
  };

  return TrainingMode;
}));