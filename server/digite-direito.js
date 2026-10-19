/**
 * Digite Direito — Servidor
 * ==========================
 * Handler autoritativo: frases, rounds, instabilidade, vidas e eliminação.
 */
'use strict';

const PHRASES = [
  'O rato roeu a roupa do rei de Roma',
  'A vida é feita de escolhas e consequências',
  'Quem não tem cão caça com gato',
  'Mais vale um pássaro na mão do que dois voando',
  'Água mole em pedra dura tanto bate até que fura',
  'De grão em grão a galinha enche o papo',
  'Cada macaco no seu galho',
  'Quem canta seus males espanta',
  'Devagar se vai ao longe',
  'O sol nasce para todos mas a sombra é para poucos',
  'Em terra de cego quem tem um olho é rei',
  'Não adianta chorar sobre o leite derramado',
  'Filho de peixe peixinho é',
  'A pressa é inimiga da perfeição',
  'Quem espera sempre alcança',
  'Antes tarde do que nunca',
  'Cavalo dado não se olha os dentes',
  'Pimenta nos olhos dos outros é refresco',
  'Santo de casa não faz milagre',
  'Mente vazia oficina do diabo'
];

function pickPhrase(rng) {
  const idx = Math.floor((rng || Math.random()) * PHRASES.length);
  return PHRASES[idx % PHRASES.length];
}

function createGameState(room) {
  return {
    phase: 'lobby', // lobby, playing, round_end, gameover
    round: 0,
    players: {},     // id -> { name, lives, instability, progress, finished, finishTime, errors }
    phrase: '',
    timeLimit: 30,
    timer: null,
    roundTimer: null,
    seed: Date.now()
  };
}

function initPlayer(gs, socketId, playerName) {
  gs.players[socketId] = {
    name: playerName || 'Jogador',
    lives: 3,
    instability: 0,
    progress: 0,
    finished: false,
    finishTime: 0,
    errors: 0,
    alive: true
  };
}

function startRound(gs, io, roomCode) {
  gs.round++;
  gs.phase = 'playing';
  gs.phrase = pickPhrase();
  gs.timeLimit = 30;

  // Resetar estado de round dos jogadores vivos
  for (const pid in gs.players) {
    const p = gs.players[pid];
    if (!p.alive) continue;
    p.instability = 0;
    p.progress = 0;
    p.finished = false;
    p.finishTime = 0;
    p.errors = 0;
  }

  io.to(roomCode).emit('game:digite:start', {
    phrase: gs.phrase,
    timeLimit: gs.timeLimit,
    round: gs.round,
    players: serializePlayers(gs)
  });

  // Timer do round
  if (gs.roundTimer) clearTimeout(gs.roundTimer);
  gs.roundTimer = setTimeout(() => {
    endRound(gs, io, roomCode, 'timeout');
  }, gs.timeLimit * 1000);
}

function endRound(gs, io, roomCode, reason) {
  if (gs.roundTimer) { clearTimeout(gs.roundTimer); gs.roundTimer = null; }
  gs.phase = 'round_end';

  // Jogadores que não terminaram perdem o round
  for (const pid in gs.players) {
    const p = gs.players[pid];
    if (p.alive && !p.finished) {
      p.lives--;
      if (p.lives <= 0) p.alive = false;
    }
  }

  // Ranking do round
  const rankings = buildRoundRankings(gs);

  io.to(roomCode).emit('game:digite:round-end', {
    reason,
    round: gs.round,
    rankings,
    players: serializePlayers(gs)
  });

  // Verificar gameover
  const alivePlayers = Object.entries(gs.players).filter(([, p]) => p.alive);
  if (alivePlayers.length <= 1) {
    endGame(gs, io, roomCode, alivePlayers);
  } else {
    // Próximo round após 4s
    gs.timer = setTimeout(() => {
      startRound(gs, io, roomCode);
    }, 4000);
  }
}

function endGame(gs, io, roomCode, alivePlayers) {
  gs.phase = 'gameover';
  if (gs.timer) { clearTimeout(gs.timer); gs.timer = null; }

  const winner = alivePlayers.length === 1 ? alivePlayers[0][1].name : 'Ninguém';
  const finalRankings = buildFinalRankings(gs);

  io.to(roomCode).emit('game:digite:gameover', {
    winner,
    rankings: finalRankings
  });
}

function buildRoundRankings(gs) {
  const list = [];
  for (const pid in gs.players) {
    const p = gs.players[pid];
    let points = 0;
    if (p.finished) {
      points += 50; // base por completar
      points += Math.max(0, 30 - p.errors) * 2; // bônus por precisão
      // Bônus por velocidade (quem terminou primeiro ganha mais)
      if (p.finishTime > 0) {
        points += Math.max(0, Math.round((gs.timeLimit - p.finishTime / 1000) * 3));
      }
    } else {
      points += Math.round(p.progress * 0.3); // pontos parciais
    }
    list.push({ id: pid, name: p.name, finished: p.finished, errors: p.errors, points });
  }
  return list.sort((a, b) => b.points - a.points);
}

function buildFinalRankings(gs) {
  const list = [];
  for (const pid in gs.players) {
    const p = gs.players[pid];
    list.push({
      id: pid,
      name: p.name,
      alive: p.alive,
      lives: p.lives,
      score: p.alive ? 100 + p.lives * 50 : p.lives * 10
    });
  }
  return list.sort((a, b) => b.score - a.score);
}

function serializePlayers(gs) {
  const out = {};
  for (const pid in gs.players) {
    const p = gs.players[pid];
    out[pid] = {
      name: p.name,
      lives: p.lives,
      instability: p.instability,
      progress: p.progress,
      finished: p.finished,
      alive: p.alive
    };
  }
  return out;
}

// ==================== GAME HANDLER ====================

const gameHandler = {
  start(room, io, roomCode) {
    const gs = createGameState(room);
    room.gameState = gs;

    // Adicionar jogadores atuais
    for (const [sid, player] of room.players) {
      initPlayer(gs, sid, player.name);
    }

    // Iniciar primeiro round após breve delay
    gs.timer = setTimeout(() => {
      startRound(gs, io, roomCode);
    }, 2000);
  },

  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs || gs.phase !== 'playing') return;

    const pid = socket.id;
    const player = gs.players[pid];
    if (!player || !player.alive || player.finished) return;

    switch (data.action) {
      case 'progress': {
        player.progress = data.progress || 0;
        player.instability = data.instability || 0;
        io.to(roomCode).emit('game:digite:player-update', {
          id: pid,
          progress: player.progress,
          instability: player.instability,
          lives: player.lives,
          finished: player.finished
        });
        break;
      }

      case 'instability-trigger': {
        // Instabilidade chegou a 100%: perde vida
        player.lives--;
        player.instability = 0;
        if (player.lives <= 0) {
          player.alive = false;
        }
        io.to(roomCode).emit('game:digite:player-update', {
          id: pid,
          progress: player.progress,
          instability: 0,
          lives: player.lives,
          finished: player.finished
        });

        // Verificar se只剩 1 jogador vivo
        const aliveCount = Object.values(gs.players).filter(p => p.alive).length;
        if (aliveCount <= 1) {
          endRound(gs, io, roomCode, 'elimination');
        }
        break;
      }

      case 'finished': {
        player.finished = true;
        player.finishTime = Date.now();
        player.errors = data.errors || 0;
        player.progress = 100;
        io.to(roomCode).emit('game:digite:player-update', {
          id: pid,
          progress: 100,
          instability: player.instability,
          lives: player.lives,
          finished: true
        });

        // Verificar se todos terminaram
        const allFinished = Object.values(gs.players)
          .filter(p => p.alive)
          .every(p => p.finished);
        if (allFinished) {
          endRound(gs, io, roomCode, 'all-finished');
        }
        break;
      }

      case 'timeout': {
        // Jogador não terminou a tempo (já tratado pelo timer do round)
        break;
      }
    }
  }
};

module.exports = { gameHandler };