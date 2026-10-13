/**
 * Rinha.io — Broadcast Utilities (Servidor)
 * ===========================================
 * Funções de broadcast extraídas para evitar dependência circular
 * entre index.js e room-manager.js.
 */
'use strict';

/**
 * Broadcast do estado da sala Rinha para todos os clientes na sala.
 * @param {object} room - Objeto da sala do hub
 * @param {object} io - Socket.IO server instance
 * @param {string} roomCode - Código da sala
 */
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