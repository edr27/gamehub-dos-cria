/**
 * Rinha.io — Renderer Canvas 2D
 * ==============================
 * Renderiza o estado do mundo usando formas vetoriais simples (sem sprites).
 * Separado da simulação: recebe worldState + config e desenha.
 *
 * Features: arena com grid/obstáculos, lutadores com direção, arcos de ataque,
 * escudos de guarda/parry, partículas, texto flutuante de dano, afterimages,
 * screen shake, flash, e overlay de debug com hitboxes/frame data.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./rinha-config.js'));
  } else {
    root.RinhaRenderer = factory(root.RinhaConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (Config) {
  'use strict';

  var States = null; // Será injetado via setStates()

  /**
   * @constructor
   * @param {HTMLCanvasElement} canvas
   */
  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.width = Config.ARENA.width;
    this.height = Config.ARENA.height;
    this.dpr = window.devicePixelRatio || 1;

    // Efeitos visuais
    this.shakeIntensity = 0;
    this.flashAlpha = 0;
    this.particles = [];       // pool de partículas
    this.floatingTexts = [];   // textos de dano flutuantes
    this.afterimages = [];     // rastros de dash

    // Limites dos pools
    this.MAX_PARTICLES = 80;
    this.MAX_TEXTS = 20;
    this.MAX_AFTERIMAGES = 15;

    // Debug
    this.debugMode = false;

    this.resize();
  }

  // ==================== SETUP ====================

  /**
   * Injeta referência aos States do engine para evitar dependência circular.
   */
  Renderer.prototype.setStates = function (statesObj) {
    States = statesObj;
  };

  /**
   * Ajusta canvas para tamanho correto com DPR.
   */
  Renderer.prototype.resize = function () {
    var container = this.canvas.parentElement;
    if (!container) return;

    var rect = container.getBoundingClientRect();
    var w = rect.width;
    var h = rect.height;

    // Manter aspect ratio da arena
    var arenaAspect = Config.ARENA.width / Config.ARENA.height;
    var containerAspect = w / h;

    if (containerAspect > arenaAspect) {
      w = h * arenaAspect;
    } else {
      h = w / arenaAspect;
    }

    this.displayWidth = Math.floor(w);
    this.displayHeight = Math.floor(h);
    this.scaleX = this.displayWidth / Config.ARENA.width;
    this.scaleY = this.displayHeight / Config.ARENA.height;

    this.canvas.width = this.displayWidth * this.dpr;
    this.canvas.height = this.displayHeight * this.dpr;
    this.canvas.style.width = this.displayWidth + 'px';
    this.canvas.style.height = this.displayHeight + 'px';

    this.ctx.setTransform(this.dpr * this.scaleX, 0, 0, this.dpr * this.scaleY, 0, 0);
  };

  // ==================== VFX API ====================

  Renderer.prototype.addShake = function (intensity) {
    this.shakeIntensity = Math.min(this.shakeIntensity + intensity, 12);
  };

  Renderer.prototype.addFlash = function (alpha) {
    this.flashAlpha = Math.min(this.flashAlpha + alpha, 0.6);
  };

  Renderer.prototype.addDamageText = function (x, y, text, color) {
    if (this.floatingTexts.length >= this.MAX_TEXTS) {
      this.floatingTexts.shift();
    }
    this.floatingTexts.push({
      x: x, y: y,
      text: String(text),
      color: color || '#ffffff',
      life: 45, // ticks (~0.75s)
      vy: -1.5
    });
  };

  Renderer.prototype.spawnParticles = function (x, y, count, color, speed) {
    for (var i = 0; i < count; i++) {
      if (this.particles.length >= this.MAX_PARTICLES) {
        this.particles.shift();
      }
      var angle = Math.random() * Math.PI * 2;
      var spd = (Math.random() * 0.7 + 0.3) * (speed || 3);
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 20 + Math.random() * 15 | 0,
        maxLife: 35,
        color: color || '#f59e0b',
        size: 1.5 + Math.random() * 2
      });
    }
  };

  Renderer.prototype.addAfterimage = function (x, y, radius, facing, color) {
    if (this.afterimages.length >= this.MAX_AFTERIMAGES) {
      this.afterimages.shift();
    }
    this.afterimages.push({
      x: x, y: y,
      radius: radius,
      facing: facing,
      color: color || '#f59e0b',
      life: 10
    });
  };

  /**
   * Processa eventos do engine e gera efeitos visuais correspondentes.
   */
  Renderer.prototype.processEvents = function (events) {
    if (!events) return;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      switch (ev.type) {
        case 'hit':
          this.addShake(ev.isHeavy ? 6 : 3);
          this.spawnParticles(ev.x, ev.y, ev.isHeavy ? 12 : 6, '#ef4444', 4);
          this.addDamageText(ev.x, ev.y - 20, ev.damage, '#ef4444');
          break;
        case 'block':
          this.addShake(2);
          this.spawnParticles(ev.x, ev.y, 4, '#f59e0b', 2);
          this.addDamageText(ev.x, ev.y - 20, 'BLOCK', '#f59e0b');
          break;
        case 'parry':
          this.addFlash(0.3);
          this.addShake(4);
          this.spawnParticles(ev.x, ev.y, 15, '#3b82f6', 5);
          this.addDamageText(ev.x, ev.y - 30, 'PARRY!', '#3b82f6');
          break;
        case 'throw':
          this.addShake(5);
          this.spawnParticles(ev.x, ev.y, 10, '#a855f7', 4);
          this.addDamageText(ev.x, ev.y - 20, ev.damage, '#a855f7');
          break;
        case 'wall_splat':
          this.addShake(8);
          this.spawnParticles(ev.x, ev.y, 15, '#ffffff', 5);
          this.addDamageText(ev.x, ev.y - 25, 'SPLAT!', '#ffffff');
          break;
        case 'posture_break':
          this.addFlash(0.4);
          this.addShake(10);
          this.spawnParticles(ev.x, ev.y, 20, '#f59e0b', 6);
          this.addDamageText(ev.x, ev.y - 35, 'BREAK!', '#f59e0b');
          break;
        case 'burst':
          this.addFlash(0.2);
          this.spawnParticles(ev.x, ev.y, 25, '#3b82f6', 7);
          break;
        case 'ko':
          this.addShake(12);
          this.addFlash(0.5);
          this.spawnParticles(ev.x, ev.y, 30, '#ef4444', 8);
          this.addDamageText(ev.x, ev.y - 40, 'K.O.', '#ef4444');
          break;
        case 'grab':
          this.addShake(3);
          this.spawnParticles(ev.x, ev.y, 8, '#a855f7', 3);
          this.addDamageText(ev.x, ev.y - 20, 'GRAB!', '#a855f7');
          break;
        case 'throw':
          this.addShake(6);
          this.spawnParticles(ev.x, ev.y, 12, '#a855f7', 5);
          this.addDamageText(ev.x, ev.y - 25, ev.damage || 'THROW', '#a855f7');
          break;
      }
    }
  };

  // ==================== RENDER PRINCIPAL ====================

  /**
   * Desenha um frame completo.
   * @param {object} world - Estado atual do mundo (Engine world)
   * @param {string} localPlayerId - ID do jogador local (para destaque)
   * @param {object} options - Opções extras { showDebug, playerColors }
   */
  Renderer.prototype.render = function (world, localPlayerId, options) {
    var ctx = this.ctx;
    var opts = options || {};

    // Limpar fundo
    ctx.fillStyle = Config.COLORS.bg;
    ctx.fillRect(0, 0, Config.ARENA.width, Config.ARENA.height);

    // Screen shake offset
    var shakeX = 0, shakeY = 0;
    if (this.shakeIntensity > 0.2) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity * 2;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity * 2;
      this.shakeIntensity *= 0.86;
      if (this.shakeIntensity < 0.2) this.shakeIntensity = 0;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    // Grid de fundo
    this.drawGrid(ctx);

    // Paredes e obstáculos
    this.drawArena(ctx);

    // Afterimages (atrás dos lutadores)
    this.drawAfterimages(ctx);

    // Lutadores
    var playerIds = Object.keys(world.players).sort();
    for (var i = 0; i < playerIds.length; i++) {
      var pid = playerIds[i];
      var p = world.players[pid];
      if (!p.alive && p.state !== (States && States.DEAD)) continue;
      this.drawFighter(ctx, p, pid === localPlayerId, opts);
    }

    // Partículas
    this.updateAndDrawParticles(ctx);

    // Textos flutuantes
    this.updateAndDrawFloatingTexts(ctx);

    // Debug overlay
    if (opts.showDebug || this.debugMode) {
      for (var j = 0; j < playerIds.length; j++) {
        var dbgP = world.players[playerIds[j]];
        if (dbgP.alive) this.drawDebugHitboxes(ctx, dbgP);
      }
    }

    ctx.restore();

    // Flash overlay (fora do shake transform)
    if (this.flashAlpha > 0.01) {
      ctx.fillStyle = 'rgba(255, 255, 255, ' + this.flashAlpha.toFixed(3) + ')';
      ctx.fillRect(0, 0, Config.ARENA.width, Config.ARENA.height);
      this.flashAlpha *= 0.85;
      if (this.flashAlpha < 0.01) this.flashAlpha = 0;
    }
  };

  // ==================== DESENHO DA ARENA ====================

  Renderer.prototype.drawGrid = function (ctx) {
    ctx.strokeStyle = Config.COLORS.gridLine;
    ctx.lineWidth = 0.5;
    var step = 40;

    ctx.beginPath();
    for (var x = 0; x <= Config.ARENA.width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, Config.ARENA.height);
    }
    for (var y = 0; y <= Config.ARENA.height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(Config.ARENA.width, y);
    }
    ctx.stroke();
  };

  Renderer.prototype.drawArena = function (ctx) {
    // Bordas da arena
    ctx.strokeStyle = Config.COLORS.wall;
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, Config.ARENA.width, Config.ARENA.height);

    // Obstáculos
    ctx.fillStyle = Config.COLORS.obstacle;
    var obs = Config.ARENA.obstacles;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      ctx.fillRect(o.x, o.y, o.w, o.h);

      // Borda sutil
      ctx.strokeStyle = '#555555';
      ctx.lineWidth = 1;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    }
  };

  // ==================== DESENHO DO LUTADOR ====================

  Renderer.prototype.drawFighter = function (ctx, p, isLocal, opts) {
    var fDef = Config.FIGHTERS[p.fighterId];
    var colorIndex = 0;
    if (opts && opts.playerColors) {
      colorIndex = opts.playerColors.indexOf(p.id);
      if (colorIndex < 0) colorIndex = 0;
    }
    var baseColor = Config.COLORS.fighterColors[colorIndex % Config.COLORS.fighterColors.length];

    // Flash branco ao tomar dano
    var drawColor = baseColor;
    if (p.flashTimer > 0) {
      drawColor = '#ffffff';
    }

    // Transparência se morto
    if (!p.alive) {
      ctx.globalAlpha = 0.3;
    }

    // Corpo (círculo com gradiente radial)
    var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, fDef.radius);
    grad.addColorStop(0, drawColor);
    grad.addColorStop(1, shadeColor(drawColor, -40));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, fDef.radius, 0, Math.PI * 2);
    ctx.fill();

    // Borda do corpo
    ctx.strokeStyle = isLocal ? '#ffffff' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = isLocal ? 2 : 1;
    ctx.stroke();

    // Visor direcional (indica facing)
    var visorLen = fDef.radius * 0.9;
    var vx = p.x + Math.cos(p.facing) * visorLen;
    var vy = p.y + Math.sin(p.facing) * visorLen;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(p.facing) * fDef.radius * 0.3, p.y + Math.sin(p.facing) * fDef.radius * 0.3);
    ctx.lineTo(vx, vy);
    ctx.stroke();

    // Arco de ataque durante active frames
    if (States && (p.state === States.ACTIVE_LIGHT || p.state === States.ACTIVE_HEAVY)) {
      var atkType = p.currentAction === 'heavy' ? 'heavy' : 'light';
      var atkDef = fDef.attacks[atkType];
      var hb = atkDef.hitbox;

      ctx.strokeStyle = p.currentAction === 'heavy' ? '#ef4444' : '#f59e0b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, hb.offsetX + hb.width / 2,
        p.facing - hb.angle, p.facing + hb.angle);
      ctx.stroke();

      // Preenchimento sutil do arco
      ctx.fillStyle = p.currentAction === 'heavy'
        ? 'rgba(239, 68, 68, 0.15)'
        : 'rgba(245, 158, 11, 0.15)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, hb.offsetX + hb.width / 2,
        p.facing - hb.angle, p.facing + hb.angle);
      ctx.closePath();
      ctx.fill();
    }

    // Escudo de guarda
    if (States && (p.state === States.GUARDING || p.state === States.BLOCKSTUN)) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, fDef.radius + 6,
        p.facing - 1.2, p.facing + 1.2);
      ctx.stroke();
    }

    // Brilho de parry (janela ativa)
    if (States && p.state === States.PARRYING) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#3b82f6';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, fDef.radius + 8,
        p.facing - 1.4, p.facing + 1.4);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Indicador de stun/postura quebrada
    if (States && p.state === States.STUNNED) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      var starCount = 3;
      for (var s = 0; s < starCount; s++) {
        var sa = (world_tick_safe() * 0.05) + (s * Math.PI * 2 / starCount);
        var sx = p.x + Math.cos(sa) * (fDef.radius + 12);
        var sy = p.y - fDef.radius - 8 + Math.sin(sa) * 5;
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Grab startup: indicador de alcance do agarrão
    if (States && p.state === States.GRAB_STARTUP) {
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, fDef.grab ? fDef.grab.range : 40,
        p.facing - 0.5, p.facing + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Grab active: arco de agarrão roxo
    if (States && p.state === States.GRAB_ACTIVE) {
      var grabRange = fDef.grab ? fDef.grab.range : 40;
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, grabRange,
        p.facing - 0.5, p.facing + 0.5);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Preenchimento do arco de grab
      ctx.fillStyle = 'rgba(168, 85, 247, 0.2)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, grabRange,
        p.facing - 0.5, p.facing + 0.5);
      ctx.closePath();
      ctx.fill();
    }

    // Thrown: efeito de desorientação (linhas espirais)
    if (States && p.state === States.THROWN) {
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)';
      ctx.lineWidth = 2;
      var throwTime = world_tick_safe() * 0.1;
      for (var t = 0; t < 3; t++) {
        var ta = throwTime + (t * Math.PI * 2 / 3);
        var tr = fDef.radius + 6 + Math.sin(throwTime * 2 + t) * 4;
        var tx = p.x + Math.cos(ta) * tr;
        var ty = p.y + Math.sin(ta) * tr;
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Dash: afterimage extra (seguro, sem transformação de contexto)
    if (States && p.state === States.DASHING) {
      this.addAfterimage(p.x, p.y, fDef.radius, p.facing, baseColor);
    }

    // Grab recovery: indicador visual de cooldown
    if (States && p.state === States.GRAB_RECOVERY) {
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, fDef.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Barras overhead (HP + postura mini)
    this.drawOverheadBars(ctx, p, fDef);

    // Nome
    ctx.fillStyle = Config.COLORS.textLight;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name || '?', p.x, p.y - fDef.radius - 18);

    ctx.globalAlpha = 1.0;
  };

  Renderer.prototype.drawOverheadBars = function (ctx, p, fDef) {
    var barW = 36;
    var barH = 3;
    var bx = p.x - barW / 2;
    var by = p.y - fDef.radius - 12;

    // HP bar background
    ctx.fillStyle = '#333333';
    ctx.fillRect(bx, by, barW, barH);

    // HP bar fill
    var hpRatio = Math.max(0, p.hp / p.hpMax);
    ctx.fillStyle = hpRatio > 0.3 ? Config.COLORS.hpBar : Config.COLORS.hpBarLow;
    ctx.fillRect(bx, by, barW * hpRatio, barH);

    // Posture bar (abaixo da HP)
    var py = by + barH + 1;
    ctx.fillStyle = '#333333';
    ctx.fillRect(bx, py, barW, 2);

    var postRatio = Math.max(0, p.posture / Config.POSTURE.max);
    ctx.fillStyle = Config.COLORS.postureBar;
    ctx.fillRect(bx, py, barW * postRatio, 2);
  };

  // ==================== AFTERIMAGES ====================

  Renderer.prototype.drawAfterimages = function (ctx) {
    for (var i = this.afterimages.length - 1; i >= 0; i--) {
      var ai = this.afterimages[i];
      ai.life--;
      if (ai.life <= 0) {
        this.afterimages.splice(i, 1);
        continue;
      }
      var alpha = ai.life / 10;
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillStyle = ai.color;
      ctx.beginPath();
      ctx.arc(ai.x, ai.y, ai.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  };

  // ==================== PARTÍCULAS ====================

  Renderer.prototype.updateAndDrawParticles = function (ctx) {
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var pt = this.particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vx *= 0.95;
      pt.vy *= 0.95;
      pt.life--;

      if (pt.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      var alpha = pt.life / pt.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  };

  // ==================== TEXTOS FLUTUANTES ====================

  Renderer.prototype.updateAndDrawFloatingTexts = function (ctx) {
    for (var i = this.floatingTexts.length - 1; i >= 0; i--) {
      var ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.vy *= 0.96;
      ft.life--;

      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }

      var alpha = Math.min(1, ft.life / 15);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 14px Space Grotesk, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1.0;
  };

  // ==================== DEBUG HITBOXES ====================

  Renderer.prototype.drawDebugHitboxes = function (ctx, p) {
    var fDef = Config.FIGHTERS[p.fighterId];

    // Hurtbox (círculo do corpo)
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, fDef.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Hitbox ativa
    if (States && (p.state === States.ACTIVE_LIGHT || p.state === States.ACTIVE_HEAVY)) {
      var atkType = p.currentAction === 'heavy' ? 'heavy' : 'light';
      var atkDef = fDef.attacks[atkType];
      var hb = atkDef.hitbox;

      var cos = Math.cos(p.facing);
      var sin = Math.sin(p.facing);
      var cx = p.x + (hb.offsetX * cos - hb.offsetY * sin);
      var cy = p.y + (hb.offsetX * sin + hb.offsetY * cos);

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(hb.width, hb.height) / 2, 0, Math.PI * 2);
      ctx.stroke();

      // Arco de alcance
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, hb.offsetX + hb.width / 2,
        p.facing - hb.angle, p.facing + hb.angle);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Frame data text
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    var stateLabel = p.state || '?';
    var tickLabel = 't:' + (p.stateTicks || 0);
    ctx.fillText(stateLabel + ' ' + tickLabel, p.x + fDef.radius + 4, p.y - 4);

    // Combo counter
    if (p.comboCount > 0) {
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('combo:' + p.comboCount, p.x + fDef.radius + 4, p.y + 8);
    }
  };

  // ==================== UTILITÁRIOS ====================

  /**
   * Escurece/clareia uma cor hex.
   * @param {string} color - Cor hex (#rrggbb)
   * @param {number} percent - Percentual negativo=escurecer, positivo=clarear
   */
  function shadeColor(color, percent) {
    var num = parseInt(color.replace('#', ''), 16);
    var r = Math.min(255, Math.max(0, (num >> 16) + percent));
    var g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + percent));
    var b = Math.min(255, Math.max(0, (num & 0x0000FF) + percent));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }

  /**
   * Helper seguro para pegar tick global (apenas para animações visuais).
   * Não afeta determinismo pois é usado apenas em efeitos cosméticos.
   */
  function world_tick_safe() {
    return Date.now();
  }

  return Renderer;
}));