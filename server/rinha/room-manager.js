/**
 * Rinha.io v2 — Room Manager (Servidor)
 * =======================================
 * Gerencia ciclo de vida da sala: lobby, ready, countdown, match,
 * queue rotation (1v1), espectadores, rematch.
 * Reescrito do zero.
 */
'use strict';

const { broadcastRinhaRoomState } = require('./broadcast');

function createRoomManager(room, io, roomCode, Config, Engine) {
  const manager = {
    setReady(playerId, fighterId, ready) {
      const rs = room.rinhaState;
      if (!rs || rs.phase !== 'lobby') return;
      const p = rs.participants.find(x => x.id === playerId);
      if (!p) return;
      p.fighterId = fighterId || p.fighterId || 'faísca';
      p.ready = !!ready;
      broadcastRinhaRoomState(room, io, roomCode);
      checkReady();
    },

    setMode(mode) {
      const rs = room.rinhaState;
      if (!rs || rs.phase !== 'lobby') return;
      if (!Config.MODES[mode]) return;
      rs.mode = mode;
      rs.roundsToWin = Config.MODES[mode].roundsToWin || 2;
      for (const p of rs.participants) p.ready = false;
      broadcastRinhaRoomState(room, io, roomCode);
    },

    setSpectator(playerId, isSpectator) {
      const rs = room.rinhaState;
      if (!rs) return;
      const p = rs.participants.find(x => x.id === playerId);
      if (!p) return;
      p.isSpectator = !!isSpectator;
      p.ready = false;
      broadcastRinhaRoomState(room, io, roomCode);
    },

    requestRematch(playerId) {
      const rs = room.rinhaState;
      if (!rs || rs.phase !== 'match_over') return;
      if (!rs.rematchVotes) rs.rematchVotes = new Set();
      rs.rematchVotes.add(playerId);
      const active = rs.participants.filter(p => !p.isSpectator);
      if (rs.rematchVotes.size >= active.length && active.length > 0) {
        startMatch();
      } else {
        io.to(roomCode).emit('rinha:room_state', {
          participants: rs.participants, mode: rs.mode,
          sessionScores: rs.sessionScores, phase: rs.phase,
          scores: rs.scores, rematchVotes: rs.rematchVotes.size,
          rematchNeeded: active.length
        });
      }
    },

    handleAction(playerId, data) {
      switch (data.action) {
        case 'ready': manager.setReady(playerId, data.fighterId, data.ready); break;
        case 'set-mode': manager.setMode(data.mode); break;
        case 'rematch': manager.requestRematch(playerId); break;
        case 'spectate': manager.setSpectator(playerId, true); break;
      }
    }
  };

  function checkReady() {
    const rs = room.rinhaState;
    if (!rs || rs.phase !== 'lobby') return;
    const active = rs.participants.filter(p => !p.isSpectator);
    if (active.length < 2) return;
    if (!active.every(p => p.ready && p.fighterId)) return;
    startCountdown();
  }

  function startCountdown() {
    const rs = room.rinhaState;
    rs.phase = 'countdown';
    broadcastRinhaRoomState(room, io, roomCode);
    let count = 3;
    io.to(roomCode).emit('rinha:countdown', { seconds: count, phase: 'countdown' });
    const cd = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(roomCode).emit('rinha:countdown', { seconds: count, phase: 'countdown' });
      } else {
        clearInterval(cd);
        io.to(roomCode).emit('rinha:countdown', { seconds: 0, phase: 'fight' });
        startMatch();
      }
    }, 1000);
    room.rinhaCountdownTimer = cd;
  }

  function startMatch() {
    const rs = room.rinhaState;
    rs.phase = 'fighting';
    rs.rematchVotes = new Set();
    rs.seed = Date.now() ^ (Math.random() * 0xFFFFFFFF >>> 0);

    const world = Engine.createWorld(rs.seed);
    world.phase = 'fighting';

    const active = rs.participants.filter(p => !p.isSpectator);
    const positions = getSpawnPositions(rs.mode, active.length);

    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      const pos = positions[i] || { x: 480, y: 320 };
      const team = rs.mode === '2v2' ? (i < 2 ? 'a' : 'b') : null;
      world.players[p.id] = Engine.createPlayer(p.id, p.name, p.fighterId || 'faísca', pos.x, pos.y, team);
    }

    rs.world = world;
    rs.inputs = {};
    if (!rs.scores || Object.keys(rs.scores).length === 0) {
      rs.scores = {};
      for (const p of active) rs.scores[p.id] = 0;
    }
    rs.roundNumber = (rs.roundNumber || 0) + 1;

    broadcastRinhaRoomState(room, io, roomCode);

    const { createTickLoop } = require('./tick-loop');
    rs.tickLoopId = createTickLoop(room, io, roomCode, Config, Engine, onRoundEnd, onMatchEnd);
  }

  function onRoundEnd(winnerId, reason) {
    const rs = room.rinhaState;
    if (!rs) return;
    if (winnerId && rs.scores[winnerId] !== undefined) rs.scores[winnerId]++;
    const roundsToWin = rs.roundsToWin || 2;
    const matchWinner = Object.entries(rs.scores).find(([, w]) => w >= roundsToWin);
    if (matchWinner) {
      onMatchEnd(matchWinner[0]);
    } else {
      rs.phase = 'round_end';
      broadcastRinhaRoomState(room, io, roomCode);
      io.to(roomCode).emit('rinha:round_end', { winnerId, reason, scores: rs.scores, round: rs.roundNumber });
      setTimeout(() => { if (rs.phase === 'round_end') startMatch(); }, 3000);
    }
  }

  function onMatchEnd(winnerId) {
    const rs = room.rinhaState;
    if (!rs) return;
    const { stopTickLoop } = require('./tick-loop');
    if (rs.tickLoopId) { stopTickLoop(rs.tickLoopId); rs.tickLoopId = null; }
    rs.phase = 'match_over';
    if (winnerId) rs.sessionScores[winnerId] = (rs.sessionScores[winnerId] || 0) + 1;
    if (rs.mode === '1v1' && rs.queue.length > 0) rotateQueue(winnerId);
    broadcastRinhaRoomState(room, io, roomCode);
    io.to(roomCode).emit('rinha:match_over', {
      winnerId, scores: rs.scores, sessionScores: rs.sessionScores,
      stats: buildStats(), round: rs.roundNumber
    });
  }

  function rotateQueue(winnerId) {
    const rs = room.rinhaState;
    const active = rs.participants.filter(p => !p.isSpectator);
    const loser = active.find(p => p.id !== winnerId);
    if (loser) rs.queue.push(loser.id);
    if (rs.queue.length > 0) {
      const nextId = rs.queue.shift();
      const challenger = rs.participants.find(p => p.id === nextId);
      if (challenger) { challenger.isSpectator = false; challenger.ready = false; }
      const winner = rs.participants.find(p => p.id === winnerId);
      if (winner) winner.ready = false;
    }
  }

  function buildStats() {
    const rs = room.rinhaState;
    if (!rs || !rs.world) return {};
    const stats = {};
    for (const [pid, p] of Object.entries(rs.world.players)) {
      stats[pid] = { name: p.name, hpRemaining: Math.max(0, p.hp), comboMax: p.comboCount };
    }
    return stats;
  }

  function getSpawnPositions(mode, count) {
    const a = Config.ARENA;
    const m = 80;
    if (mode === '1v1' || count === 2) {
      return [{ x: m + 40, y: a.height / 2 }, { x: a.width - m - 40, y: a.height / 2 }];
    }
    if (mode === 'ffa') {
      return [
        { x: m + 40, y: m + 40 }, { x: a.width - m - 40, y: m + 40 },
        { x: m + 40, y: a.height - m - 40 }, { x: a.width - m - 40, y: a.height - m - 40 }
      ].slice(0, count);
    }
    if (mode === '2v2') {
      return [
        { x: m + 40, y: a.height / 2 - 60 }, { x: m + 40, y: a.height / 2 + 60 },
        { x: a.width - m - 40, y: a.height / 2 - 60 }, { x: a.width - m - 40, y: a.height / 2 + 60 }
      ];
    }
    const positions = [];
    const spacing = (a.width - 2 * m) / (count + 1);
    for (let i = 0; i < count; i++) positions.push({ x: m + spacing * (i + 1), y: a.height / 2 });
    return positions;
  }

  return manager;
}

module.exports = { createRoomManager };