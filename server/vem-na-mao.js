/**
 * Vem na Mão — servidor autoritativo
 *
 * Briga de rua vista de cima, battle royale até 8 jogadores (solo: 5 bots).
 * - Loop de passo fixo a 60 Hz com acumulador. Snapshot por jogador a 30 Hz (volatile) com o "ack"
 *   do último input aplicado, para o cliente reconciliar a própria previsão.
 * - Movimento: o cliente manda inputs numerados (2 ticks por pacote). O servidor consome 1 input por tick
 *   de uma fila curta (buffer contra variação de ping), com o MESMO stepMove do cliente (shared.js).
 * - Golpes com compensação de lag: o acerto é testado na posição atual da vítima e na posição que o
 *   atacante estava vendo (histórico, até 160 ms).
 * - Parry tolerante a lag: golpe em humano que não está defendendo fica "pendente" por ~meio ping + interpolação;
 *   um parry que chega nesse tempo (apertado quando a vítima VIU o golpe) ainda vale.
 *
 * Estado interno em room.vm (NÃO em room.gameState, que vai no room:state).
 */
const { performance } = require('perf_hooks');
const S = require('../public/js/games/vemnamao/shared.js');
const { C, ST, BTN, WEAPONS, WEAPON_IDS, DROPPABLE, SPECIAL } = S;

const nowMs = () => performance.now();
const PREFIX = 'game:vemnamao:';
const COLORS = ['#ff3d8b', '#ffd400', '#19e36b', '#4d6bff', '#ff8a1f', '#b26bff', '#2de2e6', '#efeee9'];
const BOT_NAMES = [
  { name: 'Marrento', skill: 0.75 }, { name: 'Zé Pancada', skill: 0.95 }, { name: 'Tia do Chinelo', skill: 1.05 },
  { name: 'Gordinho', skill: 0.85 }, { name: 'Mestre Kiko', skill: 1.2 },
];
const TICK_MS = 1000 / C.TICK_HZ;
const DT = C.DT;
const INTERP_MS = 90;          // o cliente desenha os outros 90 ms no passado
const HIST_LEN = 14;           // ~230 ms de histórico de posição
const COUNTDOWN_MS = 3200;
const ROUND_END_MS = 4200;
const WEAPON_REFILL_MS = 20000;
const ITEM_EVERY_MS = 14000;
const MAX_QUEUE = 8;

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const WIDX = Object.fromEntries(WEAPON_IDS.map((id, i) => [id, i]));

function createHandler({ broadcastRoomState }) {

  // ==================== CICLO DE VIDA ====================

  function start(room, io, roomCode) {
    stop(room);
    const humans = Array.from(room.players.values()).filter(p => p.connected !== false).slice(0, 8);
    const isSolo = humans.length === 1;
    const players = [];
    humans.forEach(h => players.push(makePlayer(players.length, h.id, h.name, false)));
    if (isSolo) BOT_NAMES.forEach(b => {
      const p = makePlayer(players.length, 'bot_' + players.length, b.name, true);
      p.bot = { skill: b.skill, next: 0, mx: 0, my: 0, ax: 1, ay: 0, want: 0, targetI: -1, stuckT: 0, lastX: 0, lastY: 0, side: Math.random() < 0.5 ? 1 : -1, react: 0 };
      players.push(p);
    });

    const sim = {
      io, roomCode, room, players,
      byId: new Map(players.map(p => [p.id, p])),
      isSolo,
      winsToWin: players.length >= 4 ? 2 : 3,
      map: S.MAPS[0], mapOrder: shuffle(S.MAPS.map(m => m.id)),
      phase: 'countdown', phaseEndsAt: 0, round: 0,
      liveAt: 0, zone: { x: 1100, y: 1100, r0: 1560, off: 0 },
      tickN: 0, nextTick: nowMs(), timer: null, stopped: false,
      projs: [], bombs: [], ground: [], items: [], pend: [],
      nextId: 1, nextRefill: 0, nextItem: 0,
      feed: [],
    };
    room.vm = sim;
    room.gameState = { gameId: 'vem-na-mao', phase: 'playing' };

    emit(sim, 'start', {
      st: nowMs(), solo: isSolo, winsToWin: sim.winsToWin,
      players: players.map(p => ({ i: p.i, id: p.id, name: p.name, color: p.color, isBot: p.isBot })),
    });
    beginRound(sim, nowMs());
    loop(sim);
  }

  function stop(room) {
    const sim = room && room.vm;
    if (!sim) return;
    sim.stopped = true;
    if (sim.timer) clearTimeout(sim.timer);
    sim.timer = null;
    room.vm = null;
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function makePlayer(i, id, name, isBot) {
    return {
      i, id, name: String(name || 'Jogador').slice(0, 20), isBot, color: COLORS[i % COLORS.length],
      connected: true, rtt: 80,
      // corpo
      x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, ax: 1, ay: 0, mx: 0, my: 0,
      hp: C.HP, alive: true,
      // estado de luta
      act: null, stunT: 0, dashT: 0, dashX: 0, dashY: 0, iframeT: 0, dashCh: C.DASH_CHARGES, dashRe: 0,
      forcedT: 0, fx: 0, fy: 0, slowT: 0, bleedT: 0, bleedBy: -1, ripT: 0, thrownT: 0, thrownBy: -1, heldBy: -1,
      buf: 0, bufT: 0, cd: 0,
      w: 'maos', uses: Infinity,
      lastHitBy: -1, lastHitAt: -1e9,
      // rede
      q: [], lastSeq: -1, ack: -1, parryPress: [],
      hist: new Array(HIST_LEN).fill(null).map(() => ({ t: -1, x: 0, y: 0 })), histHead: 0,
      // partida
      wins: 0, score: 0,
      stats: { kills: 0, deaths: 0, dmg: 0, parries: 0, throws: 0, splats: 0, picks: 0 },
      bot: null,
    };
  }

  function emit(sim, ev, data) { sim.io.to(sim.roomCode).emit(PREFIX + ev, data); }
  const alivePlayers = (sim) => sim.players.filter(p => p.alive);

  // ==================== RODADAS ====================

  function beginRound(sim, t) {
    sim.round++;
    sim.map = S.mapById(sim.mapOrder[(sim.round - 1) % sim.mapOrder.length]);
    const map = sim.map;
    const n = sim.players.length;
    sim.zone = {
      x: map.w / 2 + rand(-220, 220), y: map.h / 2 + rand(-220, 220), r0: 1580,
      off: Math.max(0, (8 - n) * 2.2),   // poucos jogadores: a zona começa a fechar antes
    };
    sim.projs = []; sim.bombs = []; sim.pend = []; sim.items = []; sim.ground = [];
    // spawns bem espalhados
    const spawns = map.spawns.slice();
    const off = Math.floor(Math.random() * spawns.length);
    const order = sim.players.map((_, k) => spawns[(off + Math.round(k * spawns.length / n)) % spawns.length]);
    sim.players.forEach((p, k) => {
      const [sx, sy] = order[k];
      Object.assign(p, {
        x: sx, y: sy, vx: 0, vy: 0, kx: 0, ky: 0, hp: C.HP, alive: p.connected,
        act: null, stunT: 0, dashT: 0, iframeT: 0, dashCh: C.DASH_CHARGES, dashRe: 0, forcedT: 0, slowT: 0, bleedT: 0,
        ripT: 0, thrownT: 0, heldBy: -1, buf: 0, bufT: 0, cd: 0, w: 'maos', uses: Infinity, lastHitBy: -1, lastHitAt: -1e9,
        parryPress: [],
      });
      const dx = map.w / 2 - sx, dy = map.h / 2 - sy, dm = Math.hypot(dx, dy) || 1;
      p.ax = dx / dm; p.ay = dy / dm;
      for (const h of p.hist) h.t = -1;
    });
    // armas no chão: ~75% dos pontos
    for (const [x, y] of map.weaponSpots) if (Math.random() < 0.78) spawnWeapon(sim, x, y, null, false);
    sim.phase = 'countdown';
    sim.liveAt = t + COUNTDOWN_MS;
    sim.phaseEndsAt = sim.liveAt;
    sim.nextRefill = sim.liveAt + WEAPON_REFILL_MS;
    sim.nextItem = sim.liveAt + 9000;
    emit(sim, 'round', {
      t, round: sim.round, map: map.id, zone: sim.zone, liveAt: sim.liveAt, winsToWin: sim.winsToWin,
      players: sim.players.map(p => [p.i, Math.round(p.x), Math.round(p.y), p.alive ? 1 : 0, p.wins]),
      ground: sim.ground.map(packGround), items: [],
    });
  }

  function spawnWeapon(sim, x, y, w, announce = true, uses) {
    const id = w || pick(DROPPABLE);
    const g = { id: sim.nextId++, w: id, x, y, uses: uses != null ? uses : WEAPONS[id].uses, spot: !w };
    sim.ground.push(g);
    if (announce) emit(sim, 'wspawn', packGround(g));
    return g;
  }
  const packGround = (g) => [g.id, WIDX[g.w], Math.round(g.x), Math.round(g.y), g.uses];

  function endRound(sim, winner, t) {
    if (sim.phase === 'roundEnd') return;
    sim.phase = 'roundEnd';
    if (winner) { winner.wins++; winner.score += 20; }
    const matchOver = !!(winner && winner.wins >= sim.winsToWin);
    sim.phaseEndsAt = t + (matchOver ? 2800 : ROUND_END_MS);
    emit(sim, 'roundEnd', {
      t, winner: winner ? winner.i : -1, round: sim.round, matchOver, nextAt: sim.phaseEndsAt,
      wins: sim.players.map(p => p.wins), scores: sim.players.map(p => p.score),
    });
    sim.matchOver = matchOver ? winner : null;
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
    emit(sim, 'gameover', { winner: champ.i, rankings, rounds: sim.round, solo: sim.isSolo });
    room.gameState = { gameId: 'vem-na-mao', phase: 'results' };
    stop(room);
    broadcastRoomState(sim.roomCode);
  }

  // ==================== LOOP ====================

  function loop(sim) {
    if (sim.stopped || sim.room.vm !== sim) return;
    const t = nowMs();
    let n = 0;
    while (sim.nextTick <= t && n < 6) {
      tick(sim, sim.nextTick);
      if (sim.stopped) return;
      sim.nextTick += TICK_MS;
      n++;
    }
    if (t - sim.nextTick > 200) sim.nextTick = t;
    sim.timer = setTimeout(() => loop(sim), Math.max(1, sim.nextTick - nowMs()));
  }

  function tick(sim, t) {
    sim.tickN++;
    if (sim.phase === 'roundEnd') {
      if (t >= sim.phaseEndsAt) {
        if (sim.matchOver) return gameOver(sim, sim.matchOver);
        beginRound(sim, t);
      }
      // continua simulando corpos (para a câmera lenta ficar bonita) sem dano
    }
    if (sim.phase === 'countdown' && t >= sim.liveAt) { sim.phase = 'live'; emit(sim, 'live', { t }); }
    const live = sim.phase === 'live';
    const rt = (t - sim.liveAt) / 1000;

    for (const p of sim.players) {
      if (p.isBot) {
        if (!p.alive) continue;
        botThink(sim, p, t);
        applyInput(sim, p, consumeInput(p), t, live);
        stepPlayer(sim, p, t, live, true);
        continue;
      }
      if (!p.alive) { while (p.q.length) p.ack = p.q.shift().seq; continue; }
      // humano: exatamente 1 passo de movimento por input recebido (igual à previsão do cliente).
      // Fila vazia (input atrasado) = este tick não anda; fila acumulada = 2 passos neste tick.
      const n = p.q.length === 0 ? 0 : p.q.length >= 3 ? 2 : 1;
      if (n === 0) { stepPlayer(sim, p, t, live, false); continue; }
      for (let k = 0; k < n && p.alive; k++) {
        applyInput(sim, p, consumeInput(p), t, live);
        stepPlayer(sim, p, t, live, true);
      }
    }
    separate(sim);
    for (const p of sim.players) recordHist(p, t);

    if (live || sim.phase === 'roundEnd') {
      stepProjs(sim, t);
      stepBombs(sim, t);
    }
    if (live) {
      resolvePending(sim, t, false);
      // zona
      const z = S.zoneAt(sim.zone, rt + sim.zone.off);
      const dps = S.zoneDps(rt + sim.zone.off);
      for (const p of sim.players) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - z.x, p.y - z.y) > z.r) damage(sim, p, dps * DT, -2, t, 'zona', true);
      }
      // armas e coxinhas
      if (t >= sim.nextRefill) {
        sim.nextRefill = t + WEAPON_REFILL_MS;
        for (const [x, y] of sim.map.weaponSpots) {
          if (Math.hypot(x - z.x, y - z.y) > z.r) continue;
          if (sim.ground.some(g => Math.hypot(g.x - x, g.y - y) < 60)) continue;
          if (Math.random() < 0.6) spawnWeapon(sim, x, y, null, true);
        }
      }
      if (t >= sim.nextItem) {
        sim.nextItem = t + ITEM_EVERY_MS;
        if (sim.items.length < 3) {
          const spots = sim.map.itemSpots.filter(([x, y]) => !sim.items.some(it => it.x === x && it.y === y) && Math.hypot(x - z.x, y - z.y) < z.r - 40);
          if (spots.length) {
            const [x, y] = pick(spots);
            const it = { id: sim.nextId++, x, y };
            sim.items.push(it);
            emit(sim, 'item', [it.id, x, y]);
          }
        }
      }
      pickups(sim, t);
      // fim da rodada
      const alive = alivePlayers(sim);
      if (sim.isSolo) {
        const human = sim.players[0];
        if (!human.alive) {
          const best = alive.slice().sort((a, b) => b.hp - a.hp)[0] || null;
          endRound(sim, best, t);
        } else if (alive.length === 1) endRound(sim, human, t);
      } else if (alive.length <= 1) endRound(sim, alive[0] || null, t);
    }

    if (sim.tickN % C.SNAP_EVERY === 0) sendSnapshots(sim, t);
  }

  // ==================== INPUT ====================

  function applyInput(sim, p, inp, t, live) {
    if (!inp) return;
    p.mx = inp.mx; p.my = inp.my;
    if (inp.am > 0.01) { p.ax = inp.ax; p.ay = inp.ay; }
    if (inp.b && live) pressButtons(sim, p, inp.b, t);
  }

  function consumeInput(p) {
    if (p.isBot) { const b = p.bot; const r = { mx: b.mx, my: b.my, ax: b.ax, ay: b.ay, am: 1, b: b.want }; b.want = 0; return r; }
    if (!p.q.length) return null;
    if (p.q.length > MAX_QUEUE) {
      // fila cresceu (pico de lag): pula para perto do fim, mas não perde botões
      let b = 0;
      while (p.q.length > 3) { const d = p.q.shift(); b |= d.b; p.ack = d.seq; }
      p.q[0].b |= b;
    }
    const inp = p.q.shift();
    p.ack = inp.seq;
    return inp;
  }

  function pressButtons(sim, p, b, t) {
    if (b & BTN.DASH) tryDash(sim, p, t);
    const act = b & (BTN.ATK | BTN.PARRY | BTN.GRAB | BTN.SPECIAL);
    if (act) {
      // prioridade quando vários no mesmo tick: parry > agarrão > especial > ataque
      const one = (act & BTN.PARRY) || (act & BTN.GRAB) || (act & BTN.SPECIAL) || (act & BTN.ATK);
      p.buf = one; p.bufT = C.BUFFER_T;
    }
    if (b & BTN.SWAP) trySwap(sim, p, t);
  }

  // ==================== JOGADOR ====================

  function busy(p) { return p.stunT > 0 || p.act || p.heldBy >= 0 || !p.alive; }

  function netState(p) {
    if (!p.alive) return [ST.DEAD, 0];
    if (p.heldBy >= 0) return [ST.HELD, 0];
    if (p.stunT > 0) return [ST.STUN, p.stunT];
    const a = p.act;
    if (a) {
      if (a.k === 'atk') {
        const w = WEAPONS[a.w].atk;
        if (a.t < w.s) return [ST.ATK_S, w.s - a.t];
        if (a.t < w.s + w.a) return [ST.ATK_A, w.s + w.a - a.t];
        return [ST.ATK_R, a.dur - a.t];
      }
      if (a.k === 'grab') {
        if (a.held >= 0) return [ST.GRAB, a.dur - a.t];
        if (a.t < C.GRAB_STARTUP + C.GRAB_ACTIVE) return [ST.GRAB, C.GRAB_STARTUP + C.GRAB_ACTIVE - a.t];
        return [ST.GRAB_R, a.dur - a.t];
      }
      if (a.k === 'parry') {
        if (a.t < a.win) return [ST.PARRY, a.win - a.t];
        return [ST.PARRY_R, a.dur - a.t];
      }
      return [ST.SPECIAL, a.dur - a.t];
    }
    if (p.dashT > 0) return [ST.DASH, p.dashT];
    return [ST.IDLE, 0];
  }

  function moveState(p) {
    const [st] = netState(p);
    return { st, special: p.act && p.act.k, slow: p.slowT, dashT: p.dashT, dashX: p.dashX, dashY: p.dashY, forcedT: p.forcedT, fx: p.fx, fy: p.fy };
  }

  function stepPlayer(sim, p, t, live, move) {
    // segurado: fica preso na frente de quem agarrou
    if (p.heldBy >= 0) {
      const g = sim.players[p.heldBy];
      if (!g || !g.alive || !g.act || g.act.k !== 'grab' || g.act.held !== p.i) { p.heldBy = -1; }
      else {
        p.x = g.x + g.ax * (C.P_R * 2 + 4); p.y = g.y + g.ay * (C.P_R * 2 + 4);
        p.vx = p.vy = p.kx = p.ky = 0;
        S.collide(p, C.P_R, sim.map, null);
        return;
      }
    }

    // sem input deste humano neste tick: o corpo dele espera (a simulação dele anda no ritmo dos inputs,
    // exatamente como a previsão do cliente)
    if (!move) return;

    // temporizadores
    if (p.dashRe > 0 && p.dashCh < C.DASH_CHARGES) { p.dashRe -= DT; if (p.dashRe <= 0) { p.dashCh++; p.dashRe = p.dashCh < C.DASH_CHARGES ? C.DASH_RECHARGE : 0; } }
    if (p.cd > 0) p.cd = Math.max(0, p.cd - DT);
    if (p.slowT > 0) p.slowT -= DT;
    if (p.ripT > 0) p.ripT -= DT;
    if (p.iframeT > 0) p.iframeT -= DT;
    if (p.thrownT > 0) p.thrownT -= DT;
    if (p.bleedT > 0) {
      p.bleedT -= DT;
      if (live) damage(sim, p, C.BLEED_DPS * DT, p.bleedBy, t, 'sangue', true);
      if (!p.alive) return;
    }
    if (p.stunT > 0) p.stunT = Math.max(0, p.stunT - DT);

    // ação atual
    if (p.act) stepAct(sim, p, t);
    if (!p.alive) return;

    // buffer de comando
    if (p.bufT > 0) {
      p.bufT -= DT;
      if (!busy(p) && p.dashT <= 0) { const b = p.buf; p.buf = 0; p.bufT = 0; startAction(sim, p, b, t); }
    }

    // movimento
    if (p.dashT > 0) p.dashT -= DT;
    if (p.forcedT > 0) p.forcedT -= DT;
    const m = moveState(p);
    const spd = Math.hypot(p.kx, p.ky);
    const impact = S.stepMove(p, { mx: p.mx, my: p.my }, DT, sim.map, m);
    if (live && impact > C.WALL_SPLAT_SPEED && (p.thrownT > 0 || spd > C.WALL_SPLAT_SPEED)) {
      p.thrownT = 0;
      const by = p.lastHitAt > t - 1500 ? p.lastHitBy : -1;
      if (by >= 0 && sim.players[by]) sim.players[by].stats.splats++;
      emit(sim, 'splat', { i: p.i, x: Math.round(p.x), y: Math.round(p.y), dmg: C.WALL_SPLAT_DMG });
      p.stunT = Math.max(p.stunT, C.WALL_SPLAT_STUN);
      damage(sim, p, C.WALL_SPLAT_DMG, by, t, 'parede');
    }
  }

  function tryDash(sim, p, t) {
    if (!p.alive || p.heldBy >= 0 || p.stunT > 0 || p.dashCh <= 0 || p.dashT > 0) return;
    // dash cancela a recuperação dos golpes (não a preparação)
    if (p.act) {
      const [st] = netState(p);
      if (st !== ST.ATK_R && st !== ST.GRAB_R && st !== ST.PARRY_R) return;
      p.act = null;
    }
    let dx = p.mx, dy = p.my;
    let dm = Math.hypot(dx, dy);
    if (dm < 0.2) { dx = p.ax; dy = p.ay; dm = 1; }
    p.dashX = dx / dm; p.dashY = dy / dm;
    p.dashT = C.DASH_T; p.iframeT = C.DASH_IFRAME;
    p.dashCh--; if (p.dashRe <= 0) p.dashRe = C.DASH_RECHARGE;
    emit(sim, 'dash', { i: p.i, x: Math.round(p.x), y: Math.round(p.y), dx: +p.dashX.toFixed(2), dy: +p.dashY.toFixed(2) });
  }

  function useWeapon(sim, p, n) {
    if (p.w === 'maos') return;
    p.uses -= n;
    if (p.uses <= 0) {
      emit(sim, 'break', { i: p.i, w: WIDX[p.w], x: Math.round(p.x), y: Math.round(p.y) });
      p.w = 'maos'; p.uses = Infinity; p.cd = 0;
    }
  }

  function startAction(sim, p, b, t) {
    const W = WEAPONS[p.w];
    if (b === BTN.ATK) {
      if (W.ranged) {
        p.act = { k: 'atk', w: p.w, t: 0, dur: W.atk.s + W.atk.a + W.atk.r, hit: new Set(), shot: false };
      } else {
        p.act = { k: 'atk', w: p.w, t: 0, dur: W.atk.s + W.atk.a + W.atk.r, hit: new Set(), landed: false, pressT: t };
      }
      emit(sim, 'act', { i: p.i, k: 'atk', w: WIDX[p.w] });
    } else if (b === BTN.PARRY) {
      p.act = { k: 'parry', t: 0, win: C.PARRY_WIN, dur: C.PARRY_WIN + C.PARRY_RECOVER, super: false };
    } else if (b === BTN.GRAB) {
      p.act = { k: 'grab', t: 0, dur: C.GRAB_STARTUP + C.GRAB_ACTIVE + C.GRAB_RECOVER, held: -1 };
      emit(sim, 'act', { i: p.i, k: 'grab' });
    } else if (b === BTN.SPECIAL) {
      if (p.cd > 0) return;
      const k = W.special.k;
      const sp = SPECIAL[k];
      p.cd = W.special.cd;
      switch (k) {
        case 'voadora':
          p.act = { k, t: 0, dur: sp.t + 0.18, hit: new Set() };
          p.forcedT = sp.t; p.fx = p.ax * sp.speed; p.fy = p.ay * sp.speed;
          break;
        case 'chinelada':
          p.act = { k, t: 0, dur: 0.22 };
          spawnProj(sim, p, 'chinelo', p.ax, p.ay, sp.speed, sp.life, sp.dmg, { slow: sp.slow, kb: sp.kb, stun: sp.stun });
          useWeapon(sim, p, 3);
          break;
        case 'homerun':
          p.act = { k, t: 0, dur: sp.charge + sp.a + sp.r, hit: new Set(), landed: false };
          break;
        case 'bote':
          p.act = { k, t: 0, dur: sp.t + 0.22, hit: new Set() };
          p.forcedT = sp.t; p.fx = p.ax * sp.speed; p.fy = p.ay * sp.speed;
          break;
        case 'panelaco':
          p.act = { k: 'parry', t: 0, win: sp.win, dur: sp.win + 0.2, super: true };
          break;
        case 'rajada': {
          p.act = { k, t: 0, dur: sp.t };
          const a0 = Math.atan2(p.ay, p.ax);
          const nShots = Math.min(sp.n, p.uses);
          for (let s = 0; s < nShots; s++) {
            const a = a0 + (s - (nShots - 1) / 2) * sp.spread * Math.PI / 180;
            spawnProj(sim, p, 'pedra', Math.cos(a), Math.sin(a), W.atk.speed, W.atk.life, W.atk.dmg, { kb: W.atk.kb, stun: W.atk.stun });
          }
          useWeapon(sim, p, nShots);
          break;
        }
        case 'varrida':
          p.act = { k, t: 0, dur: sp.t, hit: new Set(), done: false };
          break;
        case 'bombinha': {
          p.act = { k, t: 0, dur: 0.25 };
          const b2 = { id: sim.nextId++, o: p.i, x: p.x + p.ax * 30, y: p.y + p.ay * 30, vx: p.ax * sp.speed + p.vx * 0.5, vy: p.ay * sp.speed + p.vy * 0.5, fuse: sp.fuse };
          sim.bombs.push(b2);
          emit(sim, 'bomb', [b2.id, b2.o, Math.round(b2.x), Math.round(b2.y), Math.round(b2.vx), Math.round(b2.vy)]);
          useWeapon(sim, p, 1);
          break;
        }
      }
      emit(sim, 'act', { i: p.i, k });
    }
  }

  function stepAct(sim, p, t) {
    const a = p.act;
    const prevT = a.t;
    a.t += DT;
    switch (a.k) {
      case 'atk': {
        const W = WEAPONS[a.w];
        if (W.ranged) {
          if (!a.shot && a.t >= W.atk.s) {
            a.shot = true;
            if (p.w === a.w) {
              spawnProj(sim, p, 'pedra', p.ax, p.ay, W.atk.speed, W.atk.life, W.atk.dmg * (p.ripT > 0 ? C.RIPOSTE_MULT : 1), { kb: W.atk.kb, stun: W.atk.stun });
              p.ripT = 0;
              useWeapon(sim, p, 1);
            }
          }
        } else {
          const A = W.atk;
          if (a.t >= A.s && prevT < A.s + A.a) {
            meleeSweep(sim, p, a, A.reach, A.arc, A.dmg, A.kb, A.stun, 'atk', t);
          }
        }
        break;
      }
      case 'grab': {
        if (a.held >= 0) {
          // segurando: mira define a direção do arremesso
          if (a.t >= a.dur) {
            const v = sim.players[a.held];
            p.act = null;
            if (v && v.alive && v.heldBy === p.i) throwPlayer(sim, p, v, t);
          }
          return;
        }
        if (a.t >= C.GRAB_STARTUP && prevT < C.GRAB_STARTUP + C.GRAB_ACTIVE) tryGrab(sim, p, a, t);
        break;
      }
      case 'voadora': {
        const sp = SPECIAL.voadora;
        if (a.t >= sp.from && a.t <= sp.to) meleeSweep(sim, p, a, sp.r + 10, 120, sp.dmg, sp.kb, sp.stun, 'voadora', t);
        break;
      }
      case 'bote': {
        const sp = SPECIAL.bote;
        if (a.t <= sp.t + 0.04) meleeSweep(sim, p, a, sp.r + 8, 110, sp.dmg, sp.kb, sp.stun, 'bote', t, { bleed: sp.bleed });
        break;
      }
      case 'homerun': {
        const sp = SPECIAL.homerun;
        if (a.t >= sp.charge && prevT < sp.charge + sp.a) meleeSweep(sim, p, a, sp.reach, sp.arc, sp.dmg, sp.kb, sp.stun, 'homerun', t);
        break;
      }
      case 'varrida': {
        const sp = SPECIAL.varrida;
        if (!a.done && a.t >= sp.at) { a.done = true; meleeSweep(sim, p, a, sp.radius, 360, sp.dmg, sp.kb, sp.stun, 'varrida', t, { radial: true }); }
        break;
      }
    }
    if (p.act === a && a.t >= a.dur) p.act = null;
  }

  // ==================== ACERTOS ====================

  function histPos(v, tq) {
    let best = null;
    for (const h of v.hist) if (h.t >= 0 && h.t <= tq && (!best || h.t > best.t)) best = h;
    return best;
  }
  function recordHist(p, t) {
    const h = p.hist[p.histHead];
    h.t = t; h.x = p.x; h.y = p.y;
    p.histHead = (p.histHead + 1) % HIST_LEN;
  }

  /** Posições da vítima que valem para o teste: atual e a que o atacante via (lag). */
  function victimPositions(a, v, t) {
    const out = [[v.x, v.y]];
    if (!a.isBot) {
      const back = Math.min(C.MAX_REWIND_MS, a.rtt * 0.5 + INTERP_MS);
      const h = histPos(v, t - back);
      if (h) out.push([h.x, h.y]);
    }
    return out;
  }

  function meleeSweep(sim, p, a, reach, arc, dmg, kb, stun, kind, t, extra) {
    let landed = false;
    for (const v of sim.players) {
      if (v === p || !v.alive || a.hit.has(v.i) || v.heldBy >= 0) continue;
      let ok = false;
      for (const [vx, vy] of victimPositions(p, v, t)) {
        if (S.inArc(p.x, p.y, p.ax, p.ay, vx, vy, reach + C.P_R, arc)) { ok = true; break; }
      }
      if (!ok) continue;
      a.hit.add(v.i);
      let mult = 1;
      if (p.ripT > 0) { mult = C.RIPOSTE_MULT; }
      landed = true;
      landHit(sim, p, v, { dmg: dmg * mult, kb, stun, kind, rip: mult > 1, radial: extra && extra.radial, bleed: extra && extra.bleed }, t);
      if (!p.alive) return;
    }
    // desgaste: 1 uso por golpe que encostou (especial gasta 2); bombinha só gasta ao arremessar
    if (landed && !a.paid && p.w !== 'maos' && p.w !== 'bombinha') { a.paid = true; useWeapon(sim, p, kind === 'atk' ? 1 : 2); }
  }

  /** Um golpe encostou. Decide parry / pendente / dano. */
  function landHit(sim, a, v, hit, t) {
    if (v.iframeT > 0) { emit(sim, 'dodge', { i: v.i }); return; }
    if (isParrying(v)) return parried(sim, v, a, hit, t);
    if (!v.isBot && v.connected) {
      // pode haver um parry a caminho: espera um pouco
      const pressOk = validPress(v, t);
      if (pressOk) return parried(sim, v, a, hit, t);
      const wait = Math.min(C.HIT_GRACE_MAX_MS, v.rtt * 0.5 + 45);
      sim.pend.push({ a: a.i, v: v.i, hit, t, until: t + wait });
      return;
    }
    applyHit(sim, a, v, hit, t);
  }

  function isParrying(v) { return v.act && v.act.k === 'parry' && v.act.t < v.act.win; }

  /** Houve um aperto de parry que, na tela da vítima, estava ativo quando o golpe chegou? */
  function validPress(v, hitT) {
    const seen = hitT + INTERP_MS;     // quando a vítima viu o golpe chegar (relógio do servidor)
    for (const pr of v.parryPress) {
      if (pr.used) continue;
      if (pr.t <= seen + C.PARRY_LATE_TOL_MS && pr.t + C.PARRY_WIN * 1000 >= seen - 20) { pr.used = true; return true; }
    }
    return false;
  }

  function resolvePending(sim, t, onlyFor) {
    if (!sim.pend.length) return;
    sim.pend = sim.pend.filter(pd => {
      const a = sim.players[pd.a], v = sim.players[pd.v];
      if (!v || !v.alive || !a) return false;
      if (onlyFor != null && onlyFor !== false && pd.v !== onlyFor) return true;
      if (isParrying(v) || validPress(v, pd.t)) { parried(sim, v, a, pd.hit, t); return false; }
      if (t >= pd.until) { applyHit(sim, a, v, pd.hit, t); return false; }
      return true;
    });
  }

  function parried(sim, v, a, hit, t) {
    const sup = v.act && v.act.k === 'parry' && v.act.super;
    v.stats.parries++;
    v.ripT = C.RIPOSTE_T;
    if (v.act && v.act.k === 'parry') { v.act.t = Math.min(v.act.t, 0.02); v.act.win = Math.max(v.act.win, 0.22); }  // continua defendendo por mais um instante
    a.act = null;
    a.stunT = Math.max(a.stunT, sup ? SPECIAL.panelaco.stun : C.PARRY_STUN);
    const dx = a.x - v.x, dy = a.y - v.y, dm = Math.hypot(dx, dy) || 1;
    a.kx += dx / dm * 260; a.ky += dy / dm * 260;
    emit(sim, 'parry', { p: v.i, a: a.i, x: Math.round((v.x + a.x) / 2), y: Math.round((v.y + a.y) / 2), sup: sup ? 1 : 0 });
    if (sup) damage(sim, a, SPECIAL.panelaco.dmg, v.i, t, 'panelaco');
  }

  function applyHit(sim, a, v, hit, t) {
    if (!v.alive) return;
    if (v.iframeT > 0) { emit(sim, 'dodge', { i: v.i }); return; }
    // o golpe interrompe o que a vítima estava fazendo (inclusive agarrão)
    if (v.act && v.act.k === 'grab' && v.act.held >= 0) { const h = sim.players[v.act.held]; if (h) h.heldBy = -1; }
    v.act = null;
    v.stunT = Math.max(v.stunT, hit.stun);
    let dx, dy;
    if (hit.radial || hit.proj) { dx = v.x - (hit.ox != null ? hit.ox : a.x); dy = v.y - (hit.oy != null ? hit.oy : a.y); }
    else { dx = a.ax; dy = a.ay; }
    if (hit.dir) { dx = hit.dir[0]; dy = hit.dir[1]; }
    const dm = Math.hypot(dx, dy) || 1;
    v.kx += dx / dm * hit.kb; v.ky += dy / dm * hit.kb;
    if (hit.bleed) { v.bleedT = hit.bleed; v.bleedBy = a.i; }
    if (hit.slow) v.slowT = Math.max(v.slowT, hit.slow);
    if (hit.rip) a.ripT = 0;
    emit(sim, 'hit', {
      a: a.i, v: v.i, dmg: Math.round(hit.dmg), x: Math.round(v.x), y: Math.round(v.y), k: hit.kind, rip: hit.rip ? 1 : 0,
      dx: +(dx / dm).toFixed(2), dy: +(dy / dm).toFixed(2),
    });
    damage(sim, v, hit.dmg, a.i, t, hit.kind);
  }

  function damage(sim, v, dmg, by, t, how, silent) {
    if (!v.alive || dmg <= 0) return;
    if (sim.phase !== 'live') return;
    v.hp -= dmg;
    if (by >= 0 && by !== v.i) {
      v.lastHitBy = by; v.lastHitAt = t;
      const a = sim.players[by]; if (a) a.stats.dmg += dmg;
    }
    if (v.hp <= 0) kill(sim, v, t, how);
  }

  function kill(sim, v, t, how) {
    v.hp = 0; v.alive = false; v.act = null; v.stunT = 0; v.bleedT = 0;
    v.stats.deaths++;
    if (v.heldBy >= 0) v.heldBy = -1;
    for (const o of sim.players) if (o.act && o.act.k === 'grab' && o.act.held === v.i) o.act = null;
    const by = v.lastHitAt > t - C.KILL_CREDIT_T * 1000 ? v.lastHitBy : -1;
    const killer = by >= 0 ? sim.players[by] : null;
    if (killer && killer !== v) { killer.stats.kills++; killer.score += 10; }
    // larga a arma
    if (v.w !== 'maos' && v.uses > 0) spawnWeapon(sim, v.x, v.y, v.w, true, v.uses);
    v.w = 'maos'; v.uses = Infinity;
    sim.pend = sim.pend.filter(pd => pd.v !== v.i && pd.a !== v.i);
    const alive = alivePlayers(sim).length;
    emit(sim, 'kill', { t, i: v.i, by: killer && killer !== v ? killer.i : -1, how, x: Math.round(v.x), y: Math.round(v.y), alive });
  }

  // ==================== AGARRÃO ====================

  function tryGrab(sim, p, a, t) {
    let best = null, bd = 1e9;
    for (const v of sim.players) {
      if (v === p || !v.alive || v.heldBy >= 0) continue;
      for (const [vx, vy] of victimPositions(p, v, t)) {
        if (S.inArc(p.x, p.y, p.ax, p.ay, vx, vy, C.GRAB_RANGE + C.P_R, C.GRAB_ARC)) {
          const d = Math.hypot(vx - p.x, vy - p.y);
          if (d < bd) { bd = d; best = v; }
          break;
        }
      }
    }
    if (!best) return;
    const v = best;
    if (v.iframeT > 0) return;
    const [vst] = netState(v);
    if (vst === ST.ATK_S || vst === ST.ATK_A || vst === ST.SPECIAL && v.act && v.act.k !== 'parry') {
      // porrada vence agarrão: quem agarrou toma
      p.act = null;
      p.stunT = C.CLANK_STUN;
      const dx = p.x - v.x, dy = p.y - v.y, dm = Math.hypot(dx, dy) || 1;
      p.kx += dx / dm * 240; p.ky += dy / dm * 240;
      emit(sim, 'clank', { a: p.i, v: v.i, x: Math.round((p.x + v.x) / 2), y: Math.round((p.y + v.y) / 2) });
      return;
    }
    // agarrou (parry e parado não escapam)
    sim.pend = sim.pend.filter(pd => pd.v !== v.i);
    if (v.act && v.act.k === 'grab' && v.act.held >= 0) { const h = sim.players[v.act.held]; if (h) h.heldBy = -1; }
    v.act = null; v.dashT = 0; v.forcedT = 0;
    v.heldBy = p.i;
    a.held = v.i; a.t = 0; a.dur = 0.3;
    emit(sim, 'grab', { a: p.i, v: v.i });
  }

  function throwPlayer(sim, p, v, t) {
    v.heldBy = -1;
    v.stunT = C.THROW_STUN;
    v.kx = p.ax * C.THROW_KB; v.ky = p.ay * C.THROW_KB;
    v.thrownT = 0.45; v.thrownBy = p.i;
    p.stats.throws++;
    const dmg = C.THROW_DMG * (p.ripT > 0 ? C.RIPOSTE_MULT : 1);
    p.ripT = 0;
    p.act = { k: 'atk', w: 'maos', t: WEAPONS.maos.atk.s + WEAPONS.maos.atk.a, dur: WEAPONS.maos.atk.s + WEAPONS.maos.atk.a + 0.12, hit: new Set([v.i]) };
    emit(sim, 'throw', { a: p.i, v: v.i, dx: +p.ax.toFixed(2), dy: +p.ay.toFixed(2), dmg: Math.round(dmg), x: Math.round(v.x), y: Math.round(v.y) });
    v.lastHitBy = p.i; v.lastHitAt = t;
    damage(sim, v, dmg, p.i, t, 'arremesso');
  }

  /** Corpos se empurram; quem foi arremessado derruba quem estiver no caminho. */
  function separate(sim) {
    const ps = sim.players;
    const min = C.P_R * 2;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]; if (!a.alive) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]; if (!b.alive) continue;
        if (a.heldBy === b.i || b.heldBy === a.i) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= min || d < 1e-4) continue;
        const nx = dx / d, ny = dy / d, pen = (min - d) * 0.5;
        a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
        // boliche
        for (const [th, o, s] of [[a, b, 1], [b, a, -1]]) {
          if (th.thrownT > 0 && th.thrownBy !== o.i && sim.phase === 'live' && Math.hypot(th.kx, th.ky) > 250 && !o._bowled) {
            o._bowled = 6;
            o.stunT = Math.max(o.stunT, 0.4); o.act = null;
            o.kx += nx * s * 380; o.ky += ny * s * 380;
            emit(sim, 'hit', { a: th.thrownBy, v: o.i, dmg: 8, x: Math.round(o.x), y: Math.round(o.y), k: 'boliche', rip: 0, dx: +(nx * s).toFixed(2), dy: +(ny * s).toFixed(2) });
            damage(sim, o, 8, th.thrownBy, nowMs(), 'boliche');
          }
        }
      }
      if (a._bowled) a._bowled--;
    }
    for (const p of ps) if (p.alive) S.collide(p, C.P_R, sim.map, null);
  }

  // ==================== PROJÉTEIS E BOMBAS ====================

  function spawnProj(sim, p, kind, dx, dy, speed, life, dmg, o) {
    const pr = { id: sim.nextId++, o: p.i, k: kind, x: p.x + dx * (C.P_R + 6), y: p.y + dy * (C.P_R + 6), vx: dx * speed, vy: dy * speed, life, dmg, ...o };
    sim.projs.push(pr);
    emit(sim, 'proj', [pr.id, pr.o, kind === 'chinelo' ? 1 : 0, Math.round(pr.x), Math.round(pr.y), Math.round(pr.vx), Math.round(pr.vy), +life.toFixed(2)]);
  }

  function stepProjs(sim, t) {
    if (!sim.projs.length) return;
    const keep = [];
    for (const pr of sim.projs) {
      let alive = true, hitI = -1, refl = false;
      const steps = 2;
      for (let s = 0; s < steps && alive; s++) {
        pr.x += pr.vx * DT / steps; pr.y += pr.vy * DT / steps;
        if (S.solidAt(sim.map, pr.x, pr.y, 2)) { alive = false; break; }
        for (const v of sim.players) {
          if (!v.alive || v.i === pr.o || v.heldBy >= 0) continue;
          if (Math.hypot(v.x - pr.x, v.y - pr.y) > C.P_R + 8) continue;
          if (v.iframeT > 0) continue;
          if (isParrying(v) || (!v.isBot && validPress(v, t))) {
            // rebate na direção que o defensor mira
            const sp = Math.hypot(pr.vx, pr.vy) * 1.15;
            pr.vx = v.ax * sp; pr.vy = v.ay * sp; pr.o = v.i; pr.life = Math.max(pr.life, 0.6);
            pr.x = v.x + v.ax * (C.P_R + 10); pr.y = v.y + v.ay * (C.P_R + 10);
            v.ripT = C.RIPOSTE_T; v.stats.parries++;
            emit(sim, 'parry', { p: v.i, a: -1, x: Math.round(pr.x), y: Math.round(pr.y), sup: 0 });
            refl = true;
            break;
          }
          const a = sim.players[pr.o];
          applyHit(sim, a, v, { dmg: pr.dmg, kb: pr.kb || 150, stun: pr.stun || 0.2, kind: pr.k, proj: true, slow: pr.slow, dir: [pr.vx, pr.vy] }, t);
          alive = false; hitI = v.i;
          break;
        }
      }
      pr.life -= DT;
      if (pr.life <= 0) alive = false;
      if (refl) emit(sim, 'proj', [pr.id, pr.o, pr.k === 'chinelo' ? 1 : 0, Math.round(pr.x), Math.round(pr.y), Math.round(pr.vx), Math.round(pr.vy), +pr.life.toFixed(2)]);
      if (alive) keep.push(pr);
      else emit(sim, 'projEnd', [pr.id, Math.round(pr.x), Math.round(pr.y), hitI]);
    }
    sim.projs = keep;
  }

  function stepBombs(sim, t) {
    if (!sim.bombs.length) return;
    const keep = [];
    const sp = SPECIAL.bombinha;
    for (const b of sim.bombs) {
      const k = Math.exp(-sp.friction * DT);
      const nx = b.x + b.vx * DT, ny = b.y + b.vy * DT;
      if (S.solidAt(sim.map, nx, b.y, 8)) b.vx = -b.vx * 0.5; else b.x = nx;
      if (S.solidAt(sim.map, b.x, ny, 8)) b.vy = -b.vy * 0.5; else b.y = ny;
      b.vx *= k; b.vy *= k;
      b.fuse -= DT;
      if (b.fuse > 0) { keep.push(b); continue; }
      emit(sim, 'boom', [b.id, Math.round(b.x), Math.round(b.y)]);
      const owner = sim.players[b.o];
      for (const v of sim.players) {
        if (!v.alive) continue;
        const d = Math.hypot(v.x - b.x, v.y - b.y);
        if (d > sp.radius + C.P_R) continue;
        if (v.iframeT > 0) continue;
        const f = 1 - Math.min(1, d / (sp.radius + C.P_R)) * 0.5;
        applyHit(sim, owner, v, { dmg: sp.dmg * f * (v.i === b.o ? 0.6 : 1), kb: sp.kb * f, stun: sp.stun, kind: 'bomba', proj: true, ox: b.x, oy: b.y }, t);
      }
    }
    sim.bombs = keep;
  }

  // ==================== ARMAS NO CHÃO ====================

  function pickups(sim, t) {
    for (const p of sim.players) {
      if (!p.alive || p.heldBy >= 0) continue;
      if (p.w === 'maos') {
        const g = nearestGround(sim, p);
        if (g) takeGround(sim, p, g);
      }
      if (p.hp < C.HP) {
        for (let k = 0; k < sim.items.length; k++) {
          const it = sim.items[k];
          if (Math.hypot(it.x - p.x, it.y - p.y) < C.PICK_R) {
            p.hp = Math.min(C.HP, p.hp + C.HEAL);
            p.bleedT = 0;
            sim.items.splice(k, 1);
            emit(sim, 'eat', { id: it.id, i: p.i, hp: Math.round(p.hp) });
            break;
          }
        }
      }
    }
  }

  function nearestGround(sim, p) {
    let best = null, bd = C.PICK_R;
    for (const g of sim.ground) { const d = Math.hypot(g.x - p.x, g.y - p.y); if (d < bd) { bd = d; best = g; } }
    return best;
  }

  function takeGround(sim, p, g) {
    sim.ground.splice(sim.ground.indexOf(g), 1);
    p.w = g.w; p.uses = g.uses; p.cd = Math.min(p.cd, 1);
    p.stats.picks++;
    emit(sim, 'pick', { id: g.id, i: p.i, w: WIDX[g.w], u: g.uses });
  }

  function trySwap(sim, p, t) {
    if (!p.alive || p.heldBy >= 0) return;
    const g = nearestGround(sim, p);
    if (!g) {
      // sem nada perto: larga a arma
      if (p.w !== 'maos' && !p.act) {
        const d = spawnWeapon(sim, p.x - p.ax * 30, p.y - p.ay * 30, p.w, true, p.uses);
        d.spot = false;
        p.w = 'maos'; p.uses = Infinity; p.cd = 0;
        emit(sim, 'pick', { id: -1, i: p.i, w: 0, u: -1 });
      }
      return;
    }
    if (p.w !== 'maos') {
      const old = p.w, u = p.uses;
      takeGround(sim, p, g);
      spawnWeapon(sim, g.x, g.y, old, true, u);
    } else takeGround(sim, p, g);
  }

  // ==================== SNAPSHOT ====================

  function sendSnapshots(sim, t) {
    const pk = [];
    for (const p of sim.players) {
      const [st, left] = netState(p);
      let fl = 0;
      if (p.ripT > 0) fl |= 1;
      if (p.bleedT > 0) fl |= 2;
      if (p.slowT > 0) fl |= 4;
      if (p.iframeT > 0) fl |= 8;
      if (p.act && p.act.k === 'parry' && p.act.super) fl |= 16;
      if (p.thrownT > 0) fl |= 32;
      pk.push(p.i, Math.round(p.x), Math.round(p.y), Math.round(Math.atan2(p.ay, p.ax) * 100), Math.ceil(p.hp), st,
        Math.round(left * 100), WIDX[p.w], fl, p.act ? spIdx(p.act.k) : 0);
    }
    for (const p of sim.players) {
      if (p.isBot || !p.connected) continue;
      const sock = sim.io.sockets && sim.io.sockets.sockets ? sim.io.sockets.sockets.get(p.id) : null;
      // valores sem arredondar: o cliente reaplica os inputs a partir daqui e precisa dos MESMOS números
      // (um timer arredondado muda em que tick uma ação termina e a previsão escorrega)
      const me = [
        p.ack, p.x, p.y, p.vx, p.vy, p.kx, p.ky, p.dashT, p.dashX, p.dashY, p.forcedT, p.fx, p.fy,
        p.slowT, p.dashCh, p.dashRe, p.cd, p.uses === Infinity ? -1 : p.uses,
        p.act ? spIdx(p.act.k) : 0, p.act ? p.act.t : 0, p.act ? p.act.dur : 0, p.act && p.act.win ? p.act.win : 0,
        p.stunT, p.buf, p.bufT, p.heldBy >= 0 ? 1 : 0, p.act && p.act.held >= 0 ? 1 : 0, Math.ceil(p.hp),
      ];
      const data = { t, p: pk, me };
      if (sock) sock.volatile.emit(PREFIX + 's', data);
      else sim.io.to(p.id).emit(PREFIX + 's', data);
    }
  }
  const SPK = S.ACT_KINDS;
  function spIdx(k) { const i = SPK.indexOf(k); return i < 0 ? 0 : i; }

  // ==================== BOTS ====================

  function botThink(sim, p, t) {
    const b = p.bot;
    if (t < b.next) return;
    b.next = t + rand(110, 230) / b.skill;
    if (sim.phase === 'countdown') { b.mx = 0; b.my = 0; return; }
    const rt = (t - sim.liveAt) / 1000;
    const z = S.zoneAt(sim.zone, rt + sim.zone.off);
    const map = sim.map;

    // alvo: o inimigo mais perto (prefere quem está fraco)
    let tg = null, td = 1e9;
    for (const o of sim.players) {
      if (o === p || !o.alive) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y) - (C.HP - o.hp) * 1.5;
      if (d < td) { td = d; tg = o; }
    }
    let gx = z.x, gy = z.y, mode = 'zona';
    const dz = Math.hypot(p.x - z.x, p.y - z.y);
    const outZone = dz > z.r - 80;
    const dist = tg ? Math.hypot(tg.x - p.x, tg.y - p.y) : 1e9;

    // pega arma / coxinha perto
    if (!outZone && (dist > 260 || p.w === 'maos' && dist > 160)) {
      let best = null, bd = p.w === 'maos' ? 650 : 0;
      for (const g of sim.ground) { const d = Math.hypot(g.x - p.x, g.y - p.y); if (d < bd && Math.hypot(g.x - z.x, g.y - z.y) < z.r) { bd = d; best = g; } }
      if (best) { gx = best.x; gy = best.y; mode = 'arma'; }
      if (p.hp < 65) for (const it of sim.items) { const d = Math.hypot(it.x - p.x, it.y - p.y); if (d < 600) { gx = it.x; gy = it.y; mode = 'coxinha'; break; } }
    }
    if (mode === 'zona' && tg && !outZone) { gx = tg.x; gy = tg.y; mode = 'luta'; }
    if (mode === 'zona' && !outZone && dz < z.r * 0.5) {
      // anda em volta do centro procurando briga
      const a = t / 2400 + p.i;
      gx = z.x + Math.cos(a) * z.r * 0.3; gy = z.y + Math.sin(a) * z.r * 0.3;
    }

    let dx = gx - p.x, dy = gy - p.y, dm = Math.hypot(dx, dy) || 1;
    dx /= dm; dy /= dm;
    let mx = dx, my = dy;

    if (mode === 'luta' && tg) {
      p.ax = dx; p.ay = dy;
      const W = WEAPONS[p.w];
      const reach = W.ranged ? 520 : W.atk.reach + C.P_R;
      const [tst, tleft] = netState(tg);
      const facingMe = (tg.ax * -dx + tg.ay * -dy) > 0.5;
      const sk = b.skill;
      const free = !busy(p);
      // distância ideal: fora do alcance dele, dentro do meu
      const ideal = W.ranged ? 360 : reach * 0.8;
      if (dist < ideal * 0.7) { mx = -dx * 0.6 + -dy * b.side * 0.8; my = -dy * 0.6 + dx * b.side * 0.8; }
      else if (dist < ideal * 1.25) { mx = -dy * b.side; my = dx * b.side; if (Math.random() < 0.08) b.side = -b.side; }
      if (free) {
        const tW = WEAPONS[tg.w];
        const tReach = (tW.ranged ? 0 : tW.atk.reach) + C.P_R * 2 + 20;
        if ((tst === ST.ATK_S || tst === ST.SPECIAL && tg.act && tg.act.k !== 'parry') && facingMe && dist < tReach + 40) {
          const r = Math.random();
          if (r < 0.32 * sk) b.want = BTN.PARRY;
          else if (r < 0.32 * sk + 0.22 && p.dashCh > 0) { b.want = BTN.DASH; b.mx = -dx; b.my = -dy; return; }
          else if (r < 0.75) b.want = BTN.ATK;
        } else if ((tst === ST.PARRY || tst === ST.IDLE && Math.random() < 0.25 || tst === ST.STUN && tleft > 0.2) && dist < C.GRAB_RANGE + C.P_R * 2 + 6) {
          b.want = Math.random() < (tst === ST.PARRY ? 0.75 * sk : 0.45) ? BTN.GRAB : BTN.ATK;
        } else if (dist < reach + 4) {
          const r = Math.random();
          if (p.cd <= 0 && r < 0.18 * sk) b.want = BTN.SPECIAL;
          else if (tst === ST.PARRY) b.want = Math.random() < 0.5 ? BTN.GRAB : 0;
          else if (r < 0.7) b.want = BTN.ATK;
        } else if (W.special.k === 'voadora' && p.cd <= 0 && dist < 230 && dist > 120 && Math.random() < 0.25 * sk) {
          b.want = BTN.SPECIAL;
        } else if (W.special.k === 'bombinha' && dist < 360 && dist > 130 && Math.random() < 0.3) {
          b.want = BTN.SPECIAL;
        } else if (dist < 140 && Math.random() < 0.05 * sk) {
          b.want = BTN.PARRY; // parry de leitura
        }
        if (p.hp < 30 && dist < 150 && p.dashCh > 0 && Math.random() < 0.15) { b.want = BTN.DASH; mx = -dx; my = -dy; }
      }
      // aim imperfeito
      const err = (1.2 - sk) * 0.25 * (Math.random() - 0.5);
      const ca = Math.cos(err), sa = Math.sin(err);
      b.ax = p.ax * ca - p.ay * sa; b.ay = p.ax * sa + p.ay * ca;
    } else {
      b.ax = dx; b.ay = dy;
      if (dm < 20) { mx = 0; my = 0; }
    }

    // desvia de obstáculos: testa o caminho e gira
    const mmag = Math.hypot(mx, my);
    if (mmag > 0.05) {
      mx /= mmag; my /= mmag;
      const probe = 48;
      if (S.solidAt(map, p.x + mx * probe, p.y + my * probe, C.P_R - 4)) {
        const base = Math.atan2(my, mx);
        for (const off of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.6, -2.6]) {
          const a = base + off * b.side;
          const cx = Math.cos(a), cy = Math.sin(a);
          if (!S.solidAt(map, p.x + cx * probe, p.y + cy * probe, C.P_R - 4)) { mx = cx; my = cy; break; }
        }
      }
    }
    // travado? muda de lado
    if (Math.hypot(p.x - b.lastX, p.y - b.lastY) < 3 && mmag > 0.3) { b.stuckT++; if (b.stuckT > 4) { b.side = -b.side; b.stuckT = 0; } } else b.stuckT = 0;
    b.lastX = p.x; b.lastY = p.y;
    b.mx = mx; b.my = my;
  }

  // ==================== AÇÕES DA REDE ====================

  function handleAction(room, io, roomCode, socket, data) {
    const sim = room.vm;
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
    if (a === 'i') {
      // { s: seq do primeiro, t: relógio do servidor do último, m: [mx,my,ax,ay,b]* }
      const m = Array.isArray(data.m) ? data.m : null;
      if (!m || m.length % 5 !== 0 || m.length > 40) return;
      const s0 = Math.floor(num(data.s, -1));
      const n = m.length / 5;
      let tc = num(data.t, t);
      if (tc > t) tc = t;
      if (tc < t - 600) tc = t - 600;
      for (let k = 0; k < n; k++) {
        const seq = s0 + k;
        if (seq <= p.lastSeq) continue;   // repetido
        p.lastSeq = seq;
        let mx = clamp(num(m[k * 5]), -1, 1), my = clamp(num(m[k * 5 + 1]), -1, 1);
        let ax = num(m[k * 5 + 2]), ay = num(m[k * 5 + 3]);
        const am = Math.hypot(ax, ay);
        if (am > 0.01) { ax /= am; ay /= am; }
        const b = Math.floor(num(m[k * 5 + 4])) & 63;
        p.q.push({ seq, mx, my, ax, ay, am, b });
        if (b & BTN.PARRY) {
          const pt = tc - (n - 1 - k) * TICK_MS;
          p.parryPress.push({ t: pt, used: false });
          if (p.parryPress.length > 4) p.parryPress.shift();
        }
      }
      // parry chegou: resolve na hora os golpes pendentes nele
      if (sim.pend.length) resolvePending(sim, t, p.i);
      return;
    }
  }

  function onDisconnect(room, io, roomCode, socketId) {
    const sim = room.vm;
    if (!sim) return;
    const p = sim.byId.get(socketId);
    if (!p) return;
    p.connected = false;
    if (p.alive) {
      const t = nowMs();
      if (sim.phase === 'live') kill(sim, p, t, 'saiu');
      else { p.alive = false; emit(sim, 'kill', { t, i: p.i, by: -1, how: 'saiu', x: Math.round(p.x), y: Math.round(p.y), alive: alivePlayers(sim).length }); }
    }
    const humansLeft = sim.players.filter(o => !o.isBot && o.connected);
    if (!humansLeft.length) { stop(room); return; }
    if (sim.phase !== 'roundEnd') {
      const alive = alivePlayers(sim);
      if (!sim.isSolo && alive.length <= 1) endRound(sim, alive[0] || null, nowMs());
    }
  }

  return { start, stop, handleAction, onDisconnect, _tick: tick };
}

module.exports = { createHandler };
