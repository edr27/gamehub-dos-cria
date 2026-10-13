/**
 * Rinha.io — Room Manager (Servidor)
 * ====================================
 * Gerencia ciclo de vida da sala Rinha: lobby, ready, countdown,
 * match start/end, queue rotation (1v1 rei da mesa), espectadores,
 * rematch e bot AI para slots vazios.
 */
'use strict';

const { broadcastRinhaRoomState } = require('./broadcast');

/**
 * Cria um manager de sala dedicado ao Rinha.
 * @param {object} room - Objeto da sala do hub
 * @param {object} io - Socket.IO server instance
 * @param {string} roomCode - Código da sala
 * @param {object} Config - RinhaConfig compartilhado
 * @param {object} Engine - RinhaEngine compartilhado
 */
function createRoomManager(room, io, roomCode, Config, Engine) {
  const manager = {
    /**
     * Define lutador e estado de pronto de um jogador.
     */
    setReady(playerId, fighterId, ready) {
      const rs = room.rinhaState;
      if (!rs || rs.phase !== 'lobby') return;

      const participant = rs.participants.find(p => p.id === playerId);
      if (!participant) return;

      participant.fighterId = fighterId || participant.fighterId || 'faisca';
      participant.ready = !!ready;

      broadcastRinhaRoomState(room, io, roomCode);
      checkReadyToStart();
    },

    /**
     * Altera modo de jogo (apenas host).
     */
    setMode(mode) {
      const rs = room.rinhaState;
      if (!rs || rs.phase !== 'lobby') return;
      if (!Config.MODES[mode]) return;

      rs.mode = mode;
      rs.roundsToWin = Config.MODES[mode].roundsToWin || 2;

      // Resetar ready de todos quando muda modo
      for (const p of rs.participants) {
        p.ready = false;
      }

      broadcastRinhaRoomState(room, io, roomCode);
    },

    /**
     * Marca jogador como espectador.
     */
    setSpectator(playerId, isSpectator) {
      const rs = room.rinhaState;
      if (!rs) return;

      const participant = rs.participants.find(p => p.id === playerId);
      if (!participant) return;

      participant.isSpectator = !!isSpectator;
      participant.ready = false;

      broadcastRinhaRoomState(room, io, roomCode);
    },

    /**
     * Solicita revanche. Quando todos solicitam, reinicia a partida.
     */
    requestRematch(playerId) {
      const rs = room.rinhaState;
      if (!rs || rs.phase !== 'match_over') return;

      if (!rs.rematchVotes) rs.rematchVotes = new Set();
      rs.rematchVotes.add(playerId);

      // Verificar se todos os participantes ativos votaram
      const activePlayers = rs.participants.filter(p => !p.isSpectator);
      if (rs.rematchVotes.size >= activePlayers.length && activePlayers.length > 0) {
        startMatch();
      } else {
        io.to(roomCode).emit('rinha:room_state', {
          participants: rs.participants,
          mode: rs.mode,
          sessionScores: rs.sessionScores,
          phase: rs.phase,
          scores: rs.scores,
          rematchVotes: rs.rematchVotes.size,
          rematchNeeded: activePlayers.length
        });
      }
    },

    /**
     * Processa ação genérica vinda do handleAction do hub.
     */
    handleAction(playerId, data) {
      switch (data.action) {
        case 'ready':
          manager.setReady(playerId, data.fighterId, data.ready);
          break;
        case 'set-mode':
          manager.setMode(data.mode);
          break;
        case 'rematch':
          manager.requestRematch(playerId);
          break;
        case 'spectate':
          manager.setSpectator(playerId, true);
          break;
      }
    }
  };

  // ==================== LÓGICA INTERNA ====================

  /**
   * Verifica se todos os jogadores ativos estão prontos e inicia countdown.
   */
  function checkReadyToStart() {
    const rs = room.rinhaState;
    if (!rs || rs.phase !== 'lobby') return;

    const activePlayers = rs.participants.filter(p => !p.isSpectator);
    const minPlayers = 2; // mínimo para qualquer modo

    if (activePlayers.length < minPlayers) return;

    const allReady = activePlayers.every(p => p.ready && p.fighterId);
    if (!allReady) return;

    // Iniciar countdown
    startCountdown();
  }

  /**
   * Inicia contagem regressiva 3-2-1-LUTE.
   */
  function startCountdown() {
    const rs = room.rinhaState;
    rs.phase = 'countdown';
    broadcastRinhaRoomState(room, io, roomCode);

    let count = 3;
    io.to(roomCode).emit('rinha:countdown', { seconds: count, phase: 'countdown' });

    const cdInterval = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(roomCode).emit('rinha:countdown', { seconds: count, phase: 'countdown' });
      } else {
        clearInterval(cdInterval);
        io.to(roomCode).emit('rinha:countdown', { seconds: 0, phase: 'fight' });
        startMatch();
      }
    }, 1000);

    room.rinhaCountdownTimer = cdInterval;
  }

  /**
   * Inicia a partida: cria world, spawn players, inicia tick loop.
   */
  function startMatch() {
    const rs = room.rinhaState;
    rs.phase = 'fighting';
    rs.rematchVotes = new Set();

    // Criar seed determinístico para esta partida
    rs.seed = Date.now() ^ (Math.random() * 0xFFFFFFFF >>> 0);

    // Criar mundo autoritativo
    const world = Engine.createWorld('default', rs.seed);
    world.phase = 'fighting';

    // Spawn dos jogadores ativos baseado no modo
    const activePlayers = rs.participants.filter(p => !p.isSpectator);
    const spawnPositions = getSpawnPositions(rs.mode, activePlayers.length);

    for (let i = 0; i < activePlayers.length; i++) {
      const p = activePlayers[i];
      const pos = spawnPositions[i] || { x: 480, y: 320 };
      const team = rs.mode === '2v2' ? (i < 2 ? 'a' : 'b') : null;

      const player = Engine.createPlayer(
        p.id,
        p.name,
        p.fighterId || 'faisca',
        pos.x, pos.y,
        team
      );
      world.players[p.id] = player;
    }

    rs.world = world;
    rs.inputs = {};

    // Resetar scores de round se nova partida (não rematch)
    if (!rs.scores || Object.keys(rs.scores).length === 0) {
      rs.scores = {};
      for (const p of activePlayers) {
        rs.scores[p.id] = 0;
      }
    }

    rs.roundNumber = (rs.roundNumber || 0) + 1;

    broadcastRinhaRoomState(room, io, roomCode);

    // Iniciar tick loop autoritativo
    const { createTickLoop } = require('./tick-loop');
    rs.tickLoopId = createTickLoop(
      room, io, roomCode, Config, Engine,
      onRoundEnd, onMatchEnd
    );
  }

  /**
   * Callback quando um round termina.
   */
  function onRoundEnd(winnerId, reason) {
    const rs = room.rinhaState;
    if (!rs) return;

    // Atualizar score
    if (winnerId && rs.scores[winnerId] !== undefined) {
      rs.scores[winnerId]++;
    }

    // Verificar se match acabou
    const roundsToWin = rs.roundsToWin || 2;
    const matchWinner = Object.entries(rs.scores).find(([, wins]) => wins >= roundsToWin);

    if (matchWinner) {
      onMatchEnd(matchWinner[0]);
    } else {
      // Próximo round após delay
      rs.phase = 'round_end';
      broadcastRinhaRoomState(room, io, roomCode);

      io.to(roomCode).emit('rinha:round_end', {
        winnerId,
        reason,
        scores: rs.scores,
        round: rs.roundNumber
      });

      setTimeout(() => {
        if (rs.phase === 'round_end') {
          startMatch();
        }
      }, 3000);
    }
  }

  /**
   * Callback quando a partida inteira termina.
   */
  function onMatchEnd(winnerId) {
    const rs = room.rinhaState;
    if (!rs) return;

    // Parar tick loop
    const { stopTickLoop } = require('./tick-loop');
    if (rs.tickLoopId) {
      stopTickLoop(rs.tickLoopId);
      rs.tickLoopId = null;
    }

    rs.phase = 'match_over';

    // Atualizar session scores
    if (winnerId) {
      rs.sessionScores[winnerId] = (rs.sessionScores[winnerId] || 0) + 1;
    }

    // Queue rotation para 1v1 rei da mesa
    if (rs.mode === '1v1' && rs.queue.length > 0) {
      rotateQueue(winnerId);
    }

    broadcastRinhaRoomState(room, io, roomCode);

    io.to(roomCode).emit('rinha:match_over', {
      winnerId,
      scores: rs.scores,
      sessionScores: rs.sessionScores,
      stats: buildMatchStats(),
      round: rs.roundNumber
    });
  }

  /**
   * Rotaciona fila no modo 1v1 rei da mesa.
   * Perdedor vai pro fim da fila, próximo desafiante entra.
   */
  function rotateQueue(winnerId) {
    const rs = room.rinhaState;
    const activePlayers = rs.participants.filter(p => !p.isSpectator);

    // Identificar perdedor
    const loser = activePlayers.find(p => p.id !== winnerId);
    if (loser) {
      // Adicionar perdedor ao fim da fila
      rs.queue.push(loser.id);
    }

    // Se há alguém na fila, trocar
    if (rs.queue.length > 0) {
      const nextChallengerId = rs.queue.shift();
      const challenger = rs.participants.find(p => p.id === nextChallengerId);
      if (challenger) {
        challenger.isSpectator = false;
        challenger.ready = false;
      }
      // Vencedor continua, mas precisa re-ready
      const winner = rs.participants.find(p => p.id === winnerId);
      if (winner) {
        winner.ready = false;
      }
    }
  }

  /**
   * Gera estatísticas da partida para tela de resultados.
   */
  function buildMatchStats() {
    const rs = room.rinhaState;
    if (!rs || !rs.world) return {};

    const stats = {};
    for (const [pid, p] of Object.entries(rs.world.players)) {
      stats[pid] = {
        name: p.name,
        hpRemaining: Math.max(0, p.hp),
        comboMax: p.comboCount
      };
    }
    return stats;
  }

  /**
   * Retorna posições de spawn baseadas no modo e número de jogadores.
   */
  function getSpawnPositions(mode, playerCount) {
    const arena = Config.ARENA;
    const margin = 80;

    if (mode === '1v1' || playerCount === 2) {
      return [
        { x: margin + 40, y: arena.height / 2 },
        { x: arena.width - margin - 40, y: arena.height / 2 }
      ];
    }

    if (mode === 'ffa') {
      // Cantos da arena
      const positions = [
        { x: margin + 40, y: margin + 40 },
        { x: arena.width - margin - 40, y: margin + 40 },
        { x: margin + 40, y: arena.height - margin - 40 },
        { x: arena.width - margin - 40, y: arena.height - margin - 40 }
      ];
      return positions.slice(0, playerCount);
    }

    if (mode === '2v2') {
      return [
        { x: margin + 40, y: arena.height / 2 - 60 },
        { x: margin + 40, y: arena.height / 2 + 60 },
        { x: arena.width - margin - 40, y: arena.height / 2 - 60 },
        { x: arena.width - margin - 40, y: arena.height / 2 + 60 }
      ];
    }

    // Fallback: linha horizontal
    const positions = [];
    const spacing = (arena.width - 2 * margin) / (playerCount + 1);
    for (let i = 0; i < playerCount; i++) {
      positions.push({
        x: margin + spacing * (i + 1),
        y: arena.height / 2
      });
    }
    return positions;
  }

  return manager;
}

module.exports = { createRoomManager };