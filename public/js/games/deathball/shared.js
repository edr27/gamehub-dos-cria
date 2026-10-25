/**
 * Death Ball v2 — núcleo compartilhado (servidor Node + navegador)
 *
 * O MESMO código roda nos dois lados: o servidor é a autoridade e o cliente usa
 * exatamente a mesma física para prever a bola até o "agora" do servidor.
 * Assim a bola que você vê é a bola que o servidor está simulando, e o parry
 * é julgado no instante em que você apertou (compensação de lag).
 *
 * Unidades: arena circular de raio 50 centrada em (0,0); tempo em segundos
 * dentro da física e em milissegundos nos carimbos de rede.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DeathBallShared = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = Object.freeze({
    // --- Rede / simulação ---
    TICK_HZ: 60,
    SUB_STEPS: 2,              // 120 Hz de física dentro de cada tick
    SNAP_EVERY: 2,             // snapshot a cada 2 ticks = 30 Hz
    MAX_REWIND_MS: 260,        // quanto o servidor aceita "voltar no tempo" para julgar um parry

    // --- Arena / jogadores ---
    ARENA_R: 50,
    PLAYER_R: 2.4,
    PLAYER_LIMIT: 46.4,        // raio máximo do centro do jogador
    PLAYER_SPEED: 29,          // unidades/s
    PLAYER_ACCEL: 16,          // suavização da aceleração (1/s)
    DASH_DIST: 15,
    DASH_TIME: 0.14,
    DASH_CD: 2.6,

    // --- Bola ---
    BALL_R: 1.5,
    KILL_DIST: 4.0,            // distância centro-a-centro que mata
    DEFLECT_DIST: 5.6,         // distância em que um parry armado rebate a bola
    BALL_START: 33,            // ~119 km/h
    BALL_MAX: 245,             // ~880 km/h
    BALL_ACCEL: 1.8,           // ganho de velocidade por segundo em voo (pressão)
    HIT_MULT: 1.055, HIT_ADD: 2.0,
    PERF_MULT: 1.075, PERF_ADD: 3.6,
    HOMING_BASE: 4.6,
    HOMING_K: 0.075,           // homing mais forte em alta velocidade
    HOMING_RAMP: 0.22,         // segundos para o homing chegar a 100% depois do tiro reto
    STRAIGHT_T: 0.10,          // tiro reto na direção da mira depois do parry
    SMASH_STRAIGHT_T: 0.24,
    HITSTOP: 0.075,            // congelamento do impacto (também esconde latência)
    HITSTOP_PERFECT: 0.12,
    CHARGE_T: 1.15,            // bola carregando no centro antes do lançamento

    // --- Janelas de parry (em segundos até o impacto) ---
    WIN_SLOW: 0.42, WIN_FAST: 0.25,
    PERF_SLOW: 0.10, PERF_FAST: 0.065,
    LATE_TOL: 0.04,            // "no limite": aceita parry até 40 ms depois do contato
    MISS_CD: 0.62,             // errou (cedo demais / sem alvo): fica sem parry
    HIT_CD: 0.08,              // acertou: pode rebater de novo rápido (clash)

    // --- Smash ---
    SMASH_CHARGES: 3,          // perfeitos necessários
    SMASH_BOOST: 0.75,         // +75% de velocidade instantânea que decai
    SMASH_DECAY: 1.05,         // por segundo

    // --- Partida ---
    COUNTDOWN_MS: 3000,
    FIRST_COUNTDOWN_MS: 3600,
    KILL_PAUSE_MS: 1700,
    ROUND_END_MS: 4200,
  });

  const PHASE = Object.freeze({ IDLE: 0, HOLD: 1, FLY: 2, PENDING: 3 });
  const EV = Object.freeze({ NONE: 0, BOUNCE: 1, CONTACT: 2, LAUNCH: 3 });

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function speedFrac(eff) {
    return clamp01((eff - C.BALL_START) / (C.BALL_MAX - C.BALL_START));
  }
  function parryWindow(eff) { return lerp(C.WIN_SLOW, C.WIN_FAST, speedFrac(eff)); }
  function perfectWindow(eff) { return lerp(C.PERF_SLOW, C.PERF_FAST, speedFrac(eff)); }
  function effSpeed(b) { return b.speed * (1 + b.smash); }
  function toKmh(u) { return Math.round(u * 3.6); }

  function newBall() {
    return {
      x: 0, y: 0, dx: 0, dy: -1, speed: C.BALL_START, smash: 0,
      phase: PHASE.IDLE, holdLeft: 0, aimT: 9, flyT: 0, straight: 0,
      target: -1, lastHitter: -1, aimAtTarget: 0
    };
  }

  function copyBall(dst, src) {
    dst.x = src.x; dst.y = src.y; dst.dx = src.dx; dst.dy = src.dy;
    dst.speed = src.speed; dst.smash = src.smash; dst.phase = src.phase;
    dst.holdLeft = src.holdLeft; dst.aimT = src.aimT; dst.flyT = src.flyT;
    dst.straight = src.straight; dst.target = src.target;
    dst.lastHitter = src.lastHitter; dst.aimAtTarget = src.aimAtTarget;
    return dst;
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  function packBall(b) {
    return [r2(b.x), r2(b.y), r4(b.dx), r4(b.dy), r2(b.speed), r4(b.smash), b.phase,
      r4(b.holdLeft), r4(Math.min(b.aimT, 9)), r4(Math.min(b.flyT, 99)), r4(b.straight),
      b.target, b.lastHitter, b.aimAtTarget];
  }
  function unpackBall(a, dst) {
    dst = dst || newBall();
    dst.x = a[0]; dst.y = a[1]; dst.dx = a[2]; dst.dy = a[3]; dst.speed = a[4]; dst.smash = a[5];
    dst.phase = a[6]; dst.holdLeft = a[7]; dst.aimT = a[8]; dst.flyT = a[9]; dst.straight = a[10];
    dst.target = a[11]; dst.lastHitter = a[12]; dst.aimAtTarget = a[13];
    return dst;
  }

  /**
   * Avança a bola dt segundos. `tgt` = {x,y} do alvo (ou null).
   * Retorna EV.* — o chamador decide o que fazer com CONTACT.
   */
  function stepBall(b, tgt, dt) {
    if (b.phase === PHASE.IDLE || b.phase === PHASE.PENDING) return EV.NONE;

    if (b.phase === PHASE.HOLD) {
      b.holdLeft -= dt;
      if (b.holdLeft > 0) return EV.NONE;
      b.phase = PHASE.FLY;
      b.holdLeft = 0;
      if (b.aimAtTarget && tgt) {
        const ddx = tgt.x - b.x, ddy = tgt.y - b.y;
        const dd = Math.hypot(ddx, ddy) || 1;
        b.dx = ddx / dd; b.dy = ddy / dd;
      }
      b.aimAtTarget = 0;
      return EV.LAUNCH;
    }

    // --- FLY ---
    b.aimT += dt;
    b.flyT += dt;
    if (b.speed < C.BALL_MAX) b.speed = Math.min(C.BALL_MAX, b.speed + C.BALL_ACCEL * dt);
    if (b.smash > 0) b.smash = Math.max(0, b.smash - C.SMASH_DECAY * dt);
    const eff = b.speed * (1 + b.smash);

    if (tgt) {
      const tx = tgt.x - b.x, ty = tgt.y - b.y;
      const d = Math.hypot(tx, ty) || 1e-6;
      const ux = tx / d, uy = ty / d;
      const ramp = clamp01((b.aimT - b.straight) / C.HOMING_RAMP);
      if (ramp > 0) {
        if (ramp >= 1 && d < C.KILL_DIST * 2.6) {
          // Perto demais: trava direto no alvo (sem órbitas)
          b.dx = ux; b.dy = uy;
        } else {
          const near = d < 20 ? (1 - d / 20) : 0;
          const k = (C.HOMING_BASE + eff * C.HOMING_K) * (1 + 3 * near) * (1 + Math.min(b.flyT, 3) * 0.35) * ramp;
          const a = 1 - Math.exp(-k * dt);
          let nx = b.dx + (ux - b.dx) * a;
          let ny = b.dy + (uy - b.dy) * a;
          const nm = Math.hypot(nx, ny);
          if (nm < 1e-4) { nx = ux; ny = uy; } else { nx /= nm; ny /= nm; }
          b.dx = nx; b.dy = ny;
        }
      }
    }

    b.x += b.dx * eff * dt;
    b.y += b.dy * eff * dt;

    // Parede circular
    let ev = EV.NONE;
    const lim = C.ARENA_R - C.BALL_R;
    const rr = Math.hypot(b.x, b.y);
    if (rr > lim) {
      const nx = b.x / rr, ny = b.y / rr;
      b.x = nx * lim; b.y = ny * lim;
      const dot = b.dx * nx + b.dy * ny;
      if (dot > 0) { b.dx -= 2 * dot * nx; b.dy -= 2 * dot * ny; }
      ev = EV.BOUNCE;
    }

    if (tgt) {
      const d2 = Math.hypot(tgt.x - b.x, tgt.y - b.y);
      if (d2 <= C.KILL_DIST) return EV.CONTACT;
    }
    return ev;
  }

  /** Tempo estimado (s) até a bola encostar em (px,py). */
  function timeToImpact(b, px, py) {
    if (b.phase === PHASE.PENDING) return 0;
    if (b.phase === PHASE.IDLE) return Infinity;
    const eff = Math.max(1, effSpeed(b));
    const d = Math.hypot(px - b.x, py - b.y) - C.KILL_DIST;
    const flight = Math.max(0, d) / eff;
    return b.phase === PHASE.HOLD ? flight + Math.max(0, b.holdLeft) : flight;
  }

  /** Escolhe o adversário mais alinhado com a mira. players: [{i,x,y,alive}] */
  function chooseTarget(fromI, fx, fy, ax, ay, players, rng) {
    let best = -1, bestScore = -Infinity, count = 0;
    const am = Math.hypot(ax, ay);
    for (let k = 0; k < players.length; k++) {
      const p = players[k];
      if (!p || !p.alive || p.i === fromI) continue;
      count++;
      if (am < 0.01) continue;
      const ox = p.x - fx, oy = p.y - fy;
      const om = Math.hypot(ox, oy) || 1;
      // alinhamento domina; distância desempata levemente
      const score = (ox / om) * (ax / am) + (oy / om) * (ay / am) - om * 0.0015;
      if (score > bestScore) { bestScore = score; best = p.i; }
    }
    if (best === -1 && count > 0) {
      const r = rng ? rng() : Math.random();
      let n = Math.floor(r * count);
      for (let k = 0; k < players.length; k++) {
        const p = players[k];
        if (!p || !p.alive || p.i === fromI) continue;
        if (n-- === 0) return p.i;
      }
    }
    return best;
  }

  function clampToArena(p) {
    const r = Math.hypot(p.x, p.y);
    if (r > C.PLAYER_LIMIT) { p.x = p.x / r * C.PLAYER_LIMIT; p.y = p.y / r * C.PLAYER_LIMIT; }
  }

  /** Nova velocidade base depois de um parry. */
  function nextSpeed(speed, perfect) {
    const s = perfect ? speed * C.PERF_MULT + C.PERF_ADD : speed * C.HIT_MULT + C.HIT_ADD;
    return Math.min(C.BALL_MAX, s);
  }

  return {
    C, PHASE, EV, newBall, copyBall, packBall, unpackBall, stepBall, timeToImpact,
    chooseTarget, parryWindow, perfectWindow, effSpeed, speedFrac, toKmh, clampToArena, nextSpeed
  };
});
