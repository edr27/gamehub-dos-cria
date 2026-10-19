/**
 * Rinha.io v2 — Serialização de Snapshots (Servidor)
 * ====================================================
 * Full snapshot + delta compression (apenas campos alterados).
 * Reescrito do zero.
 */
'use strict';

function serializeSnapshot(world, rs) {
  const players = {};
  const ids = Object.keys(world.players).sort();
  for (const pid of ids) {
    const p = world.players[pid];
    players[pid] = {
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      vx: Math.round(p.vx * 100) / 100,
      vy: Math.round(p.vy * 100) / 100,
      facing: Math.round(p.facing * 1000) / 1000,
      hp: p.hp, hpMax: p.hpMax,
      posture: Math.round(p.posture * 10) / 10,
      stamina: Math.round(p.stamina * 10) / 10,
      momentum: Math.round(p.momentum * 10) / 10,
      state: p.state, stateTicks: p.stateTicks, action: p.action,
      comboCount: p.comboCount, alive: p.alive,
      invuln: p.invuln, flashTimer: p.flashTimer,
      fighterId: p.fighterId, name: p.name, team: p.team,
      punchProgress: p.punchProgress, punchHand: p.punchHand
    };
  }
  return {
    t: world.tick, full: true,
    phase: world.phase || rs.phase,
    players, scores: rs.scores || {},
    round: rs.roundNumber || 1,
    events: world.events || []
  };
}

function serializeDelta(world, rs, lastSent) {
  if (!lastSent || !lastSent.players) return null;
  const dp = {};
  let changed = 0, total = 0;
  const ids = Object.keys(world.players).sort();
  for (const pid of ids) {
    const p = world.players[pid];
    const lp = lastSent.players[pid];
    if (!lp) {
      dp[pid] = {
        x: Math.round(p.x*10)/10, y: Math.round(p.y*10)/10,
        vx: Math.round(p.vx*100)/100, vy: Math.round(p.vy*100)/100,
        facing: Math.round(p.facing*1000)/1000,
        hp: p.hp, posture: Math.round(p.posture*10)/10,
        stamina: Math.round(p.stamina*10)/10, momentum: Math.round(p.momentum*10)/10,
        state: p.state, stateTicks: p.stateTicks, action: p.action,
        comboCount: p.comboCount, alive: p.alive,
        invuln: p.invuln, flashTimer: p.flashTimer,
        fighterId: p.fighterId, name: p.name, team: p.team,
        punchProgress: p.punchProgress, punchHand: p.punchHand
      };
      changed += 20; total += 20;
      continue;
    }
    const d = {};
    const cx = Math.round(p.x*10)/10, cy = Math.round(p.y*10)/10;
    const cvx = Math.round(p.vx*100)/100, cvy = Math.round(p.vy*100)/100;
    const cf = Math.round(p.facing*1000)/1000;
    const cps = Math.round(p.posture*10)/10;
    const cst = Math.round(p.stamina*10)/10;
    const cmo = Math.round(p.momentum*10)/10;
    if (cx !== lp.x) { d.x = cx; changed++; }
    if (cy !== lp.y) { d.y = cy; changed++; }
    if (cvx !== lp.vx) { d.vx = cvx; changed++; }
    if (cvy !== lp.vy) { d.vy = cvy; changed++; }
    if (cf !== lp.facing) { d.facing = cf; changed++; }
    if (p.hp !== lp.hp) { d.hp = p.hp; changed++; }
    if (cps !== lp.posture) { d.posture = cps; changed++; }
    if (cst !== lp.stamina) { d.stamina = cst; changed++; }
    if (cmo !== lp.momentum) { d.momentum = cmo; changed++; }
    if (p.state !== lp.state) { d.state = p.state; changed++; }
    if (p.stateTicks !== lp.stateTicks) { d.stateTicks = p.stateTicks; changed++; }
    if (p.action !== lp.action) { d.action = p.action; changed++; }
    if (p.comboCount !== lp.comboCount) { d.comboCount = p.comboCount; changed++; }
    if (p.alive !== lp.alive) { d.alive = p.alive; changed++; }
    if (p.invuln !== lp.invuln) { d.invuln = p.invuln; changed++; }
    if (p.flashTimer !== lp.flashTimer) { d.flashTimer = p.flashTimer; changed++; }
    if (p.punchProgress !== lp.punchProgress) { d.punchProgress = p.punchProgress; changed++; }
    if (p.punchHand !== lp.punchHand) { d.punchHand = p.punchHand; changed++; }
    total += 18;
    if (Object.keys(d).length > 0) dp[pid] = d;
  }
  for (const lpid of Object.keys(lastSent.players)) {
    if (!world.players[lpid]) { dp[lpid] = { removed: true }; changed++; }
  }
  if (changed === 0 && (!world.events || world.events.length === 0)) return null;
  if (total > 0 && changed / total > 0.6) return null;
  const delta = { t: world.tick, full: false, d: { players: dp } };
  if (world.events && world.events.length > 0) delta.d.events = world.events;
  if (rs.scores && JSON.stringify(rs.scores) !== JSON.stringify(lastSent.scores)) delta.d.scores = rs.scores;
  if ((rs.roundNumber || 1) !== lastSent.round) delta.d.round = rs.roundNumber || 1;
  return delta;
}

module.exports = { serializeSnapshot, serializeDelta };