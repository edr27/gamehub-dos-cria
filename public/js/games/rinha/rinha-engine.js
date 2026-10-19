/**
 * Rinha.io v2 — Engine de Combate Determinística
 * ================================================
 * Simulação pura que roda IDENTICAMENTE no servidor (autoritativo) e
 * no cliente (predição/reconciliação). Zero Math.random(), fixed timestep,
 * iteração ordenada por ID para determinismo cross-platform.
 *
 * UMD: funciona com require() no Node e <script> no browser.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./rinha-config.js'));
  } else {
    root.RinhaEngine = factory(root.RinhaConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (Config) {
  'use strict';

  // ==================== ESTADOS ====================
  var S = {
    NEUTRAL: 'neutral',
    STARTUP_L: 'startup_l',
    ACTIVE_L: 'active_l',
    RECOVERY_L: 'recovery_l',
    STARTUP_H: 'startup_h',
    ACTIVE_H: 'active_h',
    RECOVERY_H: 'recovery_h',
    GUARDING: 'guarding',
    PARRYING: 'parrying',
    GRAB_START: 'grab_start',
    GRAB_ACTIVE: 'grab_active',
    GRAB_RECOV: 'grab_recov',
    DASHING: 'dashing',
    BURST: 'burst',
    HITSTUN: 'hitstun',
    BLOCKSTUN: 'blockstun',
    STUNNED: 'stunned',
    THROWN: 'thrown',
    PARRY_STAGGER: 'parry_stagger',
    DEAD: 'dead'
  };

  var CAN_ACT = {};
  CAN_ACT[S.NEUTRAL] = true;
  CAN_ACT[S.GUARDING] = true;

  // ==================== EVENTOS ====================
  var EV = {
    HIT: 'hit', BLOCK: 'block', PARRY: 'parry',
    GRAB: 'grab', THROW: 'throw', WALL_SPLAT: 'wall_splat',
    POSTURE_BREAK: 'posture_break', KO: 'ko',
    ROUND_END: 'round_end', BURST: 'burst'
  };

  // ==================== CRIAÇÃO ====================
  function createWorld(seed) {
    return {
      tick: 0,
      phase: 'waiting',
      players: {},
      events: [],
      scores: {},
      round: 0,
      rng: Config.createRng(seed || 42)
    };
  }

  function createPlayer(id, name, fighterId, x, y, team) {
    var f = Config.FIGHTERS[fighterId];
    if (!f) throw new Error('Fighter desconhecido: ' + fighterId);
    return {
      id: id, name: name, fighterId: fighterId, team: team || null,
      x: x, y: y, vx: 0, vy: 0, facing: 0,
      hp: f.hp, hpMax: f.hp,
      posture: 0, stamina: f.staminaMax, staminaMax: f.staminaMax,
      momentum: 0,
      state: S.NEUTRAL, stateTicks: 0, action: null,
      comboCount: 0, comboTimer: 0, dashCancels: 0,
      alive: true, invuln: 0, hitThisAction: false,
      flashTimer: 0, lastDmg: 0,
      // Animação das mãos: progresso 0..1 do soco atual
      punchProgress: 0, punchHand: null
    };
  }

  // ==================== INPUT DECODE ====================
  function decodeInput(raw) {
    if (!raw) return null;
    var b = raw.btn || 0;
    return {
      tick: raw.t || 0,
      mx: (raw.mx || 0) / 10,
      my: (raw.my || 0) / 10,
      ax: raw.ax || 0, ay: raw.ay || 0,
      atkL: !!(b & 0x01), atkH: !!(b & 0x02),
      dash: !!(b & 0x04), guard: !!(b & 0x08),
      grab: !!(b & 0x10), burst: !!(b & 0x20)
    };
  }

  // ==================== STEP PRINCIPAL ====================
  function step(world, inputs) {
    world.events = [];
    world.tick++;
    var ids = Object.keys(world.players).sort();
    var i, p, inp;

    // Fase 1: Inputs + state machine
    for (i = 0; i < ids.length; i++) {
      p = world.players[ids[i]];
      if (!p.alive) continue;
      inp = inputs[ids[i]] ? decodeInput(inputs[ids[i]]) : null;
      processInput(world, p, inp);
    }

    // Fase 2: Física
    for (i = 0; i < ids.length; i++) {
      p = world.players[ids[i]];
      if (!p.alive) continue;
      applyPhysics(world, p);
    }

    // Fase 3: Combate
    for (i = 0; i < ids.length; i++) {
      p = world.players[ids[i]];
      if (!p.alive) continue;
      resolveCombat(world, p, ids);
    }

    // Fase 4: Separação
    separatePlayers(world, ids);

    // Fase 5: Decay/regen
    for (i = 0; i < ids.length; i++) {
      p = world.players[ids[i]];
      if (!p.alive) continue;
      applyDecay(world, p);
    }

    return world.events;
  }

  // ==================== STATE MACHINE ====================
  function processInput(w, p, inp) {
    p.stateTicks++;
    if (p.invuln > 0) p.invuln--;
    if (p.flashTimer > 0) p.flashTimer--;

    // Combo timeout
    if (p.comboTimer > 0) {
      p.comboTimer++;
      if (p.comboTimer >= Config.COMBO.resetTimeoutTicks) {
        p.comboCount = 0; p.comboTimer = 0; p.dashCancels = 0;
      }
    }

    // Atualizar mira
    if (inp) {
      var dx = inp.ax - p.x, dy = inp.ay - p.y;
      if (dx !== 0 || dy !== 0) p.facing = Math.atan2(dy, dx);
    }

    // Animação de soco: avançar progresso
    if (p.punchHand) {
      var fDef = Config.FIGHTERS[p.fighterId];
      var atkDef = p.action === 'heavy' ? fDef.attacks.heavy : fDef.attacks.light;
      var totalFrames = atkDef.startup + atkDef.active + atkDef.recovery;
      p.punchProgress = Math.min(1, p.stateTicks / totalFrames);
    }

    switch (p.state) {
      case S.NEUTRAL: handleNeutral(w, p, inp); break;
      case S.STARTUP_L: case S.STARTUP_H: handleStartup(w, p, inp); break;
      case S.ACTIVE_L: case S.ACTIVE_H: handleActive(w, p); break;
      case S.RECOVERY_L: case S.RECOVERY_H: handleRecovery(w, p); break;
      case S.GUARDING: handleGuard(w, p, inp); break;
      case S.PARRYING: handleParry(w, p); break;
      case S.GRAB_START: handleGrabStart(w, p); break;
      case S.GRAB_ACTIVE: handleGrabActive(w, p); break;
      case S.GRAB_RECOV: handleGrabRecov(w, p); break;
      case S.DASHING: handleDash(w, p); break;
      case S.BURST: handleBurst(w, p); break;
      case S.HITSTUN: case S.BLOCKSTUN: case S.STUNNED:
      case S.THROWN: case S.PARRY_STAGGER: handleStun(w, p); break;
      case S.DEAD: break;
    }
  }

  function enter(p, st) { p.state = st; p.stateTicks = 0; }

  function handleNeutral(w, p, inp) {
    if (!inp) return;
    var f = Config.FIGHTERS[p.fighterId];

    // Movimento
    if (inp.mx !== 0 || inp.my !== 0) {
      var len = Math.sqrt(inp.mx * inp.mx + inp.my * inp.my);
      var n = Math.min(len, 1);
      p.vx = (inp.mx / Math.max(len, 0.01)) * f.speed * n;
      p.vy = (inp.my / Math.max(len, 0.01)) * f.speed * n;
    } else {
      p.vx *= 0.7; p.vy *= 0.7;
    }

    // Prioridade: burst > dash > grab > heavy > light > guard
    if (inp.burst && p.momentum >= Config.MOMENTUM.burstCost) {
      enter(p, S.BURST); p.action = 'burst';
      p.momentum -= Config.MOMENTUM.burstCost;
      addEv(w, EV.BURST, { playerId: p.id, x: p.x, y: p.y });
      return;
    }
    if (inp.dash && p.stamina >= f.dash.staminaCost) {
      p.stamina -= f.dash.staminaCost;
      enter(p, S.DASHING); p.action = 'dash';
      p.invuln = f.dash.invulnFrames;
      return;
    }
    if (inp.grab) {
      enter(p, S.GRAB_START); p.action = 'grab';
      return;
    }
    if (inp.atkH) {
      enter(p, S.STARTUP_H); p.action = 'heavy';
      p.hitThisAction = false;
      p.punchHand = f.attacks.heavy.hand; p.punchProgress = 0;
      return;
    }
    if (inp.atkL) {
      enter(p, S.STARTUP_L); p.action = 'light';
      p.hitThisAction = false;
      p.punchHand = f.attacks.light.hand; p.punchProgress = 0;
      return;
    }
    if (inp.guard) {
      enter(p, S.PARRYING); p.action = 'guard';
      return;
    }
  }

  function handleStartup(w, p, inp) {
    var f = Config.FIGHTERS[p.fighterId];
    var atk = p.action === 'heavy' ? f.attacks.heavy : f.attacks.light;

    // Dash cancel (finta)
    if (inp && inp.dash && p.dashCancels < Config.COMBO.maxDashCancels) {
      if (p.stamina >= Config.COMBO.dashCancelStaminaCost) {
        p.stamina -= Config.COMBO.dashCancelStaminaCost;
        p.dashCancels++;
        enter(p, S.DASHING); p.action = 'dash';
        p.invuln = f.dash.invulnFrames;
        p.punchHand = null; p.punchProgress = 0;
        return;
      }
    }
    if (p.stateTicks >= atk.startup) {
      enter(p, p.action === 'heavy' ? S.ACTIVE_H : S.ACTIVE_L);
    }
  }

  function handleActive(w, p) {
    var f = Config.FIGHTERS[p.fighterId];
    var atk = p.action === 'heavy' ? f.attacks.heavy : f.attacks.light;
    if (p.stateTicks >= atk.startup + atk.active) {
      enter(p, p.action === 'heavy' ? S.RECOVERY_H : S.RECOVERY_L);
    }
  }

  function handleRecovery(w, p) {
    var f = Config.FIGHTERS[p.fighterId];
    var atk = p.action === 'heavy' ? f.attacks.heavy : f.attacks.light;
    if (p.stateTicks >= atk.startup + atk.active + atk.recovery) {
      enter(p, S.NEUTRAL); p.action = null;
      p.punchHand = null; p.punchProgress = 0;
    }
    p.vx *= 0.85; p.vy *= 0.85;
  }

  function handleGuard(w, p, inp) {
    if (!inp || !inp.guard) { enter(p, S.NEUTRAL); p.action = null; return; }
    if (inp.mx !== 0 || inp.my !== 0) {
      var f = Config.FIGHTERS[p.fighterId];
      var gs = f.speed * 0.3;
      var len = Math.sqrt(inp.mx * inp.mx + inp.my * inp.my);
      var n = Math.min(len, 1);
      p.vx = (inp.mx / Math.max(len, 0.01)) * gs * n;
      p.vy = (inp.my / Math.max(len, 0.01)) * gs * n;
    } else { p.vx *= 0.5; p.vy *= 0.5; }
  }

  function handleParry(w, p) {
    if (p.stateTicks >= Config.POSTURE.parryWindowTicks) enter(p, S.GUARDING);
  }

  function handleGrabStart(w, p) {
    if (p.stateTicks >= Config.FIGHTERS[p.fighterId].grab.startup) enter(p, S.GRAB_ACTIVE);
  }

  function handleGrabActive(w, p) {
    var g = Config.FIGHTERS[p.fighterId].grab;
    if (p.stateTicks >= g.startup + g.active) enter(p, S.GRAB_RECOV);
  }

  function handleGrabRecov(w, p) {
    var g = Config.FIGHTERS[p.fighterId].grab;
    if (p.stateTicks >= g.startup + g.active + g.recovery) {
      enter(p, S.NEUTRAL); p.action = null;
    }
    p.vx *= 0.85; p.vy *= 0.85;
  }

  function handleDash(w, p) {
    var d = Config.FIGHTERS[p.fighterId].dash;
    if (p.stateTicks >= d.duration) {
      enter(p, S.NEUTRAL); p.action = null; return;
    }
    p.vx = Math.cos(p.facing) * d.speed;
    p.vy = Math.sin(p.facing) * d.speed;
    if (p.stateTicks <= d.invulnFrames) p.invuln = 1;
  }

  function handleBurst(w, p) {
    if (p.stateTicks >= 10) { enter(p, S.NEUTRAL); p.action = null; return; }
    if (p.stateTicks === 1) {
      var ids = Object.keys(w.players).sort();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i] === p.id) continue;
        var o = w.players[ids[i]];
        if (!o.alive || isTeam(p, o)) continue;
        var dx = o.x - p.x, dy = o.y - p.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < Config.MOMENTUM.burstRadius) {
          var force = Config.MOMENTUM.burstForce * (1 - dist / Config.MOMENTUM.burstRadius);
          var ang = Math.atan2(dy, dx);
          o.vx += Math.cos(ang) * force;
          o.vy += Math.sin(ang) * force;
          o.comboCount = 0; o.comboTimer = 0; o.dashCancels = 0;
          if (o.state === S.HITSTUN || o.state === S.BLOCKSTUN) enter(o, S.NEUTRAL);
        }
      }
    }
    p.vx *= 0.5; p.vy *= 0.5;
  }

  function handleStun(w, p) {
    var dur;
    switch (p.state) {
      case S.HITSTUN: dur = 12; break;
      case S.BLOCKSTUN: dur = 8; break;
      case S.STUNNED: dur = Config.POSTURE.brokenStunTicks; break;
      case S.THROWN: dur = 20; break;
      case S.PARRY_STAGGER: dur = 18; break;
      default: dur = 10;
    }
    if (p.stateTicks >= dur) { enter(p, S.NEUTRAL); p.action = null; }
    p.vx *= 0.9; p.vy *= 0.9;
  }

  // ==================== FÍSICA ====================
  function applyPhysics(w, p) {
    p.x += p.vx; p.y += p.vy;
    var a = Config.ARENA, r = Config.FIGHTERS[p.fighterId].radius;
    var hitWall = false, wnx = 0, wny = 0;

    if (p.x - r < 0) { p.x = r; wnx = 1; hitWall = true; }
    else if (p.x + r > a.width) { p.x = a.width - r; wnx = -1; hitWall = true; }
    if (p.y - r < 0) { p.y = r; wny = 1; hitWall = true; }
    else if (p.y + r > a.height) { p.y = a.height - r; wny = -1; hitWall = true; }

    if (hitWall) {
      var spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (spd >= a.wallSplatThreshold && p.state === S.HITSTUN) {
        addEv(w, EV.WALL_SPLAT, { playerId: p.id, x: p.x, y: p.y, damage: Math.floor(spd * 2) });
        applyDmg(w, p, Math.floor(spd * 2), null);
        p.stateTicks = Math.max(0, p.stateTicks - 8);
      }
      if (wnx !== 0) p.vx *= -a.wallBounce;
      if (wny !== 0) p.vy *= -a.wallBounce;
      p.vx *= (1 - a.wallFriction);
      p.vy *= (1 - a.wallFriction);
    }

    // Obstáculos
    for (var i = 0; i < a.obstacles.length; i++) {
      var obs = a.obstacles[i];
      var cx = Config.clamp(p.x, obs.x, obs.x + obs.w);
      var cy = Config.clamp(p.y, obs.y, obs.y + obs.h);
      var odx = p.x - cx, ody = p.y - cy;
      var od2 = odx * odx + ody * ody;
      if (od2 < r * r && od2 > 0) {
        var od = Math.sqrt(od2);
        var overlap = r - od;
        var onx = odx / od, ony = ody / od;
        p.x += onx * overlap; p.y += ony * overlap;
        var dot = p.vx * onx + p.vy * ony;
        p.vx -= 2 * dot * onx * 0.5;
        p.vy -= 2 * dot * ony * 0.5;
      }
    }
  }

  // ==================== COMBATE ====================
  function resolveCombat(w, atk, ids) {
    var isAtk = atk.state === S.ACTIVE_L || atk.state === S.ACTIVE_H;
    var isGrab = atk.state === S.GRAB_ACTIVE;
    if (!isAtk && !isGrab) return;
    if (atk.hitThisAction) return;

    var f = Config.FIGHTERS[atk.fighterId];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === atk.id) continue;
      var tgt = w.players[ids[i]];
      if (!tgt.alive || isTeam(atk, tgt) || tgt.invuln > 0) continue;

      if (isAtk) { checkHit(w, atk, tgt, f); }
      else { checkGrab(w, atk, tgt, f); }
      if (atk.hitThisAction) break;
    }
  }

  function checkHit(w, atk, tgt, f) {
    var ad = atk.action === 'heavy' ? f.attacks.heavy : f.attacks.light;
    var hb = ad.hitbox;
    var cos = Math.cos(atk.facing), sin = Math.sin(atk.facing);
    var hcx = atk.x + (hb.offsetX * cos - hb.offsetY * sin);
    var hcy = atk.y + (hb.offsetX * sin + hb.offsetY * cos);
    var hr = Math.max(hb.width, hb.height) / 2;
    var tr = Config.FIGHTERS[tgt.fighterId].radius;
    var dx = hcx - tgt.x, dy = hcy - tgt.y;
    if (Math.sqrt(dx * dx + dy * dy) > hr + tr) return;

    var ang = Math.atan2(tgt.y - atk.y, tgt.x - atk.x);
    if (Math.abs(Config.normalizeAngle(ang - atk.facing)) > hb.angle) return;

    atk.hitThisAction = true;
    resolveTriangle(w, atk, tgt, ad);
  }

  function checkGrab(w, atk, tgt, f) {
    var g = f.grab;
    var dx = tgt.x - atk.x, dy = tgt.y - atk.y;
    if (Math.sqrt(dx * dx + dy * dy) > g.range + Config.FIGHTERS[tgt.fighterId].radius) return;
    var ang = Math.atan2(dy, dx);
    if (Math.abs(Config.normalizeAngle(ang - atk.facing)) > 0.5) return;

    atk.hitThisAction = true;
    if (tgt.state === S.GUARDING || tgt.state === S.PARRYING ||
        tgt.state === S.NEUTRAL || tgt.state === S.STARTUP_L || tgt.state === S.STARTUP_H) {
      doGrab(w, atk, tgt, g);
    }
  }

  function resolveTriangle(w, atk, tgt, ad) {
    // Parry vence ataque
    if (tgt.state === S.PARRYING) {
      enter(atk, S.PARRY_STAGGER); atk.action = null;
      atk.punchHand = null; atk.punchProgress = 0;
      tgt.posture = Math.max(0, tgt.posture - Config.POSTURE.postureRecoveryOnParry);
      tgt.momentum = Math.min(Config.MOMENTUM.max, tgt.momentum + Config.MOMENTUM.gainOnParry);
      addEv(w, EV.PARRY, { defId: tgt.id, atkId: atk.id, x: (atk.x + tgt.x) / 2, y: (atk.y + tgt.y) / 2 });
      return;
    }

    // Guarda bloqueia
    if (tgt.state === S.GUARDING) {
      var blocked = Math.floor(ad.damage * (1 - Config.POSTURE.guardReduction));
      applyDmg(w, tgt, blocked, atk);
      tgt.posture += Config.POSTURE.postureOnBlock;
      enter(tgt, S.BLOCKSTUN);
      var ka = Math.atan2(tgt.y - atk.y, tgt.x - atk.x);
      tgt.vx += Math.cos(ka) * ad.knockback * 0.4;
      tgt.vy += Math.sin(ka) * ad.knockback * 0.4;
      addEv(w, EV.BLOCK, { defId: tgt.id, atkId: atk.id, dmg: blocked, x: tgt.x, y: tgt.y });
      checkPostureBreak(w, tgt);
      return;
    }

    // Hit limpo
    var ci = Math.min(atk.comboCount, Config.COMBO.scaling.length - 1);
    var scale = Config.COMBO.scaling[ci] || Config.COMBO.minScale;
    var dmg = Math.floor(ad.damage * scale);
    applyDmg(w, tgt, dmg, atk);
    atk.comboCount++; atk.comboTimer = 0;
    atk.momentum = Math.min(Config.MOMENTUM.max, atk.momentum + Config.MOMENTUM.gainOnHitDeal);
    tgt.momentum = Math.min(Config.MOMENTUM.max, tgt.momentum + Config.MOMENTUM.gainOnHitTake);
    var ka2 = Math.atan2(tgt.y - atk.y, tgt.x - atk.x);
    tgt.vx += Math.cos(ka2) * ad.knockback;
    tgt.vy += Math.sin(ka2) * ad.knockback;
    tgt.posture += Math.floor(ad.postureDamage * 0.5);
    enter(tgt, S.HITSTUN);
    addEv(w, EV.HIT, { atkId: atk.id, defId: tgt.id, dmg: dmg, combo: atk.comboCount, kb: ad.knockback, x: tgt.x, y: tgt.y, heavy: atk.action === 'heavy' });
    checkPostureBreak(w, tgt);
  }

  function doGrab(w, atk, tgt, g) {
    applyDmg(w, tgt, g.damage, atk);
    enter(tgt, S.THROWN);
    var ta = Math.atan2(tgt.y - atk.y, tgt.x - atk.x);
    tgt.vx = Math.cos(ta) * 6; tgt.vy = Math.sin(ta) * 6;
    tgt.posture = Math.min(tgt.posture, Config.POSTURE.max * 0.5);
    atk.comboCount++; atk.comboTimer = 0;
    atk.momentum = Math.min(Config.MOMENTUM.max, atk.momentum + Config.MOMENTUM.gainOnHitDeal);
    addEv(w, EV.THROW, { atkId: atk.id, defId: tgt.id, dmg: g.damage, x: tgt.x, y: tgt.y });
  }

  function applyDmg(w, p, amt, atk) {
    if (amt <= 0) return;
    p.hp -= amt; p.lastDmg = amt; p.flashTimer = 4;
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false; enter(p, S.DEAD);
      addEv(w, EV.KO, { playerId: p.id, killerId: atk ? atk.id : null, x: p.x, y: p.y });
      checkRoundEnd(w);
    }
  }

  function checkPostureBreak(w, p) {
    if (p.posture >= Config.POSTURE.max) {
      p.posture = Config.POSTURE.max;
      enter(p, S.STUNNED); p.action = null;
      addEv(w, EV.POSTURE_BREAK, { playerId: p.id, x: p.x, y: p.y });
    }
  }

  function checkRoundEnd(w) {
    var alive = Object.keys(w.players).filter(function (id) { return w.players[id].alive; });
    if (alive.length <= 1) {
      addEv(w, EV.ROUND_END, { winnerId: alive[0] || null, reason: 'ko' });
      w.phase = 'round_end';
    }
  }

  function separatePlayers(w, ids) {
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = w.players[ids[i]], b = w.players[ids[j]];
        if (!a.alive || !b.alive) continue;
        var ra = Config.FIGHTERS[a.fighterId].radius;
        var rb = Config.FIGHTERS[b.fighterId].radius;
        var md = ra + rb;
        var dx = b.x - a.x, dy = b.y - a.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < md * md && d2 > 0.001) {
          var d = Math.sqrt(d2), ov = md - d;
          var nx = dx / d, ny = dy / d;
          a.x -= nx * ov * 0.5; a.y -= ny * ov * 0.5;
          b.x += nx * ov * 0.5; b.y += ny * ov * 0.5;
        }
      }
    }
  }

  function applyDecay(w, p) {
    var f = Config.FIGHTERS[p.fighterId];
    p.stamina = Math.min(f.staminaMax, p.stamina + f.staminaRegen * (p.state === S.NEUTRAL ? 1 : 0.3));
    if (p.state !== S.GUARDING && p.state !== S.BLOCKSTUN) {
      p.posture = Math.max(0, p.posture - Config.POSTURE.decayPerTick);
    }
    p.momentum = Math.max(0, p.momentum - Config.MOMENTUM.decayPerTick);
  }

  function isTeam(a, b) { return a.team && b.team && a.team === b.team; }
  function addEv(w, type, data) { w.events.push({ type: type, tick: w.tick, data: data }); }

  // ==================== CLONE ====================
  function cloneWorld(w) {
    var c = { tick: w.tick, phase: w.phase, players: {}, events: [], scores: {}, round: w.round, rng: Config.createRng(0) };
    var ids = Object.keys(w.players);
    for (var i = 0; i < ids.length; i++) c.players[ids[i]] = clonePlayer(w.players[ids[i]]);
    return c;
  }

  function clonePlayer(p) {
    return {
      id: p.id, name: p.name, fighterId: p.fighterId, team: p.team,
      x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing,
      hp: p.hp, hpMax: p.hpMax, posture: p.posture,
      stamina: p.stamina, staminaMax: p.staminaMax, momentum: p.momentum,
      state: p.state, stateTicks: p.stateTicks, action: p.action,
      comboCount: p.comboCount, comboTimer: p.comboTimer, dashCancels: p.dashCancels,
      alive: p.alive, invuln: p.invuln, hitThisAction: p.hitThisAction,
      flashTimer: p.flashTimer, lastDmg: p.lastDmg,
      punchProgress: p.punchProgress, punchHand: p.punchHand
    };
  }

  return { States: S, EventTypes: EV, createWorld: createWorld, createPlayer: createPlayer, step: step, cloneWorld: cloneWorld, clonePlayer: clonePlayer, decodeInput: decodeInput, isTeam: isTeam };
}));