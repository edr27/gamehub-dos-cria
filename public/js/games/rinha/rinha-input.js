/**
 * Rinha.io — Módulo de Input
 * ===========================
 * Captura teclado (WASD) e mouse (mira + botões), amostra a 60Hz,
 * e serializa no formato compacto wire: { t, mx, my, ax, ay, btn }.
 *
 * Cleanup explícito via destroy() para evitar vazamento de listeners.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.RinhaInput = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Mapeamento de teclas WASD para direção normalizada (-1..1)
  const KEY_MAP = {
    'KeyW': { axis: 'y', val: -1 },
    'KeyS': { axis: 'y', val: 1 },
    'KeyA': { axis: 'x', val: -1 },
    'KeyD': { axis: 'x', val: 1 },
    'ArrowUp': { axis: 'y', val: -1 },
    'ArrowDown': { axis: 'y', val: 1 },
    'ArrowLeft': { axis: 'x', val: -1 },
    'ArrowRight': { axis: 'x', val: 1 }
  };

  /**
   * @constructor
   * @param {HTMLCanvasElement} canvas - Elemento canvas para tracking do mouse
   */
  function InputManager(canvas) {
    this.canvas = canvas;
    this.destroyed = false;

    // Estado bruto dos inputs
    this.keys = {};           // code -> boolean
    this.mouseX = 0;          // posição do mouse em coordenadas do canvas
    this.mouseY = 0;
    this.mouseButtons = {};   // button index -> boolean

    // Lista de listeners para cleanup
    this._listeners = [];

    this._bindEvents();
  }

  // ==================== BINDING ====================

  InputManager.prototype._bindEvents = function () {
    var self = this;

    // Teclado
    var onKeyDown = function (e) {
      if (self.destroyed) return;
      // Prevenir scroll com WASD/Space/Arrow keys durante o jogo
      if (KEY_MAP[e.code] || e.code === 'Space') {
        e.preventDefault();
      }
      self.keys[e.code] = true;
    };

    var onKeyUp = function (e) {
      if (self.destroyed) return;
      self.keys[e.code] = false;
    };

    // Mouse movement
    var onMouseMove = function (e) {
      if (self.destroyed) return;
      var rect = self.canvas.getBoundingClientRect();
      self.mouseX = e.clientX - rect.left;
      self.mouseY = e.clientY - rect.top;
    };

    // Mouse buttons
    var onMouseDown = function (e) {
      if (self.destroyed) return;
      self.mouseButtons[e.button] = true;
      // Prevenir menu de contexto com botão direito
      if (e.button === 2) e.preventDefault();
    };

    var onMouseUp = function (e) {
      if (self.destroyed) return;
      self.mouseButtons[e.button] = false;
    };

    // Prevenir context menu no canvas
    var onContextMenu = function (e) {
      e.preventDefault();
    };

    // Blur/focus: limpar estado quando janela perde foco
    var onBlur = function () {
      if (self.destroyed) return;
      self.keys = {};
      self.mouseButtons = {};
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.canvas.addEventListener('mousemove', onMouseMove);
    this.canvas.addEventListener('mousedown', onMouseDown);
    this.canvas.addEventListener('mouseup', onMouseUp);
    this.canvas.addEventListener('contextmenu', onContextMenu);

    this._listeners.push(
      { target: window, event: 'keydown', fn: onKeyDown },
      { target: window, event: 'keyup', fn: onKeyUp },
      { target: window, event: 'blur', fn: onBlur },
      { target: this.canvas, event: 'mousemove', fn: onMouseMove },
      { target: this.canvas, event: 'mousedown', fn: onMouseDown },
      { target: this.canvas, event: 'mouseup', fn: onMouseUp },
      { target: this.canvas, event: 'contextmenu', fn: onContextMenu }
    );
  };

  // ==================== SAMPLING ====================

  /**
   * Amostra o input atual e retorna no formato wire compacto.
   * Chamado uma vez por tick (60Hz).
   *
   * @param {number} tick - Número do tick atual
   * @returns {object} Input serializado { t, mx, my, ax, ay, btn }
   */
  InputManager.prototype.sample = function (tick) {
    // Movimento WASD → vetor normalizado int8 (-10..10)
    var moveX = 0;
    var moveY = 0;

    for (var code in KEY_MAP) {
      if (this.keys[code]) {
        var mapping = KEY_MAP[code];
        if (mapping.axis === 'x') moveX += mapping.val;
        if (mapping.axis === 'y') moveY += mapping.val;
      }
    }

    // Normalizar diagonal para magnitude 1.0
    var len = Math.sqrt(moveX * moveX + moveY * moveY);
    if (len > 1.0) {
      moveX /= len;
      moveY /= len;
    }

    // Quantizar para int8 range (-10..10)
    var mx = Math.round(moveX * 10);
    var my = Math.round(moveY * 10);

    // Mira: coordenadas absolutas do mouse no canvas (int16)
    var ax = Math.round(this.mouseX);
    var ay = Math.round(this.mouseY);

    // Botões → bitmask
    // bit 0: attackLight  (LClick = button 0)
    // bit 1: attackHeavy  (RClick = button 2, ou não — usamos Shift+LClick)
    // bit 2: dash         (Shift ou RClick)
    // bit 3: guard        (Space)
    // bit 4: grab         (E key ou Q key)
    // bit 5: burst        (F key)
    var btn = 0;

    // Attack light: botão esquerdo do mouse
    if (this.mouseButtons[0]) btn |= 0x01;

    // Attack heavy: botão direito do mouse (quando não é dash)
    // Ou pode ser combinado com shift — simplificamos: RClick = heavy
    if (this.mouseButtons[2]) btn |= 0x02;

    // Dash: Shift (qualquer) ou botão direito como alternativa
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) btn |= 0x04;

    // Guard/Parry: Space
    if (this.keys['Space']) btn |= 0x08;

    // Grab: E ou Q
    if (this.keys['KeyE'] || this.keys['KeyQ']) btn |= 0x10;

    // Burst: F
    if (this.keys['KeyF']) btn |= 0x20;

    return {
      t: tick,
      mx: mx,
      my: my,
      ax: ax,
      ay: ay,
      btn: btn
    };
  };

  /**
   * Retorna se uma tecla específica está pressionada.
   * Útil para UI (não para simulação).
   * @param {string} code - KeyboardEvent.code
   */
  InputManager.prototype.isKeyDown = function (code) {
    return !!this.keys[code];
  };

  /**
   * Retorna posição atual do mouse relativa ao canvas.
   * @returns {{ x: number, y: number }}
   */
  InputManager.prototype.getMousePos = function () {
    return { x: this.mouseX, y: this.mouseY };
  };

  // ==================== CLEANUP ====================

  /**
   * Remove todos os event listeners. DEVE ser chamado ao sair do jogo.
   */
  InputManager.prototype.destroy = function () {
    this.destroyed = true;
    for (var i = 0; i < this._listeners.length; i++) {
      var entry = this._listeners[i];
      entry.target.removeEventListener(entry.event, entry.fn);
    }
    this._listeners = [];
    this.keys = {};
    this.mouseButtons = {};
  };

  return InputManager;
}));