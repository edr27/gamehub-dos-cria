/**
 * Rinha.io — Módulo Servidor (Entry Point)
 * =========================================
 * Exporta gameHandler compatível com o padrão do hub (gameHandlers[gameId])
 * e função registerSocketEvents(io) para attachar handlers rinha:* na conexão.
 *
 * Integração no server.js:
 *   const rinhaModule = require('./server/rinha');
 *   gameHandlers['rinha'] = rinhaModule.gameHandler;
 *   rinhaModule.registerSocketEvents(io);
 */

'use strict';

const Config = require('../../public/js/games/rinha/rinha-config.js');
const Engine = require('../../public/js/games/rinha/rinha-engine.js');
const { createRoomManager } = require('./room-manager');
const { createTickLoop, stopTickLoop } = require('./tick-loop');
const { serializeSnapshot, serializeDelta } = require('./snapshot');
const { validateInput } = require('./input-validator');
const { broadcastRinhaRoomState } = require('./broadcast');

// ==================== GAME HANDLER ====================

const gameHandler = {
  /**
   * Chamado pelo hub quando o host inicia o jogo Rinha.
   * Inicializa estado da sala e prepara lobby do Rinha.
   */
  start(room, io, roomCode) {
    // Criar manager de sala dedicado ao Rinha
    const manager = createRoomManager(room, io, roomCode, Config, Engine);
    room.rinhaManager = manager;

    // Inicializar estado do Rinha na sala
    room.rinhaState = {
      phase: 'lobby', // lobby, countdown, fighting, round_end, match_over
      mode: '1v1',
      roundsToWin: 2,
      participants: [], // { id, name, fighterId, ready, isSpectator, team }
      scores: {},       // playerId -> roundsWon
      sessionScores: {}, // playerId -> vitórias na sessão (persiste entre partidas)
      queue: [],        // fila de espera para 1v1 rei da mesa
      spectators: [],   // IDs dos espectadores
      inputs: {},       // playerId -> último input recebido
      world: null,      // Engine world (só existe durante fighting)
      tickLoopId: null, // referência para parar o loop
      lastSentStates: {}, // playerId -> último snapshot enviado (para delta)
      seed: Date.now() ^ (Math.random() * 0xFFFFFFFF >>> 0)
    };

    // Preencher participantes com jogadores atuais da sala
    for (const [sid, player] of room.players) {
      room.rinhaState.participants.push({
        id: sid,
        name: player.name || 'Jogador',
        fighterId: null,
        ready: false,
        isSpectator: false,
        team: null
      });
      room.rinhaState.sessionScores[sid] = room.rinhaState.sessionScores[sid] || 0;
    }

    broadcastRinhaRoomState(room, io, roomCode);
  },

  /**
   * Chamado pelo hub para ações genéricas de jogo.
   * A maioria das ações do Rinha vai direto via eventos rinha:* registrados abaixo.
   */
  handleAction(room, io, roomCode, socket, data) {
    if (!room.rinhaManager) return;
    room.rinhaManager.handleAction(socket.id, data);
  }
};

// ==================== REGISTRO DE EVENTOS SOCKET.IO ====================

/**
 * Registra handlers para eventos rinha:* dentro de io.on('connection').
 * Deve ser chamado uma vez no startup do servidor.
 */
function registerSocketEvents(io) {
  io.on('connection', (socket) => {

    // --- JOIN ---
    socket.on('rinha:join', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState) return;

      const rs = room.rinhaState;
      const participant = rs.participants.find(p => p.id === socket.id);
      if (participant) {
        participant.fighterId = data.fighterId || 'faisca';
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

    // --- READY ---
    socket.on('rinha:ready', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState || !room.rinhaManager) return;

      room.rinhaManager.setReady(socket.id, data.fighterId, data.ready);
    });

    // --- SET MODE ---
    socket.on('rinha:set-mode', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState || !room.rinhaManager) return;

      // Apenas host pode mudar modo
      if (room.hostId !== socket.id) return;
      room.rinhaManager.setMode(data.mode);
    });

    // --- INPUT ---
    socket.on('rinha:input', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState) return;

      const rs = room.rinhaState;
      if (rs.phase !== 'fighting') return;

      // Validação básica de input
      if (!validateInput(data)) return;

      // Armazenar input para o tick loop processar
      rs.inputs[socket.id] = data;
    });

    // --- REMATCH ---
    socket.on('rinha:rematch', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState || !room.rinhaManager) return;

      room.rinhaManager.requestRematch(socket.id);
    });

    // --- EMOTE ---
    socket.on('rinha:emote', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState) return;

      // Rate limit simples: max 2 emotes por segundo por jogador
      const now = Date.now();
      if (!room._rinhaEmoteThrottle) room._rinhaEmoteThrottle = {};
      const last = room._rinhaEmoteThrottle[socket.id] || 0;
      if (now - last < 500) return;
      room._rinhaEmoteThrottle[socket.id] = now;

      const emoji = data.emoji || '⚔️';
      io.to(info.roomCode).emit('rinha:emote', {
        playerId: socket.id,
        playerName: info.playerName,
        emoji: emoji
      });
    });

    // --- CHAT ---
    socket.on('rinha:chat', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState) return;

      // Rate limit: max 5 mensagens por segundo
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

    // --- SPECTATE ---
    socket.on('rinha:spectate', (data) => {
      const info = getPlayerInfo(socket.id);
      if (!info) return;
      const room = getRoom(info.roomCode);
      if (!room || !room.rinhaState || !room.rinhaManager) return;

      room.rinhaManager.setSpectator(socket.id, true);
    });

    // --- PING ---
    socket.on('rinha:ping', (data) => {
      socket.emit('rinha:pong', { time: data ? data.time : Date.now() });
    });
  });
}

// ==================== UTILITÁRIOS INTERNOS ====================

// Registry compartilhado: o server.js chama setHubContext(rooms, playerSockets)
// após carregar este módulo, permitindo acesso aos mapas do hub sem acoplamento direto.
let _rooms = null;
let _playerSockets = null;

/**
 * Injeta as referências aos mapas globais do hub (rooms e playerSockets).
 * Deve ser chamado uma vez no startup do server.js após a definição dos mapas.
 * @param {Map} rooms - Mapa de salas do hub (roomCode -> room)
 * @param {Map} playerSockets - Mapa de jogadores do hub (socketId -> info)
 */
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

// ==================== EXPORTS ====================

module.exports = {
  gameHandler,
  registerSocketEvents,
  setHubContext,
  broadcastRinhaRoomState,
  // Expostos para uso direto no server.js durante transição
  Config,
  Engine,
  createRoomManager,
  createTickLoop,
  stopTickLoop,
  serializeSnapshot,
  serializeDelta,
  validateInput
};