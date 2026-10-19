/**
 * Rinha.io v2 — Tick Loop Autoritativo (Servidor)
 * =================================================
 * Loop fixed-timestep com hrtime accumulator. 60 ticks/s reais.
 * Reescrito do zero.
 */
'use strict';

const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const TICK_NS = BigInt(Math.round(TICK_MS * 1e6));

const activeLoops = new Map();
let loopIdCounter = 0;

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

    const now = process.hrtime.bigint();
    const delta = now - lastTime;
    lastTime = now;

    const maxDelta = TICK_NS * BigInt(5);
    accumulator += delta < maxDelta ? delta : maxDelta;

    while (accumulator >= TICK_NS) {
      const inputsByPlayerId = {};
      for (const [pid, input] of Object.entries(rs.inputs)) {
        inputsByPlayerId[pid] = input;
      }

      const events = Engine.step(rs.world, inputsByPlayerId);

      for (const ev of events) {
        if (ev.type === 'round_end') {
          onRoundEnd(ev.data ? ev.data.winnerId : null, ev.data ? ev.data.reason : 'ko');
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

    broadcastSnapshot(room, io, roomCode, Engine, false);

    const nextDelay = Number(TICK_NS - accumulator) / 1e6;
    const clampedDelay = Math.max(1, Math.min(nextDelay, TICK_MS * 2));
    const timerId = setTimeout(tick, clampedDelay);
    activeLoops.set(loopId, { timerId, stop: () => { running = false; clearTimeout(timerId); } });
  }

  tick();
  return loopId;
}

function stopTickLoop(loopId) {
  const loop = activeLoops.get(loopId);
  if (loop) {
    loop.stop();
    activeLoops.delete(loopId);
  }
}

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
      const full = serializeSnapshot(rs.world, rs);
      socket.emit('rinha:snapshot', full);
      rs.lastSentStates[pid] = JSON.parse(JSON.stringify(full));
    } else {
      const delta = serializeDelta(rs.world, rs, lastSent);
      if (delta) {
        socket.emit('rinha:snapshot', delta);
        rs.lastSentStates[pid] = JSON.parse(JSON.stringify(serializeSnapshot(rs.world, rs)));
      }
    }
  }

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