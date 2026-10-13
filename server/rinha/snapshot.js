/**
 * Rinha.io — Serialização de Snapshots (Servidor)
 * =================================================
 * Serializa o estado do mundo para envio aos clientes.
 * Suporta full snapshot e delta compression (apenas campos alterados).
 *
 * Delta strategy: compara campo a campo por jogador. Se delta > 60% do
 * tamanho do full, envia full ao invés de delta.
 */
'use strict';

/**
 * Serializa um snapshot completo do mundo.
 * @param {object} world - Estado atual do Engine world
 * @param {object} rs - rinhaState da sala
 * @returns {object} Snapshot completo pronto para JSON.stringify
 */
function serializeSnapshot(world, rs) {
  const players = {};
  const playerIds = Object.keys(world.players).sort();

  for (const pid of playerIds) {
    const p = world.players[pid];
    players[pid] = {
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      vx: Math.round(p.vx * 100) / 100,
      vy: Math.round(p.vy * 100) / 100,
      facing: Math.round(p.facing * 1000) / 1000,
      hp: p.hp,
      hpMax: p.hpMax,
      posture: Math.round(p.posture * 10) / 10,
      stamina: Math.round(p.stamina * 10) / 10,
      momentum: Math.round(p.momentum * 10) / 10,
      state: p.state,
      stateTicks: p.stateTicks,
      currentAction: p.currentAction,
      comboCount: p.comboCount,
      alive: p.alive,
      invulnFrames: p.invulnFrames,
      flashTimer: p.flashTimer,
      fighterId: p.fighterId,
      name: p.name,
      team: p.team
    };
  }

  return {
    t: world.tick,
    full: true,
    phase: world.phase || rs.phase,
    players: players,
    scores: rs.scores || {},
    round: rs.roundNumber || 1,
    events: world.events || []
  };
}

/**
 * Gera um delta snapshot contendo apenas campos que mudaram desde lastSent.
 * @param {object} world - Estado atual do Engine world
 * @param {object} rs - rinhaState da sala
 * @param {object} lastSent - Último snapshot enviado a este cliente
 * @returns {object|null} Delta snapshot ou null se não houver mudanças significativas
 */
function serializeDelta(world, rs, lastSent) {
  if (!lastSent || !lastSent.players) return null;

  const deltaPlayers = {};
  let changedFields = 0;
  let totalFields = 0;

  const playerIds = Object.keys(world.players).sort();

  for (const pid of playerIds) {
    const p = world.players[pid];
    const lp = lastSent.players[pid];

    if (!lp) {
      // Jogador novo: enviar estado completo dele
      deltaPlayers[pid] = {
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx * 100) / 100,
        vy: Math.round(p.vy * 100) / 100,
        facing: Math.round(p.facing * 1000) / 1000,
        hp: p.hp,
        posture: Math.round(p.posture * 10) / 10,
        stamina: Math.round(p.stamina * 10) / 10,
        momentum: Math.round(p.momentum * 10) / 10,
        state: p.state,
        stateTicks: p.stateTicks,
        currentAction: p.currentAction,
        comboCount: p.comboCount,
        alive: p.alive,
        invulnFrames: p.invulnFrames,
        flashTimer: p.flashTimer,
        fighterId: p.fighterId,
        name: p.name,
        team: p.team
      };
      changedFields += 18;
      totalFields += 18;
      continue;
    }

    // Comparar campo a campo e incluir apenas diferenças
    const d = {};
    const cx = Math.round(p.x * 10) / 10;
    const cy = Math.round(p.y * 10) / 10;
    const cvx = Math.round(p.vx * 100) / 100;
    const cvy = Math.round(p.vy * 100) / 100;
    const cfacing = Math.round(p.facing * 1000) / 1000;
    const cposture = Math.round(p.posture * 10) / 10;
    const cstamina = Math.round(p.stamina * 10) / 10;
    const cmomentum = Math.round(p.momentum * 10) / 10;

    if (cx !== lp.x) { d.x = cx; changedFields++; }
    if (cy !== lp.y) { d.y = cy; changedFields++; }
    if (cvx !== lp.vx) { d.vx = cvx; changedFields++; }
    if (cvy !== lp.vy) { d.vy = cvy; changedFields++; }
    if (cfacing !== lp.facing) { d.facing = cfacing; changedFields++; }
    if (p.hp !== lp.hp) { d.hp = p.hp; changedFields++; }
    if (cposture !== lp.posture) { d.posture = cposture; changedFields++; }
    if (cstamina !== lp.stamina) { d.stamina = cstamina; changedFields++; }
    if (cmomentum !== lp.momentum) { d.momentum = cmomentum; changedFields++; }
    if (p.state !== lp.state) { d.state = p.state; changedFields++; }
    if (p.stateTicks !== lp.stateTicks) { d.stateTicks = p.stateTicks; changedFields++; }
    if (p.currentAction !== lp.currentAction) { d.currentAction = p.currentAction; changedFields++; }
    if (p.comboCount !== lp.comboCount) { d.comboCount = p.comboCount; changedFields++; }
    if (p.alive !== lp.alive) { d.alive = p.alive; changedFields++; }
    if (p.invulnFrames !== lp.invulnFrames) { d.invulnFrames = p.invulnFrames; changedFields++; }
    if (p.flashTimer !== lp.flashTimer) { d.flashTimer = p.flashTimer; changedFields++; }

    totalFields += 16;

    // Só incluir jogador no delta se algo mudou
    if (Object.keys(d).length > 0) {
      deltaPlayers[pid] = d;
    }
  }

  // Verificar jogadores removidos
  for (const lpid of Object.keys(lastSent.players)) {
    if (!world.players[lpid]) {
      deltaPlayers[lpid] = { removed: true };
      changedFields++;
    }
  }

  // Se nada mudou, retornar null (não enviar)
  if (changedFields === 0 && (!world.events || world.events.length === 0)) {
    return null;
  }

  // Se delta é muito grande (>60% dos campos), melhor enviar full
  if (totalFields > 0 && changedFields / totalFields > 0.6) {
    return null; // caller deve enviar full snapshot ao invés
  }

  const delta = {
    t: world.tick,
    full: false,
    d: {
      players: deltaPlayers
    }
  };

  // Incluir eventos sempre (são transitórios)
  if (world.events && world.events.length > 0) {
    delta.d.events = world.events;
  }

  // Incluir scores/round se mudaram
  if (rs.scores && JSON.stringify(rs.scores) !== JSON.stringify(lastSent.scores)) {
    delta.d.scores = rs.scores;
  }
  if ((rs.roundNumber || 1) !== lastSent.round) {
    delta.d.round = rs.roundNumber || 1;
  }

  return delta;
}

module.exports = { serializeSnapshot, serializeDelta };