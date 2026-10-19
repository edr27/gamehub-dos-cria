/**
 * Rinha.io v2 — Input Manager
 * ============================
 * Captura WASD + mouse, amostra a 60Hz no formato wire compacto.
 * Cleanup explícito via destroy().
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.RinhaInput = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY_MAP = {
    'KeyW': { a: 'y', v: -1 }, 'KeyS': { a: 'y', v: 1 },
    'KeyA': { a: 'x', v: -1 }, 'KeyD': { a: 'x', v: 1 },
    'ArrowUp': { a: 'y', v: -1 }, 'ArrowDown': { a: 'y', v: 1 },
    'ArrowLeft': { a: 'x', v: -1 }, 'ArrowRight': { a: 'x', v: 1 }
  };

  function InputManager(canvas) {
    this.canvas = canvas;
    this.destroyed = false;
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseButtons = {};
    this._listeners = [];
    this._bind();
  }

  InputManager.prototype._bind = function () {
    var self = this;
    var onKD = function (e) {
      if (self.destroyed) return;
      if (KEY_MAP[e.code] || e.code === 'Space') e.preventDefault();
      self.keys[e.code] = true;
    };
    var onKU = function (e) { if (!self.destroyed) self.keys[e.code] = false; };
    var onMM = function (e) {
      if (self.destroyed) return;
      var r = self.canvas.getBoundingClientRect();
      self.mouseX = e.clientX - r.left;
      self.mouseY = e.clientY - r.top;
    };
    var onMD = function (e) {
      if (self.destroyed) return;
      self.mouseButtons[e.button] = true;
      if (e.button === 2) e.preventDefault();
    };
    var onMU = function (e) { if (!self.destroyed) self.mouseButtons[e.button] = false; };
    var onCtx = function (e) { e.preventDefault(); };
    var onBlur = function () { if (!self.destroyed) { self.keys = {}; self.mouseButtons = {}; } };

    window.addEventListener('keydown', onKD);
    window.addEventListener('keyup', onKU);
    window.addEventListener('blur', onBlur);
    this.canvas.addEventListener('mousemove', onMM);
    this.canvas.addEventListener('mousedown', onMD);
    this.canvas.addEventListener('mouseup', onMU);
    this.canvas.addEventListener('contextmenu', onCtx);

    this._listeners = [
      { t: window, e: 'keydown', f: onKD },
      { t: window, e: 'keyup', f: onKU },
      { t: window, e: 'blur', f: onBlur },
      { t: this.canvas, e: 'mousemove', f: onMM },
      { t: this.canvas, e: 'mousedown', f: onMD },
      { t: this.canvas, e: 'mouseup', f: onMU },
      { t: this.canvas, e: 'contextmenu', f: onCtx }
    ];
  };

  InputManager.prototype.sample = function (tick) {
    var mx = 0, my = 0;
    for (var code in KEY_MAP) {
      if (this.keys[code]) {
        if (KEY_MAP[code].a === 'x') mx += KEY_MAP[code].v;
        else my += KEY_MAP[code].v;
      }
    }
    var len = Math.sqrt(mx * mx + my * my);
    if (len > 1) { mx /= len; my /= len; }

    var btn = 0;
    if (this.mouseButtons[0]) btn |= 0x01; // light attack
    if (this.mouseButtons[2]) btn |= 0x02; // heavy attack
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) btn |= 0x04; // dash
    if (this.keys['Space']) btn |= 0x08; // guard/parry
    if (this.keys['KeyE'] || this.keys['KeyQ']) btn |= 0x10; // grab
    if (this.keys['KeyF']) btn |= 0x20; // burst

    return {
      t: tick,
      mx: Math.round(mx * 10),
      my: Math.round(my * 10),
      ax: Math.round(this.mouseX),
      ay: Math.round(this.mouseY),
      btn: btn
    };
  };

  InputManager.prototype.destroy = function () {
    this.destroyed = true;
    for (var i = 0; i < this._listeners.length; i++) {
      var l = this._listeners[i];
      l.t.removeEventListener(l.e, l.f);
    }
    this._listeners = [];
    this.keys = {};
    this.mouseButtons = {};
  };

  return InputManager;
}));