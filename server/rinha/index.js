/**
 * Rinha.io v2 — Módulo Servidor (Entry Point)
 * ============================================
 * Exporta gameHandler compatível com o hub + registerSocketEvents(io).
 * Reescrito do zero: sem código da versão anterior.
 */
'use strict';

const Config = require('../../public/js/games/rinha/rinha-config.js');
const Engine = require('../../public/js/games/rinha/rinha-engine.js');
const { createRoomManager } = require('./room-manager');
const { createTickLoop, stopTickLoop } = require('./tick-loop');
const { serializeSnapshot, serializeDelta } = require('./snapshot');
const { validateInput } = require('./input-validator');
const { broadcastRinhaRoomState } = require('./broadcast');

// Registry injetado pelo server.js via setHubContext()
let _rooms = null;
let _playerSockets = null;

function setHubContext(rooms, playerSockets) {
  _rooms = rooms;
  _playerSockets = playerSockets;
}

function getPlayerInfo(socketId) {
  if (!_playerSockets) return null;
  return _playerSockets.get(socketId) || null;
}

function getRoom(roomCode) {
  if (!_rooms) return null;
  return _rooms.get(roomCode) || null;
}

// ==================== GAME HANDLER ====================
const gameHandler = {
  start(room, io, roomCode) {
    const manager = createRoomManager(room, io, roomCode, Config, Engine);
    room.rinhaManager = manager;

    room.rinhaState = {
      phase: 'lobby',
      mode: '1v1',
      roundsToWin: 2,
      participants: [],
      scores: {},
      sessionScores: {},
      queue: [],
      spectators: [],
      inputs: {},
      world: null,
      tickLoopId: null,
      lastSentStates: {},
      seed: Date.now() ^ (Math.random() * 0xFFFFFFFF >>> 0)
    };

    // Preencher participantes com jogadores atuais
    for (const [sid, player] of room.players) {
      room.rinhaState.participants.push({
        id: sid,
        name: player.name || 'Jogador',
        fighterId: null,
        ready: false,
        isSpectator: false,
        team: null
      });
      room.rinhaState.sessionScores[sid] = 0;
    }

    broadcastRinhaRoomState(room, io, roomCode);
  },

  handleAction(room, io, roomCode, socket, data) {
    if (!room.rinhaManager) return;
    room.rinhaManager.handleAction(socket.id, data);
  }
};

// ==================== REGISTRO DE EVENTOS SOCKET.IO ====================
function registerSocketEvents(io) {
  io.on('connection', (socket) => {

    socket.on('rinha:join', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState) return;

      const rs = room.rinhaState;
      const participant = rs.participants.find(p => p.id === socket.id);
      if (participant) {
        participant.fighterId = data.fighterId || 'faísca';
        participant.name = data.playerName || participant.name;
      }

      socket.emit('rinha:room_state', {
        localPlayerId: socket.id,
        participants: rs.participants,
        mode: rs.mode,
        sessionScores: rs.sessionScores,
        phase: rs.phase
      });
    });

    socket.on('rinha:ready', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState || !room.rinhaManager) return;
      room.rinhaManager.setReady(socket.id, data.fighterId, data.ready);
    });

    socket.on('rinha:set-mode', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState || !room.rinhaManager) return;
      if (room.hostId !== socket.id) return;
      room.rinhaManager.setMode(data.mode);
    });

    socket.on('rinha:input', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState) return;
      if (room.rinhaState.phase !== 'fighting') return;
      if (!validateInput(data)) return;
      room.rinhaState.inputs[socket.id] = data;
    });

    socket.on('rinha:rematch', () => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState || !room.rinhaManager) return;
      room.rinhaManager.requestRematch(socket.id);
    });

    socket.on('rinha:emote', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState) return;
      const now = Date.now();
      if (!room._rinhaEmoteThrottle) room._rinhaEmoteThrottle = {};
      const last = room._rinhaEmoteThrottle[socket.id] || 0;
      if (now - last < 500) return;
      room._rinhaEmoteThrottle[socket.id] = now;
      io.to(info.roomCode).emit('rinha:emote', {
        playerId: socket.id,
        playerName: info.playerName,
        emoji: data.emoji || '⚔️'
      });
    });

    socket.on('rinha:chat', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState) return;
      const now = Date.now();
      if (!room._rinhaChatThrottle) room._rinhaChatThrottle = {};
      const last = room._rinhaChatThrottle[socket.id] || 0;
      if (now - last < 200) return;
      room._rinhaChatThrottle[socket.id] = now;
      const text = (data.text || '').substring(0, 200);
      if (!text.trim()) return;
      io.to(info.roomCode).emit('rinha:chat', {
        playerId: socket.id,
        playerName: info.playerName,
        text: text
      });
    });

    socket.on('rinha:spectate', () => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState || !room.rinhaManager) return;
      room.rinhaManager.setSpectator(socket.id, true);
    });

    socket.on('rinha:ping', (data) => {
      socket.emit('rinha:pong', { time: data ? data.time : Date.now() });
    });
  });
}

module.exports = {
  gameHandler,
  registerSocketEvents,
  setHubContext,
  broadcastRinhaRoomState,
  Config,
  Engine,
  createRoomManager,
  createTickLoop,
  stopTickLoop,
  serializeSnapshot,
  serializeDelta,
  validateInput
};