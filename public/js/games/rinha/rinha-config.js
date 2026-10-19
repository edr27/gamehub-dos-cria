/**
 * Rinha.io v2 — Configuração de Combate (Design Original)
 * ========================================================
 * Este arquivo define TODOS os números de balanceamento, física e dados
 * de lutadores para o Rinha.io reescrito do zero.
 *
 * Princípios de design:
 * - 2 mãos visíveis por personagem (renderizadas como círculos offset)
 * - Animações de soco com startup/active/recovery claros
 * - Triângulo: Ataque > Agarrão > Guarda > Ataque; Parry vence Ataque no timing
 * - Postura quebra = stun + janela de combo livre
 * - Combo curto (3-8 hits) com scaling decrescente
 * - Determinístico: sem Math.random(), PRNG seeded, fixed timestep
 *
 * UMD: funciona com require() no Node e <script> no browser.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.RinhaConfig = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var Config = {
    // ==================== TICK & FÍSICA ====================
    TICK_RATE: 60,
    FIXED_DT: 1 / 60,

    ARENA: {
      width: 960,
      height: 640,
      wallFriction: 0.3,
      wallBounce: 0.4,
      wallSplatThreshold: 3.5,
      obstacles: [
        { x: 180, y: 180, w: 40, h: 280 },
        { x: 740, y: 180, w: 40, h: 280 },
        { x: 380, y: 260, w: 200, h: 120 }
      ]
    },

    // ==================== POSTURA ====================
    POSTURE: {
      max: 100,
      decayPerTick: 0.12,
      brokenStunTicks: 90,       // ~1.5s de atordoamento
      parryWindowTicks: 7,       // ~117ms janela de parry perfeito
      guardReduction: 0.82,      // 82% do dano HP bloqueado
      postureOnBlock: 14,        // postura ganha ao bloquear
      postureRecoveryOnParry: 35 // postura recuperada no parry perfeito
    },

    // ==================== MOMENTUM ====================
    MOMENTUM: {
      max: 100,
      burstCost: 55,
      burstRadius: 140,
      burstForce: 9.0,
      gainOnHitDeal: 7,
      gainOnHitTake: 4,
      gainOnParry: 18,
      decayPerTick: 0.04
    },

    // ==================== COMBO ====================
    COMBO: {
      // Escala de dano por hit no combo (índice = hit number)
      scaling: [1.0, 0.88, 0.76, 0.65, 0.55, 0.46, 0.38, 0.32],
      minScale: 0.25,
      resetTimeoutTicks: 45,     // ~0.75s sem acertar = reset
      maxDashCancels: 2,
      dashCancelStaminaCost: 22
    },

    // ==================== LUTADORES ====================
    // Cada lutador tem 2 mãos visíveis (offset do centro + raio da mão)
    FIGHTERS: {
      faísca: {
        id: 'faísca',
        name: 'Faísca',
        desc: 'Ágil e rápido. Socos velozes com menor dano.',
        radius: 20,
        hp: 88,
        speed: 5.8,
        staminaMax: 125,
        staminaRegen: 0.45,
        // Mãos visíveis: posição relativa ao centro + facing
        hands: {
          left:  { offsetX: -12, offsetY: 8,  radius: 7, punchExtend: 28 },
          right: { offsetX: 12,  offsetY: 8,  radius: 7, punchExtend: 28 }
        },
        attacks: {
          light: {
            hand: 'right',          // qual mão soca
            startup: 5,
            active: 4,
            recovery: 7,
            damage: 7,
            knockback: 2.8,
            postureDamage: 9,
            hitbox: { offsetX: 26, offsetY: 0, width: 34, height: 28, angle: 0.55 }
          },
          heavy: {
            hand: 'left',
            startup: 11,
            active: 5,
            recovery: 15,
            damage: 17,
            knockback: 5.5,
            postureDamage: 20,
            hitbox: { offsetX: 30, offsetY: 0, width: 46, height: 38, angle: 0.75 }
          }
        },
        grab: {
          startup: 7,
          active: 4,
          recovery: 13,
          damage: 11,
          range: 38
        },
        dash: {
          duration: 9,
          speed: 13.0,
          invulnFrames: 6,
          cooldown: 28,
          staminaCost: 24
        }
      },

      golias: {
        id: 'golias',
        name: 'Golias',
        desc: 'Lento e pesado. Socos devastadores com maior alcance.',
        radius: 26,
        hp: 130,
        speed: 3.9,
        staminaMax: 105,
        staminaRegen: 0.32,
        hands: {
          left:  { offsetX: -16, offsetY: 10, radius: 10, punchExtend: 34 },
          right: { offsetX: 16,  offsetY: 10, radius: 10, punchExtend: 34 }
        },
        attacks: {
          light: {
            hand: 'right',
            startup: 8,
            active: 5,
            recovery: 11,
            damage: 11,
            knockback: 3.8,
            postureDamage: 13,
            hitbox: { offsetX: 32, offsetY: 0, width: 42, height: 34, angle: 0.65 }
          },
          heavy: {
            hand: 'left',
            startup: 17,
            active: 7,
            recovery: 21,
            damage: 27,
            knockback: 8.5,
            postureDamage: 33,
            hitbox: { offsetX: 38, offsetY: 0, width: 58, height: 48, angle: 0.85 }
          }
        },
        grab: {
          startup: 11,
          active: 5,
          recovery: 17,
          damage: 17,
          range: 46
        },
        dash: {
          duration: 7,
          speed: 9.5,
          invulnFrames: 3,
          cooldown: 38,
          staminaCost: 28
        }
      }
    },

    // ==================== MODOS ====================
    MODES: {
      '1v1': { id: '1v1', name: '1v1 Rei da Mesa', maxPlayers: 2, roundsToWin: 2, queue: true },
      'ffa': { id: 'ffa', name: 'Free-for-All',   maxPlayers: 4, roundsToWin: 1, queue: false },
      '2v2': { id: '2v2', name: '2v2 Equipes',    maxPlayers: 4, roundsToWin: 2, queue: false }
    },

    // ==================== CORES ====================
    COLORS: {
      primary: '#f59e0b',
      accent: '#ef4444',
      bg: '#0f0f0f',
      grid: '#1a1a1a',
      wall: '#333333',
      obstacle: '#444444',
      hpBar: '#22c55e',
      hpBarLow: '#ef4444',
      postureBar: '#f59e0b',
      momentumBar: '#3b82f6',
      staminaBar: '#a855f7',
      textLight: '#ffffff',
      textMuted: '#888888',
      fighterColors: ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e'],
      // Cores das mãos (para distinguir socos)
      handLeft: '#e0e0e0',
      handRight: '#ffffff',
      handPunch: '#ffcc00'
    },

    // ==================== UTILITÁRIOS ====================
    createRng: function (seed) {
      var s0 = seed | 0;
      var s1 = (seed * 2654435761) | 0;
      return {
        next: function () {
          var x = s0;
          var y = s1;
          s0 = y;
          x ^= x << 23;
          x ^= x >> 17;
          x ^= y ^ (y >> 26);
          s1 = x;
          return ((s0 + s1) >>> 0) / 4294967296;
        },
        nextInt: function (min, max) {
          return min + Math.floor(this.next() * (max - min));
        }
      };
    },

    normalizeAngle: function (a) {
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      return a;
    },

    clamp: function (v, min, max) {
      return v < min ? min : v > max ? max : v;
    }
  };

  return Config;
}));