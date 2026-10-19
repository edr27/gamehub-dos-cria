/**
 * Rinha.io v2 — Broadcast Utilities (Servidor)
 * =============================================
 * Funções de broadcast extraídas para evitar dependência circular.
 */
'use strict';

function broadcastRinhaRoomState(room, io, roomCode) {
  if (!room.rinhaState) return;
  const rs = room.rinhaState;
  io.to(roomCode).emit('rinha:room_state', {
    participants: rs.participants,
    mode: rs.mode,
    sessionScores: rs.sessionScores,
    phase: rs.phase,
    scores: rs.scores,
    queue: rs.queue
  });
}

module.exports = { broadcastRinhaRoomState };