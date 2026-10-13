/**
 * Rinha.io — Modo de Treino Offline
 * ===================================
 * Permite treinar combos, parries e movimentação contra um boneco
 * com comportamento configurável (parado, atacando, guardando).
 *
 * Features: dummy AI com 3 comportamentos, toggle de hitboxes/frame data,
 * reset de posições/stats, stats de sessão (dano, combos, parries),
 * cleanup explícito de listeners e rAF.
 *
 * Construtor usa options object para evitar ambiguidade de parâmetros.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./rinha-config.js'),
      require('./rinha-engine.js')
    );
  } else {
    root.RinhaTraining = factory(root.RinhaConfig, root.RinhaEngine);
  }
}(typeof self !== 'undefined' ? self : this, function (Config, Engine) {
  'use strict';

  /**
   * @constructor
   * @param {object} opts - Opções nomeadas
   * @param {HTMLCanvasElement} opts.canvas - Canvas do jogo
   * @param {object} opts.renderer - Instância de RinhaRenderer
   * @param {Function} opts.onExit - Callback ao sair do treino
   */
  function TrainingMode(opts) {
    if (!opts || !opts.canvas) throw new Error('TrainingMode requer opts.canvas');
    this.canvas = opts.canvas;
    this.renderer = opts.renderer;
    this.onExit = opts.onExit || function () {};

    this.world = null;
    this.localPlayerId = 'training_local';
    this.dummyId = 'training_dummy';
    this.running = false;
    this.rafId = null;
    this.showDebug = true; // hitboxes + frame data por padrão no treino

    // Comportamento do dummy: 'idle', 'attacking', 'guarding'
    this.dummyBehavior = 'idle';
    this.dummyTimer = 0;

    // Stats da sessão de treino
    this.stats = {
      damageDealt: 0,
      damageTaken: 0,
      maxCombo: 0,
      parriesLanded: 0,
      guardsBroken: 0,
      wallSplats: 0,
      burstsUsed: 0
    };

    // Input state (mesmo formato do rinha-input.js mas inline)
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseButtons = {};
    this._listeners = [];

    // DOM do toolbar
    this.toolbar = null;
    this.statsEl = null;
  }

  // ==================== INICIAR ====================

  /**
   * Inicia o modo de treino com o lutador escolhido.
   * @param {string} fighterId - 'faisca' ou 'golias'
   */
  TrainingMode.prototype.start = function (fighterId) {
    fighterId = fighterId || 'faisca';

    // Criar mundo offline
    this.world = Engine.createWorld('default', 12345);
    this.world.phase = 'fighting';

    // Spawn do jogador local
    var localPlayer = Engine.createPlayer(
      this.localPlayerId, 'Você', fighterId, 300, 320, null
    );
    this.world.players[this.localPlayerId] = localPlayer;

    // Spawn do dummy (sempre Golias para contraste)
    var dummyFighter = fighterId === 'golias' ? 'faisca' : 'golias';
    var dummy = Engine.createPlayer(
      this.dummyId, 'Boneco', dummyFighter, 660, 320, null
    );
    this.world.players[this.dummyId] = dummy;

    // Setup
    this._buildToolbar();
    this._bindInputs();
    this._resetStats();

    // Inject States no renderer se disponível
    if (this.renderer && this.renderer.setStates) {
      this.renderer.setStates(Engine.States);
    }

    this.running = true;
    this._loop();
  };

  // ==================== GAME LOOP ====================

  TrainingMode.prototype._loop = function () {
    if (!this.running) return;

    var self = this;

    // Sample input
    var input = this._sampleInput();
    var inputs = {};
    inputs[this.localPlayerId] = input;

    // Dummy AI
    inputs[this.dummyId] = this._generateDummyInput();

    // Step engine
    var events = Engine.step(this.world, inputs);

    // Track stats from events
    this._processEvents(events);

    // Dummy auto-regen se HP baixo
    var dummy = this.world.players[this.dummyId];
    if (dummy && dummy.hp <= 5 && dummy.alive) {
      dummy.hp = dummy.hpMax;
      dummy.posture = 0;
      dummy.state = Engine.States.NEUTRAL;
      dummy.stateTicks = 0;
    }

    // Render
    if (this.renderer) {
      this.renderer.render(this.world, this.localPlayerId, {
        showDebug: this.showDebug,
        playerColors: [this.localPlayerId, this.dummyId]
      });
    }

    // Update stats display
    this._updateStatsDisplay();

    this.rafId = requestAnimationFrame(function () { self._loop(); });
  };

  // ==================== INPUT INLINE ====================

  TrainingMode.prototype._bindInputs = function () {
    var self = this;

    var onKeyDown = function (e) {
      if (['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(e.code) >= 0) {
        e.preventDefault();
      }
      self.keys[e.code] = true;
    };
    var onKeyUp = function (e) { self.keys[e.code] = false; };
    var onMouseMove = function (e) {
      var rect = self.canvas.getBoundingClientRect();
      self.mouseX = e.clientX - rect.left;
      self.mouseY = e.clientY - rect.top;
    };
    var onMouseDown = function (e) { self.mouseButtons[e.button] = true; if (e.button === 2) e.preventDefault(); };
    var onMouseUp = function (e) { self.mouseButtons[e.button] = false; };
    var onContext = function (e) { e.preventDefault(); };
    var onBlur = function () { self.keys = {}; self.mouseButtons = {}; };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.canvas.addEventListener('mousemove', onMouseMove);
    this.canvas.addEventListener('mousedown', onMouseDown);
    this.canvas.addEventListener('mouseup', onMouseUp);
    this.canvas.addEventListener('contextmenu', onContext);

    this._listeners = [
      { t: window, e: 'keydown', f: onKeyDown },
      { t: window, e: 'keyup', f: onKeyUp },
      { t: window, e: 'blur', f: onBlur },
      { t: this.canvas, e: 'mousemove', f: onMouseMove },
      { t: this.canvas, e: 'mousedown', f: onMouseDown },
      { t: this.canvas, e: 'mouseup', f: onMouseUp },
      { t: this.canvas, e: 'contextmenu', f: onContext }
    ];
  };

  TrainingMode.prototype._sampleInput = function () {
    var mx = 0, my = 0;
    var keyMap = {
      'KeyW': { a: 'y', v: -1 }, 'KeyS': { a: 'y', v: 1 },
      'KeyA': { a: 'x', v: -1 }, 'KeyD': { a: 'x', v: 1 },
      'ArrowUp': { a: 'y', v: -1 }, 'ArrowDown': { a: 'y', v: 1 },
      'ArrowLeft': { a: 'x', v: -1 }, 'ArrowRight': { a: 'x', v: 1 }
    };
    for (var code in keyMap) {
      if (this.keys[code]) {
        if (keyMap[code].a === 'x') mx += keyMap[code].v;
        else my += keyMap[code].v;
      }
    }
    var len = Math.sqrt(mx * mx + my * my);
    if (len > 1) { mx /= len; my /= len; }

    var btn = 0;
    if (this.mouseButtons[0]) btn |= 0x01;
    if (this.mouseButtons[2]) btn |= 0x02;
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) btn |= 0x04;
    if (this.keys['Space']) btn |= 0x08;
    if (this.keys['KeyE'] || this.keys['KeyQ']) btn |= 0x10;
    if (this.keys['KeyF']) btn |= 0x20;

    return {
      t: this.world.tick,
      mx: Math.round(mx * 10),
      my: Math.round(my * 10),
      ax: Math.round(this.mouseX / (this.canvas.clientWidth / Config.ARENA.width)),
      ay: Math.round(this.mouseY / (this.canvas.clientHeight / Config.ARENA.height)),
      btn: btn
    };
  };

  // ==================== DUMMY AI ====================

  TrainingMode.prototype._generateDummyInput = function () {
    this.dummyTimer++;
    var dummy = this.world.players[this.dummyId];
    if (!dummy || !dummy.alive) return { t: this.world.tick, mx: 0, my: 0, ax: 0, ay: 0, btn: 0 };

    var btn = 0;
    var mx = 0, my = 0;

    switch (this.dummyBehavior) {
      case 'idle':
        // Fica parado, sem fazer nada
        break;

      case 'attacking':
        // Ataca periodicamente: light a cada ~75 ticks, heavy a cada ~150
        if (this.dummyTimer % 75 === 0) {
          btn |= 0x01; // light attack
        }
        if (this.dummyTimer % 150 === 0) {
          btn |= 0x02; // heavy attack
        }
        // Mira no jogador local
        var lp = this.world.players[this.localPlayerId];
        if (lp) {
          // ax/ay são coordenadas absolutas na arena
          return {
            t: this.world.tick, mx: 0, my: 0,
            ax: Math.round(lp.x), ay: Math.round(lp.y),
            btn: btn
          };
        }
        break;

      case 'guarding':
        // Segura guarda permanentemente
        btn |= 0x08;
        break;
    }

    return { t: this.world.tick, mx: mx, my: my, ax: 0, ay: 0, btn: btn };
  };

  // ==================== STATS TRACKING ====================

  TrainingMode.prototype._processEvents = function (events) {
    if (!events) return;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      switch (ev.type) {
        case 'hit':
          if (ev.attackerId === this.localPlayerId) {
            this.stats.damageDealt += ev.damage || 0;
            if (ev.comboCount > this.stats.maxCombo) {
              this.stats.maxCombo = ev.comboCount;
            }
          } else {
            this.stats.damageTaken += ev.damage || 0;
          }
          break;
        case 'parry':
          if (ev.defenderId === this.localPlayerId) {
            this.stats.parriesLanded++;
          }
          break;
        case 'posture_break':
          if (ev.playerId === this.dummyId) {
            this.stats.guardsBroken++;
          }
          break;
        case 'wall_splat':
          this.stats.wallSplats++;
          break;
        case 'burst':
          if (ev.playerId === this.localPlayerId) {
            this.stats.burstsUsed++;
          }
          break;
      }
    }
  };

  TrainingMode.prototype._resetStats = function () {
    this.stats = {
      damageDealt: 0,
      damageTaken: 0,
      maxCombo: 0,
      parriesLanded: 0,
      guardsBroken: 0,
      wallSplats: 0,
      burstsUsed: 0
    };
  };

  TrainingMode.prototype._updateStatsDisplay = function () {
    if (!this.statsEl) return;
    this.statsEl.innerHTML =
      '⚔️ Dano: ' + this.stats.damageDealt +
      ' | 💔 Recebido: ' + this.stats.damageTaken +
      ' | 🔥 Max Combo: ' + this.stats.maxCombo +
      ' | 🛡️ Parries: ' + this.stats.parriesLanded +
      ' | 💥 Breaks: ' + this.stats.guardsBroken +
      ' | 🧱 Splats: ' + this.stats.wallSplats;
  };

  // ==================== TOOLBAR DOM ====================

  TrainingMode.prototype._buildToolbar = function () {
    var self = this;

    var div = document.createElement('div');
    div.className = 'rinha-training-toolbar';
    div.innerHTML = '' +
      '<div class="rt-title">🏋️ MODO DE TREINO</div>' +
      '<div class="rt-controls">' +
        '<span class="rt-label">Boneco:</span>' +
        '<button class="rt-btn rt-behavior active" data-bh="idle">Parado</button>' +
        '<button class="rt-btn rt-behavior" data-bh="attacking">Atacando</button>' +
        '<button class="rt-btn rt-behavior" data-bh="guarding">Guardando</button>' +
        '<span class="rt-sep">|</span>' +
        '<button class="rt-btn" id="rt-toggle-debug">Hitboxes: ON</button>' +
        '<button class="rt-btn" id="rt-reset-pos">Reset Pos</button>' +
        '<button class="rt-btn" id="rt-reset-stats">Reset Stats</button>' +
        '<span class="rt-sep">|</span>' +
        '<button class="rt-btn rt-exit" id="rt-exit">✕ Sair</button>' +
      '</div>' +
      '<div class="rt-stats" id="rt-stats"></div>';

    document.body.appendChild(div);
    this.toolbar = div;
    this.statsEl = div.querySelector('#rt-stats');

    // Behavior buttons
    var bhBtns = div.querySelectorAll('.rt-behavior');
    for (var i = 0; i < bhBtns.length; i++) {
      bhBtns[i].addEventListener('click', function () {
        self.setBehavior(this.getAttribute('data-bh'));
        for (var j = 0; j < bhBtns.length; j++) bhBtns[j].classList.remove('active');
        this.classList.add('active');
      });
    }

    // Toggle debug
    var debugBtn = div.querySelector('#rt-toggle-debug');
    debugBtn.addEventListener('click', function () {
      self.showDebug = !self.showDebug;
      debugBtn.textContent = 'Hitboxes: ' + (self.showDebug ? 'ON' : 'OFF');
    });

    // Reset positions
    div.querySelector('#rt-reset-pos').addEventListener('click', function () {
      self.resetPositions();
    });

    // Reset stats
    div.querySelector('#rt-reset-stats').addEventListener('click', function () {
      self._resetStats();
    });

    // Exit
    div.querySelector('#rt-exit').addEventListener('click', function () {
      self.stop();
    });
  };

  // ==================== CONTROLES PÚBLICOS ====================

  TrainingMode.prototype.setBehavior = function (behavior) {
    if (['idle', 'attacking', 'guarding'].indexOf(behavior) >= 0) {
      this.dummyBehavior = behavior;
      this.dummyTimer = 0;
    }
  };

  TrainingMode.prototype.resetPositions = function () {
    var local = this.world.players[this.localPlayerId];
    var dummy = this.world.players[this.dummyId];

    if (local) {
      local.x = 300; local.y = 320;
      local.vx = 0; local.vy = 0;
      local.hp = local.hpMax; local.posture = 0;
      local.stamina = local.staminaMax; local.momentum = 0;
      local.state = Engine.States.NEUTRAL; local.stateTicks = 0;
      local.comboCount = 0; local.comboTimer = 0;
      local.alive = true;
    }
    if (dummy) {
      dummy.x = 660; dummy.y = 320;
      dummy.vx = 0; dummy.vy = 0;
      dummy.hp = dummy.hpMax; dummy.posture = 0;
      dummy.stamina = dummy.staminaMax; dummy.momentum = 0;
      dummy.state = Engine.States.NEUTRAL; dummy.stateTicks = 0;
      dummy.comboCount = 0; dummy.comboTimer = 0;
      dummy.alive = true;
    }
  };

  // ==================== CLEANUP ====================

  TrainingMode.prototype.stop = function () {
    this.running = false;

    // Cancelar rAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Remover event listeners
    for (var i = 0; i < this._listeners.length; i++) {
      var entry = this._listeners[i];
      entry.t.removeEventListener(entry.e, entry.f);
    }
    this._listeners = [];
    this.keys = {};
    this.mouseButtons = {};

    // Remover toolbar
    if (this.toolbar && this.toolbar.parentNode) {
      this.toolbar.parentNode.removeChild(this.toolbar);
    }
    this.toolbar = null;
    this.statsEl = null;

    // Callback de saída
    this.onExit();
  };

  return TrainingMode;
}));