/**
 * Rinha.io — Configuração Compartilhada
 * =====================================
 * Este arquivo é carregado tanto no servidor (Node.js via require()) quanto
 * no cliente (browser via <script>). Contém TODOS os números de balanceamento,
 * definições de lutadores, arena e constantes de física.
 *
 * Regra de ouro: NENHUM cálculo de combate deve usar Math.random().
 * Use o PRNG xorshift128 com seed da sala para qualquer aleatoriedade.
 */

(function (root, factory) {
  // UMD module pattern: funciona com require() no Node e <script> no browser
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.RinhaConfig = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const Config = {
    // ==================== TICK RATE ====================
    TICK_RATE: 60,
    FIXED_DELTA_TIME: 1 / 60, // ~16.667ms por tick

    // ==================== ARENA ====================
    ARENA: {
      width: 960,
      height: 640,
      // Atrito aplicado quando jogador encosta na parede (0-1)
      wallFriction: 0.3,
      // Restituição do quique na parede (0-1)
      wallRestitution: 0.5,
      // Velocidade mínima para considerar wall splat
      wallSplatSpeedThreshold: 3.0,
      // Obstáculos da arena padrão (retângulos {x, y, w, h})
      obstacles: [
        { x: 200, y: 200, w: 40, h: 240 },
        { x: 720, y: 200, w: 40, h: 240 },
        { x: 400, y: 280, w: 160, h: 80 }
      ]
    },

    // ==================== POSTURA ====================
    POSTURE: {
      max: 100,
      // Decaimento natural por tick quando não está sendo pressionado
      decayPerTick: 0.15,
      // Ticks de atordoamento quando postura quebra (~1.5s)
      brokenStunTicks: 90,
      // Janela de parry perfeito em ticks (~133ms)
      parryWindowTicks: 8,
      // Eficiência da guarda em reduzir dano HP (0.8 = 80% bloqueado)
      guardDamageReduction: 0.8,
      // Dano de postura ao bloquear um ataque
      postureDamageOnBlock: 12,
      // Recuperação de postura no parry perfeito
      postureRecoveryOnParry: 30
    },

    // ==================== MOMENTUM ====================
    MOMENTUM: {
      max: 100,
      // Custo para ativar burst
      burstCost: 60,
      // Raio de efeito do burst em pixels
      burstRadius: 130,
      // Força de empurrão do burst
      burstForce: 8.0,
      // Momentum ganho ao acertar um golpe
      gainOnHitDeal: 8,
      // Momentum ganho ao receber dano
      gainOnHitTake: 5,
      // Momentum ganho no parry perfeito
      gainOnParry: 15,
      // Decaimento natural por tick
      decayPerTick: 0.05
    },

    // ==================== COMBO ====================
    COMBO: {
      // Escala de dano por hit no combo (índice = número do hit)
      damageScaling: [1.0, 0.85, 0.72, 0.61, 0.52, 0.44, 0.38, 0.33, 0.28],
      // Dano mínimo garantido (floor)
      minDamageScale: 0.25,
      // Ticks sem acertar para resetar combo (~0.67s)
      resetTimeoutTicks: 40,
      // Máximo de dash cancels permitidos por combo
      maxDashCancels: 2,
      // Custo de stamina por dash cancel
      dashCancelStaminaCost: 20
    },

    // ==================== TRIÂNGULO DE COMBATE ====================
    COMBAT_TRIANGLE: {
      // attack > grab > guard > attack
      // parry (timing window) > attack
      ATTACK_BEATS: 'grab',
      GRAB_BEATS: 'guard',
      PARRY_BEATS: 'attack'
    },

    // ==================== LUTADORES ====================
    FIGHTERS: {
      faisca: {
        id: 'faisca',
        name: 'Faísca',
        desc: 'Ágil e rápido. Ataques velozes com menor dano.',
        radius: 22,
        hp: 90,
        speed: 5.6,
        staminaMax: 120,
        staminaRegen: 0.4,
        // Dados de frame (em ticks a 60fps)
        attacks: {
          light: {
            startup: 6,
            active: 5,
            recovery: 8,
            damage: 8,
            knockback: 3.0,
            postureDamage: 10,
            // Hitbox relativa ao centro + direção da mira
            hitbox: { offsetX: 28, offsetY: 0, width: 36, height: 30, angle: 0.6 }
          },
          heavy: {
            startup: 12,
            active: 6,
            recovery: 16,
            damage: 18,
            knockback: 6.0,
            postureDamage: 22,
            hitbox: { offsetX: 32, offsetY: 0, width: 48, height: 40, angle: 0.8 }
          }
        },
        grab: {
          startup: 8,
          active: 4,
          recovery: 14,
          damage: 12,
          range: 40
        },
        dash: {
          duration: 10,
          speed: 12.0,
          invulnFrames: 7,
          cooldown: 30,
          staminaCost: 25
        }
      },
      golias: {
        id: 'golias',
        name: 'Golias',
        desc: 'Lento e pesado. Golpes devastadores com maior alcance.',
        radius: 27,
        hp: 125,
        speed: 4.1,
        staminaMax: 100,
        staminaRegen: 0.3,
        attacks: {
          light: {
            startup: 9,
            active: 6,
            recovery: 12,
            damage: 12,
            knockback: 4.0,
            postureDamage: 14,
            hitbox: { offsetX: 34, offsetY: 0, width: 44, height: 36, angle: 0.7 }
          },
          heavy: {
            startup: 18,
            active: 8,
            recovery: 22,
            damage: 28,
            knockback: 9.0,
            postureDamage: 35,
            hitbox: { offsetX: 40, offsetY: 0, width: 60, height: 50, angle: 0.9 }
          }
        },
        grab: {
          startup: 12,
          active: 5,
          recovery: 18,
          damage: 18,
          range: 48
        },
        dash: {
          duration: 8,
          speed: 9.0,
          invulnFrames: 4,
          cooldown: 40,
          staminaCost: 30
        }
      }
    },

    // ==================== MODOS DE JOGO ====================
    MODES: {
      '1v1': { id: '1v1', name: '1v1 Rei da Mesa', maxPlayers: 2, roundsToWin: 2, queue: true },
      'ffa': { id: 'ffa', name: 'Free-for-All', maxPlayers: 4, roundsToWin: 1, queue: false },
      '2v2': { id: '2v2', name: '2v2 Equipes', maxPlayers: 4, roundsToWin: 2, queue: false }
    },

    // ==================== CORES DA PALETA ====================
    COLORS: {
      primary: '#f59e0b',    // amber
      accent: '#ef4444',     // crimson
      bg: '#0f0f0f',
      gridLine: '#1a1a1a',
      wall: '#333333',
      obstacle: '#444444',
      hpBar: '#22c55e',
      hpBarLow: '#ef4444',
      postureBar: '#f59e0b',
      momentumBar: '#3b82f6',
      staminaBar: '#a855f7',
      textLight: '#ffffff',
      textMuted: '#888888',
      fighterColors: ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e']
    },

    // ==================== UTILITÁRIOS ====================

    /**
     * Cria uma instância de PRNG xorshift128 determinístico.
     * Usado para efeitos visuais e qualquer aleatoriedade na simulação.
     * @param {number} seed - Seed inicial (geralmente hash do roomCode + tick)
     */
    createRng: function (seed) {
      let s0 = seed | 0;
      let s1 = (seed * 2654435761) | 0;
      return {
        next: function () {
          let x = s0;
          const y = s1;
          s0 = y;
          x ^= x << 23;
          x ^= x >> 17;
          x ^= y ^ (y >> 26);
          s1 = x;
          return ((s0 + s1) >>> 0) / 4294967296;
        },
        // Retorna inteiro entre min (inclusivo) e max (exclusivo)
        nextInt: function (min, max) {
          return min + Math.floor(this.next() * (max - min));
        }
      };
    },

    /**
     * Normaliza ângulo para [-PI, PI] usando aritmética segura.
     */
    normalizeAngle: function (angle) {
      while (angle > Math.PI) angle -= 2 * Math.PI;
      while (angle < -Math.PI) angle += 2 * Math.PI;
      return angle;
    },

    /**
     * Clamp genérico.
     */
    clamp: function (val, min, max) {
      return val < min ? min : val > max ? max : val;
    }
  };

  return Config;
}));