/**
 * Death Ball v2 — servidor autoritativo
 *
 * - Loop de passo fixo a 60 Hz (física a 120 Hz) com acumulador; snapshots a 30 Hz via
 *   emit "volatile" (se a rede engasgar, o pacote velho é descartado em vez de enfileirar lag).
 * - Parry com compensação de lag: o cliente manda o instante (no relógio do servidor) em que
 *   apertou; o servidor consulta o histórico da bola naquele instante e julga.
 * - Contato com um humano não mata na hora: a bola "gruda" por um período de tolerância
 *   proporcional ao ping desse jogador, esperando um parry que já pode estar a caminho.
 * - Rodadas: o último vivo vence a rodada; primeiro a N rodadas vence a partida.
 *
 * O estado interno fica em room.db (NÃO em room.gameState, que é serializado no room:state).
 */
const { performance } = require('perf_hooks');
const S = require('../public/js/games/deathball/shared.js');
const { C, PHASE, EV } = S;

const nowMs = () => performance.now();
const PREFIX = 'game:deathball:';
const COLORS = ['#f59e0b', '#38bdf8', '#f472b6', '#4ade80', '#a78bfa', '#fb7185', '#facc15', '#2dd4bf', '#fb923c', '#94a3b8'];
const BOTS = [
  { name: 'Cypher', skill: 1.0 },
  { name: 'Nova', skill: 1.15 },
  { name: 'Blaze', skill: 1.3 },
];
const SUB_DT = 1 / (C.TICK_HZ * C.SUB_STEPS);
const TICK_MS = 1000 / C.TICK_HZ;
const HIST_LEN = 40; // ~0,66 s de histórico por tick

function randn() { // normal padrão (Box-Muller)
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function createHandler({ broadcastRoomState }) {

  // ==================== CICLO DE VIDA ====================

  function start(room, io, roomCode) {
    stop(room);

    const humans = Array.from(room.players.values()).filter(p => p.connected !== false);
    const isSolo = humans.length === 1;
    const players = [];
    humans.forEach((h) => {
      players.push(makePlayer(players.length, h.id, h.name, false));
    });
    if (isSolo) BOTS.forEach(b => {
      const p = makePlayer(players.length, 'bot_' + b.name.toLowerCase(), b.name, true);
      p.bot = { skill: b.skill, goalX: 0, goalY: 0, goalUntil: 0, plan: null, planKey: '', aimI: -1 };
      players.push(p);
    });

    const sim = {
      io, roomCode, room, players,
      byId: new Map(players.map(p => [p.id, p])),
      isSolo,
      winsToWin: players.length >= 4 ? 2 : 3,
      ball: S.newBall(),
      phase: 'countdown',
      phaseEndsAt: 0,
      round: 0,
      rally: 0,
      duel: false,
      tickN: 0,
      nextTick: nowMs(),
      timer: null,
      stopped: false,
      hist: new Array(HIST_LEN).fill(null).map(() => ({ t: -1, x: 0, y: 0, target: -1, phase: 0, eff: 0, holdLeft: 0 })),
      histHead: 0,
      impactT: 0,
      pendingUntil: 0,
      matchMaxSpeed: 0,
      matchBestRally: 0,
    };
    room.db = sim;
    room.gameState = { gameId: 'death-ball', phase: 'playing' };

    emit(sim, 'start', {
      st: nowMs(),
      solo: isSolo,
      winsToWin: sim.winsToWin,
      players: players.map(p => ({ i: p.i, id: p.id, name: p.name, color: p.color, isBot: p.isBot, level: p.level })),
    });

    beginRound(sim, nowMs());
    loop(sim);
  }

  function stop(room) {
    const sim = room && room.db;
    if (!sim) return;
    sim.stopped = true;
    if (sim.timer) clearTimeout(sim.timer);
    sim.timer = null;
    room.db = null;
  }

  function makePlayer(i, id, name, isBot) {
    return {
      i, id, name: String(name || 'Jogador').slice(0, 20), isBot, color: COLORS[i % COLORS.length], level: 1,
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: -1, alive: true, connected: true,
      parryReadyAt: 0, armedUntil: 0, armedPerfect: false, lastSeq: -1,
      meter: 0, dashReadyAt: 0, dashUntil: 0, lastMoveAt: 0, rtt: 80, lastEmoteAt: 0,
      wins: 0, score: 0,
      stats: { parries: 0, perfects: 0, clutches: 0, smashes: 0, kills: 0, deaths: 0, whiffs: 0, maxParrySpeed: 0, bestRally: 0 },
      bot: null,
    };
  }

  function emit(sim, ev, data) { sim.io.to(sim.roomCode).emit(PREFIX + ev, data); }

  // ==================== LOOP DE PASSO FIXO ====================

  function loop(sim) {
    if (sim.stopped || sim.room.db !== sim) return;
    const t = nowMs();
    let n = 0;
    while (sim.nextTick <= t && n < 6) {
      tick(sim, sim.nextTick);
      if (sim.stopped) return;
      sim.nextTick += TICK_MS;
      n++;
    }
    if (t - sim.nextTick > 200) sim.nextTick = t; // servidor travou: não tenta "alcançar" o passado
    sim.timer = setTimeout(() => loop(sim), Math.max(1, sim.nextTick - nowMs()));
  }

  function alivePlayers(sim) { return sim.players.filter(p => p.alive); }

  /**
   * Posição usada pela bola para perseguir o alvo. Para humanos, extrapola a última posição
   * recebida por velocidade × meio ping: aproxima onde o jogador REALMENTE está na tela dele,
   * que é exatamente o que a previsão do cliente usa. Sem isso, cliente e servidor julgariam
   * bolas diferentes.
   */
  const _hp = { x: 0, y: 0 };
  function homingPos(p, t) {
    if (!p) return null;
    _hp.x = p.x; _hp.y = p.y;
    if (!p.isBot && t - p.lastMoveAt < 90) {
      const lead = Math.min(0.1, p.rtt / 2000);
      _hp.x += p.vx * lead; _hp.y += p.vy * lead;
      S.clampToArena(_hp);
    }
    return _hp;
  }

  function tick(sim, t) {
    sim.tickN++;

    // Sala sem nenhum humano conectado: encerra
    if (!sim.players.some(p => !p.isBot && p.connected)) { stop(sim.room); return; }

    // --- transições de fase ---
    if (sim.phase === 'countdown' && t >= sim.phaseEndsAt) {
      sim.phase = 'live';
      spawnBall(sim, t, null);
    } else if (sim.phase === 'killpause' && t >= sim.phaseEndsAt) {
      sim.phase = 'live';
      spawnBall(sim, t, null);
    } else if (sim.phase === 'roundEnd' && t >= sim.phaseEndsAt) {
      const champ = sim.players.find(p => p.wins >= sim.winsToWin);
      if (champ) { gameOver(sim, champ); return; }
      beginRound(sim, t);
    }

    updateBots(sim, t, 1 / C.TICK_HZ);

    // --- bola ---
    const b = sim.ball;
    if (sim.phase === 'live' && b.phase !== PHASE.IDLE) {
      ensureTarget(sim, t);
      for (let s = 0; s < C.SUB_STEPS && sim.phase === 'live'; s++) {
        const tg = sim.players[b.target];
        if (b.phase === PHASE.PENDING) {
          if (t >= sim.pendingUntil) { kill(sim, tg, t); }
          break;
        }
        const hp = homingPos(tg, t);
        const ev = S.stepBall(b, hp, SUB_DT);
        if (b.phase === PHASE.FLY && tg && tg.armedUntil >= t) {
          const d = Math.hypot(hp.x - b.x, hp.y - b.y);
          if (d <= C.DEFLECT_DIST || S.timeToImpact(b, hp.x, hp.y) <= 0.03) {
            deflect(sim, tg, t, tg.armedPerfect, false);
            continue;
          }
        }
        if (ev === EV.CONTACT) {
          if (tg.isBot || !tg.connected) { kill(sim, tg, t); break; }
          b.phase = PHASE.PENDING;
          sim.impactT = t;
          // tolerância ≈ meio ping + folga para jitter, limitada
          sim.pendingUntil = t + Math.max(60, Math.min(230, tg.rtt * 0.5 + 55));
        }
      }
    }

    // histórico para compensação de lag
    const h = sim.hist[sim.histHead];
    h.t = t; h.x = b.x; h.y = b.y; h.target = b.target; h.phase = b.phase;
    h.eff = S.effSpeed(b); h.holdLeft = b.holdLeft;
    sim.histHead = (sim.histHead + 1) % HIST_LEN;

    if (sim.tickN % C.SNAP_EVERY === 0) sendSnapshot(sim, t);
  }

  function sendSnapshot(sim, t) {
    const p = [];
    for (const pl of sim.players) {
      const hp = homingPos(pl, t);
      p.push(pl.i, Math.round(pl.x * 100) / 100, Math.round(pl.y * 100) / 100,
        Math.round(pl.ax * 100) / 100, Math.round(pl.ay * 100) / 100, pl.alive ? 1 : 0,
        Math.round(hp.x * 100) / 100, Math.round(hp.y * 100) / 100);
    }
    const b = sim.ball;
    sim.io.to(sim.roomCode).volatile.emit(PREFIX + 's', {
      t: Math.round(t * 10) / 10,
      b: (sim.phase === 'live' && b.phase !== PHASE.IDLE) ? S.packBall(b) : 0,
      p,
    });
  }

  // ==================== RODADAS ====================

  function beginRound(sim, t) {
    sim.round++;
    sim.rally = 0;
    sim.ball = S.newBall();
    const conn = sim.players.filter(p => p.isBot || p.connected);
    const rot = Math.random() * Math.PI * 2;
    conn.forEach((p, k) => {
      const a = rot + (k / conn.length) * Math.PI * 2;
      p.x = Math.cos(a) * 30; p.y = Math.sin(a) * 30;
      p.ax = -Math.cos(a); p.ay = -Math.sin(a);
      p.alive = true;
      p.parryReadyAt = 0; p.armedUntil = 0; p.meter = 0; p.dashReadyAt = 0; p.dashUntil = 0;
      p.lastMoveAt = t; p.vx = 0; p.vy = 0;
      if (p.bot) { p.bot.plan = null; p.bot.goalUntil = 0; }
    });
    sim.players.forEach(p => { if (!p.isBot && !p.connected) p.alive = false; });
    sim.duel = alivePlayers(sim).length === 2;
    sim.phase = 'countdown';
    const cd = sim.round === 1 ? C.FIRST_COUNTDOWN_MS : C.COUNTDOWN_MS;
    sim.phaseEndsAt = t + cd;
    emit(sim, 'round', {
      t, round: sim.round, goAt: sim.phaseEndsAt, duel: sim.duel,
      pos: sim.players.map(p => [p.i, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, p.alive ? 1 : 0]),
      wins: sim.players.map(p => p.wins),
    });
  }

  function spawnBall(sim, t, preferTarget) {
    const alive = alivePlayers(sim);
    if (alive.length < 2) return;
    const b = sim.ball = S.newBall();
    const tg = preferTarget || alive[Math.floor(Math.random() * alive.length)];
    b.phase = PHASE.HOLD;
    b.holdLeft = C.CHARGE_T;
    b.target = tg.i;
    b.aimAtTarget = 1;
    b.speed = C.BALL_START;
    sim.rally = 0;
    emit(sim, 'launch', { t, ball: S.packBall(b) });
  }

  function ensureTarget(sim, t) {
    const b = sim.ball;
    const tg = sim.players[b.target];
    if (tg && tg.alive) return;
    const alive = alivePlayers(sim).filter(p => p.i !== b.lastHitter);
    const pool = alive.length ? alive : alivePlayers(sim);
    if (!pool.length) return;
    b.target = pool[Math.floor(Math.random() * pool.length)].i;
    if (b.phase === PHASE.PENDING) b.phase = PHASE.FLY;
    emit(sim, 'retarget', { t, ball: S.packBall(b) });
  }

  function kill(sim, victim, t) {
    if (!victim || !victim.alive) return;
    victim.alive = false;
    victim.armedUntil = 0;
    victim.stats.deaths++;
    const b = sim.ball;
    const killer = sim.players[b.lastHitter];
    let byI = -1;
    if (killer && killer.i !== victim.i) {
      killer.stats.kills++;
      killer.score += 5;
      byI = killer.i;
    }
    const speedKmh = S.toKmh(S.effSpeed(b));
    const kx = victim.x, ky = victim.y;
    sim.ball = S.newBall();
    const alive = alivePlayers(sim);
    emit(sim, 'kill', { t, i: victim.i, by: byI, x: kx, y: ky, kmh: speedKmh, rally: sim.rally, alive: alive.length });
    sim.rally = 0;

    const humansAlive = alive.some(p => !p.isBot);
    if (alive.length <= 1 || (sim.isSolo && !humansAlive)) {
      let winner = alive.length === 1 ? alive[0] : null;
      if (!winner && alive.length > 1) winner = (killer && killer.alive) ? killer : alive[Math.floor(Math.random() * alive.length)];
      endRound(sim, winner, t);
      return;
    }
    sim.phase = 'killpause';
    sim.phaseEndsAt = t + C.KILL_PAUSE_MS;
    if (alive.length === 2 && !sim.duel) {
      sim.duel = true;
      emit(sim, 'duel', { t, finalists: alive.map(p => p.i) });
    }
  }

  function endRound(sim, winner, t) {
    sim.phase = 'roundEnd';
    sim.ball = S.newBall();
    if (winner) { winner.wins++; winner.score += 15; }
    const matchOver = !!(winner && winner.wins >= sim.winsToWin);
    sim.phaseEndsAt = t + (matchOver ? 2600 : C.ROUND_END_MS);
    emit(sim, 'roundEnd', {
      t, winner: winner ? winner.i : -1, round: sim.round, matchOver,
      wins: sim.players.map(p => p.wins), scores: sim.players.map(p => p.score), nextAt: sim.phaseEndsAt,
    });
  }

  function gameOver(sim, champ) {
    champ.score += 30;
    const room = sim.room;
    for (const p of sim.players) {
      if (p.isBot) continue;
      const rp = room.players.get(p.id);
      if (rp) rp.score += p.score;
    }
    const rankings = sim.players.slice().sort((a, b) => (b.wins - a.wins) || (b.score - a.score)).map(p => ({
      i: p.i, id: p.id, name: p.name, color: p.color, isBot: p.isBot, wins: p.wins, score: p.score, stats: p.stats,
      winner: p.i === champ.i,
    }));
    emit(sim, 'gameover', {
      winner: champ.i, rankings, rounds: sim.round, solo: sim.isSolo,
      maxKmh: S.toKmh(sim.matchMaxSpeed), bestRally: sim.matchBestRally,
    });
    room.gameState = { gameId: 'death-ball', phase: 'results' };
    stop(room);
    broadcastRoomState(sim.roomCode);
  }

  // ==================== PARRY ====================

  function histAt(sim, t) {
    // procura a entrada mais recente com h.t <= t
    let best = null, oldest = null;
    for (let k = 0; k < HIST_LEN; k++) {
      const h = sim.hist[k];
      if (h.t < 0) continue;
      if (!oldest || h.t < oldest.t) oldest = h;
      if (h.t <= t && (!best || h.t > best.t)) best = h;
    }
    return best || oldest;
  }

  function deflect(sim, p, t, perfect, clutch) {
    const b = sim.ball;
    sim.rally++;
    p.armedUntil = 0;
    p.parryReadyAt = t + C.HIT_CD * 1000;
    p.stats.parries++;
    if (perfect) p.stats.perfects++;
    if (clutch) p.stats.clutches++;

    let smash = false;
    if (p.meter >= C.SMASH_CHARGES) { smash = true; p.meter = 0; p.stats.smashes++; }
    else if (perfect) p.meter = Math.min(C.SMASH_CHARGES, p.meter + 1);

    const before = S.effSpeed(b);
    p.stats.maxParrySpeed = Math.max(p.stats.maxParrySpeed, before);
    b.speed = S.nextSpeed(b.speed, perfect);
    b.smash = smash ? C.SMASH_BOOST : Math.max(0, b.smash * 0.5);
    sim.matchMaxSpeed = Math.max(sim.matchMaxSpeed, S.effSpeed(b));
    sim.matchBestRally = Math.max(sim.matchBestRally, sim.rally);
    p.stats.bestRally = Math.max(p.stats.bestRally, sim.rally);

    // mira → novo alvo
    let ax = p.ax, ay = p.ay;
    let am = Math.hypot(ax, ay);
    const tgI = S.chooseTarget(p.i, p.x, p.y, ax, ay, sim.players);
    if (am < 0.01) {
      const tg = sim.players[tgI];
      ax = tg ? tg.x - p.x : 0; ay = tg ? tg.y - p.y : -1; am = Math.hypot(ax, ay) || 1;
    }
    b.dx = ax / am; b.dy = ay / am;
    // posiciona a bola na frente do jogador para não reencostar
    b.x = p.x + b.dx * (C.KILL_DIST + 0.6);
    b.y = p.y + b.dy * (C.KILL_DIST + 0.6);
    S.clampToArena(b);
    b.phase = PHASE.HOLD;
    b.holdLeft = perfect || smash ? C.HITSTOP_PERFECT : C.HITSTOP;
    b.aimT = 0; b.flyT = 0;
    b.straight = smash ? C.SMASH_STRAIGHT_T : C.STRAIGHT_T;
    b.target = tgI;
    b.lastHitter = p.i;
    b.aimAtTarget = 0;

    const pts = 1 + (perfect ? 2 : 0) + (clutch ? 3 : 0) + (smash ? 2 : 0);
    p.score += pts;

    emit(sim, 'parry', {
      t, by: p.i, tg: tgI, pf: perfect ? 1 : 0, cl: clutch ? 1 : 0, sm: smash ? 1 : 0, seq: p.lastSeq,
      rally: sim.rally, kmh: S.toKmh(S.effSpeed(b)), meter: p.meter, pts, score: p.score,
      ball: S.packBall(b),
    });
  }

  function whiff(sim, p, t, reason) {
    p.parryReadyAt = t + C.MISS_CD * 1000;
    p.armedUntil = 0;
    p.stats.whiffs++;
    emit(sim, 'whiff', { t, i: p.i, r: reason, seq: p.lastSeq, readyAt: p.parryReadyAt });
  }

  /**
   * Julga um parry apertado no instante tPress (relógio do servidor).
   * Para humanos, (px,py) é a posição informada no momento do clique.
   */
  function pressParry(sim, p, tPress, px, py, tNow, cliTti) {
    if (!p.alive || sim.phase !== 'live') return;
    const b = sim.ball;
    if (b.phase === PHASE.IDLE) return;

    const pending = b.phase === PHASE.PENDING && b.target === p.i;
    // Contato já aconteceu e o clique veio tarde demais mesmo considerando o lag
    if (pending && tPress > sim.impactT + C.LATE_TOL * 1000) { whiff(sim, p, tNow, 'late'); return; }

    const h = histAt(sim, tPress);
    const targetAtPress = h ? h.target : b.target;
    if (!pending && targetAtPress !== p.i && b.target !== p.i) { whiff(sim, p, tNow, 'notarget'); return; }

    // tempo até o impacto NO INSTANTE DO CLIQUE (pelo histórico), não no instante em que o pacote chegou
    let tti;
    if (h && h.target === p.i && h.phase !== PHASE.IDLE) {
      const d = Math.hypot(px - h.x, py - h.y) - C.KILL_DIST;
      tti = Math.max(0, d) / Math.max(1, h.eff) + (h.phase === PHASE.HOLD ? Math.max(0, h.holdLeft) : 0);
      if (h.phase === PHASE.PENDING) tti = 0;
    } else {
      tti = pending ? 0 : S.timeToImpact(b, p.x, p.y);
    }
    // O cliente informa o tempo-até-impacto que via na tela; se for coerente com o do servidor
    // (tolerância proporcional ao ping), vale o do jogador: "o que você vê é o que conta".
    if (typeof cliTti === 'number' && cliTti >= 0 && Number.isFinite(cliTti)) {
      const tol = Math.min(0.16, 0.07 + p.rtt / 2000);
      if (Math.abs(cliTti - tti) <= tol) tti = cliTti;
    }
    const eff = S.effSpeed(b);
    const win = S.parryWindow(eff);
    const perfectWin = S.perfectWindow(eff);

    if (pending) {
      // A bola encostou no servidor, mas o clique foi antes (ou logo depois) do contato.
      const clutch = tPress >= sim.impactT - 5 || tti <= 0.004;
      deflect(sim, p, tNow, !clutch && tti <= perfectWin, clutch);
      return;
    }
    if (tti > win) { whiff(sim, p, tNow, 'early'); return; }

    const perfect = tti <= perfectWin;
    const dNow = Math.hypot(p.x - b.x, p.y - b.y);
    if (b.phase === PHASE.FLY && (dNow <= C.DEFLECT_DIST || S.timeToImpact(b, p.x, p.y) <= 0.03)) {
      deflect(sim, p, tNow, perfect, false);
    } else {
      // arma o parry: rebate assim que a bola chegar
      p.armedUntil = tPress + (win + 0.05) * 1000;
      p.armedPerfect = perfect;
    }
  }

  // ==================== BOTS ====================

  function updateBots(sim, t, dt) {
    const b = sim.ball;
    for (const p of sim.players) {
      if (!p.bot || !p.alive) continue;
      const bot = p.bot;
      const targeted = sim.phase === 'live' && b.phase !== PHASE.IDLE && b.target === p.i;

      // --- movimento ---
      if (t >= bot.goalUntil || Math.hypot(bot.goalX - p.x, bot.goalY - p.y) < 2) {
        const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 28;
        bot.goalX = Math.cos(a) * r; bot.goalY = Math.sin(a) * r;
        bot.goalUntil = t + 900 + Math.random() * 1600;
      }
      let mx = bot.goalX - p.x, my = bot.goalY - p.y;
      if (targeted && b.phase === PHASE.FLY) {
        // recua de lado em relação à bola para ganhar tempo
        const bx = p.x - b.x, by = p.y - b.y, bm = Math.hypot(bx, by) || 1;
        mx += (-by / bm) * 12 + (bx / bm) * 6; my += (bx / bm) * 12 + (by / bm) * 6;
      }
      const mm = Math.hypot(mx, my);
      if (mm > 0.5 && sim.phase !== 'roundEnd') {
        const sp = C.PLAYER_SPEED * 0.72 * dt;
        p.x += (mx / mm) * Math.min(sp, mm); p.y += (my / mm) * Math.min(sp, mm);
        S.clampToArena(p);
      }

      // --- mira: prefere humanos ---
      if (bot.aimI < 0 || !sim.players[bot.aimI] || !sim.players[bot.aimI].alive || Math.random() < 0.01) {
        const opp = sim.players.filter(o => o.alive && o.i !== p.i);
        const humans = opp.filter(o => !o.isBot);
        const pick = (humans.length && Math.random() < 0.6) ? humans : opp;
        bot.aimI = pick.length ? pick[Math.floor(Math.random() * pick.length)].i : -1;
      }
      const at = sim.players[bot.aimI];
      if (at) {
        const ax = at.x - p.x, ay = at.y - p.y, am = Math.hypot(ax, ay) || 1;
        p.ax = ax / am; p.ay = ay / am;
      }

      // --- parry ---
      if (!targeted || t < p.parryReadyAt || p.armedUntil >= t) continue;
      const eff = S.effSpeed(b);
      const key = sim.round + ':' + sim.rally + ':' + b.lastHitter;
      if (bot.planKey !== key) {
        bot.planKey = key;
        const win = S.parryWindow(eff);
        const frac = S.speedFrac(eff);
        const sigma = (0.05 + frac * 0.24) * bot.skill;
        let press = win * 0.42 + randn() * sigma;
        if (Math.random() < 0.035) press = win + 0.1; // vacilo ocasional
        bot.plan = press;
      }
      const tti = S.timeToImpact(b, p.x, p.y);
      if (tti <= bot.plan || b.phase === PHASE.PENDING) {
        bot.plan = -99;
        pressParry(sim, p, t, p.x, p.y, t);
      }
    }
  }

  // ==================== AÇÕES DOS JOGADORES ====================

  function handleAction(room, io, roomCode, socket, data) {
    const sim = room.db;
    if (!sim || !data) return;
    const p = sim.byId.get(socket.id);
    const a = data.action;
    const t = nowMs();

    if (a === 'ping') {
      socket.emit(PREFIX + 'pong', { c: num(data.c), s: t });
      if (p && data.rtt > 0 && data.rtt < 2000) p.rtt = p.rtt * 0.7 + data.rtt * 0.3;
      return;
    }
    if (!p || p.isBot) return;

    switch (a) {
      case 'm': {
        if (!p.alive) return;
        const x = num(data.x, p.x), y = num(data.y, p.y);
        const el = Math.min(0.25, Math.max(0.005, (t - p.lastMoveAt) / 1000));
        p.lastMoveAt = t;
        let maxD = C.PLAYER_SPEED * 1.4 * el + 0.8;
        if (t < p.dashUntil) maxD += C.DASH_DIST * 1.2;
        let dx = x - p.x, dy = y - p.y;
        const dm = Math.hypot(dx, dy);
        let corrected = false;
        if (dm > maxD) { dx = dx / dm * maxD; dy = dy / dm * maxD; corrected = dm - maxD > 3; }
        p.x += dx; p.y += dy;
        S.clampToArena(p);
        // velocidade informada pelo cliente (limitada); usada só para extrapolar o alvo da bola
        let vx = num(data.vx), vy = num(data.vy);
        const vm = Math.hypot(vx, vy), vmax = C.PLAYER_SPEED * (t < p.dashUntil ? 4 : 1.15);
        if (vm > vmax) { vx = vx / vm * vmax; vy = vy / vm * vmax; }
        p.vx = vx; p.vy = vy;
        const ax = num(data.ax), ay = num(data.ay), am = Math.hypot(ax, ay);
        if (am > 0.01) { p.ax = ax / am; p.ay = ay / am; }
        if (corrected) socket.emit(PREFIX + 'correct', { x: p.x, y: p.y });
        return;
      }
      case 'parry': {
        const seq = num(data.seq, -1);
        if (seq <= p.lastSeq) return;           // pacote repetido: ignora (anti-duplo)
        p.lastSeq = seq;
        if (!p.alive || sim.phase !== 'live') return;
        const rewind = Math.min(C.MAX_REWIND_MS, p.rtt * 0.75 + 70);
        let tp = num(data.t, t);
        if (tp > t) tp = t;
        if (tp < t - rewind) tp = t - rewind;
        if (tp < p.parryReadyAt - 25) return;   // ainda em recarga (o cliente não deveria mandar)
        // posição do clique: aceita se coerente com a posição conhecida
        let px = num(data.x, p.x), py = num(data.y, p.y);
        if (Math.hypot(px - p.x, py - p.y) > 6) { px = p.x; py = p.y; }
        const ax = num(data.ax), ay = num(data.ay), am = Math.hypot(ax, ay);
        if (am > 0.01) { p.ax = ax / am; p.ay = ay / am; }
        const ct = data.tti;
        pressParry(sim, p, tp, px, py, t, typeof ct === 'number' ? ct : undefined);
        return;
      }
      case 'dash': {
        if (!p.alive || t < p.dashReadyAt - 60) return;
        p.dashReadyAt = t + C.DASH_CD * 1000;
        p.dashUntil = t + 320;
        const dx = num(data.dx), dy = num(data.dy), dm = Math.hypot(dx, dy) || 1;
        socket.to(sim.roomCode).emit(PREFIX + 'dash', { i: p.i, x: p.x, y: p.y, dx: dx / dm, dy: dy / dm });
        return;
      }
      case 'emote': {
        if (t - p.lastEmoteAt < 700) return;
        p.lastEmoteAt = t;
        const e = Math.floor(num(data.e, 0));
        if (e < 0 || e > 5) return;
        emit(sim, 'emote', { i: p.i, e });
        return;
      }
      case 'profile': {
        const lv = Math.max(1, Math.min(999, Math.floor(num(data.level, 1))));
        p.level = lv;
        emit(sim, 'profile', { i: p.i, level: lv });
        return;
      }
    }
  }

  function onDisconnect(room, io, roomCode, socketId) {
    const sim = room.db;
    if (!sim) return;
    const p = sim.byId.get(socketId);
    if (!p) return;
    p.connected = false;
    if (p.alive && (sim.phase === 'live' || sim.phase === 'killpause' || sim.phase === 'countdown')) {
      const t = nowMs();
      if (sim.phase === 'live' && sim.ball.target === p.i) {
        kill(sim, p, t);
      } else {
        p.alive = false;
        emit(sim, 'kill', { t, i: p.i, by: -1, x: p.x, y: p.y, kmh: 0, rally: 0, alive: alivePlayers(sim).length, left: 1 });
        const alive = alivePlayers(sim);
        if (alive.length <= 1 && sim.phase !== 'roundEnd') endRound(sim, alive[0] || null, t);
      }
    }
  }

  return { start, stop, handleAction, onDisconnect, _tick: tick };
}

module.exports = { createHandler };
