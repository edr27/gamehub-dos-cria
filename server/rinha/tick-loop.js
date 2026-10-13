/**
 * Rinha.io — Tick Loop Autoritativo (Servidor)
 * ==============================================
 * Loop de simulação fixed-timestep usando hrtime accumulator.
 * Garante exatamente 60 ticks/segundo independente do load do Node.
 *
 * Substitui o setInterval(16ms) da versão anterior que causava drift.
 */
'use strict';

const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE; // ~16.667ms
const TICK_NS = BigInt(Math.round(TICK_MS * 1e6)); // nanossegundos por tick

// Map de loops ativos para poder parar individualmente
const activeLoops = new Map();
let loopIdCounter = 0;

/**
 * Cria e inicia um tick loop autoritativo para uma sala Rinha.
 * @param {object} room - Objeto da sala do hub
 * @param {object} io - Socket.IO server instance
 * @param {string} roomCode - Código da sala
 * @param {object} Config - RinhaConfig compartilhado
 * @param {object} Engine - RinhaEngine compartilhado
 * @param {Function} onRoundEnd - Callback(winnerId, reason) quando round termina
 * @param {Function} onMatchEnd - Callback(winnerId) quando match termina
 * @returns {number} ID do loop (para stopTickLoop)
 */
function createTickLoop(room, io, roomCode, Config, Engine, onRoundEnd, onMatchEnd) {
  const loopId = ++loopIdCounter;

  let accumulator = BigInt(0);
  let lastTime = process.hrtime.bigint();
  let running = true;

  function tick() {
    if (!running) return;

    const rs = room.rinhaState;
    if (!rs || !rs.world || rs.phase !== 'fighting') {
      running = false;
      activeLoops.delete(loopId);
      return;
    }

    // Calcular delta time em nanossegundos
    const now = process.hrtime.bigint();
    const delta = now - lastTime;
    lastTime = now;

    // Cap delta para evitar spiral of death (max 5 ticks de catch-up)
    const maxDelta = TICK_NS * BigInt(5);
    accumulator += delta < maxDelta ? delta : maxDelta;

    // Processar ticks fixos
    while (accumulator >= TICK_NS) {
      // Coletar inputs de todos os jogadores
      const inputsByPlayerId = {};
      for (const [pid, input] of Object.entries(rs.inputs)) {
        inputsByPlayerId[pid] = input;
      }

      // Step da engine autoritativa
      const events = Engine.step(rs.world, inputsByPlayerId);

      // Verificar eventos de fim de round/match
      for (const ev of events) {
        if (ev.type === 'round_end') {
          onRoundEnd(ev.winnerId, ev.reason);
          if (rs.phase !== 'fighting') {
            running = false;
            activeLoops.delete(loopId);
            broadcastSnapshot(room, io, roomCode, Engine, true);
            return;
          }
        }
      }

      accumulator -= TICK_NS;
    }

    // Broadcast snapshot após todos os ticks pendentes serem processados
    broadcastSnapshot(room, io, roomCode, Engine, false);

    // Agendar próximo frame via setTimeout com precisão
    const nextDelay = Number(TICK_NS - accumulator) / 1e6;
    const clampedDelay = Math.max(1, Math.min(nextDelay, TICK_MS * 2));

    const timerId = setTimeout(tick, clampedDelay);
    activeLoops.set(loopId, { timerId, stop: () => { running = false; clearTimeout(timerId); } });
  }

  // Iniciar loop
  tick();

  return loopId;
}

/**
 * Para um tick loop ativo.
 * @param {number} loopId - ID retornado por createTickLoop
 */
function stopTickLoop(loopId) {
  const loop = activeLoops.get(loopId);
  if (loop) {
    loop.stop();
    activeLoops.delete(loopId);
  }
}

/**
 * Serializa e broadcasta o estado atual do mundo para todos os clientes.
 * Usa delta compression quando possível.
 */
function broadcastSnapshot(room, io, roomCode, Engine, forceFull) {
  const rs = room.rinhaState;
  if (!rs || !rs.world) return;

  const { serializeSnapshot, serializeDelta } = require('./snapshot');

  const playerIds = Object.keys(rs.world.players).sort();

  for (const pid of playerIds) {
    const socket = io.sockets.sockets.get(pid);
    if (!socket) continue;

    const lastSent = rs.lastSentStates[pid];

    if (forceFull || !lastSent) {
      // Full snapshot
      const full = serializeSnapshot(rs.world, rs);
      socket.emit('rinha:snapshot', full);
      rs.lastSentStates[pid] = JSON.parse(JSON.stringify(full));
    } else {
      // Delta snapshot
      const delta = serializeDelta(rs.world, rs, lastSent);
      if (delta) {
        socket.emit('rinha:snapshot', delta);
        // Atualizar lastSent com estado atual
        rs.lastSentStates[pid] = JSON.parse(JSON.stringify(serializeSnapshot(rs.world, rs)));
      }
    }
  }

  // Também enviar para espectadores
  if (rs.spectators) {
    for (const specId of rs.spectators) {
      const socket = io.sockets.sockets.get(specId);
      if (!socket) continue;

      const full = serializeSnapshot(rs.world, rs);
      socket.emit('rinha:snapshot', full);
    }
  }
}

module.exports = { createTickLoop, stopTickLoop };