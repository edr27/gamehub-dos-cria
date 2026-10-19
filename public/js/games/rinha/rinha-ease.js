/**
 * Rinha.io v2 — Easing Library
 * ==============================
 * Funções de easing puras para animações procedurais.
 * Zero alocação, zero dependências.
 *
 * Todas recebem t em [0,1] e retornam valor em [0,1] (ou além para overshoot).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.RinhaEase = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var Ease = {
    linear: function (t) { return t; },

    inQuad: function (t) { return t * t; },
    outQuad: function (t) { return t * (2 - t); },
    inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; },

    inCubic: function (t) { return t * t * t; },
    outCubic: function (t) { return (--t) * t * t + 1; },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; },

    inBack: function (t) { var s = 1.70158; return t * t * ((s + 1) * t - s); },
    outBack: function (t) { var s = 1.70158; return (--t) * t * ((s + 1) * t + s) + 1; },
    inOutBack: function (t) {
      var s = 1.70158 * 1.525;
      if ((t *= 2) < 1) return 0.5 * (t * t * ((s + 1) * t - s));
      return 0.5 * ((t -= 2) * t * ((s + 1) * t + s) + 2);
    },

    outElastic: function (t) {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
    },

    outBounce: function (t) {
      if (t < 1 / 2.75) return 7.5625 * t * t;
      if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
      if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    },

    // Spring crítica: sem oscilação, assenta rápido
    criticalSpring: function (t) {
      return 1 - (1 + 10 * t) * Math.exp(-10 * t);
    },

    // Smoothstep clássico
    smoothstep: function (t) { return t * t * (3 - 2 * t); },

    // Anticipation: recua antes de avançar (para startup de golpes)
    anticipation: function (t) {
      // Recua até t=0.3, depois avança com outCubic
      if (t < 0.3) {
        return -0.15 * Ease.outQuad(t / 0.3);
      }
      return Ease.outCubic((t - 0.3) / 0.7);
    },

    // Follow-through: overshoot suave no final (para recovery)
    followThrough: function (t) {
      return Ease.outBack(t);
    },

    // Hitstop freeze: retorna 0 durante freeze, 1 depois
    hitstop: function (t, freezeDuration) {
      return t < freezeDuration ? 0 : Ease.outQuad((t - freezeDuration) / (1 - freezeDuration));
    }
  };

  /**
   * Interpolação linear entre dois valores.
   */
  Ease.lerp = function (a, b, t) {
    return a + (b - a) * t;
  };

  /**
   * Interpolação de ângulo (shortest path).
   */
  Ease.lerpAngle = function (a, b, t) {
    var diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
  };

  /**
   * Clamp genérico.
   */
  Ease.clamp = function (v, min, max) {
    return v < min ? min : v > max ? max : v;
  };

  return Ease;
}));