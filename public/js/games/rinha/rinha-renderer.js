/**
 * Rinha.io v2 — Renderer Canvas 2D (Design Original)
 * ====================================================
 * Renderiza arena, lutadores com 2 MÃOS VISÍVEIS, animações de soco,
 * partículas, texto flutuante, screen shake e debug hitboxes.
 *
 * As mãos são círculos offset do corpo que se estendem durante ataques
 * baseados no punchProgress (0..1) do engine state.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./rinha-config.js'));
  } else {
    root.RinhaRenderer = factory(root.RinhaConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (Config) {
  'use strict';

  var States = null;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.width = Config.ARENA.width;
    this.height = Config.ARENA.height;
    this.dpr = window.devicePixelRatio || 1;
    this.shake = 0;
    this.flash = 0;
    this.particles = [];
    this.texts = [];
    this.afterimages = [];
    this.MAX_P = 100;
    this.MAX_T = 24;
    this.MAX_AI = 18;
    this.debug = false;
    this.resize();
  }

  Renderer.prototype.setStates = function (s) { States = s; };

  Renderer.prototype.resize = function () {
    var c = this.canvas.parentElement;
    if (!c) return;
    var r = c.getBoundingClientRect();
    var w = r.width, h = r.height;
    var ar = Config.ARENA.width / Config.ARENA.height;
    if (w / h > ar) w = h * ar; else h = w / ar;
    this.dw = Math.floor(w);
    this.dh = Math.floor(h);
    this.sx = this.dw / Config.ARENA.width;
    this.sy = this.dh / Config.ARENA.height;
    this.canvas.width = this.dw * this.dpr;
    this.canvas.height = this.dh * this.dpr;
    this.canvas.style.width = this.dw + 'px';
    this.canvas.style.height = this.dh + 'px';
    this.ctx.setTransform(this.dpr * this.sx, 0, 0, this.dpr * this.sy, 0, 0);
  };

  // ==================== VFX ====================
  Renderer.prototype.addShake = function (n) { this.shake = Math.min(this.shake + n, 14); };
  Renderer.prototype.addFlash = function (a) { this.flash = Math.min(this.flash + a, 0.6); };
  Renderer.prototype.addText = function (x, y, txt, col) {
    if (this.texts.length >= this.MAX_T) this.texts.shift();
    this.texts.push({ x: x, y: y, t: txt, c: col || '#fff', life: 45, vy: -1.5 });
  };
  Renderer.prototype.spawnP = function (x, y, n, col, spd) {
    for (var i = 0; i < n; i++) {
      if (this.particles.length >= this.MAX_P) this.particles.shift();
      var a = Math.random() * Math.PI * 2;
      var s = (Math.random() * 0.7 + 0.3) * (spd || 3);
      this.particles.push({ x: x, y: y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: 20+Math.random()*15|0, ml: 35, c: col||'#f59e0b', sz: 1.5+Math.random()*2 });
    }
  };
  Renderer.prototype.addAI = function (x, y, r, f, c) {
    if (this.afterimages.length >= this.MAX_AI) this.afterimages.shift();
    this.afterimages.push({ x:x, y:y, r:r, f:f, c:c||'#f59e0b', life:10 });
  };

  Renderer.prototype.processEvents = function (evts) {
    if (!evts) return;
    for (var i = 0; i < evts.length; i++) {
      var e = evts[i], d = e.data || e;
      switch (e.type || e) {
        case 'hit':
          this.addShake(d.heavy ? 7 : 3);
          this.spawnP(d.x, d.y, d.heavy ? 14 : 7, '#ef4444', 4);
          this.addText(d.x, d.y - 20, d.dmg, '#ef4444');
          break;
        case 'block':
          this.addShake(2); this.spawnP(d.x, d.y, 5, '#f59e0b', 2);
          this.addText(d.x, d.y - 20, 'BLOCK', '#f59e0b'); break;
        case 'parry':
          this.addFlash(0.35); this.addShake(5);
          this.spawnP(d.x, d.y, 18, '#3b82f6', 5);
          this.addText(d.x, d.y - 30, 'PARRY!', '#3b82f6'); break;
        case 'throw':
          this.addShake(6); this.spawnP(d.x, d.y, 12, '#a855f7', 5);
          this.addText(d.x, d.y - 25, d.dmg || 'THROW', '#a855f7'); break;
        case 'wall_splat':
          this.addShake(9); this.spawnP(d.x, d.y, 16, '#fff', 5);
          this.addText(d.x, d.y - 25, 'SPLAT!', '#fff'); break;
        case 'posture_break':
          this.addFlash(0.4); this.addShake(11);
          this.spawnP(d.x, d.y, 22, '#f59e0b', 6);
          this.addText(d.x, d.y - 35, 'BREAK!', '#f59e0b'); break;
        case 'burst':
          this.addFlash(0.2); this.spawnP(d.x, d.y, 28, '#3b82f6', 7); break;
        case 'ko':
          this.addShake(13); this.addFlash(0.5);
          this.spawnP(d.x, d.y, 32, '#ef4444', 8);
          this.addText(d.x, d.y - 40, 'K.O.', '#ef4444'); break;
      }
    }
  };

  // ==================== RENDER ====================
  Renderer.prototype.render = function (world, localId, opts) {
    var ctx = this.ctx;
    opts = opts || {};
    ctx.fillStyle = Config.COLORS.bg;
    ctx.fillRect(0, 0, Config.ARENA.width, Config.ARENA.height);

    var skX = 0, skY = 0;
    if (this.shake > 0.2) {
      skX = (Math.random()-0.5)*this.shake*2;
      skY = (Math.random()-0.5)*this.shake*2;
      this.shake *= 0.85;
      if (this.shake < 0.2) this.shake = 0;
    }
    ctx.save();
    ctx.translate(skX, skY);

    this.drawGrid(ctx);
    this.drawArena(ctx);
    this.drawAfterimages(ctx);

    var ids = Object.keys(world.players).sort();
    for (var i = 0; i < ids.length; i++) {
      var p = world.players[ids[i]];
      if (!p.alive && !(States && p.state === States.DEAD)) continue;
      this.drawFighter(ctx, p, ids[i] === localId, opts);
    }

    this.drawParticles(ctx);
    this.drawTexts(ctx);

    if (opts.showDebug || this.debug) {
      for (var j = 0; j < ids.length; j++) {
        if (world.players[ids[j]].alive) this.drawDebug(ctx, world.players[ids[j]]);
      }
    }
    ctx.restore();

    if (this.flash > 0.01) {
      ctx.fillStyle = 'rgba(255,255,255,' + this.flash.toFixed(3) + ')';
      ctx.fillRect(0, 0, Config.ARENA.width, Config.ARENA.height);
      this.flash *= 0.84;
      if (this.flash < 0.01) this.flash = 0;
    }
  };

  // ==================== ARENA ====================
  Renderer.prototype.drawGrid = function (ctx) {
    ctx.strokeStyle = Config.COLORS.grid; ctx.lineWidth = 0.5;
    var s = 40;
    ctx.beginPath();
    for (var x = 0; x <= Config.ARENA.width; x += s) { ctx.moveTo(x,0); ctx.lineTo(x,Config.ARENA.height); }
    for (var y = 0; y <= Config.ARENA.height; y += s) { ctx.moveTo(0,y); ctx.lineTo(Config.ARENA.width,y); }
    ctx.stroke();
  };
  Renderer.prototype.drawArena = function (ctx) {
    ctx.strokeStyle = Config.COLORS.wall; ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, Config.ARENA.width, Config.ARENA.height);
    ctx.fillStyle = Config.COLORS.obstacle;
    var obs = Config.ARENA.obstacles;
    for (var i = 0; i < obs.length; i++) {
      ctx.fillRect(obs[i].x, obs[i].y, obs[i].w, obs[i].h);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
      ctx.strokeRect(obs[i].x, obs[i].y, obs[i].w, obs[i].h);
    }
  };

  // ==================== FIGHTER COM 2 MÃOS ====================
  Renderer.prototype.drawFighter = function (ctx, p, isLocal, opts) {
    var fDef = Config.FIGHTERS[p.fighterId];
    var colIdx = 0;
    if (opts.playerColors) {
      colIdx = opts.playerColors.indexOf(p.id);
      if (colIdx < 0) colIdx = 0;
    }
    var baseCol = Config.COLORS.fighterColors[colIdx % Config.COLORS.fighterColors.length];
    var drawCol = p.flashTimer > 0 ? '#ffffff' : baseCol;

    if (!p.alive) ctx.globalAlpha = 0.3;

    var cos = Math.cos(p.facing), sin = Math.sin(p.facing);

    // Afterimage durante dash
    if (States && p.state === States.DASHING) {
      this.addAI(p.x, p.y, fDef.radius, p.facing, baseCol);
    }

    // === CORPO ===
    var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, fDef.radius);
    grad.addColorStop(0, drawCol);
    grad.addColorStop(1, shade(drawCol, -40));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(p.x, p.y, fDef.radius, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = isLocal ? '#fff' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = isLocal ? 2 : 1;
    ctx.stroke();

    // === VISOR DIRECIONAL ===
    var vl = fDef.radius * 0.85;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p.x + cos*fDef.radius*0.3, p.y + sin*fDef.radius*0.3);
    ctx.lineTo(p.x + cos*vl, p.y + sin*vl);
    ctx.stroke();

    // === 2 MÃOS VISÍVEIS ===
    this.drawHands(ctx, p, fDef, cos, sin);

    // === ARCO DE ATAQUE (active frames) ===
    if (States && (p.state === States.ACTIVE_L || p.state === States.ACTIVE_H)) {
      var atkT = p.action === 'heavy' ? 'heavy' : 'light';
      var ad = fDef.attacks[atkT];
      var hb = ad.hitbox;
      ctx.strokeStyle = p.action === 'heavy' ? '#ef4444' : '#f59e0b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, hb.offsetX + hb.width/2, p.facing - hb.angle, p.facing + hb.angle);
      ctx.stroke();
      ctx.fillStyle = p.action === 'heavy' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)';
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, hb.offsetX + hb.width/2, p.facing - hb.angle, p.facing + hb.angle);
      ctx.closePath(); ctx.fill();
    }

    // === ESCUDO GUARDA ===
    if (States && (p.state === States.GUARDING || p.state === States.BLOCKSTUN)) {
      ctx.strokeStyle = 'rgba(245,158,11,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, fDef.radius+6, p.facing-1.2, p.facing+1.2); ctx.stroke();
    }

    // === PARRY BRILHO ===
    if (States && p.state === States.PARRYING) {
      ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 3;
      ctx.shadowColor = '#3b82f6'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(p.x, p.y, fDef.radius+8, p.facing-1.4, p.facing+1.4); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // === GRAB INDICATOR ===
    if (States && p.state === States.GRAB_START) {
      ctx.strokeStyle = 'rgba(168,85,247,0.5)'; ctx.lineWidth = 2;
      ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.arc(p.x, p.y, fDef.grab.range, p.facing-0.5, p.facing+0.5); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (States && p.state === States.GRAB_ACTIVE) {
      ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 4;
      ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, fDef.grab.range, p.facing-0.5, p.facing+0.5); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(168,85,247,0.2)';
      ctx.beginPath(); ctx.moveTo(p.x,p.y);
      ctx.arc(p.x, p.y, fDef.grab.range, p.facing-0.5, p.facing+0.5);
      ctx.closePath(); ctx.fill();
    }

    // === STUNNED STARS ===
    if (States && p.state === States.STUNNED) {
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
      var t = Date.now() * 0.05;
      for (var s = 0; s < 3; s++) {
        var sa = t + s * Math.PI*2/3;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(sa)*(fDef.radius+12), p.y - fDef.radius - 8 + Math.sin(sa)*5, 2, 0, Math.PI*2);
        ctx.stroke();
      }
    }

    // === THROWN SPIRAL ===
    if (States && p.state === States.THROWN) {
      ctx.strokeStyle = 'rgba(168,85,247,0.6)'; ctx.lineWidth = 2;
      var tt = Date.now() * 0.1;
      for (var ti = 0; ti < 3; ti++) {
        var ta = tt + ti*Math.PI*2/3;
        var tr = fDef.radius + 6 + Math.sin(tt*2+ti)*4;
        ctx.beginPath(); ctx.arc(p.x+Math.cos(ta)*tr, p.y+Math.sin(ta)*tr, 3, 0, Math.PI*2); ctx.stroke();
      }
    }

    // Overhead bars
    this.drawBars(ctx, p, fDef);

    // Nome
    ctx.fillStyle = Config.COLORS.textLight;
    ctx.font = '10px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name || '?', p.x, p.y - fDef.radius - 18);
    ctx.globalAlpha = 1;
  };

  // ==================== 2 MÃOS COM ANIMAÇÃO DE SOCO ====================
  Renderer.prototype.drawHands = function (ctx, p, fDef, cos, sin) {
    var hands = fDef.hands;
    var punchExt = 0;
    var punchingHand = null;

    // Calcular extensão do soco baseado no estado e progresso
    if (p.punchHand && p.punchProgress > 0) {
      punchingHand = p.punchHand;
      var atkType = p.action === 'heavy' ? 'heavy' : 'light';
      var atkDef = fDef.attacks[atkType];
      var totalF = atkDef.startup + atkDef.active + atkDef.recovery;

      // Curva de animação: estende rápido no startup, mantém no active, retrai no recovery
      if (p.stateTicks <= atkDef.startup) {
        // Startup: mão avança
        punchExt = (p.stateTicks / atkDef.startup) * atkDef.hitbox.offsetX;
      } else if (p.stateTicks <= atkDef.startup + atkDef.active) {
        // Active: mão totalmente estendida
        punchExt = atkDef.hitbox.offsetX;
      } else {
        // Recovery: mão retrai
        var recovProg = (p.stateTicks - atkDef.startup - atkDef.active) / atkDef.recovery;
        punchExt = atkDef.hitbox.offsetX * (1 - recovProg);
      }
    }

    // Desenhar cada mão
    var handNames = ['left', 'right'];
    for (var h = 0; h < 2; h++) {
      var hName = handNames[h];
      var hDef = hands[hName];
      if (!hDef) continue;

      // Posição base da mão relativa ao centro, rotacionada pelo facing
      var hx = p.x + (hDef.offsetX * cos - hDef.offsetY * sin);
      var hy = p.y + (hDef.offsetX * sin + hDef.offsetY * cos);

      // Se esta é a mão que está socando, estender na direção do facing
      if (hName === punchingHand && punchExt > 0) {
        hx += cos * punchExt;
        hy += sin * punchExt;
      }

      // Cor da mão: amarela durante soco ativo, normal caso contrário
      var handCol = Config.COLORS.handLeft;
      if (hName === 'right') handCol = Config.COLORS.handRight;
      if (hName === punchingHand && punchExt > 2) {
        handCol = Config.COLORS.handPunch;
      }

      // Sombra da mão (projeção)
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(hx + 2, hy + 2, hDef.radius, 0, Math.PI * 2);
      ctx.fill();

      // Mão propriamente dita
      ctx.fillStyle = handCol;
      ctx.beginPath();
      ctx.arc(hx, hy, hDef.radius, 0, Math.PI * 2);
      ctx.fill();

      // Borda da mão
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Brilho no punho durante active frames
      if (hName === punchingHand && States &&
          (p.state === States.ACTIVE_L || p.state === States.ACTIVE_H)) {
        ctx.shadowColor = handCol;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, hDef.radius + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Trail de movimento da mão (motion blur)
        var trailLen = 3;
        for (var tl = 1; tl <= trailLen; tl++) {
          var tx = hx - cos * tl * 6;
          var ty = hy - sin * tl * 6;
          var ta = 0.3 * (1 - tl / trailLen);
          ctx.globalAlpha = ta;
          ctx.fillStyle = handCol;
          ctx.beginPath();
          ctx.arc(tx, ty, hDef.radius * (1 - tl*0.15), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = p.alive ? 1 : 0.3;
      }
    }
  };

  // ==================== OVERHEAD BARS ====================
  Renderer.prototype.drawBars = function (ctx, p, fDef) {
    var bw = 36, bh = 3;
    var bx = p.x - bw/2, by = p.y - fDef.radius - 12;
    ctx.fillStyle = '#333'; ctx.fillRect(bx, by, bw, bh);
    var hr = Math.max(0, p.hp / p.hpMax);
    ctx.fillStyle = hr > 0.3 ? Config.COLORS.hpBar : Config.COLORS.hpBarLow;
    ctx.fillRect(bx, by, bw * hr, bh);
    var py = by + bh + 1;
    ctx.fillStyle = '#333'; ctx.fillRect(bx, py, bw, 2);
    ctx.fillStyle = Config.COLORS.postureBar;
    ctx.fillRect(bx, py, bw * Math.max(0, p.posture / Config.POSTURE.max), 2);
  };

  // ==================== AFTERIMAGES ====================
  Renderer.prototype.drawAfterimages = function (ctx) {
    for (var i = this.afterimages.length-1; i >= 0; i--) {
      var a = this.afterimages[i]; a.life--;
      if (a.life <= 0) { this.afterimages.splice(i,1); continue; }
      ctx.globalAlpha = (a.life/10)*0.3;
      ctx.fillStyle = a.c;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  // ==================== PARTICLES ====================
  Renderer.prototype.drawParticles = function (ctx) {
    for (var i = this.particles.length-1; i >= 0; i--) {
      var pt = this.particles[i];
      pt.x += pt.vx; pt.y += pt.vy; pt.vx *= 0.95; pt.vy *= 0.95; pt.life--;
      if (pt.life <= 0) { this.particles.splice(i,1); continue; }
      ctx.globalAlpha = pt.life / pt.ml;
      ctx.fillStyle = pt.c;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.sz * (pt.life/pt.ml), 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  // ==================== FLOATING TEXT ====================
  Renderer.prototype.drawTexts = function (ctx) {
    for (var i = this.texts.length-1; i >= 0; i--) {
      var ft = this.texts[i]; ft.y += ft.vy; ft.vy *= 0.96; ft.life--;
      if (ft.life <= 0) { this.texts.splice(i,1); continue; }
      ctx.globalAlpha = Math.min(1, ft.life/15);
      ctx.fillStyle = ft.c;
      ctx.font = 'bold 14px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ft.t, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;
  };

  // ==================== DEBUG ====================
  Renderer.prototype.drawDebug = function (ctx, p) {
    var fDef = Config.FIGHTERS[p.fighterId];
    ctx.strokeStyle = 'rgba(34,197,94,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, fDef.radius, 0, Math.PI*2); ctx.stroke();
    if (States && (p.state === States.ACTIVE_L || p.state === States.ACTIVE_H)) {
      var ad = fDef.attacks[p.action === 'heavy' ? 'heavy' : 'light'];
      var hb = ad.hitbox;
      var cx = p.x + hb.offsetX * Math.cos(p.facing);
      var cy = p.y + hb.offsetX * Math.sin(p.facing);
      ctx.strokeStyle = 'rgba(239,68,68,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(hb.width,hb.height)/2, 0, Math.PI*2); ctx.stroke();
    }
    ctx.fillStyle = '#aaa'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
    ctx.fillText((p.state||'?')+' t:'+p.stateTicks, p.x+fDef.radius+4, p.y-4);
    if (p.comboCount > 0) { ctx.fillStyle='#f59e0b'; ctx.fillText('combo:'+p.comboCount, p.x+fDef.radius+4, p.y+8); }
    if (p.punchHand) { ctx.fillStyle='#ffcc00'; ctx.fillText('punch:'+p.punchHand+' '+p.punchProgress.toFixed(2), p.x+fDef.radius+4, p.y+18); }
  };

  function shade(c, pct) {
    var n = parseInt(c.replace('#',''),16);
    var r = Math.min(255,Math.max(0,(n>>16)+pct));
    var g = Math.min(255,Math.max(0,((n>>8)&0xFF)+pct));
    var b = Math.min(255,Math.max(0,(n&0xFF)+pct));
    return '#'+(0x1000000+r*0x10000+g*0x100+b).toString(16).slice(1);
  }

  return Renderer;
}));