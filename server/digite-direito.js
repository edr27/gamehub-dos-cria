/**
 * Digite Direito v3 — Servidor Autoritativo
 * ===========================================
 * Regras:
 * - Fases com múltiplas frases; todos recebem a mesma sequência.
 * - Erro reseta a frase atual (não bloqueia). ENTER confirma frase completa.
 * - 3 erros acumulados → roleta-russa server-side (1/6 eliminação).
 * - Sobreviveu → erros zeram, continua na mesma frase (reiniciada).
 * - Eliminado → fora da partida.
 * - Vitória quando restar ≤1 jogador vivo.
 * - Fase avança quando todos os vivos terminaram suas frases da fase.
 */
'use strict';

// ==================== BANCO DE FRASES POR FASE ====================
const PHASES = [
  {
    id: 1,
    phrases: [
      'A noite está muito silenciosa.',
      'O destino pertence aos corajosos.',
      'Cada segundo pode mudar tudo.',
      'O medo não pode controlar você.',
      'Apenas um sobreviverá até o final.'
    ]
  },
  {
    id: 2,
    phrases: [
      'O silêncio é a resposta mais barulhenta.',
      'Quem hesita perde a vez.',
      'A coragem nasce do medo dominado.',
      'Nenhum plano sobrevive ao primeiro erro.',
      'O tempo não espera pelos indecisos.'
    ]
  },
  {
    id: 3,
    phrases: [
      'A verdade dói mas liberta.',
      'Cada escolha tem seu preço.',
      'O caos revela quem realmente somos.',
      'Sobreviver exige mais que sorte.',
      'A última palavra ainda não foi dita.'
    ]
  }
];

// Probabilidade configurável de eliminação na roleta (1/N)
const ROULETTE_CHANCE = 6; // 1 em 6

function getPhrasesForPhase(phaseIndex) {
  const phase = PHASES[phaseIndex % PHASES.length];
  return phase ? phase.phrases : ['Frase de teste.'];
}

// ==================== ESTADO DO JOGO ====================
function createGameState(room) {
  return {
    phase: 'lobby',          // lobby | playing | roulette | gameover
    currentPhaseIndex: 0,    // índice da fase atual
    players: {},             // id -> PlayerState
    timer: null,
    seed: Date.now()
  };
}

function initPlayer(gs, socketId, playerName) {
  gs.players[socketId] = {
    name: playerName || 'Jogador',
    alive: true,
    errors: 0,               // erros acumulados no ciclo atual (reseta após roleta)
    totalErrors: 0,           // erros totais da partida (stats)
    currentPhraseIndex: 0,    // índice da frase dentro da fase atual
    completedPhases: 0,       // quantas fases já completou
    inRoulette: false,        // se está na animação de roleta
    finishedCurrentPhase: false
  };
}

// ==================== HANDLER ====================
const gameHandler = {
  start(room, io, roomCode) {
    const gs = createGameState(room);
    room.gameState = gs;

    for (const [sid, player] of room.players) {
      initPlayer(gs, sid, player.name);
    }

    // Iniciar primeira fase após delay
    gs.timer = setTimeout(() => {
      startPhase(gs, io, roomCode);
    }, 2500);
  },

  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs || gs.phase !== 'playing') return;

    const pid = socket.id;
    const player = gs.players[pid];
    if (!player || !player.alive || player.inRoulette) return;

    switch (data.action) {

      // Cliente informa que completou uma frase corretamente (ENTER pressionado)
      case 'phrase-complete': {
        const phrases = getPhrasesForPhase(gs.currentPhaseIndex);
        // Validação: o índice informado deve bater com o esperado
        if (data.phraseIndex !== player.currentPhraseIndex) break;
        if (player.currentPhraseIndex >= phrases.length) break;

        player.currentPhraseIndex++;
        player.errors = Math.max(0, player.errors); // mantém erros acumulados

        // Verificar se terminou todas as frases da fase
        if (player.currentPhraseIndex >= phrases.length) {
          player.finishedCurrentPhase = true;
        }

        broadcastPlayerState(gs, io, roomCode, pid);
        checkPhaseComplete(gs, io, roomCode);
        break;
      }

      // Cliente informa que errou um caractere
      case 'error': {
        player.errors++;
        player.totalErrors++;

        if (player.errors >= 3) {
          // Entrar em roleta-russa
          player.inRoulette = true;
          broadcastPlayerState(gs, io, roomCode, pid);

          // Resolver roleta no servidor imediatamente
          const roll = Math.floor(Math.random() * ROULETTE_CHANCE); // 0..5
          const eliminated = (roll === 0); // 1 em 6

          // Enviar resultado para o cliente específico (animação é visual-only)
          socket.emit('game:digite:roulette-result', {
            eliminated,
            roll,
            chance: ROULETTE_CHANCE
          });

          if (eliminated) {
            player.alive = false;
            player.inRoulette = false;
            broadcastPlayerState(gs, io, roomCode, pid);
            io.to(roomCode).emit('game:digite:player-eliminated', {
              id: pid,
              name: player.name
            });
            checkGameOver(gs, io, roomCode);
          } else {
            // Sobreviveu: após delay da animação, zera erros e volta
            // O cliente envia 'roulette-survived' quando a animação termina
          }
        } else {
          broadcastPlayerState(gs, io, roomCode, pid);
        }
        break;
      }

      // Cliente confirma que a animação de sobrevivência terminou
      case 'roulette-survived': {
        if (!player.inRoulette) break;
        player.inRoulette = false;
        player.errors = 0; // zera ciclo de erros
        // A frase atual é reiniciada no cliente (já foi resetada pelo erro)
        broadcastPlayerState(gs, io, roomCode, pid);
        break;
      }

      // Progresso parcial (para exibir nos painéis dos outros jogadores)
      case 'progress': {
        // Apenas informativo, não altera estado autoritativo
        io.to(roomCode).emit('game:digite:player-progress', {
          id: pid,
          phraseProgress: data.phraseProgress || 0
        });
        break;
      }
    }
  }
};

// ==================== LÓGICA DE FASES ====================
function startPhase(gs, io, roomCode) {
  gs.phase = 'playing';
  const phrases = getPhrasesForPhase(gs.currentPhaseIndex);

  // Resetar estado de fase para jogadores vivos
  for (const pid in gs.players) {
    const p = gs.players[pid];
    if (!p.alive) continue;
    p.currentPhraseIndex = 0;
    p.finishedCurrentPhase = false;
    // NÃO reseta erros — são acumulados na partida inteira (ciclo de 3)
  }

  io.to(roomCode).emit('game:digite:phase-start', {
    phaseIndex: gs.currentPhaseIndex,
    phaseNumber: gs.currentPhaseIndex + 1,
    totalPhrases: phrases.length,
    phrases: phrases,
    players: serializePlayers(gs)
  });
}

function checkPhaseComplete(gs, io, roomCode) {
  const alivePlayers = Object.values(gs.players).filter(p => p.alive);
  if (alivePlayers.length === 0) {
    checkGameOver(gs, io, roomCode);
    return;
  }

  const allFinished = alivePlayers.every(p => p.finishedCurrentPhase);
  if (!allFinished) return;

  // Todos os vivos terminaram a fase → avançar
  gs.currentPhaseIndex++;

  // Verificar se existem mais fases
  if (gs.currentPhaseIndex >= PHASES.length) {
    // Acabaram as fases: quem tiver menos erros totais vence
    // Ou simplesmente declarar vitória dos sobreviventes
    endGame(gs, io, roomCode);
  } else {
    // Delay antes da próxima fase
    io.to(roomCode).emit('game:digite:phase-complete', {
      nextPhaseIn: 3
    });
    gs.timer = setTimeout(() => {
      startPhase(gs, io, roomCode);
    }, 3000);
  }
}

function checkGameOver(gs, io, roomCode) {
  const alivePlayers = Object.entries(gs.players).filter(([, p]) => p.alive);
  if (alivePlayers.length <= 1) {
    endGame(gs, io, roomCode);
  }
}

function endGame(gs, io, roomCode) {
  gs.phase = 'gameover';
  if (gs.timer) { clearTimeout(gs.timer); gs.timer = null; }

  const alivePlayers = Object.entries(gs.players).filter(([, p]) => p.alive);
  const winner = alivePlayers.length === 1 ? alivePlayers[0][1].name : 'Ninguém';

  const rankings = buildFinalRankings(gs);

  io.to(roomCode).emit('game:digite:gameover', {
    winner,
    rankings
  });
}

// ==================== UTILITÁRIOS ====================
function buildFinalRankings(gs) {
  const list = [];
  for (const pid in gs.players) {
    const p = gs.players[pid];
    list.push({
      id: pid,
      name: p.name,
      alive: p.alive,
      totalErrors: p.totalErrors,
      phasesCompleted: p.completedPhases + (p.finishedCurrentPhase ? 1 : 0),
      score: p.alive ? 1000 - p.totalErrors * 10 : p.totalErrors
    });
  }
  return list.sort((a, b) => {
    // Vivos primeiro, depois por menor erro
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return a.totalErrors - b.totalErrors;
  });
}

function serializePlayers(gs) {
  const out = {};
  for (const pid in gs.players) {
    const p = gs.players[pid];
    out[pid] = {
      name: p.name,
      alive: p.alive,
      errors: p.errors,
      totalErrors: p.totalErrors,
      currentPhraseIndex: p.currentPhraseIndex,
      inRoulette: p.inRoulette,
      finishedCurrentPhase: p.finishedCurrentPhase
    };
  }
  return out;
}

function broadcastPlayerState(gs, io, roomCode, pid) {
  const p = gs.players[pid];
  if (!p) return;
  io.to(roomCode).emit('game:digite:player-update', {
    id: pid,
    alive: p.alive,
    errors: p.errors,
    totalErrors: p.totalErrors,
    currentPhraseIndex: p.currentPhraseIndex,
    inRoulette: p.inRoulette,
    finishedCurrentPhase: p.finishedCurrentPhase
  });
}

module.exports = { gameHandler };