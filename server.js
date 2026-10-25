/**
 * Hub de Jogos Multiplayer - Servidor Principal
 * Gerencia salas, jogadores, chat e jogos via Socket.IO
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});


// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// ==================== ESTADO GLOBAL ====================

const rooms = new Map();       // roomCode -> RoomState
const playerSockets = new Map(); // socketId -> { roomCode, playerName }


// ==================== UTILIDADES ====================

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function getRoomPlayers(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  return Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    isHost: p.isHost,
    connected: p.connected
  }));
}

/**
 * Cópia do gameState segura para enviar pela rede: remove timers (Timeout/Immediate), funções e
 * referências circulares. Vários jogos guardam timers no gameState (roundTimer/turnTimer...) e,
 * enviados crus, fazem o Socket.IO entrar em recursão infinita e derrubar o servidor inteiro.
 */
function safeGameState(gs) {
  if (!gs || typeof gs !== 'object') return gs || null;
  const seen = new WeakSet();
  try {
    return JSON.parse(JSON.stringify(gs, (key, value) => {
      if (typeof value === 'function') return undefined;
      if (value && typeof value === 'object') {
        const ctor = value.constructor && value.constructor.name;
        if (ctor === 'Timeout' || ctor === 'Immediate') return undefined;
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    }));
  } catch (e) {
    return { gameId: gs.gameId, phase: gs.phase };
  }
}

function broadcastRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit('room:state', {
    code: roomCode,
    players: getRoomPlayers(roomCode),
    currentGame: room.currentGame,
    gameState: safeGameState(room.gameState),
    hostId: room.hostId
  });
}

// ==================== DADOS DOS JOGOS ====================

const GAME_LIST = [
  { id: 'ritmo', name: 'Ritmo', icon: '🥁', desc: 'Ouça a batida e reproduza!', minPlayers: 1, maxPlayers: 8, color: '#ec4899' },
  { id: 'pesos-medidas', name: 'Adivinhe o Ângulo', icon: '📐', desc: 'Gire o transferidor e acerte o ângulo!', minPlayers: 1, maxPlayers: 8, color: '#00e5ff' },
  { id: 'cronometro-cego', name: 'Cronômetro Cego', icon: '⏱️', desc: 'Conte 10 segundos na cabeça.', minPlayers: 1, maxPlayers: 8, color: '#f59e0b' },
  { id: 'quem-escreveu', name: 'Quem Escreveu Isso?', icon: '✍️', desc: 'Respostas anônimas, adivinhe o autor!', minPlayers: 2, maxPlayers: 8, color: '#a855f7' },
  { id: 'ia-falsa', name: 'Imagem de IA Falsa', icon: '🖼️', desc: 'Descubra qual foto é real.', minPlayers: 1, maxPlayers: 8, color: '#10b981' },
  { id: 'consenso', name: 'Consenso', icon: '🤝', desc: 'Responda igual à maioria para ganhar!', minPlayers: 2, maxPlayers: 8, color: '#8b5cf6' },
  { id: 'quao-grande', name: 'Quão Grande É?', icon: '📏', desc: 'Estique o objeto até o tamanho real.', minPlayers: 1, maxPlayers: 8, color: '#06b6d4' },
  { id: 'temperatura', name: 'Temperatura do Grupo', icon: '🌡️', desc: 'Estime a temperatura do lugar na foto.', minPlayers: 1, maxPlayers: 8, color: '#ef4444' },
  { id: 'historia-cadeia', name: 'História em Cadeia', icon: '📖', desc: 'Uma palavra por vez! Construa uma narrativa.', minPlayers: 1, maxPlayers: 8, color: '#3b82f6' },
  { id: 'estime', name: 'Estime', icon: '📦', desc: 'Qual o tamanho desse objeto? Chute em cm!', minPlayers: 1, maxPlayers: 8, color: '#f97316' },
  { id: 'death-ball', name: 'Death Ball', icon: '💀', desc: 'Rebata a bola mortal no tempo exato. Último de pé vence!', minPlayers: 1, maxPlayers: 8, color: '#6366f1' },
  { id: 'cartas-contra-humanidade', name: 'Cartas Contra a Humanidade', icon: '🃏', desc: 'Humor ácido e absurdo! Escolha a melhor resposta.', minPlayers: 1, maxPlayers: 10, color: '#8b5cf6' },
  { id: 'digite-direito', name: 'Digite Direito', icon: '⌨️', desc: 'Battle royale de digitação: o último é eliminado e cada 4 erros puxam o gatilho.', minPlayers: 1, maxPlayers: 8, color: '#06b6d4' },
  { id: 'vem-na-mao', name: 'Vem na Mão', icon: '👊', desc: 'Briga de rua battle royale: porrada vence agarrão, agarrão vence parry, parry vence porrada.', minPlayers: 1, maxPlayers: 8, color: '#ff3d8b' }
];

// ==================== LÓGICA DE JOGOS (SERVIDOR) ====================

const gameHandlers = {};

// --- CRONÔMETRO CEGO ---
gameHandlers['cronometro-cego'] = {
  start(room, io, roomCode) {
    const targetTime = 10000; // 10 segundos em ms
    const mode = Math.random() < 0.5 ? 'conversa' : 'normal';
    room.gameState = {
      phase: 'waiting', // waiting -> counting -> results
      targetTime,
      mode,
      startTimes: {},
      results: {},
      playerCount: room.players.size
    };
    io.to(roomCode).emit('game:cronometro:start', { targetTime, mode });
  },
  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'press-start') {
      gs.startTimes[socket.id] = Date.now();
      socket.emit('game:cronometro:started');
    }

    if (data.action === 'press-stop') {
      const start = gs.startTimes[socket.id];
      if (!start) return;
      const elapsed = Date.now() - start;
      const diff = Math.abs(elapsed - gs.targetTime);
      const player = room.players.get(socket.id);
      gs.results[socket.id] = {
        name: player?.name || 'Jogador',
        elapsed,
        diff,
        accuracy: Math.max(0, 100 - (diff / gs.targetTime) * 100)
      };
      socket.emit('game:cronometro:stopped', gs.results[socket.id]);

      // Checar se todos terminaram
      if (Object.keys(gs.results).length >= gs.playerCount) {
        const sorted = Object.values(gs.results).sort((a, b) => a.diff - b.diff);
        sorted.forEach((r, i) => {
          const points = Math.round(r.accuracy);
          // Dar pontos ao jogador
          for (const [sid, p] of room.players) {
            if (p.name === r.name) {
              p.score += points;
              break;
            }
          }
          r.rank = i + 1;
          r.points = points;
        });
        gs.phase = 'results';
        io.to(roomCode).emit('game:cronometro:results', { results: sorted, mode: gs.mode });
        broadcastRoomState(roomCode);
      }
    }
  }
};

// --- CONSENSO (TORNEIO DA MENTE COLETIVA) ---
const CONSENSO_QUESTIONS = [
  // 1. Comidas & Bebidas
  { question: 'Diga uma fruta amarela indispensável na fruteira', category: 'Comida & Bebida', emoji: '🍌', botAnswers: ['banana', 'maracujá', 'abacaxi'] },
  { question: 'Diga uma comida que todo mundo pede no delivery no domingo à noite', category: 'Comida & Bebida', emoji: '🍕', botAnswers: ['pizza', 'hambúrguer', 'hambúrguer'] },
  { question: 'Diga a melhor cobertura doce para colocar num sorvete de massa', category: 'Comida & Bebida', emoji: '🍨', botAnswers: ['chocolate', 'caramelo', 'chocolate'] },
  { question: 'Diga algo indispensável no café da manhã tradicional brasileiro', category: 'Comida & Bebida', emoji: '☕', botAnswers: ['café', 'pão na chapa', 'café com leite'] },
  { question: 'Diga uma comida típica inesquecível de festa junina', category: 'Comida & Bebida', emoji: '🌽', botAnswers: ['pipoca', 'quentão', 'bolo de milho'] },
  { question: 'Diga o melhor acompanhamento para arroz e feijão', category: 'Comida & Bebida', emoji: '🥩', botAnswers: ['bife', 'batata frita', 'farofa'] },
  { question: 'Diga um vegetal verde que muitas crianças odeiam comer', category: 'Comida & Bebida', emoji: '🥦', botAnswers: ['brócolis', 'alface', 'espinafre'] },
  { question: 'Diga um sabor clássico de pizza que agrada todo mundo', category: 'Comida & Bebida', emoji: '🍕', botAnswers: ['calabresa', 'mussarela', 'margherita'] },
  { question: 'Diga a bebida que você mais pede num dia quente de praia', category: 'Comida & Bebida', emoji: '🥥', botAnswers: ['água de coco', 'cerveja', 'refrigerante'] },
  { question: 'Diga a primeira comida que vem à mente em festa de aniversário infantil', category: 'Comida & Bebida', emoji: '🎂', botAnswers: ['brigadeiro', 'coxinha', 'bolo'] },
  { question: 'Diga um ingrediente que não pode faltar num bom hambúrguer artesanal', category: 'Comida & Bebida', emoji: '🍔', botAnswers: ['queijo', 'bacon', 'hambúrguer'] },
  { question: 'Diga uma fruta vermelha muito saborosa', category: 'Comida & Bebida', emoji: '🍓', botAnswers: ['morango', 'maçã', 'cereja'] },
  { question: 'Diga uma comida que fica ainda mais gostosa no dia seguinte', category: 'Comida & Bebida', emoji: '🍝', botAnswers: ['lasanha', 'pizza', 'feijoada'] },

  // 2. Animais & Natureza
  { question: 'Diga um animal que começa com a letra C', category: 'Animais', emoji: '🐶', botAnswers: ['cachorro', 'cavalo', 'cachorro'] },
  { question: 'Diga um animal veloz que corre muito na savana', category: 'Animais', emoji: '🐆', botAnswers: ['leopardo', 'guepardo', 'leão'] },
  { question: 'Diga um animal de estimação além de cachorro e gato', category: 'Animais', emoji: '🦜', botAnswers: ['hamster', 'papagaio', 'peixe'] },
  { question: 'Diga o predador mais temido dos oceanos', category: 'Animais', emoji: '🦈', botAnswers: ['tubarão', 'baleia orca', 'tubarão branco'] },
  { question: 'Diga uma ave que não consegue voar', category: 'Animais', emoji: '🐧', botAnswers: ['pinguim', 'avestruz', 'galinha'] },
  { question: 'Diga um inseto irritante que atrapalha o sono no verão', category: 'Animais', emoji: '🦟', botAnswers: ['pernilongo', 'mosquito', 'mosca'] },
  { question: 'Diga um animal com chifres grandes', category: 'Animais', emoji: '🐂', botAnswers: ['touro', 'veado', 'alce'] },
  { question: 'Diga um animal famoso por dormir muito ou ser preguiçoso', category: 'Animais', emoji: '🦥', botAnswers: ['bicho-preguiça', 'gato', 'urso koala'] },
  { question: 'Diga um réptil assustador', category: 'Animais', emoji: '🐊', botAnswers: ['jacaré', 'crocodilo', 'cobra'] },
  { question: 'Diga um animal selvagem que você nunca gostaria de encontrar na mata', category: 'Animais', emoji: '🐻', botAnswers: ['onça', 'urso', 'lobo'] },
  { question: 'Diga um animal preto e branco', category: 'Animais', emoji: '🦓', botAnswers: ['zebra', 'panda', 'pinguim'] },

  // 3. Cotidiano & Casa
  { question: 'Diga a primeira coisa que você faz assim que acorda de manhã', category: 'Cotidiano', emoji: '⏰', botAnswers: ['olhar o celular', 'ir ao banheiro', 'escovar os dentes'] },
  { question: 'Diga algo que você sempre perde dentro de casa', category: 'Cotidiano', emoji: '🔑', botAnswers: ['chave', 'controle remoto', 'celular'] },
  { question: 'Diga algo indispensável que você nunca pode esquecer ao sair de casa', category: 'Cotidiano', emoji: '📱', botAnswers: ['celular', 'carteira', 'chave'] },
  { question: 'Diga o eletrodoméstico mais barulhento da casa', category: 'Cotidiano', emoji: '🌪️', botAnswers: ['liquidificador', 'aspirador de pó', 'máquina de lavar'] },
  { question: 'Diga a tarefa doméstica mais chata e cansativa de se fazer', category: 'Cotidiano', emoji: '🧹', botAnswers: ['lavar louça', 'passar roupa', 'limpar o banheiro'] },
  { question: 'Diga algo que sempre tem guardado na porta da geladeira', category: 'Cotidiano', emoji: '🧊', botAnswers: ['água', 'leite', 'ketchup'] },
  { question: 'Diga um item indispensável dentro de uma mochila escolar', category: 'Cotidiano', emoji: '🎒', botAnswers: ['estojo', 'caderno', 'lápis'] },
  { question: 'Diga um cômodo da casa onde você mais gosta de relaxar', category: 'Cotidiano', emoji: '🛋️', botAnswers: ['quarto', 'sala', 'varanda'] },
  { question: 'Diga um objeto que quase todo mundo tem no banheiro', category: 'Cotidiano', emoji: '🪥', botAnswers: ['escova de dentes', 'sabonete', 'toalha'] },
  { question: 'Diga uma ferramenta básica que toda casa tem na gaveta', category: 'Cotidiano', emoji: '🔨', botAnswers: ['martelo', 'chave de fenda', 'alicate'] },

  // 4. Cultura Pop, Lazer & Jogos
  { question: 'Diga um super-herói mundialmente famoso de capa ou máscara', category: 'Cultura Pop', emoji: '🦸', botAnswers: ['batman', 'homem-aranha', 'superman'] },
  { question: 'Diga um vilão clássico do cinema ou dos quadrinhos', category: 'Cultura Pop', emoji: '🦹', botAnswers: ['coringa', 'darth vader', 'thanos'] },
  { question: 'Diga um instrumento musical indispensável numa banda de rock', category: 'Cultura Pop', emoji: '🎸', botAnswers: ['guitarra', 'bateria', 'baixo'] },
  { question: 'Diga um esporte olímpico muito popular e praticado', category: 'Esportes', emoji: '⚽', botAnswers: ['futebol', 'vôlei', 'natação'] },
  { question: 'Diga um clássico jogo de tabuleiro de reunir a família', category: 'Jogos', emoji: '🎲', botAnswers: ['banco imobiliário', 'war', 'ludo'] },
  { question: 'Diga um clássico filme de animação da Disney ou Pixar', category: 'Cinema', emoji: '🎬', botAnswers: ['rei leão', 'toy story', 'shrek'] },
  { question: 'Diga um aplicativo de celular que você abre todos os dias', category: 'Tecnologia', emoji: '📲', botAnswers: ['whatsapp', 'instagram', 'youtube'] },
  { question: 'Diga um personagem lendário do mundo dos videogames', category: 'Games', emoji: '🎮', botAnswers: ['mario', 'sonic', 'pac-man'] },
  { question: 'Diga uma profissão muito respeitada que usa uniforme característico', category: 'Sociedade', emoji: '🩺', botAnswers: ['médico', 'policial', 'bombeiro'] },
  { question: 'Diga uma marca de carro muito famosa no Brasil', category: 'Veículos', emoji: '🚗', botAnswers: ['fiat', 'chevrolet', 'volkswagen'] },

  // 5. Lugares & Viagens
  { question: 'Diga um país da Europa que quase todo mundo sonha em conhecer', category: 'Viagens', emoji: '✈️', botAnswers: ['frança', 'itália', 'espanha'] },
  { question: 'Diga um estado brasileiro famoso pelas suas praias maravilhosas', category: 'Viagens', emoji: '🏖️', botAnswers: ['bahia', 'rio de janeiro', 'santa catarina'] },
  { question: 'Diga algo típico e obrigatório que você sempre encontra na praia', category: 'Lazer', emoji: '⛱️', botAnswers: ['guarda-sol', 'areia', 'mar'] },
  { question: 'Diga um meio de transporte coletivo rápido', category: 'Transporte', emoji: '🚇', botAnswers: ['metrô', 'avião', 'trem'] },
  { question: 'Diga um lugar clássico para levar alguém no primeiro encontro', category: 'Romance', emoji: '🍷', botAnswers: ['restaurante', 'cinema', 'café'] },
  { question: 'Diga uma atração imperdível de parque de diversões', category: 'Parques', emoji: '🎡', botAnswers: ['montanha-russa', 'roda-gigante', 'carrinho bate-bate'] },
  { question: 'Diga algo essencial de colocar na mala para uma viagem de férias', category: 'Viagens', emoji: '🧳', botAnswers: ['roupa', 'protetor solar', 'óculos de sol'] },

  // 6. Sensações, Cores & Situações
  { question: 'Diga uma cor muito usada para pintar a parede da sala', category: 'Cores', emoji: '🎨', botAnswers: ['branco', 'cinza', 'bege'] },
  { question: 'Diga uma palavra em inglês que quase todo brasileiro fala no dia a dia', category: 'Línguas', emoji: '💬', botAnswers: ['ok', 'show', 'feedback'] },
  { question: 'Diga algo muito comum que dá medo em crianças', category: 'Emoções', emoji: '👻', botAnswers: ['escuro', 'monstro', 'palhaço'] },
  { question: 'Diga uma desculpa clássica de quem se atrasa para um compromisso', category: 'Situações', emoji: '🚗', botAnswers: ['trânsito', 'despertador não tocou', 'pneu furou'] },
  { question: 'Diga a melhor estação do ano', category: 'Clima', emoji: '☀️', botAnswers: ['verão', 'inverno', 'primavera'] },
  { question: 'Diga um motivo comum que faz as pessoas perderem a paciência no trânsito', category: 'Trânsito', emoji: '🚦', botAnswers: ['fechada', 'sinal vermelho', 'buzina'] },
  { question: 'Diga um presente de amigo secreto que todo mundo já ganhou pelo menos uma vez', category: 'Presentes', emoji: '🎁', botAnswers: ['meia', 'caneca', 'chocolate'] }
];

// Normalização inteligente de texto em português
function normalizeConsensoText(text) {
  if (!text) return '';
  let s = text.trim().toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'!]/g, '');
  s = s.replace(/^(o|a|os|as|um|uma|uns|umas)\s+/, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) {
    s = s.slice(0, -1);
  }
  return s;
}

// Verifica similaridade para agrupar pequenas variações de digitação
function areAnswersSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length > 3 && b.length > 3) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
  }
  if (Math.abs(a.length - b.length) > 1) return false;
  let diff = 0, i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] !== b[j]) {
      diff++;
      if (diff > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    } else {
      i++; j++;
    }
  }
  return true;
}

function startConsensoRound(room, io, roomCode, roundNum) {
  const gs = room.gameState;
  if (!gs) return;

  const totalQuestions = CONSENSO_QUESTIONS.length;
  let chosenIdx;
  let attempts = 0;
  do {
    chosenIdx = Math.floor(Math.random() * totalQuestions);
    attempts++;
  } while (gs.usedIndices.has(chosenIdx) && attempts < 50);

  gs.usedIndices.add(chosenIdx);
  const qObj = CONSENSO_QUESTIONS[chosenIdx];

  // Rodada 3 é a Ovelha Negra (Anti-Consenso: seja o único a responder algo diferente!)
  const isOvelhaNegra = (roundNum === 3);
  // Rodada 4 é a Final de Ouro (2x Pontos!)
  const isGoldenRound = (roundNum === gs.totalRounds);
  const timeLimit = 35; // 35 segundos para pensar e enviar

  gs.phase = 'answering';
  gs.currentRound = roundNum;
  gs.currentQuestion = qObj;
  gs.isOvelhaNegra = isOvelhaNegra;
  gs.isGoldenRound = isGoldenRound;
  gs.answers = {};
  gs.roundEndsAt = Date.now() + timeLimit * 1000;

  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  io.to(roomCode).emit('game:consenso:question', {
    round: roundNum,
    totalRounds: gs.totalRounds,
    question: qObj.question,
    category: qObj.category,
    emoji: qObj.emoji,
    isOvelhaNegra,
    isGoldenRound,
    timeLimit
  });

  gs.roundTimer = setTimeout(() => {
    if (room.gameState && room.gameState.phase === 'answering' && room.gameState.currentRound === roundNum) {
      finalizeConsensoRound(room, io, roomCode);
    }
  }, (timeLimit + 1) * 1000);
}

function finalizeConsensoRound(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'answering') return;
  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  gs.phase = 'results';

  // Preenche respostas vazias com texto neutro
  for (const [sid, p] of room.players) {
    if (!gs.answers[sid]) {
      gs.answers[sid] = {
        sid,
        name: p.name,
        answer: 'em branco',
        rawAnswer: 'Em branco ⏱️',
        color: p.color || '#1abc9c'
      };
    }
  }

  // Se estiver testando solo com 1 jogador, adiciona 3 bots para interagir com o gráfico!
  if (room.players.size === 1) {
    const qObj = gs.currentQuestion;
    const botChoices = qObj.botAnswers || ['pizza', 'hambúrguer', 'pizza'];
    const bots = [
      { sid: 'bot_pop', name: 'Bot Popular 🤖', raw: botChoices[0], color: '#3498db' },
      { sid: 'bot_amigo', name: 'Bot Amigo 🤝', raw: botChoices[1], color: '#e67e22' },
      { sid: 'bot_clone', name: 'Bot Sincronia ⚡', raw: botChoices[2], color: '#9b59b6' }
    ];
    bots.forEach(b => {
      gs.answers[b.sid] = {
        sid: b.sid,
        name: b.name,
        answer: normalizeConsensoText(b.raw),
        rawAnswer: b.raw,
        color: b.color
      };
    });
  }

  const allAnswers = Object.values(gs.answers);

  // Agrupamento inteligente por similaridade
  // canonicalGroups: { [canonicalWord]: { count, displayWord, players: [{ name, sid, raw, color }] } }
  const canonicalGroups = {};

  allAnswers.forEach(item => {
    const norm = item.answer;
    if (!norm) return;

    let matchedKey = null;
    for (const key of Object.keys(canonicalGroups)) {
      if (areAnswersSimilar(norm, key)) {
        matchedKey = key;
        break;
      }
    }

    if (matchedKey) {
      canonicalGroups[matchedKey].count++;
      canonicalGroups[matchedKey].players.push(item);
    } else {
      canonicalGroups[norm] = {
        count: 1,
        displayWord: item.rawAnswer.charAt(0).toUpperCase() + item.rawAnswer.slice(1),
        players: [item]
      };
    }
  });

  const totalAnswered = allAnswers.length;
  const isOvelha = gs.isOvelhaNegra;
  const isGolden = gs.isGoldenRound;
  const multiplier = isGolden ? 2 : 1;

  // Verifica se houve unanimidade (100% de consenso no grupo)
  const isUnanimous = (totalAnswered > 1 && Object.keys(canonicalGroups).length === 1 && !isOvelha);
  const unanimousBonus = isUnanimous ? 25 : 0;

  // Calcula pontuação para cada jogador
  const playerScoresRound = {};

  for (const [key, group] of Object.entries(canonicalGroups)) {
    const count = group.count;
    let basePoints = 0;

    if (isOvelha) {
      // Na Ovelha Negra: quem foi o ÚNICO a dar a resposta ganha 30 pontos! Quem repetiu zera.
      basePoints = (count === 1) ? 30 : 0;
    } else {
      // No Consenso Tradicional: cada pessoa ganha (count * 15) se houve match (count > 1).
      basePoints = (count > 1) ? (count * 15) : 0;
    }

    const finalPoints = (basePoints * multiplier) + unanimousBonus;

    group.players.forEach(p => {
      playerScoresRound[p.sid] = {
        name: p.name,
        answer: p.rawAnswer,
        canonical: group.displayWord,
        matches: count,
        points: finalPoints,
        color: p.color
      };

      // Atualiza pontuação da partida e do hub
      if (!gs.gameScores) gs.gameScores = {};
      gs.gameScores[p.sid] = (gs.gameScores[p.sid] || 0) + finalPoints;
      const realP = room.players.get(p.sid);
      if (realP) realP.score += finalPoints;
    });
  }

  // Prepara lista ordenada de resultados da rodada
  const results = Object.entries(playerScoresRound).map(([sid, d]) => ({
    sid,
    name: d.name,
    answer: d.canonical,
    rawAnswer: d.answer,
    matches: d.matches,
    points: d.points,
    color: d.color
  })).sort((a, b) => b.points - a.points);

  results.forEach((r, idx) => { r.rank = idx + 1; });

  // Lista de frequências ordenada para o gráfico de barras
  const frequencies = Object.values(canonicalGroups).map(g => ({
    word: g.displayWord,
    count: g.count,
    players: g.players.map(p => ({ name: p.name, color: p.color, sid: p.sid }))
  })).sort((a, b) => b.count - a.count);

  const topAnswer = frequencies[0] || null;

  // Afinidades telepáticas: duplas que pensaram igual
  const affinities = [];
  frequencies.filter(f => f.count >= 2).forEach(f => {
    for (let i = 0; i < f.players.length; i++) {
      for (let j = i + 1; j < f.players.length; j++) {
        affinities.push({
          p1: f.players[i].name,
          p2: f.players[j].name,
          word: f.word
        });
      }
    }
  });

  const isLastRound = (gs.currentRound >= gs.totalRounds);
  const currentScores = Array.from(room.players.entries()).map(([sid, p]) => ({
    id: sid,
    name: p.name,
    color: p.color,
    score: (gs.gameScores && gs.gameScores[sid]) || 0,
    gameScore: (gs.gameScores && gs.gameScores[sid]) || 0
  })).sort((a, b) => b.score - a.score);

  io.to(roomCode).emit('game:consenso:results', {
    round: gs.currentRound,
    totalRounds: gs.totalRounds,
    question: gs.currentQuestion.question,
    category: gs.currentQuestion.category,
    emoji: gs.currentQuestion.emoji,
    isOvelhaNegra: isOvelha,
    isGoldenRound: isGolden,
    isUnanimous,
    frequencies,
    topAnswer,
    affinities,
    results,
    scores: currentScores,
    isLastRound
  });

  broadcastRoomState(roomCode);
}

gameHandlers['consenso'] = {
  start(room, io, roomCode) {
    const totalRounds = 4; // Torneio em 4 rodadas com reviravolta
    room.gameState = {
      phase: 'init',
      currentRound: 0,
      totalRounds,
      usedIndices: new Set(),
      answers: {},
      playerCount: room.players.size,
      roundTimer: null,
      gameScores: {}
    };

    startConsensoRound(room, io, roomCode, 1);
  },

  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'answer') {
      if (gs.phase !== 'answering') return;
      const player = room.players.get(socket.id);
      const rawText = (data.answer || '').trim();
      if (!rawText) return;

      gs.answers[socket.id] = {
        sid: socket.id,
        name: player?.name || 'Jogador',
        answer: normalizeConsensoText(rawText),
        rawAnswer: rawText,
        color: player?.color || '#1abc9c'
      };

      io.to(roomCode).emit('game:consenso:answered', {
        count: Object.keys(gs.answers).length,
        total: room.players.size
      });

      if (Object.keys(gs.answers).length >= room.players.size) {
        finalizeConsensoRound(room, io, roomCode);
      }
    } else if (data.action === 'next-round') {
      if (gs.phase !== 'results') return;
      if (gs.currentRound < gs.totalRounds) {
        startConsensoRound(room, io, roomCode, gs.currentRound + 1);
      } else {
        // Encerramento do Torneio
        gs.phase = 'gameover';
        const finalRankings = Array.from(room.players.entries()).map(([sid, p]) => ({
          id: sid,
          name: p.name,
          color: p.color,
          score: (gs.gameScores && gs.gameScores[sid]) || 0,
          gameScore: (gs.gameScores && gs.gameScores[sid]) || 0
        })).sort((a, b) => b.score - a.score);
        io.to(roomCode).emit('game:consenso:gameover', {
          winner: finalRankings[0]?.name || 'Campeão',
          rankings: finalRankings,
          totalRounds: gs.totalRounds
        });
        broadcastRoomState(roomCode);
      }
    }
  }
};

// --- TEMPERATURA DO GRUPO ---
gameHandlers['temperatura'] = {
  start(room, io, roomCode) {
    const locations = [
      { name: 'Deserto do Saara', temp: 50, emoji: '🏜️', hint: 'Deserto mais quente do mundo' },
      { name: 'Praia de Copacabana (Verão)', temp: 35, emoji: '🏖️', hint: 'Rio de Janeiro no auge do calor' },
      { name: 'Moscou no Inverno', temp: -15, emoji: '🏔️', hint: 'Capital russa em dezembro' },
      { name: 'Café Recém-passado', temp: 65, emoji: '☕', hint: 'Temperatura ideal para servir' },
      { name: 'Antártida', temp: -40, emoji: '🧊', hint: 'O continente mais frio' },
      { name: 'Forno de Pizza', temp: 400, emoji: '🍕', hint: 'Pizza napolitana tradicional' },
      { name: 'Superfície do Sol', temp: 5500, emoji: '☀️', hint: 'Estrela do sistema solar' },
      { name: 'Corpo Humano', temp: 37, emoji: '🧍', hint: 'Temperatura corporal média' },
      { name: 'Geladeira', temp: 4, emoji: '🧊', hint: 'Para conservar alimentos' },
      { name: 'Noite no Deserto', temp: 5, emoji: '🌙', hint: 'Surpresa: deserto à noite' },
      { name: 'Banho Quente', temp: 40, emoji: '🚿', hint: 'Temperatura agradável' },
      { name: 'Piscina de Competição', temp: 26, emoji: '🏊', hint: 'Regulamentação olímpica' },
      { name: 'Neve Derretendo', temp: 0, emoji: '❄️', hint: 'Ponto de fusão da água' },
      { name: 'São Paulo em Julho', temp: 15, emoji: '🌧️', hint: 'Inverno paulistano' },
      { name: 'Salvador no Carnaval', temp: 32, emoji: '🎭', hint: 'Festa no calor baiano' }
    ];
    const location = locations[Math.floor(Math.random() * locations.length)];
    room.gameState = {
      phase: 'guessing',
      location,
      guesses: {},
      playerCount: room.players.size
    };
    io.to(roomCode).emit('game:temperatura:start', {
      name: location.name,
      emoji: location.emoji,
      hint: location.hint
    });
  },
  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'guess') {
      const player = room.players.get(socket.id);
      const guess = parseFloat(data.value);
      if (isNaN(guess)) return;
      const diff = Math.abs(guess - gs.location.temp);
      const maxDiff = Math.abs(gs.location.temp) + 50;
      const accuracy = Math.max(0, 100 - (diff / maxDiff) * 100);

      gs.guesses[socket.id] = {
        name: player?.name || 'Jogador',
        guess,
        diff,
        accuracy
      };

      io.to(roomCode).emit('game:temperatura:guessed', {
        count: Object.keys(gs.guesses).length,
        total: gs.playerCount
      });

      if (Object.keys(gs.guesses).length >= gs.playerCount) {
        const sorted = Object.values(gs.guesses).sort((a, b) => a.diff - b.diff);
        const avgGuess = Object.values(gs.guesses).reduce((s, g) => s + g.guess, 0) / Object.keys(gs.guesses).length;

        sorted.forEach((r, i) => {
          const points = Math.round(r.accuracy);
          for (const [sid, p] of room.players) {
            if (p.name === r.name) {
              p.score += points;
              break;
            }
          }
          r.rank = i + 1;
          r.points = points;
        });

        gs.phase = 'results';
        io.to(roomCode).emit('game:temperatura:results', {
          results: sorted,
          realTemp: gs.location.temp,
          avgGuess: Math.round(avgGuess * 10) / 10,
          locationName: gs.location.name
        });
        broadcastRoomState(roomCode);
      }
    }
  }
};

// --- ESTIME ---
// --- ESTIME (SURVIVAL BATTLE ROYALE - 3 VIDAS) ---
const ESTIME_OBJECTS = [
  // 1. Cotidianos & Bolso (Centímetros)
  { name: 'Joaninha Comum', dimension: 'comprimento', value: 0.8, unit: 'cm', emoji: '🐞', category: 'Natureza', fact: 'Apesar de ter menos de 1 cm, uma única joaninha consome mais de 5.000 pulgões durante sua vida.' },
  { name: 'Moeda de R$ 1', dimension: 'diâmetro', value: 2.7, unit: 'cm', emoji: '🪙', category: 'Cotidiano', fact: 'A moeda de 1 real é bimetálica com miolo de cuproníquel e anel externo dourado de alpaca.' },
  { name: 'Clipe de Papel nº 2', dimension: 'comprimento', value: 3.3, unit: 'cm', emoji: '📎', category: 'Cotidiano', fact: 'O design clássico do clipe tipo Gem foi patenteado na Inglaterra no final do século XIX.' },
  { name: 'Palito de Fósforo', dimension: 'comprimento', value: 4.2, unit: 'cm', emoji: '🔥', category: 'Cotidiano', fact: 'O palito de fósforo moderno tem comprimento padronizado para caber com folga na caixinha de 5 cm.' },
  { name: 'Pilha AA (Pequena)', dimension: 'altura', value: 5.05, unit: 'cm', emoji: '🔋', category: 'Cotidiano', fact: 'O padrão global de 50.5 mm de altura para pilhas AA foi formalizado pela ANSI em 1947.' },
  { name: 'Chave de Casa Comum', dimension: 'comprimento', value: 6.2, unit: 'cm', emoji: '🔑', category: 'Cotidiano', fact: 'Chaves residenciais cilíndricas do padrão Yale medem entre 6.0 e 6.5 cm.' },
  { name: 'Isqueiro BIC Maxi', dimension: 'altura', value: 8.0, unit: 'cm', emoji: '🔥', category: 'Cotidiano', fact: 'O clássico isqueiro descartável Maxi da BIC contém gás suficiente para até 3.000 chamas.' },
  { name: 'Cartão de Crédito', dimension: 'comprimento', value: 8.56, unit: 'cm', emoji: '💳', category: 'Cotidiano', fact: 'O tamanho segue a norma global ISO/IEC 7810 no padrão ID-1 (85.60 mm x 53.98 mm).' },
  { name: 'Passaporte Brasileiro', dimension: 'altura', value: 12.5, unit: 'cm', emoji: '🛂', category: 'Cotidiano', fact: 'Segue a padronização mundial da ICAO para passaportes de viagem no formato B7 (88 mm x 125 mm).' },
  { name: 'Lata de Coca-Cola 350ml', dimension: 'altura', value: 12.2, unit: 'cm', emoji: '🥤', category: 'Cozinha', fact: 'O padrão internacional de latas de alumínio de 350ml (12 oz) mede exatamente 122 mm de altura.' },
  { name: 'Caneta BIC Cristal', dimension: 'comprimento com tampa', value: 14.9, unit: 'cm', emoji: '🖊️', category: 'Cotidiano', fact: 'A caneta mais famosa do mundo consegue traçar uma linha contínua de cerca de 2 a 3 km!' },
  { name: 'Barra de Chocolate 90g', dimension: 'comprimento', value: 16.5, unit: 'cm', emoji: '🍫', category: 'Cozinha', fact: 'As tradicionais barras de chocolate ao leite medem cerca de 16.5 cm de ponta a ponta.' },
  { name: 'Banana Prata Média', dimension: 'comprimento', value: 18.0, unit: 'cm', emoji: '🍌', category: 'Cozinha', fact: 'A banana curva-se naturalmente para cima enquanto cresce em busca da luz solar (geotropismo negativo).' },
  { name: 'Bola de Futebol Oficial', dimension: 'diâmetro', value: 22.0, unit: 'cm', emoji: '⚽', category: 'Esportes', fact: 'Uma bola tamanho 5 da FIFA tem circunferência oficial de 68 a 70 cm (diâmetro de 22 cm).' },
  { name: 'Folha de Papel A4', dimension: 'altura', value: 29.7, unit: 'cm', emoji: '📄', category: 'Escritório', fact: 'A proporção do padrão ISO 216 mantém a razão geométrica única de 1 para raiz quadrada de 2.' },
  { name: 'Garrafa PET de 2 Litros', dimension: 'altura', value: 32.0, unit: 'cm', emoji: '🍶', category: 'Cozinha', fact: 'Feita de polietileno tereftalato, a garrafa vazia pesa apenas cerca de 42 a 45 gramas.' },
  { name: 'Pizza Grande Padrão', dimension: 'diâmetro', value: 35.0, unit: 'cm', emoji: '🍕', category: 'Cozinha', fact: 'Uma pizza grande tradicional no Brasil tem 35 cm e é tipicamente fatiada em 8 pedaços.' },
  { name: 'Skate Street', dimension: 'comprimento do deck', value: 80.0, unit: 'cm', emoji: '🛹', category: 'Esportes', fact: 'Um shape clássico de maple mede aproximadamente 31.5 polegadas de comprimento (80 cm).' },
  { name: 'Violão Acústico 4/4', dimension: 'comprimento total', value: 100.0, unit: 'cm', emoji: '🎸', category: 'Música', fact: 'O violão clássico padrão adulto mede cerca de 100 cm da mão até a base da caixa de ressonância.' },

  // 2. Animais Médios e Gigantes (Metros)
  { name: 'Pinguim-Imperador', dimension: 'altura em pé', value: 1.15, unit: 'm', emoji: '🐧', category: 'Animais', fact: 'É a maior espécie de pinguim do planeta, suportando temperaturas antárticas de até -50°C.' },
  { name: 'Lobo Cinzento Adulto', dimension: 'comprimento do corpo', value: 1.50, unit: 'm', emoji: '🐺', category: 'Animais', fact: 'Lobos adultos podem alcançar até 60 km/h em perseguições curtas e percorrer 50 km num só dia.' },
  { name: 'Gorila das Montanhas', dimension: 'altura em pé', value: 1.75, unit: 'm', emoji: '🦍', category: 'Animais', fact: 'Apesar de ter a mesma altura de um humano adulto, seus braços abertos podem atingir 2.3 metros de envergadura!' },
  { name: 'Leão Africano Macho', dimension: 'comprimento sem cauda', value: 2.10, unit: 'm', emoji: '🦁', category: 'Animais', fact: 'O rugido de um leão macho adulto pode ser ouvido a uma impressionante distância de até 8 km.' },
  { name: 'Avestruz Africana', dimension: 'altura total', value: 2.60, unit: 'm', emoji: '🪶', category: 'Animais', fact: 'A maior ave do planeta possui olhos com 5 cm de diâmetro — maiores até do que o seu próprio cérebro!' },
  { name: 'Tigre de Bengala', dimension: 'comprimento da cabeça à cauda', value: 3.10, unit: 'm', emoji: '🐯', category: 'Animais', fact: 'As listras de cada tigre são absolutamente únicas, como as impressões digitais humanas, gravadas até na pele.' },
  { name: 'Elefante Africano Macho', dimension: 'altura até os ombros', value: 3.50, unit: 'm', emoji: '🐘', category: 'Animais', fact: 'É o maior animal terrestre vivo; suas orelhas gigantes funcionam como radiadores naturais para resfriar o sangue.' },
  { name: 'Tiranossauro Rex (T-Rex)', dimension: 'altura do quadril', value: 4.00, unit: 'm', emoji: '🦖', category: 'Dinossauros', fact: 'Apesar de ter 4 metros de altura só até o quadril, o T-Rex pesava mais de 8 toneladas e tinha dentes de 30 cm.' },
  { name: 'Tubarão Branco Adulto', dimension: 'comprimento total', value: 5.20, unit: 'm', emoji: '🦈', category: 'Animais', fact: 'Possui até 300 dentes serrilhados em várias fileiras e consegue detectar uma gota de sangue a quilômetros.' },
  { name: 'Girafa Macho Adulta', dimension: 'altura total', value: 5.50, unit: 'm', emoji: '🦒', category: 'Animais', fact: 'O animal mais alto da Terra tem um pescoço de quase 2 metros, mas com apenas 7 vértebras — igualzinho aos humanos!' },
  { name: 'Lula Gigante', dimension: 'comprimento com tentáculos', value: 12.0, unit: 'm', emoji: '🦑', category: 'Animais', fact: 'Habitante das profundezas abissais, possui olhos do tamanho de pratos de jantar (cerca de 27 cm).' },
  { name: 'T-Rex (Cabeça à Cauda)', dimension: 'comprimento total', value: 12.3, unit: 'm', emoji: '🦖', category: 'Dinossauros', fact: 'Do focinho até a ponta da cauda, o fóssil mais completo já descoberto (Sue) mede exatamente 12.3 metros.' },
  { name: 'Tubarão-Baleia', dimension: 'comprimento total', value: 18.8, unit: 'm', emoji: '🦈', category: 'Animais', fact: 'O maior peixe dos oceanos é um gigante pacífico que se alimenta exclusivamente de plâncton e pequenos peixes.' },
  { name: 'Megalodonte Pré-Histórico', dimension: 'comprimento total estimado', value: 16.0, unit: 'm', emoji: '🦈', category: 'Animais', fact: 'O predador marinho extinto tinha uma mordida com força suficiente para esmagar um carro de passeio!' },
  { name: 'Baleia-Jubarte', dimension: 'comprimento médio', value: 16.0, unit: 'm', emoji: '🐋', category: 'Animais', fact: 'Famosa pelos seus belos cantos subaquáticos, suas nadadeiras peitorais chegam a medir um terço do seu corpo.' },
  { name: 'Baleia Azul', dimension: 'comprimento total', value: 30.0, unit: 'm', emoji: '🐋', category: 'Animais', fact: 'O maior animal que já existiu na história da Terra! Sua língua pesa tanto quanto um elefante adulto inteiro.' },

  // 3. Veículos & Engenharia (Metros)
  { name: 'Carro Popular (Fusca)', dimension: 'comprimento', value: 4.07, unit: 'm', emoji: '🚗', category: 'Veículos', fact: 'O clássico Fusca foi desenhado na década de 1930 e teve mais de 21 milhões de unidades produzidas no mundo.' },
  { name: 'Caminhonete Hilux', dimension: 'comprimento total', value: 5.33, unit: 'm', emoji: '🛻', category: 'Veículos', fact: 'Uma das picapes médias mais populares do mundo, medindo mais de 5.3 metros do para-choque dianteiro à traseira.' },
  { name: 'Ônibus Urbano Convencional', dimension: 'comprimento total', value: 12.5, unit: 'm', emoji: '🚌', category: 'Veículos', fact: 'O modelo padrão de transporte coletivo urbano nas metrópoles brasileiras tem comprimento oficial de 12.5 metros.' },
  { name: 'Vagão de Trem do Metrô', dimension: 'comprimento de um vagão', value: 22.0, unit: 'm', emoji: '🚇', category: 'Veículos', fact: 'Um único carro das composições modernas do metrô tem 22 metros e capacidade para até 350 passageiros.' },
  { name: 'Avião Boeing 737-800', dimension: 'comprimento da fuselagem', value: 39.5, unit: 'm', emoji: '✈️', category: 'Veículos', fact: 'O avião comercial a jato mais vendido da história da aviação, transportando até 189 passageiros por voo.' },
  { name: 'Ônibus Espacial da NASA', dimension: 'altura acoplado ao tanque', value: 56.1, unit: 'm', emoji: '🚀', category: 'Veículos', fact: 'O sistema composto pelo orbitador, tanque externo e dois propulsores auxiliares atingia mais de 28.000 km/h.' },
  { name: 'Boeing 747 (Jumbo Jet)', dimension: 'comprimento total', value: 70.6, unit: 'm', emoji: '✈️', category: 'Veículos', fact: 'Conhecido como a Rainha dos Céus, seu andar superior característico transformou as viagens aéreas em massa.' },
  { name: 'Navio RMS Titanic', dimension: 'comprimento de proa a popa', value: 269.0, unit: 'm', emoji: '🚢', category: 'Veículos', fact: 'Quando zarpou em 1912, o Titanic era o maior objeto móvel já construído pela humanidade na história.' },

  // 4. Edifícios, Monumentos & Maravilhas do Mundo (Metros)
  { name: 'Letreiro de Hollywood', dimension: 'altura de cada letra', value: 14.0, unit: 'm', emoji: '🎬', category: 'Monumentos', fact: 'Construído em 1923 como outdoor imobiliário que dizia "HOLLYWOODLAND", tem letras com 14 metros de altura.' },
  { name: 'Cristo Redentor (Rio de Janeiro)', dimension: 'altura total com pedestal', value: 38.0, unit: 'm', emoji: '✝️', category: 'Monumentos', fact: 'Inaugurado no topo do Corcovado em 1931, sua estátua mede 30 metros sobre um pedestal de 8 metros.' },
  { name: 'Coliseu de Roma', dimension: 'altura das muralhas externas', value: 48.0, unit: 'm', emoji: '🏛️', category: 'Monumentos', fact: 'O gigantesco anfiteatro romano em formato elíptico comportava até 65.000 espectadores nos tempos dos gladiadores.' },
  { name: 'Arco do Triunfo (Paris)', dimension: 'altura total', value: 50.0, unit: 'm', emoji: '🇫🇷', category: 'Monumentos', fact: 'Encomendado por Napoleão Bonaparte em 1806 para celebrar suas vitórias militares nas guerras napoleônicas.' },
  { name: 'Torre Inclinada de Pisa', dimension: 'altura no lado mais alto', value: 56.7, unit: 'm', emoji: '🇮🇹', category: 'Monumentos', fact: 'Começou a se inclinar logo na construção em 1173 devido ao solo arenoso e argiloso instável da fundação.' },
  { name: 'Catedral da Sé (São Paulo)', dimension: 'altura das torres', value: 92.0, unit: 'm', emoji: '⛪', category: 'Monumentos', fact: 'Um dos maiores templos neogóticos do mundo ocidental, com capacidade para 8.000 fiéis sob suas duas cúpulas.' },
  { name: 'Estátua da Liberdade', dimension: 'altura do solo até a tocha', value: 93.0, unit: 'm', emoji: '🗽', category: 'Monumentos', fact: 'Presente da França aos EUA em 1886; sua estrutura metálica interna de sustentação foi projetada por Gustave Eiffel.' },
  { name: 'Big Ben (Torre Elizabeth)', dimension: 'altura total da torre', value: 96.0, unit: 'm', emoji: '🕰️', category: 'Monumentos', fact: 'O sino principal de 13.7 toneladas é o verdadeiro "Big Ben", instalado na torre do Parlamento britânico.' },
  { name: 'Campo de Futebol FIFA', dimension: 'comprimento do gramado', value: 105.0, unit: 'm', emoji: '⚽', category: 'Esportes', fact: 'O padrão internacional oficial da FIFA estabelece 105 metros de comprimento por 68 metros de largura.' },
  { name: 'Grande Pirâmide de Gizé', dimension: 'altura atual', value: 138.8, unit: 'm', emoji: '🔺', category: 'Monumentos', fact: 'Construída há mais de 4.500 anos para o faraó Quéops, foi a estrutura mais alta do mundo por mais de 3.800 anos!' },
  { name: 'Edifício Altino Arantes (Banespa)', dimension: 'altura do topo', value: 161.0, unit: 'm', emoji: '🏙️', category: 'Monumentos', fact: 'Inspirado no Empire State de NY, foi o arranha-céu de concreto armado mais alto do mundo quando inaugurado em 1947.' },
  { name: 'Golden Gate Bridge', dimension: 'altura das torres', value: 227.0, unit: 'm', emoji: '🌉', category: 'Monumentos', fact: 'As famosas torres da ponte pênsil de São Francisco erguem-se a 227 metros acima do nível das águas da baía.' },
  { name: 'Torre Eiffel (Paris)', dimension: 'altura total com antena', value: 330.0, unit: 'm', emoji: '🗼', category: 'Monumentos', fact: 'Erguida para a Exposição Universal de 1889, pode ficar até 15 cm mais alta no verão devido à dilatação térmica do ferro!' },
  { name: 'Empire State Building', dimension: 'altura do terraço', value: 381.0, unit: 'm', emoji: '🏙️', category: 'Monumentos', fact: 'Com sua antena icônica atinge 443 metros; foi construído em tempo recorde de apenas 1 ano e 45 dias em 1930.' },
  { name: 'One World Trade Center', dimension: 'altura arquitetônica', value: 541.0, unit: 'm', emoji: '🏙️', category: 'Monumentos', fact: 'Erguido no Marco Zero em Nova York, sua altura de 1.776 pés (541 m) homenageia o ano da independência dos EUA.' },
  { name: 'Burj Khalifa (Dubai)', dimension: 'altura total do topo da antena', value: 828.0, unit: 'm', emoji: '✨', category: 'Monumentos', fact: 'O prédio mais alto já construído pelo ser humano na história! Tem 163 andares e seu cume pode ser visto a 95 km de distância.' }
];

function calculateEstimeScale(realVal, unit) {
  if (unit === 'cm') {
    if (realVal <= 5) return 10;
    if (realVal <= 10) return 20;
    if (realVal <= 18) return 30;
    if (realVal <= 35) return 50;
    if (realVal <= 60) return 90;
    if (realVal <= 110) return 150;
    return Math.ceil(realVal * 1.5);
  }
  // unit === 'm'
  if (realVal <= 3) return 5;
  if (realVal <= 6) return 10;
  if (realVal <= 15) return 25;
  if (realVal <= 35) return 50;
  if (realVal <= 60) return 100;
  if (realVal <= 150) return 250;
  if (realVal <= 350) return 500;
  if (realVal <= 600) return 900;
  if (realVal <= 1000) return 1400;
  return Math.ceil(realVal * 1.5);
}

function startEstimeRound(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs) return;

  // Identifica jogadores ainda vivos
  const alivePlayers = Array.from(room.players.entries()).filter(([sid]) => (gs.lives[sid] ?? 3) > 0);

  // Se no multiplayer sobrou 1 ou nenhum, encerra imediatamente
  if (room.players.size > 1 && alivePlayers.length <= 1) {
    finalizeEstimeTournament(room, io, roomCode);
    return;
  }
  // Se no modo solo perdeu todas as vidas
  if (room.players.size === 1 && alivePlayers.length === 0) {
    finalizeEstimeTournament(room, io, roomCode);
    return;
  }

  // Sorteia objeto
  const totalObjects = ESTIME_OBJECTS.length;
  let chosenIdx;
  let attempts = 0;
  do {
    chosenIdx = Math.floor(Math.random() * totalObjects);
    attempts++;
  } while (gs.usedIndices.has(chosenIdx) && attempts < 60);

  gs.usedIndices.add(chosenIdx);
  const obj = ESTIME_OBJECTS[chosenIdx];

  const maxScale = calculateEstimeScale(obj.value, obj.unit);
  const minScale = 0;
  const timeLimit = 30; // 30 segundos por rodada

  gs.phase = 'guessing';
  gs.currentRound++;
  gs.object = obj;
  gs.maxScale = maxScale;
  gs.minScale = minScale;
  gs.guesses = {};
  gs.roundEndsAt = Date.now() + timeLimit * 1000;

  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  io.to(roomCode).emit('game:estime:start', {
    round: gs.currentRound,
    name: obj.name,
    dimension: obj.dimension,
    unit: obj.unit,
    emoji: obj.emoji,
    category: obj.category,
    minScale,
    maxScale,
    timeLimit,
    lives: gs.lives,
    aliveCount: alivePlayers.length,
    totalPlayers: room.players.size
  });

  // Timer automático da rodada
  gs.roundTimer = setTimeout(() => {
    if (room.gameState && room.gameState.phase === 'guessing') {
      finalizeEstimeRound(room, io, roomCode);
    }
  }, (timeLimit + 1) * 1000);
}

function finalizeEstimeRound(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'guessing') return;
  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  gs.phase = 'reveal';
  const realVal = gs.object.value;
  const unit = gs.object.unit;

  // Processa palpites dos jogadores vivos
  const alivePlayers = Array.from(room.players.entries()).filter(([sid]) => (gs.lives[sid] ?? 3) > 0);
  const results = [];

  for (const [sid, p] of alivePlayers) {
    const playerGuessData = gs.guesses[sid];
    let guessVal = playerGuessData ? playerGuessData.guess : null;
    let diff, pctErr, accuracy, isBullseye, points;

    if (guessVal === null || isNaN(guessVal)) {
      guessVal = null;
      diff = 999999;
      pctErr = 999;
      accuracy = 0;
      isBullseye = false;
      points = 0;
    } else {
      diff = Math.abs(guessVal - realVal);
      pctErr = (diff / realVal) * 100;
      accuracy = Math.max(0, 100 - pctErr);
      isBullseye = (pctErr <= 3.0);
      points = Math.round(accuracy) + (isBullseye ? 25 : 0);
    }

    results.push({
      sid,
      name: p.name,
      guess: guessVal,
      diff: diff !== 999999 ? Math.round(diff * 100) / 100 : null,
      pctErr: diff !== 999999 ? Math.round(pctErr * 10) / 10 : 999,
      accuracy: Math.round(accuracy),
      isBullseye,
      points,
      lives: gs.lives[sid] ?? 3,
      color: p.color || '#7c6aff'
    });
  }

  // Ordena por erro percentual crescente (melhor precisão em 1º)
  results.sort((a, b) => {
    if (a.diff === null && b.diff === null) return 0;
    if (a.diff === null) return 1;
    if (b.diff === null) return -1;
    return a.pctErr - b.pctErr;
  });

  results.forEach((r, idx) => {
    r.rank = idx + 1;
    if (!gs.gameScores) gs.gameScores = {};
    gs.gameScores[r.sid] = (gs.gameScores[r.sid] || 0) + r.points;
    const p = room.players.get(r.sid);
    if (p) p.score += r.points;
  });

  // Determinar quem perde vida nesta rodada
  let loserSid = null;
  let loserName = null;
  let loserDied = false;

  if (room.players.size > 1 && results.length > 1) {
    // Último colocado da rodada perde 1 vida!
    const worst = results[results.length - 1];
    loserSid = worst.sid;
    loserName = worst.name;
    gs.lives[worst.sid] = Math.max(0, (gs.lives[worst.sid] ?? 3) - 1);
    worst.lives = gs.lives[worst.sid];
    if (gs.lives[worst.sid] === 0) {
      loserDied = true;
    }
  } else if (room.players.size === 1 && results.length === 1) {
    // Modo solo: perde vida se errar mais de 30% do valor real
    const solo = results[0];
    if (solo.pctErr > 30 || solo.guess === null) {
      loserSid = solo.sid;
      loserName = solo.name;
      gs.lives[solo.sid] = Math.max(0, (gs.lives[solo.sid] ?? 3) - 1);
      solo.lives = gs.lives[solo.sid];
      if (gs.lives[solo.sid] === 0) loserDied = true;
    }
  }

  // Contagem de sobreviventes após a perda de vida
  const stillAlive = Array.from(room.players.entries()).filter(([sid]) => (gs.lives[sid] ?? 3) > 0);
  const isGameOver = (room.players.size > 1 && stillAlive.length <= 1) || (room.players.size === 1 && stillAlive.length === 0);
  const winnerName = stillAlive.length === 1 ? stillAlive[0][1].name : (stillAlive[0] ? stillAlive[0][1].name : (results[0]?.name || 'Ninguém'));

  io.to(roomCode).emit('game:estime:reveal', {
    round: gs.currentRound,
    objectName: gs.object.name,
    dimension: gs.object.dimension,
    realValue: realVal,
    unit: gs.object.unit,
    fact: gs.object.fact,
    emoji: gs.object.emoji,
    minScale: gs.minScale,
    maxScale: gs.maxScale,
    results,
    lives: gs.lives,
    loserSid,
    loserName,
    loserDied,
    isGameOver,
    winnerName,
    stillAliveCount: stillAlive.length
  });

  broadcastRoomState(roomCode);
}

function finalizeEstimeTournament(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs) return;
  gs.phase = 'gameover';

  const rankings = Array.from(room.players.entries()).map(([sid, p]) => ({
    sid,
    name: p.name,
    score: (gs.gameScores && gs.gameScores[sid]) || 0,
    gameScore: (gs.gameScores && gs.gameScores[sid]) || 0,
    lives: gs.lives[sid] ?? 0,
    alive: (gs.lives[sid] ?? 0) > 0
  })).sort((a, b) => {
    // Vivos na frente, depois por vidas restantes, depois por pontuação da partida
    if (a.alive && !b.alive) return -1;
    if (!a.alive && b.alive) return 1;
    if (b.lives !== a.lives) return b.lives - a.lives;
    return b.score - a.score;
  });

  const winner = rankings[0]?.name || 'Campeão';

  io.to(roomCode).emit('game:estime:gameover', {
    winner,
    rankings,
    totalRounds: gs.currentRound
  });

  broadcastRoomState(roomCode);
}

gameHandlers['estime'] = {
  start(room, io, roomCode) {
    room.gameState = {
      phase: 'init',
      currentRound: 0,
      usedIndices: new Set(),
      lives: {},
      playerCount: room.players.size,
      object: null,
      guesses: {},
      gameScores: {},
      roundTimer: null
    };

    // Todos os jogadores começam com exatamente 3 vidas
    for (const [sid] of room.players) {
      room.gameState.lives[sid] = 3;
    }

    startEstimeRound(room, io, roomCode);
  },

  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'guess') {
      if (gs.phase !== 'guessing') return;
      // Jogador eliminado não pode enviar palpite
      if ((gs.lives[socket.id] ?? 0) <= 0) return;

      const player = room.players.get(socket.id);
      const guess = parseFloat(data.value);
      if (isNaN(guess) || guess < 0) return;

      gs.guesses[socket.id] = {
        sid: socket.id,
        name: player?.name || 'Jogador',
        guess: Math.round(guess * 100) / 100
      };

      const alivePlayers = Array.from(room.players.keys()).filter(sid => (gs.lives[sid] ?? 3) > 0);

      io.to(roomCode).emit('game:estime:guessed', {
        count: Object.keys(gs.guesses).length,
        total: alivePlayers.length
      });

      // Se todos os jogadores vivos enviaram o palpite, finaliza na hora!
      if (Object.keys(gs.guesses).length >= alivePlayers.length) {
        finalizeEstimeRound(room, io, roomCode);
      }
    } else if (data.action === 'next-round') {
      if (gs.phase !== 'reveal') return;

      const alivePlayers = Array.from(room.players.keys()).filter(sid => (gs.lives[sid] ?? 3) > 0);
      const isGameOver = (room.players.size > 1 && alivePlayers.length <= 1) || (room.players.size === 1 && alivePlayers.length === 0);

      if (isGameOver) {
        finalizeEstimeTournament(room, io, roomCode);
      } else {
        startEstimeRound(room, io, roomCode);
      }
    }
  }
};

// --- ADIVINHE O ÂNGULO (MEMORIZE O PONTEIRO E REPRODUZA) ---
function startAnguloRound(room, io, roomCode, roundNum) {
  const gs = room.gameState;
  if (!gs) return;

  // Ângulo alvo aleatório entre 15° e 165° (sem números para os jogadores)
  const targetAngle = Math.round((Math.random() * 150 + 15) * 10) / 10;

  gs.phase = 'showing';
  gs.currentRound = roundNum;
  gs.targetAngle = targetAngle;
  gs.guesses = {};

  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  // 1. Fase de Exibição / Memorização (2.5s com o ponteiro na posição)
  const showDuration = 2500;
  io.to(roomCode).emit('game:angulo:show', {
    round: roundNum,
    totalRounds: gs.totalRounds,
    targetAngle,
    showDuration
  });

  // 2. Após a exibição, o ponteiro de referência some e os jogadores ajustam
  gs.roundTimer = setTimeout(() => {
    if (!room.gameState || room.gameState.currentRound !== roundNum) return;
    gs.phase = 'guessing';
    const timeLimit = 15;
    gs.roundEndsAt = Date.now() + timeLimit * 1000;

    io.to(roomCode).emit('game:angulo:guess-phase', {
      round: roundNum,
      totalRounds: gs.totalRounds,
      timeLimit
    });

    gs.roundTimer = setTimeout(() => {
      if (room.gameState && room.gameState.phase === 'guessing' && room.gameState.currentRound === roundNum) {
        finalizeAnguloRound(room, io, roomCode);
      }
    }, (timeLimit + 1) * 1000);
  }, showDuration + 200);
}

function finalizeAnguloRound(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'guessing') return;
  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  gs.phase = 'results';
  const target = gs.targetAngle;

  // Preenche quem não palpitou com 90°
  for (const [sid, p] of room.players) {
    if (gs.guesses[sid] === undefined) {
      gs.guesses[sid] = {
        sid,
        name: p.name,
        guess: 90,
        color: p.color || '#00e5ff'
      };
    }
  }

  // Se teste solo (1 jogador na sala), simula 2 bots para visualização das linhas
  if (room.players.size === 1) {
    const bots = [
      { sid: 'bot_1', name: 'Bot Olho Clínico 👁️', offset: (Math.random() < 0.5 ? 1 : -1) * (Math.floor(Math.random() * 4) + 1.2), color: '#3498db' },
      { sid: 'bot_2', name: 'Bot Quase Lá 🎯', offset: (Math.random() < 0.5 ? 1 : -1) * (Math.floor(Math.random() * 9) + 4.5), color: '#e67e22' }
    ];
    bots.forEach(b => {
      const bGuess = Math.max(0, Math.min(180, Math.round((target + b.offset) * 10) / 10));
      gs.guesses[b.sid] = {
        sid: b.sid,
        name: b.name,
        guess: bGuess,
        color: b.color
      };
    });
  }

  // Calcula desvios e pontuações
  const results = Object.values(gs.guesses).map(item => {
    const guess = Math.round(item.guess * 10) / 10;
    const diff = Math.round(Math.abs(guess - target) * 10) / 10;
    const isBullseye = (diff <= 1.5);

    let points = 0;
    if (diff <= 1.0) points = 150;       // Na mosca absoluta!
    else if (diff <= 2.5) points = 120;  // Quase perfeito
    else if (diff <= 5.0) points = 95;   // Ótimo olho
    else if (diff <= 10.0) points = 75;  // Bom
    else if (diff <= 20.0) points = 50;  // Regular
    else points = Math.max(10, Math.round(35 - (diff - 20) * 0.5));

    const realPlayer = room.players.get(item.sid);
    if (realPlayer) {
      if (!gs.gameScores) gs.gameScores = {};
      gs.gameScores[item.sid] = (gs.gameScores[item.sid] || 0) + points;
      realPlayer.score += points;
      if (!realPlayer.angleDiffs) realPlayer.angleDiffs = [];
      realPlayer.angleDiffs.push(diff);
    }

    return {
      sid: item.sid,
      name: item.name,
      guess,
      diff,
      points,
      color: item.color,
      isBullseye
    };
  }).sort((a, b) => a.diff - b.diff);

  results.forEach((r, idx) => { r.rank = idx + 1; });

  const isGameOver = (gs.currentRound >= gs.totalRounds);
  const currentScores = Array.from(room.players.entries()).map(([sid, p]) => ({
    id: sid,
    name: p.name,
    color: p.color,
    score: (gs.gameScores && gs.gameScores[sid]) || 0,
    gameScore: (gs.gameScores && gs.gameScores[sid]) || 0
  })).sort((a, b) => b.score - a.score);

  io.to(roomCode).emit('game:angulo:results', {
    round: gs.currentRound,
    totalRounds: gs.totalRounds,
    targetAngle: target,
    results,
    scores: currentScores,
    isGameOver
  });

  broadcastRoomState(roomCode);
}

gameHandlers['pesos-medidas'] = {
  start(room, io, roomCode) {
    const totalRounds = 5;
    room.gameState = {
      phase: 'init',
      currentRound: 0,
      totalRounds,
      targetAngle: 90,
      guesses: {},
      playerCount: room.players.size,
      roundTimer: null,
      gameScores: {}
    };

    for (const [, p] of room.players) {
      p.angleDiffs = [];
    }

    startAnguloRound(room, io, roomCode, 1);
  },

  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'guess') {
      if (gs.phase !== 'guessing') return;
      const player = room.players.get(socket.id);
      const angleVal = parseFloat(data.value);
      if (isNaN(angleVal)) return;

      const clamped = Math.max(0, Math.min(180, Math.round(angleVal * 10) / 10));

      gs.guesses[socket.id] = {
        sid: socket.id,
        name: player?.name || 'Jogador',
        guess: clamped,
        color: player?.color || '#00e5ff'
      };

      io.to(roomCode).emit('game:angulo:guessed', {
        count: Object.keys(gs.guesses).length,
        total: room.players.size
      });

      if (Object.keys(gs.guesses).length >= room.players.size) {
        finalizeAnguloRound(room, io, roomCode);
      }
    } else if (data.action === 'next-round') {
      if (gs.phase !== 'results') return;
      if (gs.currentRound < gs.totalRounds) {
        startAnguloRound(room, io, roomCode, gs.currentRound + 1);
      } else {
        gs.phase = 'gameover';
        const finalRankings = Array.from(room.players.entries()).map(([sid, p]) => {
          const diffs = p.angleDiffs || [10];
          const avgDiff = Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10;
          return {
            id: sid,
            name: p.name,
            score: (gs.gameScores && gs.gameScores[sid]) || 0,
            gameScore: (gs.gameScores && gs.gameScores[sid]) || 0,
            color: p.color,
            avgDiff
          };
        }).sort((a, b) => b.score - a.score);

        io.to(roomCode).emit('game:angulo:gameover', {
          winner: finalRankings[0]?.name || 'Campeão',
          rankings: finalRankings,
          totalRounds: gs.totalRounds
        });
        broadcastRoomState(roomCode);
      }
    }
  }
};

gameHandlers['adivinhe-angulo'] = gameHandlers['pesos-medidas'];


// --- MAPA DE TIMERS SEGUROS DO RITMO (Evita recursão no Socket.io) ---
const ritmoTimers = new Map();

function clearRitmoTimer(roomCode) {
  const t = ritmoTimers.get(roomCode);
  if (t) {
    clearTimeout(t);
    ritmoTimers.delete(roomCode);
  }
}

function setRitmoTimer(roomCode, fn, delay) {
  clearRitmoTimer(roomCode);
  const t = setTimeout(() => {
    ritmoTimers.delete(roomCode);
    fn();
  }, delay);
  ritmoTimers.set(roomCode, t);
}

// --- ARQUÉTIPOS RÍTMICOS MUSICAIS VARIADOS (7 NÍVEIS, 4 ATÉ 11 BATIDAS, MULTI-INSTRUMENTOS) ---
// Cadência musical equilibrada (85 a 115 BPM) para ser divertido, nítido e humanamente possível de tocar!
const RHYTHM_ARCHETYPES = [
  // NÍVEL 1: Aquecimento (4 a 5 Batidas)
  {
    level: 1,
    name: '🎸 Rock Clássico (Tum-Tum-Pá)',
    bpmRange: [85, 100],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'kick' },
      { step: 1.0, inst: 'snare' },
      { step: 2.0, inst: 'kick' },
      { step: 2.5, inst: 'snare' }
    ]
  },
  {
    level: 1,
    name: '🔥 Funk Carioca (Tum-Pá-Tchá)',
    bpmRange: [92, 106],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.75, inst: 'snare' },
      { step: 1.5, inst: 'kick' },
      { step: 2.25, inst: 'snare' },
      { step: 3.0, inst: 'hihat' }
    ]
  },
  {
    level: 1,
    name: '🌴 Dembow Latino Suave',
    bpmRange: [88, 102],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.75, inst: 'snare' },
      { step: 1.5, inst: 'kick' },
      { step: 2.25, inst: 'snare' }
    ]
  },
  {
    level: 1,
    name: '⏸️ Pausa Dramática (Pegadinha!)',
    bpmRange: [85, 100],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.75, inst: 'snare' },
      { step: 1.5, inst: 'kick' },
      { step: 3.0, inst: 'snare' }
    ]
  },

  // NÍVEL 2: No Groove (5 a 6 Batidas)
  {
    level: 2,
    name: '🪘 Clave de Samba & Pandeiro',
    bpmRange: [90, 106],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.75, inst: 'tom' },
      { step: 1.5, inst: 'snare' },
      { step: 2.25, inst: 'tom' },
      { step: 3.0, inst: 'snare' },
      { step: 3.75, inst: 'hihat' }
    ]
  },
  {
    level: 2,
    name: '🌵 Baião & Forró Nordestino',
    bpmRange: [88, 104],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.75, inst: 'hihat' },
      { step: 1.25, inst: 'tom' },
      { step: 2.0, inst: 'kick' },
      { step: 2.75, inst: 'snare' },
      { step: 3.5, inst: 'hihat' }
    ]
  },
  {
    level: 2,
    name: '👏 Palmas de Torcida & Bateria',
    bpmRange: [92, 108],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'kick' },
      { step: 1.25, inst: 'snare' },
      { step: 2.0, inst: 'snare' },
      { step: 2.75, inst: 'kick' },
      { step: 3.5, inst: 'snare' }
    ]
  },
  {
    level: 2,
    name: '⚡ Trap 808 Espaçado',
    bpmRange: [85, 100],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'hihat' },
      { step: 1.0, inst: 'snare' },
      { step: 1.75, inst: 'kick' },
      { step: 2.5, inst: 'snare' },
      { step: 3.25, inst: 'hihat' }
    ]
  },

  // NÍVEL 3: Síncope Musical (6 a 7 Batidas)
  {
    level: 3,
    name: '💃 Rumba & Flamenco Gitano',
    bpmRange: [90, 105],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.6, inst: 'snare' },
      { step: 1.2, inst: 'kick' },
      { step: 1.8, inst: 'tom' },
      { step: 2.4, inst: 'snare' },
      { step: 3.0, inst: 'hihat' },
      { step: 3.6, inst: 'kick' }
    ]
  },
  {
    level: 3,
    name: '🌴 Reggae One Drop & Bob Marley',
    bpmRange: [85, 98],
    pattern: [
      { step: 0, inst: 'hihat' },
      { step: 0.75, inst: 'hihat' },
      { step: 1.5, inst: 'snare' },
      { step: 2.25, inst: 'hihat' },
      { step: 3.0, inst: 'kick' },
      { step: 3.5, inst: 'snare' },
      { step: 4.25, inst: 'hihat' }
    ]
  },
  {
    level: 3,
    name: '🛑 Frenagem com Aceleração Dupla',
    bpmRange: [88, 104],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.8, inst: 'snare' },
      { step: 1.6, inst: 'hihat' },
      { step: 2.2, inst: 'tom' },
      { step: 2.7, inst: 'snare' },
      { step: 3.3, inst: 'kick' },
      { step: 3.9, inst: 'hihat' }
    ]
  },

  // NÍVEL 4: Viradas Pop & Rock (7 a 8 Batidas)
  {
    level: 4,
    name: '🥁 Virada Clássica de Pop Rock',
    bpmRange: [92, 108],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.6, inst: 'hihat' },
      { step: 1.2, inst: 'snare' },
      { step: 1.8, inst: 'tom' },
      { step: 2.3, inst: 'tom' },
      { step: 2.8, inst: 'snare' },
      { step: 3.4, inst: 'kick' },
      { step: 4.0, inst: 'hihat' }
    ]
  },
  {
    level: 4,
    name: '🪩 Disco Funk 70s Dançante',
    bpmRange: [95, 110],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'hihat' },
      { step: 1.0, inst: 'snare' },
      { step: 1.5, inst: 'hihat' },
      { step: 2.0, inst: 'kick' },
      { step: 2.5, inst: 'hihat' },
      { step: 3.0, inst: 'snare' },
      { step: 3.6, inst: 'tom' }
    ]
  },
  {
    level: 4,
    name: '📻 Lo-Fi Hip Hop & Conga Suave',
    bpmRange: [86, 100],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.6, inst: 'hihat' },
      { step: 1.2, inst: 'snare' },
      { step: 1.8, inst: 'tom' },
      { step: 2.4, inst: 'tom' },
      { step: 3.0, inst: 'snare' },
      { step: 3.6, inst: 'kick' }
    ]
  },

  // NÍVEL 5: Ritmo Dinâmico (8 a 9 Batidas)
  {
    level: 5,
    name: '🪘 Maracatu do Recife & Alfaias',
    bpmRange: [90, 106],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'kick' },
      { step: 1.1, inst: 'tom' },
      { step: 1.6, inst: 'snare' },
      { step: 2.2, inst: 'kick' },
      { step: 2.7, inst: 'tom' },
      { step: 3.2, inst: 'tom' },
      { step: 3.8, inst: 'snare' },
      { step: 4.3, inst: 'hihat' }
    ]
  },
  {
    level: 5,
    name: '🏎️ Breakbeat Cadenciado & Groove',
    bpmRange: [94, 110],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'hihat' },
      { step: 1.1, inst: 'snare' },
      { step: 1.6, inst: 'kick' },
      { step: 2.2, inst: 'hihat' },
      { step: 2.7, inst: 'snare' },
      { step: 3.3, inst: 'kick' },
      { step: 3.9, inst: 'snare' }
    ]
  },
  {
    level: 5,
    name: '🔥 Funk Melody 90s',
    bpmRange: [95, 112],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'hihat' },
      { step: 1.0, inst: 'snare' },
      { step: 1.6, inst: 'kick' },
      { step: 2.1, inst: 'kick' },
      { step: 2.6, inst: 'snare' },
      { step: 3.2, inst: 'tom' },
      { step: 3.7, inst: 'hihat' },
      { step: 4.2, inst: 'kick' }
    ]
  },

  // NÍVEL 6: Complexidade Rítmica & Polirritmia (9 a 10 Batidas)
  {
    level: 6,
    name: '🌍 Afrobeat & Polirritmia de Congas',
    bpmRange: [92, 108],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'tom' },
      { step: 1.0, inst: 'hihat' },
      { step: 1.5, inst: 'snare' },
      { step: 2.1, inst: 'tom' },
      { step: 2.6, inst: 'tom' },
      { step: 3.1, inst: 'snare' },
      { step: 3.7, inst: 'kick' },
      { step: 4.2, inst: 'hihat' },
      { step: 4.7, inst: 'snare' }
    ]
  },
  {
    level: 6,
    name: '🎺 Bateria de Escola de Samba Master',
    bpmRange: [95, 112],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'tom' },
      { step: 1.0, inst: 'snare' },
      { step: 1.5, inst: 'tom' },
      { step: 2.0, inst: 'hihat' },
      { step: 2.5, inst: 'kick' },
      { step: 3.0, inst: 'snare' },
      { step: 3.5, inst: 'tom' },
      { step: 4.0, inst: 'snare' },
      { step: 4.6, inst: 'kick' }
    ]
  },
  {
    level: 6,
    name: '⚡ Trap 808 com Virada de Conga',
    bpmRange: [90, 106],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'hihat' },
      { step: 1.0, inst: 'snare' },
      { step: 1.6, inst: 'kick' },
      { step: 2.1, inst: 'tom' },
      { step: 2.6, inst: 'tom' },
      { step: 3.1, inst: 'snare' },
      { step: 3.6, inst: 'hihat' },
      { step: 4.1, inst: 'kick' }
    ]
  },

  // NÍVEL 7: O Grande Solo Épico (Boss Final - 10 a 11 Batidas)
  {
    level: 7,
    name: '👑 O Grande Solo Épico de Bateria (Grande Final)',
    bpmRange: [94, 112],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'snare' },
      { step: 1.0, inst: 'hihat' },
      { step: 1.5, inst: 'kick' },
      { step: 2.0, inst: 'kick' },
      { step: 2.5, inst: 'snare' },
      { step: 3.0, inst: 'tom' },
      { step: 3.5, inst: 'tom' },
      { step: 4.0, inst: 'snare' },
      { step: 4.5, inst: 'kick' },
      { step: 5.1, inst: 'hihat' }
    ]
  },
  {
    level: 7,
    name: '🌪️ Virada Lendária de Heavy Rock',
    bpmRange: [95, 114],
    pattern: [
      { step: 0, inst: 'kick' },
      { step: 0.5, inst: 'kick' },
      { step: 1.0, inst: 'snare' },
      { step: 1.6, inst: 'tom' },
      { step: 2.1, inst: 'tom' },
      { step: 2.6, inst: 'tom' },
      { step: 3.1, inst: 'snare' },
      { step: 3.6, inst: 'kick' },
      { step: 4.1, inst: 'kick' },
      { step: 4.6, inst: 'snare' },
      { step: 5.2, inst: 'hihat' }
    ]
  },
  {
    level: 7,
    name: '🥁 Marcha Imperial Triunfal',
    bpmRange: [92, 108],
    pattern: [
      { step: 0, inst: 'snare' },
      { step: 0.5, inst: 'snare' },
      { step: 1.1, inst: 'tom' },
      { step: 1.6, inst: 'tom' },
      { step: 2.2, inst: 'kick' },
      { step: 2.7, inst: 'kick' },
      { step: 3.3, inst: 'snare' },
      { step: 3.8, inst: 'snare' },
      { step: 4.4, inst: 'kick' },
      { step: 5.0, inst: 'hihat' }
    ]
  }
];

function generateMusicalRhythm(roundNum = 1) {
  // Filtra por nível adequado para a rodada (1 a 7)
  const targetLevel = Math.max(1, Math.min(7, roundNum));
  let candidates = RHYTHM_ARCHETYPES.filter(a => a.level === targetLevel);
  if (candidates.length === 0) {
    candidates = RHYTHM_ARCHETYPES;
  }

  const tpl = candidates[Math.floor(Math.random() * candidates.length)];
  const bpm = Math.floor(Math.random() * (tpl.bpmRange[1] - tpl.bpmRange[0] + 1)) + tpl.bpmRange[0];
  const beatDurationMs = (60 / bpm) * 1000;
  const swing = (Math.random() - 0.5) * 0.05;

  const beats = [];
  const instruments = [];
  tpl.pattern.forEach((p, idx) => {
    let t = 0;
    if (idx > 0) {
      const adjustedStep = (idx % 2 === 1) ? p.step + swing : p.step;
      t = Math.round(adjustedStep * beatDurationMs);
    }
    beats.push(t);
    instruments.push(p.inst || 'kick');
  });

  const uniqueInstruments = [...new Set(instruments)];

  return {
    name: tpl.name,
    bpm,
    beats,
    instruments,
    uniqueInstruments,
    beatCount: beats.length,
    listenDuration: beats[beats.length - 1] + 1200
  };
}

// --- RITMO (Sistema de 7 Rodadas Competitivas com Grande Variedade e Instrumentos) ---
gameHandlers['ritmo'] = {
  start(room, io, roomCode) {
    clearRitmoTimer(roomCode);

    room.gameState = {
      phase: 'listening',
      currentRound: 1,
      totalRounds: 7,
      rhythm: null,
      beats: [],
      instruments: [],
      submissions: {},
      playerCount: room.players.size,
      gameScores: {}
    };

    this.startRound(room, io, roomCode);
  },

  startRound(room, io, roomCode) {
    const gs = room.gameState;
    if (!gs) return;

    clearRitmoTimer(roomCode);

    const rhythm = generateMusicalRhythm(gs.currentRound);
    gs.rhythm = rhythm;
    gs.beats = rhythm.beats;
    gs.instruments = rhythm.instruments;
    gs.submissions = {};
    gs.phase = 'listening';
    gs.playerCount = room.players.size;

    io.to(roomCode).emit('game:ritmo:round-start', {
      round: gs.currentRound,
      totalRounds: gs.totalRounds,
      genreName: rhythm.name,
      bpm: rhythm.bpm,
      beats: rhythm.beats,
      instruments: rhythm.instruments,
      uniqueInstruments: rhythm.uniqueInstruments,
      beatCount: rhythm.beatCount,
      listenDuration: rhythm.listenDuration
    });

    // Transição para a fase de reprodução
    setRitmoTimer(roomCode, () => {
      if (room.gameState && room.gameState.phase === 'listening') {
        room.gameState.phase = 'tapping';
        io.to(roomCode).emit('game:ritmo:tap-phase', {
          beatCount: rhythm.beatCount,
          uniqueInstruments: rhythm.uniqueInstruments,
          timeoutMs: rhythm.beats[rhythm.beats.length - 1] + 7500
        });

        // Timeout de segurança para caso alguém não submeta
        setRitmoTimer(roomCode, () => {
          if (room.gameState && room.gameState.phase === 'tapping') {
            this.finalizeRound(room, io, roomCode);
          }
        }, rhythm.beats[rhythm.beats.length - 1] + 9500);
      }
    }, rhythm.listenDuration + 450);
  },

  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'submit-taps' && gs.phase === 'tapping') {
      const player = room.players.get(socket.id);
      const rawTaps = data.taps || [];

      // Normaliza taps caso venha no formato de objetos { time, inst } ou números simples
      const taps = rawTaps.map(t => {
        if (typeof t === 'number') return { time: t, inst: 'kick' };
        return { time: t.time || 0, inst: t.inst || 'kick' };
      });

      // Calcular desvio milimétrico de tempo e concordância de instrumentos
      let totalDiff = 0;
      const maxBeats = Math.min(taps.length, gs.beats.length);

      for (let i = 0; i < maxBeats; i++) {
        const timeDiff = Math.abs(taps[i].time - gs.beats[i]);
        // Bônus/penalidade para o instrumento correto
        const expectedInst = gs.instruments[i] || 'kick';
        const instPenalty = (taps[i].inst === expectedInst) ? 0 : 70; // Penalidade leve se acertar o tempo mas errar o instrumento

        totalDiff += timeDiff + instPenalty;
      }

      // Penalidade por batidas faltantes ou excedentes
      const missingBeats = Math.abs(taps.length - gs.beats.length);
      totalDiff += missingBeats * 240;

      const avgDiff = Math.round(totalDiff / gs.beats.length);
      const accuracy = Math.max(0, Math.min(100, Math.round(100 - (avgDiff / 5.2))));

      let title = '🎵 No Ritmo';
      if (accuracy >= 92) title = '👑 Metrônomo Humano';
      else if (accuracy >= 80) title = '🥁 Baterista Lendário';
      else if (accuracy >= 65) title = '⚡ No Groove';
      else if (accuracy >= 45) title = '🐢 Meio Desafinado';
      else title = '🤡 Inimigo do Ritmo';

      gs.submissions[socket.id] = {
        id: socket.id,
        name: player?.name || 'Jogador',
        taps,
        avgDiff,
        accuracy,
        title
      };

      io.to(roomCode).emit('game:ritmo:submitted', {
        count: Object.keys(gs.submissions).length,
        total: gs.playerCount
      });

      // Se todos os jogadores submeteram, finaliza a rodada imediatamente
      if (Object.keys(gs.submissions).length >= gs.playerCount) {
        clearRitmoTimer(roomCode);
        this.finalizeRound(room, io, roomCode);
      }
    }

    if (data.action === 'next-round' && gs.phase === 'results') {
      const player = room.players.get(socket.id);
      if (player && (player.isHost || room.hostId === socket.id)) {
        clearRitmoTimer(roomCode);
        if (gs.currentRound < gs.totalRounds) {
          gs.currentRound++;
          this.startRound(room, io, roomCode);
        }
      }
    }
  },

  finalizeRound(room, io, roomCode) {
    const gs = room.gameState;
    if (!gs) return;
    clearRitmoTimer(roomCode);

    gs.phase = 'results';

    // Ordenar participantes da rodada por precisão
    const sorted = Object.values(gs.submissions).sort((a, b) => b.accuracy - a.accuracy);

    // Distribuir pontos da rodada
    sorted.forEach((r, i) => {
      let roundPts = 35;
      if (i === 0) roundPts = 100;
      else if (i === 1) roundPts = 70;
      else if (i === 2) roundPts = 50;

      const accuracyBonus = Math.round(r.accuracy * 0.35);
      const totalRoundPoints = roundPts + accuracyBonus;

      if (!gs.gameScores) gs.gameScores = {};
      gs.gameScores[r.id] = (gs.gameScores[r.id] || 0) + totalRoundPoints;

      const p = room.players.get(r.id);
      if (p) p.score += totalRoundPoints;

      r.rank = i + 1;
      r.pointsEarned = totalRoundPoints;
      r.currentTotalScore = gs.gameScores[r.id];
    });

    const isGameOver = (gs.currentRound >= gs.totalRounds);

    io.to(roomCode).emit('game:ritmo:round-results', {
      round: gs.currentRound,
      totalRounds: gs.totalRounds,
      genreName: gs.rhythm.name,
      bpm: gs.rhythm.bpm,
      originalBeats: gs.beats,
      originalInstruments: gs.instruments,
      results: sorted,
      isGameOver
    });

    if (isGameOver) {
      // Jogo concluído após as rodadas!
      const finalRankings = Array.from(room.players.entries()).map(([sid, p]) => ({
        id: sid,
        name: p.name,
        color: p.color,
        score: (gs.gameScores && gs.gameScores[sid]) || 0,
        gameScore: (gs.gameScores && gs.gameScores[sid]) || 0
      })).sort((a, b) => b.score - a.score);
      setRitmoTimer(roomCode, () => {
        io.to(roomCode).emit('game:ritmo:gameover', {
          rankings: finalRankings,
          totalRounds: gs.totalRounds
        });
        broadcastRoomState(roomCode);
      }, 3500);
    } else {
      // Avança automaticamente para a próxima rodada após 8 segundos
      setRitmoTimer(roomCode, () => {
        if (room.gameState && room.gameState.phase === 'results') {
          room.gameState.currentRound++;
          this.startRound(room, io, roomCode);
        }
      }, 8000);
    }
  }
};

// --- QUEM ESCREVEU ISSO? (RESPOSTAS CRIATIVAS & BLEFES) ---
const QUEM_PROMPTS = [
  // 1. Complete a Frase (Fofocas, Confissões & Micos do Cotidiano)
  { text: 'Minha avó ficou assustada quando me viu porque...', category: 'Complete a Frase', emoji: '👵' },
  { text: 'Todos ficaram surpresos no mercado porque eu...', category: 'Complete a Frase', emoji: '🛒' },
  { text: 'Eu levaria para o piquenique: ... e suco de uva', category: 'Complete a Frase', emoji: '🧺' },
  { text: 'A polícia bateu na minha porta às 3 da manhã achando que eu...', category: 'Complete a Frase', emoji: '🚨' },
  { text: 'Fui expulso da festa de aniversário de 5 anos do meu primo porque...', category: 'Complete a Frase', emoji: '🎂' },
  { text: 'Minha mãe mexeu nas minhas coisas e tive que explicar que aquilo era...', category: 'Complete a Frase', emoji: '😳' },
  { text: 'O garçom me olhou com cara de nojo depois que eu pedi...', category: 'Complete a Frase', emoji: '🍽️' },
  { text: 'Terminei meu último relacionamento pelo motivo mais fútil do mundo: ...', category: 'Complete a Frase', emoji: '💔' },
  { text: 'Cheguei com 2 horas de atraso no trabalho e minha desculpa foi que...', category: 'Complete a Frase', emoji: '⏰' },
  { text: 'Se eu fosse preso amanhã, meus amigos teriam certeza de que foi por causa de...', category: 'Complete a Frase', emoji: '⛓️' },
  { text: 'Tentei impressionar alguém no primeiro encontro fingindo que sabia tudo sobre...', category: 'Complete a Frase', emoji: '🍷' },
  { text: 'A pior coisa para se gritar num velório silencioso é: ...', category: 'Complete a Frase', emoji: '⚰️' },
  { text: 'O médico olhou meu exame, arregalou os olhos e disse: ...', category: 'Complete a Frase', emoji: '🩺' },
  { text: 'Se eu ganhasse 10 milhões agora, a primeira besteira que eu compraria seria...', category: 'Complete a Frase', emoji: '💰' },
  { text: 'O motivo mais ridículo pelo qual eu já chorei na vida foi...', category: 'Complete a Frase', emoji: '😭' },
  { text: 'Fui demitido no meu primeiro dia de estágio porque confundi...', category: 'Complete a Frase', emoji: '💼' },
  { text: 'O motorista do Uber cancelou a minha corrida assim que me viu segurando...', category: 'Complete a Frase', emoji: '🚗' },
  { text: 'Minha última mensagem no WhatsApp antes de ser abduzido por alienígenas seria: ...', category: 'Complete a Frase', emoji: '🛸' },
  { text: 'Eu nunca admitiria para os meus pais, mas uma vez eu quebrei...', category: 'Complete a Frase', emoji: '🔨' },
  { text: 'O padre parou a missa no meio quando percebeu que eu estava...', category: 'Complete a Frase', emoji: '⛪' },
  { text: 'Se eu pudesse proibir uma coisa no Brasil por lei, com certeza seria...', category: 'Complete a Frase', emoji: '📜' },
  { text: 'Esqueci a câmera ligada na reunião da empresa bem na hora que eu...', category: 'Complete a Frase', emoji: '📹' },
  { text: 'O pior apelido de infância que já tentaram me colocar foi...', category: 'Complete a Frase', emoji: '🏷️' },
  { text: 'No meio de um silêncio constrangedor no elevador cheio, eu de repente...', category: 'Complete a Frase', emoji: '🛗' },
  { text: 'O vizinho veio reclamar na minha porta porque de madrugada eu estava...', category: 'Complete a Frase', emoji: '🔊' },
  { text: 'Fui barrado na porta da balada porque o segurança achou que eu...', category: 'Complete a Frase', emoji: '🛑' },

  // 2. Situações Inusitadas & Respostas Criativas
  { text: 'Se você tivesse que se disfarçar para invadir uma festa chique de milionários, qual seria seu disfarce?', category: 'Situação Inusitada', emoji: '🎭' },
  { text: 'Qual o pior conselho amoroso que você poderia dar para o seu melhor amigo?', category: 'Situação Inusitada', emoji: '💘' },
  { text: 'O que você faria se acordasse amanhã com três braços?', category: 'Situação Inusitada', emoji: '🦾' },
  { text: 'Qual sabor de pizza deveria ser proibido pela Convenção de Genebra?', category: 'Situação Inusitada', emoji: '🍕' },
  { text: 'Como você explicaria o que é a humanidade para um extraterrestre em uma única frase?', category: 'Situação Inusitada', emoji: '👽' },
  { text: 'O que você falaria se estivesse disfarçado de piloto num avião e pedissem para você pousar?', category: 'Situação Inusitada', emoji: '✈️' },
  { text: 'Se você pudesse mandar uma mensagem de texto para a humanidade inteira de uma só vez, o que escreveria?', category: 'Situação Inusitada', emoji: '📱' },
  { text: 'Qual é o objeto mais aleatório que você salvaria da sua casa em caso de incêndio?', category: 'Situação Inusitada', emoji: '🔥' },
  { text: 'Se você fosse assombrar uma pessoa depois de morrer, que pegadinha sem graça faria todos os dias?', category: 'Situação Inusitada', emoji: '👻' },
  { text: 'O que a sua geladeira falaria se ela pudesse te julgar toda vez que você a abre de madrugada?', category: 'Situação Inusitada', emoji: '🧊' },
  { text: 'Qual é a mania mais esquisita que você tem quando está 100% sozinho em casa?', category: 'Situação Inusitada', emoji: '🏠' },
  { text: 'Se você fosse eleito prefeito da sua cidade, qual seria seu primeiro decreto absurdo?', category: 'Situação Inusitada', emoji: '🏛️' },
  { text: 'Qual o presente mais horrível que você já fingiu que amou receber de aniversário?', category: 'Situação Inusitada', emoji: '🎁' },
  { text: 'Descreva o som que o sinal do Wi-Fi faria se ele emitisse barulho o tempo todo', category: 'Situação Inusitada', emoji: '📡' },
  { text: 'Se os animais pudessem abrir processos judiciais contra humanos, qual animal te processaria primeiro?', category: 'Situação Inusitada', emoji: '⚖️' },
  { text: 'Qual superpoder parece incrível no gibi, mas seria um desastre horroroso na vida real?', category: 'Situação Inusitada', emoji: '🦸' },

  // 3. Dilemas e Pensamentos Cômicos
  { text: 'Descreva o cheiro de uma segunda-feira nublada com chuva', category: 'Dilema Cômico', emoji: '🌧️' },
  { text: 'Se você fosse um produto anunciado na TV às 3 da manhã, qual seria o seu bordão?', category: 'Dilema Cômico', emoji: '📺' },
  { text: 'Qual conselho sincero você daria para o seu próprio eu de 12 anos de idade?', category: 'Dilema Cômico', emoji: '🧒' },
  { text: 'Se você virasse um meme mundial amanhã, sobre qual assunto vergonhoso seria?', category: 'Dilema Cômico', emoji: '🤪' },
  { text: 'Qual seria o título da biografia não autorizada e polêmica da sua vida?', category: 'Dilema Cômico', emoji: '📖' },
  { text: 'Se você fosse um eletrodoméstico, qual seria e qual seria seu maior defeito de fábrica?', category: 'Dilema Cômico', emoji: '🔌' },
  { text: 'Descreva a sensação exata de pisar descalço num Lego pequeno no escuro às 2 da manhã', category: 'Dilema Cômico', emoji: '🦶' },
  { text: 'Qual seria o slogan mais honesto e vergonhoso para resumir a sua personalidade?', category: 'Dilema Cômico', emoji: '📢' },
  { text: 'Se você pudesse ter uma habilidade totalmente inútil mas estilosa, qual seria?', category: 'Dilema Cômico', emoji: '✨' },
  { text: 'O que você faria se ficasse invisível por exatamente 1 hora na sua cidade?', category: 'Dilema Cômico', emoji: '🫥' }
];

function startQuemRound(room, io, roomCode, roundNum) {
  const gs = room.gameState;
  if (!gs) return;

  const totalPrompts = QUEM_PROMPTS.length;
  let chosenIdx;
  let attempts = 0;
  do {
    chosenIdx = Math.floor(Math.random() * totalPrompts);
    attempts++;
  } while (gs.usedPromptIndices.has(chosenIdx) && attempts < 50);

  gs.usedPromptIndices.add(chosenIdx);
  const promptObj = QUEM_PROMPTS[chosenIdx];

  gs.phase = 'writing';
  gs.currentRound = roundNum;
  gs.currentPrompt = promptObj;
  gs.answers = {};
  gs.votes = {};
  gs.currentReveal = 0;
  gs.shuffledAnswers = [];

  const timeLimit = 60; // 60 segundos para escrever
  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  io.to(roomCode).emit('game:quem:question', {
    round: roundNum,
    totalRounds: gs.totalRounds,
    question: promptObj.text,
    category: promptObj.category,
    emoji: promptObj.emoji,
    timeLimit
  });

  // Timer automático de escrita
  gs.roundTimer = setTimeout(() => {
    if (room.gameState && room.gameState.phase === 'writing' && room.gameState.currentRound === roundNum) {
      finalizeQuemWriting(room, io, roomCode);
    }
  }, (timeLimit + 1) * 1000);
}

function finalizeQuemWriting(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'writing') return;
  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  // Preenche respostas para quem não enviou a tempo
  for (const [sid, p] of room.players) {
    if (!gs.answers[sid]) {
      gs.answers[sid] = {
        sid,
        name: p.name,
        text: 'Não deu tempo de pensar, esqueci o que ia escrever! 😅'
      };
    }
  }

  // Se estiver testando solo com 1 jogador, adiciona 2 bots divertidos para permitir jogar e testar!
  if (room.players.size === 1) {
    const soloBots = [
      { sid: 'bot_1', name: 'Robô Trapalhão 🤖', text: 'Eu comi o papel do recibo achando que era cupom de desconto!' },
      { sid: 'bot_2', name: 'Vovó Fofoqueira 👵', text: 'Eu vi tudo pela fresta da janela e anotei no meu caderninho.' }
    ];
    solobots: for (const b of soloBots) {
      gs.answers[b.sid] = b;
    }
  }

  gs.phase = 'voting';
  // Embaralha as respostas
  const shuffled = Object.values(gs.answers).sort(() => Math.random() - 0.5);
  gs.shuffledAnswers = shuffled;
  gs.currentReveal = 0;

  startQuemVoteItem(room, io, roomCode);
}

function startQuemVoteItem(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'voting') return;
  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  const currentAnswer = gs.shuffledAnswers[gs.currentReveal];
  if (!currentAnswer) {
    finalizeQuemRound(room, io, roomCode);
    return;
  }

  gs.voteRound = {};
  const allPlayerNames = Array.from(room.players.values()).map(p => p.name);
  if (room.players.size === 1) {
    allPlayerNames.push('Robô Trapalhão 🤖', 'Vovó Fofoqueira 👵');
  }

  const timeLimit = 25; // 25s para votar em cada resposta

  io.to(roomCode).emit('game:quem:vote-start', {
    index: gs.currentReveal,
    total: gs.shuffledAnswers.length,
    text: currentAnswer.text,
    authorSid: currentAnswer.sid,
    playerNames: allPlayerNames,
    timeLimit
  });

  gs.roundTimer = setTimeout(() => {
    if (room.gameState && room.gameState.phase === 'voting') {
      finalizeQuemVoteItem(room, io, roomCode);
    }
  }, (timeLimit + 1) * 1000);
}

function finalizeQuemVoteItem(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'voting') return;
  if (gs.roundTimer) clearTimeout(gs.roundTimer);

  const currentAnswer = gs.shuffledAnswers[gs.currentReveal];
  if (!currentAnswer) return;

  const realAuthor = currentAnswer.name;
  const authorSid = currentAnswer.sid;
  const authorPlayer = room.players.get(authorSid);

  // Votos da rodada
  const votes = Object.values(gs.voteRound || {});
  let correctVotesCount = 0;
  let wrongVotesCount = 0;

  // Processa pontuação
  votes.forEach(v => {
    const isCorrect = (v.votedFor === realAuthor);
    v.correct = isCorrect;

    if (isCorrect) {
      correctVotesCount++;
      // Detetive acertou o autor: +15 pontos
      for (const [sid, p] of room.players) {
        if (p.name === v.voterName) {
          p.score += 15;
          if (!gs.gameScores) gs.gameScores = {};
          gs.gameScores[sid] = (gs.gameScores[sid] || 0) + 15;
          if (!gs.stats[sid]) gs.stats[sid] = { detective: 0, bluffs: 0 };
          gs.stats[sid].detective++;
          break;
        }
      }
    } else {
      wrongVotesCount++;
      // Autor enganou esse jogador (Mestre do Blefe): +10 pontos para o autor
      if (authorPlayer) {
        authorPlayer.score += 10;
        if (!gs.gameScores) gs.gameScores = {};
        gs.gameScores[authorSid] = (gs.gameScores[authorSid] || 0) + 10;
        if (!gs.stats[authorSid]) gs.stats[authorSid] = { detective: 0, bluffs: 0 };
        gs.stats[authorSid].bluffs++;
      }
    }
  });

  // Bônus para o autor
  const perfectBluff = (votes.length > 0 && correctVotesCount === 0);
  if (perfectBluff && authorPlayer) {
    authorPlayer.score += 15; // Bônus de Blefe Perfeito (+15)
    if (!gs.gameScores) gs.gameScores = {};
    gs.gameScores[authorSid] = (gs.gameScores[authorSid] || 0) + 15;
  } else if (correctVotesCount > 0 && authorPlayer) {
    authorPlayer.score += 5; // Estilo Reconhecido (+5)
    if (!gs.gameScores) gs.gameScores = {};
    gs.gameScores[authorSid] = (gs.gameScores[authorSid] || 0) + 5;
  }

  io.to(roomCode).emit('game:quem:reveal', {
    index: gs.currentReveal,
    total: gs.shuffledAnswers.length,
    text: currentAnswer.text,
    realAuthor,
    authorSid,
    authorColor: authorPlayer?.color || '#9b59b6',
    votes,
    bluffsCount: wrongVotesCount,
    perfectBluff
  });

  broadcastRoomState(roomCode);

  gs.currentReveal++;

  // Aguarda 4.5 segundos para leitura antes da próxima resposta
  setTimeout(() => {
    if (room.gameState && room.gameState.phase === 'voting') {
      if (gs.currentReveal < gs.shuffledAnswers.length) {
        startQuemVoteItem(room, io, roomCode);
      } else {
        finalizeQuemRound(room, io, roomCode);
      }
    }
  }, 4500);
}

function finalizeQuemRound(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs) return;

  const currentRound = gs.currentRound;
  const isLastRound = (currentRound >= gs.totalRounds);

  if (!gs.gameScores) gs.gameScores = {};
  const scores = Array.from(room.players.entries()).map(([sid, p]) => ({
    id: sid,
    name: p.name,
    color: p.color,
    score: gs.gameScores[sid] || 0,
    gameScore: gs.gameScores[sid] || 0
  })).sort((a, b) => b.score - a.score);

  if (isLastRound) {
    gs.phase = 'gameover';
    io.to(roomCode).emit('game:quem:final-results', {
      rankings: scores,
      stats: gs.stats
    });
    broadcastRoomState(roomCode);
  } else {
    gs.phase = 'round-summary';
    io.to(roomCode).emit('game:quem:round-summary', {
      round: currentRound,
      totalRounds: gs.totalRounds,
      scores
    });
    broadcastRoomState(roomCode);
  }
}

gameHandlers['quem-escreveu'] = {
  start(room, io, roomCode) {
    const totalRounds = 3; // Torneio em 3 rodadas
    room.gameState = {
      phase: 'init',
      currentRound: 0,
      totalRounds,
      usedPromptIndices: new Set(),
      answers: {},
      votes: {},
      stats: {},
      shuffledAnswers: [],
      currentReveal: 0,
      playerCount: room.players.size,
      roundTimer: null,
      gameScores: {}
    };

    for (const [sid] of room.players) {
      room.gameState.stats[sid] = { detective: 0, bluffs: 0 };
    }

    startQuemRound(room, io, roomCode, 1);
  },

  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'answer') {
      if (gs.phase !== 'writing') return;
      const player = room.players.get(socket.id);
      const text = (data.text || '').trim();
      if (!text) return;

      gs.answers[socket.id] = {
        sid: socket.id,
        name: player?.name || 'Jogador',
        text
      };

      io.to(roomCode).emit('game:quem:answered', {
        count: Object.keys(gs.answers).length,
        total: room.players.size
      });

      // Se todos responderam, finaliza a escrita imediatamente!
      if (Object.keys(gs.answers).length >= room.players.size) {
        finalizeQuemWriting(room, io, roomCode);
      }
    } else if (data.action === 'vote') {
      if (gs.phase !== 'voting') return;
      const currentAnswer = gs.shuffledAnswers[gs.currentReveal];
      if (!currentAnswer) return;

      // O autor da própria resposta não vota
      if (socket.id === currentAnswer.sid && room.players.size > 1) return;

      const player = room.players.get(socket.id);
      if (!gs.voteRound) gs.voteRound = {};

      gs.voteRound[socket.id] = {
        voterSid: socket.id,
        voterName: player?.name || 'Jogador',
        votedFor: data.votedFor
      };

      // Votantes necessários: todos exceto o autor (ou 1 se solo)
      const votersNeeded = room.players.size > 1 ? (room.players.size - 1) : 1;

      io.to(roomCode).emit('game:quem:vote-progress', {
        count: Object.keys(gs.voteRound).length,
        total: votersNeeded
      });

      if (Object.keys(gs.voteRound).length >= votersNeeded) {
        finalizeQuemVoteItem(room, io, roomCode);
      }
    } else if (data.action === 'next-round') {
      if (gs.phase !== 'round-summary') return;
      if (gs.currentRound < gs.totalRounds) {
        startQuemRound(room, io, roomCode, gs.currentRound + 1);
      } else {
        finalizeQuemRound(room, io, roomCode);
      }
    }
  }
};

// --- HISTÓRIA EM CADEIA (PALAVRA POR PALAVRA EM 4 ATOS) ---
const HISTORIA_CATEGORIES = [
  {
    id: 'fantasia',
    name: 'Fantasia Épica & Magia',
    icon: '🧙‍♂️',
    color: '#9b59b6',
    prompts: [
      'O guerreiro mais temido dos sete reinos acordou depois de mil anos e descobriu que sua espada havia sido trocada por...',
      'Nas profundezas da Floresta dos Sussurros, o mago abriu o caldeirão proibido e encontrou...',
      'A profecia ancestral dizia que o dragão só seria derrotado se o escolhido usasse...',
      'Ao tocar na pedra mágica da montanha proibida, o jovem aprendiz começou a...'
    ],
    emergencyWords: ['magia', 'dragão', 'portal', 'espada', 'poção', 'feitiço', 'brilho']
  },
  {
    id: 'terror',
    name: 'Terror Cômico & Sobrenatural',
    icon: '👻',
    color: '#e74c3c',
    prompts: [
      'O grupo de amigos decidiu explorar o cemitério abandonado à meia-noite, até que uma lápide começou a...',
      'As portas do elevador abriram no 13º andar do prédio fantasma e a primeira coisa que apareceu foi...',
      'A antiga boneca de porcelana no sótão começou a piscar e exigiu que todos...',
      'Ao apagar a última vela do quarto escuro, uma voz debaixo da cama sussurrou pedindo...'
    ],
    emergencyWords: ['fantasma', 'grito', 'susto', 'sombra', 'risada', 'calafrio', 'correr']
  },
  {
    id: 'ficcao',
    name: 'Ficção Científica',
    icon: '🚀',
    color: '#3498db',
    prompts: [
      'A 40 anos-luz da Terra, o computador da nave espacial de repente declarou que...',
      'O cientista finalmente conseguiu abrir o primeiro portal dimensional, mas a única coisa que atravessou foi...',
      'Ao pousar no planeta desconhecido coberto por cristais roxos, os astronautas viram...',
      'O robô mais inteligente do mundo alcançou a consciência cósmica e a sua primeira ordem foi...'
    ],
    emergencyWords: ['laser', 'planeta', 'robô', 'nave', 'reator', 'alienígena', 'órbita']
  },
  {
    id: 'misterio',
    name: 'Mistério e Investigação',
    icon: '🕵️',
    color: '#8e44ad',
    prompts: [
      'A chuva caía pesada na cidade quando o detetive encontrou um bilhete com o próprio nome marcado em...',
      'O testamento do milionário continha apenas uma linha dizendo que sua herança secreta pertencia a...',
      'Durante a festa de gala na mansão, as luzes se apagaram e, quando voltaram, havia apenas...',
      'No cofre do banco que nunca havia sido violado, a polícia encontrou uma caixa contendo...'
    ],
    emergencyWords: ['pista', 'suspeito', 'veneno', 'segredo', 'cofre', 'sombra', 'álibi']
  },
  {
    id: 'medieval',
    name: 'Aventura Medieval',
    icon: '⚔️',
    color: '#d35400',
    prompts: [
      'O rei convocou todos os cavaleiros para uma missão urgente porque o bobo da corte havia...',
      'No meio da batalha pelo castelo de pedra, o general levantou sua bandeira e gritou para...',
      'A caravana de comerciantes parou diante da ponte guardada pelo gigante que exigia...',
      'O ferreiro lendário bateu o martelo na bigorna sagrada e forjou uma armadura feita de...'
    ],
    emergencyWords: ['cavaleiro', 'escudo', 'castelo', 'rei', 'batalha', 'honra', 'glória']
  },
  {
    id: 'zumbi',
    name: 'Apocalipse Zumbi',
    icon: '🧟',
    color: '#27ae60',
    prompts: [
      'O rádio a pilha do bunker emitiu o último sinal de socorro informando que os zumbis agora sabiam...',
      'Ao invadir o supermercado abandonado atrás de comida, os sobreviventes deram de cara com...',
      'O cientista jurava que tinha criado a cura para a infecção, mas o remédio fazia as pessoas...',
      'Trancados no topo da torre de transmissão, os sobreviventes olharam para baixo e viram...'
    ],
    emergencyWords: ['mordida', 'machado', 'fuga', 'bunker', 'barricada', 'horda', 'socorro']
  },
  {
    id: 'cotidiano',
    name: 'Situações Cotidianas Absurdas',
    icon: '🏢',
    color: '#f39c12',
    prompts: [
      'Meu chefe me chamou para uma reunião secreta às três da manhã e, quando abri a porta, encontrei...',
      'A fila da padaria estava enorme até o padeiro avisar que o último pão francês continha...',
      'Ao tentar consertar o chuveiro que estava dando choque, o encanador acidentalmente conectou...',
      'A reunião de condomínio estava tranquila até que o morador do 402 trouxe para a mesa...'
    ],
    emergencyWords: ['café', 'boleto', 'chefe', 'confusão', 'vizinho', 'reunião', 'panela']
  },
  {
    id: 'brasil',
    name: 'Comédia Brasileira',
    icon: '🇧🇷',
    color: '#2ecc71',
    prompts: [
      'Na manhã em que o Brasil declarou guerra contra a Lua, ninguém imaginava que o verdadeiro inimigo estava...',
      'No churrasco da família de domingo, o tio do pavê pegou o microfone e revelou que...',
      'O ônibus lotado das 18h parou no meio da avenida porque o motorista viu...',
      'Na praia lotada no réveillon de Copacabana, uma onda gigante trouxe de volta...'
    ],
    emergencyWords: ['farofa', 'chinelo', 'pastel', 'pagode', 'feijoada', 'gambiarra', 'surpresa']
  },
  {
    id: 'romance',
    name: 'Romance Desastroso',
    icon: '💔',
    color: '#e84393',
    prompts: [
      'O casamento parecia perfeito até o padre pedir que falassem agora ou calassem-se, quando de repente...',
      'No primeiro encontro no restaurante chique, ela olhou nos olhos dele e confessou que...',
      'Ele preparou um jantar romântico à luz de velas, mas ao abrir a tampa da travessa principal havia...',
      'A serenata na janela começou linda, até que o cantor desafinou e atingiu a janela com...'
    ],
    emergencyWords: ['coração', 'beijo', 'lágrima', 'traição', 'aliança', 'desastre', 'fuga']
  },
  {
    id: 'traicao',
    name: 'Histórias de Traição',
    icon: '🗡️',
    color: '#c0392b',
    prompts: [
      'Os dois espiões se encontraram no beco escuro para trocar as maletas, mas um deles sacou...',
      'No leito de morte do mafioso, o seu braço direito se aproximou do ouvido dele e sussurrou...',
      'O plano do roubo ao cassino era impecável, até o comparsa trocar o mapa da fuga por...',
      'A imperatriz brindou com a taça de vinho dourada sem saber que seu general havia colocado...'
    ],
    emergencyWords: ['veneno', 'faca', 'segredo', 'traidor', 'dinheiro', 'vingança', 'disparo']
  },
  {
    id: 'policial',
    name: 'Ficção Policial',
    icon: '🚨',
    color: '#2980b9',
    prompts: [
      'A sirene da viatura tocou no meio da perseguição quando o suspeito virou a esquina e...',
      'O delegado entrou na sala de interrogatório, colocou uma xícara de café frio na mesa e disse...',
      'Na cena do crime mais bizarro do ano, a única impressão digital encontrada pertencia a...',
      'O informante secreto mandou uma mensagem codificada marcando um encontro urgente debaixo de...'
    ],
    emergencyWords: ['algema', 'viatura', 'arma', 'delegacia', 'sirene', 'mandado', 'fuga']
  },
  {
    id: 'caos',
    name: 'Caos Completamente Aleatório',
    icon: '🌀',
    color: '#fd79a8',
    prompts: [
      'Quando o último ser humano desapareceu da Terra, o único sobrevivente era um pombo que sabia...',
      'O maior vilão da história finalmente conquistou o mundo, mas cometeu um erro terrível ao esquecer...',
      'O concurso de beleza de cachorros saiu do controle no momento em que um poodle gigante começou a...',
      'O despertador tocou às 7 da manhã, mas o tempo parou e todas as maçanetas da casa viraram...'
    ],
    emergencyWords: ['pudim', 'banana', 'explosão', 'disco', 'patinete', 'bigode', 'meteoro']
  }
];

function getHistoriaActByWordIndex(index, totalWords) {
  const p = totalWords > 0 ? (index / totalWords) : 0;
  if (p < 0.25) {
    return {
      actNumber: 1,
      title: 'ATO I — O COMEÇO',
      icon: '🌅',
      desc: 'Construindo o universo, personagens e o cenário inicial.'
    };
  } else if (p < 0.50) {
    return {
      actNumber: 2,
      title: 'ATO II — A COMPLICAÇÃO',
      icon: '⚡',
      desc: 'O enredo toma rumos inesperados! Conflitos e mistérios surgem.'
    };
  } else if (p < 0.75) {
    return {
      actNumber: 3,
      title: 'ATO III — O CAOS',
      icon: '💥',
      desc: 'Clímax imprevisível! Reviravoltas, situações absurdas e tensão máxima.'
    };
  } else {
    return {
      actNumber: 4,
      title: 'ATO IV — O DESFECHO',
      icon: '🏆',
      desc: 'Conclusão definitiva! Conduza a história a um encerramento marcante.'
    };
  }
}

function sanitizeSingleWord(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Deve ser apenas UMA única palavra (sem espaços no meio)
  if (/\s/.test(trimmed)) return null;
  // Tamanho razoável
  if (trimmed.length > 35) return null;
  return trimmed;
}

function generateCinematicStoryTitle(category, words) {
  const cleanList = words
    .map(w => w.word.replace(/[.,!?;:"'—\-]/g, '').trim())
    .filter(w => w.length >= 4);

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  const w1 = cleanList[0] ? cap(cleanList[0]) : 'O Enigma';
  const w2 = cleanList[Math.floor(cleanList.length / 2)] ? cap(cleanList[Math.floor(cleanList.length / 2)]) : 'O Segredo';
  const w3 = cleanList[cleanList.length - 1] ? cap(cleanList[cleanList.length - 1]) : 'O Destino';

  const templates = [
    `As Crônicas de ${w1} e o ${w3}`,
    `O Dia em que ${w1} Encontrou ${w2}`,
    `O Mistério de ${w2}: A Lenda de ${w1}`,
    `${w1}: A Conspiração de ${w3}`,
    `A Odisseia Inesperada de ${w1}`,
    `Quando ${w1} Desafiou o ${w3}`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

function startHistoriaWordTurnTimer(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'playing') return;
  if (gs.turnTimer) clearTimeout(gs.turnTimer);

  const durationSec = gs.turnDuration || 20;
  gs.turnExpiresAt = Date.now() + (durationSec * 1000);

  gs.turnTimer = setTimeout(() => {
    if (!room.gameState || room.currentGame !== 'historia-cadeia' || room.gameState.phase !== 'playing') return;

    const currentWriter = gs.playerOrder[gs.currentTurn % gs.playerOrder.length];
    const emergencyList = gs.category.emergencyWords;
    const fallbackWord = emergencyList[Math.floor(Math.random() * emergencyList.length)];

    io.to(roomCode).emit('chat:message', {
      type: 'system',
      text: `⏱️ Tempo de ${currentWriter.name} esgotou! Palavra automática adicionada: "${fallbackWord}".`,
      timestamp: Date.now()
    });

    handleHistoriaAddWord(room, io, roomCode, currentWriter.sid, fallbackWord, true);
  }, (durationSec + 1) * 1000);
}

function handleHistoriaAddWord(room, io, roomCode, socketId, rawWord, isAuto = false) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'playing') return;

  const currentWriter = gs.playerOrder[gs.currentTurn % gs.playerOrder.length];
  if (socketId !== currentWriter.sid) return;

  const word = sanitizeSingleWord(rawWord);
  if (!word) {
    const s = io.sockets.sockets.get(socketId);
    if (s) s.emit('game:historia:error', { message: 'Envie apenas UMA única palavra por vez!' });
    return;
  }

  if (gs.turnTimer) clearTimeout(gs.turnTimer);

  const wordIndex = gs.storyWords.length;
  const currentAct = getHistoriaActByWordIndex(wordIndex, gs.totalWords);

  // Formatação do texto acumulado
  const isPunctuationOnly = /^[.,!?;:]+$/.test(word);
  if (isPunctuationOnly) {
    gs.fullText = gs.fullText.trimEnd() + word + ' ';
  } else {
    // Se a frase inicial termina com reticências '...', dá espaço
    gs.fullText = gs.fullText + ' ' + word;
  }

  const wordObj = {
    word,
    author: currentWriter.name,
    authorId: currentWriter.sid,
    wordIndex: wordIndex + 1,
    actNumber: currentAct.actNumber,
    isAuto: !!isAuto,
    timestamp: Date.now()
  };

  gs.storyWords.push(wordObj);

  // Pontuação do GameHub
  if (!gs.gameScores) gs.gameScores = {};
  gs.gameScores[currentWriter.sid] = (gs.gameScores[currentWriter.sid] || 0) + 10;
  const p = room.players.get(currentWriter.sid);
  if (p) p.score += 10;

  gs.currentTurn++;

  // Checar se mudou de Ato
  const nextWordIndex = gs.storyWords.length;
  const nextAct = getHistoriaActByWordIndex(nextWordIndex, gs.totalWords);
  const actChanged = nextAct.actNumber !== currentAct.actNumber && nextWordIndex < gs.totalWords;

  if (actChanged) {
    gs.currentAct = nextAct.actNumber;
    io.to(roomCode).emit('game:historia:act-change', {
      actNumber: nextAct.actNumber,
      title: nextAct.title,
      icon: nextAct.icon,
      desc: nextAct.desc
    });
  }

  // Notificar todos sobre a palavra adicionada
  const isComplete = gs.storyWords.length >= gs.totalWords;

  if (!isComplete) {
    // Filtrar apenas jogadores conectados para o próximo turno
    const activeOrder = gs.playerOrder.filter(pl => {
      const playerObj = room.players.get(pl.sid);
      return playerObj && playerObj.connected;
    });

    const nextWriter = (activeOrder.length > 0)
      ? activeOrder[gs.currentTurn % activeOrder.length]
      : gs.playerOrder[gs.currentTurn % gs.playerOrder.length];

    io.to(roomCode).emit('game:historia:word-added', {
      word,
      author: currentWriter.name,
      authorId: currentWriter.sid,
      wordIndex: gs.storyWords.length,
      totalWords: gs.totalWords,
      act: nextAct,
      fullText: gs.fullText,
      nextWriter: nextWriter.name,
      nextWriterId: nextWriter.sid,
      turnDuration: gs.turnDuration
    });

    broadcastRoomState(roomCode);
    startHistoriaWordTurnTimer(room, io, roomCode);
  } else {
    // --- HISTÓRIA CONCLUÍDA: A ESTREIA ÉPICA ---
    gs.phase = 'completed';
    const cinematicTitle = generateCinematicStoryTitle(gs.category, gs.storyWords);
    gs.cinematicTitle = cinematicTitle;

    // Bônus para todos os participantes por concluir a história
    room.players.forEach(player => {
      if (player.connected) {
        player.score += 25;
        gs.gameScores[player.id] = (gs.gameScores[player.id] || 0) + 25;
      }
    });

    broadcastRoomState(roomCode);

    const stats = {
      totalWords: gs.storyWords.length,
      totalParticipants: Array.from(new Set(gs.storyWords.map(w => w.author))).length,
      durationMs: Date.now() - (gs.startTime || Date.now()),
      categoryName: gs.category.name,
      longestWord: gs.storyWords.reduce((longest, curr) => curr.word.length > longest.length ? curr.word : longest, '')
    };

    io.to(roomCode).emit('game:historia:story-complete', {
      title: cinematicTitle,
      category: gs.category,
      initialSentence: gs.initialSentence,
      words: gs.storyWords,
      fullText: gs.fullText,
      stats,
      authors: Array.from(new Set(gs.storyWords.map(w => w.author))),
      leaderboard: Array.from(room.players.entries()).map(([sid, pl]) => ({
        id: sid,
        name: pl.name,
        color: pl.color,
        score: (gs.gameScores && gs.gameScores[sid]) || 0,
        gameScore: (gs.gameScores && gs.gameScores[sid]) || 0
      })).sort((a, b) => b.score - a.score)
    });
  }
}

gameHandlers['historia-cadeia'] = {
  start(room, io, roomCode) {
    // Escolher categoria
    const category = HISTORIA_CATEGORIES[Math.floor(Math.random() * HISTORIA_CATEGORIES.length)];
    const initialSentence = category.prompts[Math.floor(Math.random() * category.prompts.length)];

    // Ordenar jogadores conectados
    const playerOrder = Array.from(room.players.entries())
      .filter(([_, p]) => p.connected)
      .map(([sid, p]) => ({ sid, name: p.name }))
      .sort(() => Math.random() - 0.5);

    // Ajustar total de palavras para que a história dure e tenha desenvolvimento nos 4 atos
    // Mínimo de 20 palavras (partida curta), 32 palavras (partida média), 48 (longa)
    const pCount = Math.max(1, playerOrder.length);
    let totalWords = 32;
    if (pCount === 1) totalWords = 24;
    else if (pCount === 2) totalWords = 32;
    else if (pCount >= 5) totalWords = 40;

    const turnDuration = 20; // 20 segundos por palavra

    room.gameState = {
      phase: 'countdown',
      category,
      initialSentence,
      fullText: initialSentence,
      playerOrder,
      currentTurn: 0,
      totalWords,
      turnDuration,
      storyWords: [],
      currentAct: 1,
      startTime: Date.now(),
      turnTimer: null,
      votes: {}
    };

    const firstWriter = playerOrder[0];
    const initialAct = getHistoriaActByWordIndex(0, totalWords);

    // Envia contagem regressiva de início (3... 2... 1...)
    let countdown = 3;
    io.to(roomCode).emit('game:historia:countdown', {
      seconds: countdown,
      category,
      initialSentence
    });

    const cdInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        io.to(roomCode).emit('game:historia:countdown', {
          seconds: countdown,
          category,
          initialSentence
        });
      } else {
        clearInterval(cdInterval);
        if (!room.gameState || room.currentGame !== 'historia-cadeia') return;

        room.gameState.phase = 'playing';
        room.gameState.startTime = Date.now();

        io.to(roomCode).emit('game:historia:round-start', {
          category,
          initialSentence,
          totalWords,
          turnDuration,
          currentWriter: firstWriter.name,
          currentWriterId: firstWriter.sid,
          act: initialAct,
          fullText: initialSentence,
          storyWords: []
        });

        startHistoriaWordTurnTimer(room, io, roomCode);
      }
    }, 1000);
  },

  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    // --- ENVIAR UMA PALAVRA ---
    if (data.action === 'add-word') {
      handleHistoriaAddWord(room, io, roomCode, socket.id, data.word, false);
      return;
    }

    // --- PASSAR A VEZ ---
    if (data.action === 'pass') {
      if (gs.phase !== 'playing') return;
      const currentWriter = gs.playerOrder[gs.currentTurn % gs.playerOrder.length];
      if (socket.id !== currentWriter.sid) return;

      const fallbackWord = 'então';
      io.to(roomCode).emit('chat:message', {
        type: 'system',
        text: `⏭️ ${currentWriter.name} passou a vez.`,
        timestamp: Date.now()
      });
      handleHistoriaAddWord(room, io, roomCode, socket.id, fallbackWord, true);
      return;
    }

    // --- REAÇÕES DA PLATEIA ---
    if (data.action === 'react') {
      const allowedEmojis = ['🔥', '😱', '👏', '🍿', '✍️', '🤯', '❤️', '😂', '⭐', '🚀'];
      const emoji = allowedEmojis.includes(data.emoji) ? data.emoji : '✨';
      const player = room.players.get(socket.id);
      io.to(roomCode).emit('game:historia:reaction', {
        emoji,
        senderName: player?.name || 'Espectador'
      });
      return;
    }

    // --- VOTAÇÃO DE AVALIAÇÃO FINAL ---
    if (data.action === 'vote') {
      if (gs.phase !== 'completed') return;
      if (!gs.votes) gs.votes = {};

      gs.votes[socket.id] = {
        bestWord: data.bestWord,
        funniestWord: data.funniestWord,
        twistWord: data.twistWord
      };

      const voterCount = Object.keys(gs.votes).length;
      const totalVoters = Array.from(room.players.values()).filter(p => p.connected).length;

      // Se todos votaram, computa prêmios extras
      if (voterCount >= totalVoters) {
        // Bonificar autores votados
        Object.values(gs.votes).forEach(vote => {
          if (vote.bestWord !== undefined && gs.storyWords[vote.bestWord]) {
            const p = room.players.get(gs.storyWords[vote.bestWord].authorId);
            if (p) p.score += 20;
          }
          if (vote.funniestWord !== undefined && gs.storyWords[vote.funniestWord]) {
            const p = room.players.get(gs.storyWords[vote.funniestWord].authorId);
            if (p) p.score += 15;
          }
          if (vote.twistWord !== undefined && gs.storyWords[vote.twistWord]) {
            const p = room.players.get(gs.storyWords[vote.twistWord].authorId);
            if (p) p.score += 15;
          }
        });
        broadcastRoomState(roomCode);
        io.to(roomCode).emit('game:historia:voting-results', {
          success: true,
          votes: gs.votes
        });
      }
      return;
    }

    // --- JOGAR NOVAMENTE COM O MESMO GRUPO ---
    if (data.action === 'play-again') {
      if (room.hostId !== socket.id) return;
      if (gs.turnTimer) clearTimeout(gs.turnTimer);
      gameHandlers['historia-cadeia'].start(room, io, roomCode);
    }
  }
};

// --- IMAGEM DE IA FALSA ---
gameHandlers['ia-falsa'] = {
  start(room, io, roomCode) {
    const rounds = [
      {
        theme: 'Paisagens',
        images: [
          { id: 0, desc: 'Montanha com lago ao pôr do sol', isReal: false },
          { id: 1, desc: 'Floresta tropical densa', isReal: true },
          { id: 2, desc: 'Cachoeira com arco-íris duplo', isReal: false },
          { id: 3, desc: 'Deserto com aurora boreal', isReal: false }
        ],
        realIndex: 1
      },
      {
        theme: 'Animais',
        images: [
          { id: 0, desc: 'Gato com olhos bicolores', isReal: false },
          { id: 1, desc: 'Papagaio multicolorido', isReal: false },
          { id: 2, desc: 'Cachorro golden retriever', isReal: true },
          { id: 3, desc: 'Coruja branca na neve', isReal: false }
        ],
        realIndex: 2
      },
      {
        theme: 'Comidas',
        images: [
          { id: 0, desc: 'Pizza artesanal perfeita', isReal: false },
          { id: 1, desc: 'Sushi elaborado', isReal: false },
          { id: 2, desc: 'Bolo de chocolate decorado', isReal: false },
          { id: 3, desc: 'Prato de macarrão caseiro', isReal: true }
        ],
        realIndex: 3
      },
      {
        theme: 'Cidades',
        images: [
          { id: 0, desc: 'Cidade futurista à noite', isReal: false },
          { id: 1, desc: 'Vila medieval europeia', isReal: false },
          { id: 2, desc: 'Rua de Tóquio com letreiros', isReal: true },
          { id: 3, desc: 'Cidade flutuante nas nuvens', isReal: false }
        ],
        realIndex: 2
      }
    ];

    const round = rounds[Math.floor(Math.random() * rounds.length)];
    room.gameState = {
      phase: 'voting',
      round,
      votes: {},
      playerCount: room.players.size
    };
    io.to(roomCode).emit('game:ia:start', {
      theme: round.theme,
      images: round.images.map(img => ({ id: img.id, desc: img.desc }))
    });
  },
  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'vote') {
      const player = room.players.get(socket.id);
      gs.votes[socket.id] = {
        name: player?.name || 'Jogador',
        choice: data.choice
      };

      io.to(roomCode).emit('game:ia:voted', {
        count: Object.keys(gs.votes).length,
        total: gs.playerCount
      });

      if (Object.keys(gs.votes).length >= gs.playerCount) {
        const results = Object.values(gs.votes).map(v => {
          const correct = v.choice === gs.round.realIndex;
          const points = correct ? 25 : 0;
          for (const [sid, p] of room.players) {
            if (p.name === v.name) { p.score += points; break; }
          }
          return { name: v.name, choice: v.choice, correct, points };
        }).sort((a, b) => b.points - a.points);

        gs.phase = 'results';
        io.to(roomCode).emit('game:ia:results', {
          results,
          realIndex: gs.round.realIndex,
          images: gs.round.images
        });
        broadcastRoomState(roomCode);
      }
    }
  }
};

// --- QUÃO GRANDE É? ---
gameHandlers['quao-grande'] = {
  start(room, io, roomCode) {
    const objects = [
      { name: 'Elefante Africano', realSize: 350, unit: 'cm (altura)', emoji: '🐘', category: 'Animais' },
      { name: 'Girafa', realSize: 550, unit: 'cm (altura)', emoji: '🦒', category: 'Animais' },
      { name: 'Baleia Azul', realSize: 3000, unit: 'cm (comprimento)', emoji: '🐋', category: 'Animais' },
      { name: 'T-Rex', realSize: 400, unit: 'cm (altura)', emoji: '🦖', category: 'Dinossauros' },
      { name: 'Estátua da Liberdade', realSize: 9300, unit: 'cm (altura total)', emoji: '🗽', category: 'Monumentos' },
      { name: 'Cristo Redentor', realSize: 3800, unit: 'cm (altura)', emoji: '✝️', category: 'Monumentos' },
      { name: 'Torre Eiffel', realSize: 33000, unit: 'cm (altura)', emoji: '🗼', category: 'Monumentos' },
      { name: 'Ônibus Escolar', realSize: 1050, unit: 'cm (comprimento)', emoji: '🚌', category: 'Veículos' },
      { name: 'Boeing 747', realSize: 7060, unit: 'cm (comprimento)', emoji: '✈️', category: 'Veículos' },
      { name: 'Lua', realSize: 347400000, unit: 'cm (diâmetro)', emoji: '🌙', category: 'Espaço' },
      { name: 'Pessoa Média', realSize: 170, unit: 'cm (altura)', emoji: '🧍', category: 'Referência' },
      { name: 'Gorila Adulto', realSize: 175, unit: 'cm (altura em pé)', emoji: '🦍', category: 'Animais' },
      { name: 'Tubarão Branco', realSize: 500, unit: 'cm (comprimento)', emoji: '🦈', category: 'Animais' },
      { name: 'Fusca', realSize: 407, unit: 'cm (comprimento)', emoji: '🚗', category: 'Veículos' }
    ];

    const obj = objects[Math.floor(Math.random() * objects.length)];
    const players = Array.from(room.players.entries());

    if (!room.duelLives) {
      room.duelLives = {};
    }
    players.forEach(([sid]) => {
      if (room.duelLives[sid] === undefined || room.duelLives[sid] <= 0) {
        room.duelLives[sid] = 4;
      }
    });

    room.gameState = {
      phase: 'sizing',
      object: obj,
      guesses: {},
      playerCount: room.players.size
    };

    io.to(roomCode).emit('game:grande:start', {
      name: obj.name,
      unit: obj.unit,
      emoji: obj.emoji,
      category: obj.category,
      lives: room.duelLives
    });
  },
  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'guess') {
      const player = room.players.get(socket.id);
      const guess = parseFloat(data.value);
      if (isNaN(guess)) return;

      const diff = Math.abs(guess - gs.object.realSize);
      const pctOff = (diff / gs.object.realSize) * 100;
      const accuracy = Math.max(0, 100 - pctOff);

      gs.guesses[socket.id] = {
        sid: socket.id,
        name: player?.name || 'Jogador',
        skin: data.skin || 'wood',
        guess,
        diff,
        accuracy,
        pctOff: Math.round(pctOff)
      };

      io.to(roomCode).emit('game:grande:guessed', {
        count: Object.keys(gs.guesses).length,
        total: gs.playerCount
      });

      if (Object.keys(gs.guesses).length >= gs.playerCount) {
        const sorted = Object.values(gs.guesses).sort((a, b) => a.diff - b.diff);

        let explodedName = null;
        let winnerName = sorted[0].name;

        if (sorted.length > 1) {
          const loser = sorted[sorted.length - 1];
          if (room.duelLives && room.duelLives[loser.sid] !== undefined) {
            room.duelLives[loser.sid] = Math.max(0, room.duelLives[loser.sid] - 1);
          }
          explodedName = loser.name;
        }

        sorted.forEach((r, i) => {
          const points = Math.round(r.accuracy) + (i === 0 ? 25 : 0);
          const p = room.players.get(r.sid);
          if (p) p.score += points;
          r.rank = i + 1;
          r.points = points;
          r.lives = room.duelLives ? (room.duelLives[r.sid] ?? 4) : 4;
        });

        gs.phase = 'results';
        io.to(roomCode).emit('game:grande:results', {
          results: sorted,
          realSize: gs.object.realSize,
          objectName: gs.object.name,
          unit: gs.object.unit,
          emoji: gs.object.emoji,
          winnerName,
          explodedName,
          lives: room.duelLives
        });
        broadcastRoomState(roomCode);
      }
    }
  }
};

// --- DEATH BALL v2 (módulo próprio: server/death-ball.js) ---
// Física compartilhada com o cliente em public/js/games/deathball/shared.js
gameHandlers['death-ball'] = require('./server/death-ball').createHandler({ broadcastRoomState });

// --- CARTAS CONTRA A HUMANIDADE (MULTIJOGADOR EM TEMPO REAL) ---
let cartasDeckData = null;
try {
  cartasDeckData = require('./data/cartas_cards.json');
} catch (e) {
  try {
    cartasDeckData = require('./scratch/extracted_cards.json');
  } catch (err) {
    console.error('Erro ao carregar baralho de cartas:', err);
    cartasDeckData = { blackCards: [], whiteCards: [] };
  }
}

function shuffleCartasArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawCartasWhiteCard(gs) {
  if (!gs.whiteDeck || gs.whiteDeck.length === 0) {
    if (gs.discardWhite && gs.discardWhite.length > 0) {
      gs.whiteDeck = shuffleCartasArray(gs.discardWhite);
      gs.discardWhite = [];
    } else {
      gs.whiteDeck = shuffleCartasArray(cartasDeckData.whiteCards || []);
    }
  }
  return gs.whiteDeck.pop() || { id: 'w_fallback', text: 'Humor negro sem limites.' };
}

function drawCartasBlackCard(gs) {
  if (!gs.blackDeck || gs.blackDeck.length === 0) {
    if (gs.discardBlack && gs.discardBlack.length > 0) {
      gs.blackDeck = shuffleCartasArray(gs.discardBlack);
      gs.discardBlack = [];
    } else {
      gs.blackDeck = shuffleCartasArray(cartasDeckData.blackCards || []);
    }
  }
  return gs.blackDeck.pop() || { id: 'b_fallback', text: 'Eu nunca pensei que veria ________.', pick: 1 };
}

function formatCartasCompletedSentence(blackText, whiteCards) {
  let result = blackText || '';
  const blankRegex = /_{2,}/g;
  let cardIndex = 0;

  if (blankRegex.test(result)) {
    blankRegex.lastIndex = 0;
    result = result.replace(blankRegex, () => {
      const card = whiteCards[cardIndex++];
      return card ? `【${card.text}】` : '________';
    });
  } else {
    const answers = whiteCards.map(c => `【${c.text}】`).join(' + ');
    result = `${result} — ${answers}`;
  }
  return result;
}

function startCartasRound(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs) return;

  const activePlayers = Array.from(room.players.values()).filter(p => p.connected);
  if (activePlayers.length === 0) return;

  gs.round++;
  gs.phase = 'submitting';
  gs.submissions = {};
  gs.shuffledSubmissions = [];

  // Czar rotativo entre os jogadores ativos
  const czarPlayer = activePlayers[gs.czarIndex % activePlayers.length];
  gs.czarId = czarPlayer.id;
  gs.czarName = czarPlayer.name;

  // Saca carta preta
  const blackCard = drawCartasBlackCard(gs);
  gs.currentBlackCard = blackCard;

  // Garante que cada jogador conectado tenha 10 cartas na mão
  for (const player of activePlayers) {
    if (!gs.playerHands[player.id]) {
      gs.playerHands[player.id] = [];
    }
    while (gs.playerHands[player.id].length < 10) {
      gs.playerHands[player.id].push(drawCartasWhiteCard(gs));
    }
  }

  // Notifica cada jogador individualmente
  for (const player of activePlayers) {
    const isCzar = (player.id === gs.czarId);
    const pSocket = io.sockets.sockets.get(player.id);
    if (pSocket) {
      pSocket.emit('game:cartas:round-start', {
        round: gs.round,
        isCzar,
        czarId: gs.czarId,
        czarName: gs.czarName,
        blackCard: gs.currentBlackCard,
        hand: gs.playerHands[player.id] || [],
        scores: gs.scores,
        targetScore: gs.targetScore,
        players: getRoomPlayers(roomCode),
        shufflesAvailable: (gs.shufflesAvailable ? gs.shufflesAvailable[player.id] : 1) ?? 1
      });
    }
  }

  io.to(roomCode).emit('chat:message', {
    type: 'system',
    text: `👑 Rodada ${gs.round}: ${gs.czarName} é o Czar! Pergunta: "${blackCard.text}"`,
    timestamp: Date.now()
  });

  // Se for teste solo (apenas 1 jogador na sala), injeta bots automaticamente após 1.5s
  if (activePlayers.length === 1) {
    const pickRequired = blackCard.pick || 1;
    const bot1 = [];
    const bot2 = [];
    for (let i = 0; i < pickRequired; i++) {
      bot1.push(drawCartasWhiteCard(gs));
      bot2.push(drawCartasWhiteCard(gs));
    }
    gs.submissions['rando_1'] = {
      playerId: 'rando_1',
      playerName: 'Rando Cardrissian 🤖',
      cards: bot1
    };
    gs.submissions['rando_2'] = {
      playerId: 'rando_2',
      playerName: 'Inimigo do Bom Senso 🤖',
      cards: bot2
    };

    setTimeout(() => {
      advanceCartasToJudging(room, io, roomCode);
    }, 1500);
  }
}

function advanceCartasToJudging(room, io, roomCode) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'submitting') return;

  gs.phase = 'judging';
  const subsList = Object.values(gs.submissions);

  // Embaralha anonimamente
  const anonymousSubs = shuffleCartasArray(subsList).map((sub, idx) => ({
    subId: `sub_${idx}_${Date.now()}`,
    cards: sub.cards,
    revealed: false,
    originalPlayerId: sub.playerId,
    originalPlayerName: sub.playerName
  }));

  gs.shuffledSubmissions = anonymousSubs;

  io.to(roomCode).emit('game:cartas:judging-start', {
    blackCard: gs.currentBlackCard,
    czarId: gs.czarId,
    czarName: gs.czarName,
    submissions: anonymousSubs.map(s => ({
      subId: s.subId,
      cards: s.cards,
      revealed: s.revealed
    }))
  });
}

gameHandlers['cartas-contra-humanidade'] = {
  start(room, io, roomCode) {
    const playersList = Array.from(room.players.values()).filter(p => p.connected);

    room.gameState = {
      gameId: 'cartas-contra-humanidade',
      phase: 'submitting',
      round: 0,
      targetScore: 5, // Primeiro a 5 pontos vence
      czarIndex: 0,
      czarId: null,
      czarName: '',
      blackDeck: shuffleCartasArray(cartasDeckData.blackCards || []),
      whiteDeck: shuffleCartasArray(cartasDeckData.whiteCards || []),
      discardBlack: [],
      discardWhite: [],
      playerHands: {},
      scores: {},
      shufflesAvailable: {}, // 1 único shuffle por jogador por toda jornada!
      submissions: {},
      shuffledSubmissions: [],
      roundWinner: null
    };

    // Inicializa scores, mãos e shuffles únicos da jornada
    for (const p of playersList) {
      room.gameState.scores[p.id] = 0;
      room.gameState.shufflesAvailable[p.id] = 1;
      room.gameState.playerHands[p.id] = [];
      for (let i = 0; i < 10; i++) {
        room.gameState.playerHands[p.id].push(drawCartasWhiteCard(room.gameState));
      }
    }

    startCartasRound(room, io, roomCode);
  },

  handleAction(room, io, roomCode, socket, data) {
    const gs = room.gameState;
    if (!gs) return;

    if (data.action === 'submit') {
      if (gs.phase !== 'submitting') return;
      if (socket.id === gs.czarId) return; // Czar não joga carta
      if (gs.submissions[socket.id]) return; // Já enviou

      const cardIds = Array.isArray(data.cardIds) ? data.cardIds : [data.cardIds];
      const pickRequired = gs.currentBlackCard?.pick || 1;
      if (cardIds.length !== pickRequired) return;

      const hand = gs.playerHands[socket.id] || [];
      const chosenCards = [];
      for (const cid of cardIds) {
        const found = hand.find(c => c.id === cid);
        if (!found) return;
        chosenCards.push(found);
      }

      // Remove da mão e descarta
      for (const chosen of chosenCards) {
        const idx = hand.findIndex(c => c.id === chosen.id);
        if (idx !== -1) {
          hand.splice(idx, 1);
          gs.discardWhite.push(chosen);
        }
      }

      const player = room.players.get(socket.id);
      gs.submissions[socket.id] = {
        playerId: socket.id,
        playerName: player?.name || 'Jogador',
        cards: chosenCards
      };

      // Confirmação para o jogador com sua mão atualizada
      socket.emit('game:cartas:submitted-ack', {
        hand: gs.playerHands[socket.id]
      });

      // Progresso para a sala
      const activeNonCzar = Array.from(room.players.values())
        .filter(p => p.connected && p.id !== gs.czarId);
      const submittedCount = Object.keys(gs.submissions).length;

      io.to(roomCode).emit('game:cartas:submission-progress', {
        submittedCount,
        totalNeeded: activeNonCzar.length,
        submittedPlayerIds: Object.keys(gs.submissions)
      });

      // Se todos os não-czars enviaram
      if (submittedCount >= activeNonCzar.length) {
        // Se houver apenas 1 não-czar (sala de 2 jogadores), injeta Rando Cardrissian
        if (activeNonCzar.length === 1) {
          const botCards = [];
          for (let i = 0; i < pickRequired; i++) {
            botCards.push(drawCartasWhiteCard(gs));
          }
          gs.submissions['rando_bot'] = {
            playerId: 'rando_bot',
            playerName: 'Rando Cardrissian 🤖',
            cards: botCards
          };
        }
        advanceCartasToJudging(room, io, roomCode);
      }
    }

    // AÇÃO: ÚNICO SHUFFLE POR JORNADA (Reset de todas as cartas com até 3 salvas)
    else if (data.action === 'shuffle-hand') {
      if (gs.phase !== 'submitting') return;
      if (socket.id === gs.czarId) return; // Czar não possui cartas para enviar
      if (gs.submissions[socket.id]) return; // Já enviou sua resposta da rodada

      if (!gs.shufflesAvailable || gs.shufflesAvailable[socket.id] !== 1) {
        socket.emit('game:cartas:error', { message: 'Você já utilizou seu único shuffle desta partida!' });
        return;
      }

      const hand = gs.playerHands[socket.id] || [];
      const keepCardIds = Array.isArray(data.keepCardIds) ? data.keepCardIds.slice(0, 3) : [];

      const savedCards = [];
      const cardsToDiscard = [];

      for (const card of hand) {
        if (keepCardIds.includes(card.id) && savedCards.length < 3) {
          savedCards.push(card);
        } else {
          cardsToDiscard.push(card);
        }
      }

      // Descarta as demais cartas
      for (const card of cardsToDiscard) {
        gs.discardWhite.push(card);
      }

      // Nova mão começa com as até 3 cartas salvas
      const newHand = [...savedCards];
      while (newHand.length < 10) {
        newHand.push(drawCartasWhiteCard(gs));
      }

      gs.playerHands[socket.id] = newHand;
      gs.shufflesAvailable[socket.id] = 0; // Gastou o único shuffle da jornada!

      socket.emit('game:cartas:hand-shuffled', {
        hand: newHand,
        savedCount: savedCards.length,
        shufflesAvailable: 0
      });

      const player = room.players.get(socket.id);
      io.to(roomCode).emit('chat:message', {
        type: 'system',
        text: `🔀 ${player?.name || 'Jogador'} usou seu único Shuffle da partida e renovou a mão (salvou ${savedCards.length} cartas)!`,
        timestamp: Date.now()
      });
    }

    else if (data.action === 'reveal-card') {
      if (gs.phase !== 'judging') return;
      if (socket.id !== gs.czarId && room.hostId !== socket.id) return;

      const sub = gs.shuffledSubmissions.find(s => s.subId === data.subId);
      if (!sub || sub.revealed) return;

      sub.revealed = true;
      io.to(roomCode).emit('game:cartas:card-revealed', {
        subId: sub.subId
      });
    }

    else if (data.action === 'judge') {
      if (gs.phase !== 'judging') return;
      if (socket.id !== gs.czarId) return; // Apenas o Czar julga

      const sub = gs.shuffledSubmissions.find(s => s.subId === data.subId);
      if (!sub) return;

      gs.phase = 'round-winner';
      const winnerId = sub.originalPlayerId;
      const winnerName = sub.originalPlayerName;

      if (winnerId !== 'rando_bot') {
        gs.scores[winnerId] = (gs.scores[winnerId] || 0) + 1;
      }

      const completed = formatCartasCompletedSentence(gs.currentBlackCard.text, sub.cards);
      const isGameOver = (winnerId !== 'rando_bot' && gs.scores[winnerId] >= gs.targetScore);

      io.to(roomCode).emit('game:cartas:round-winner', {
        winnerId,
        winnerName,
        winningCards: sub.cards,
        blackCard: gs.currentBlackCard,
        completedSentence: completed,
        scores: gs.scores,
        players: getRoomPlayers(roomCode),
        isGameOver
      });
    }

    else if (data.action === 'next-round') {
      if (gs.phase !== 'round-winner') return;
      if (socket.id !== gs.czarId && room.hostId !== socket.id) return;

      const activePlayers = Array.from(room.players.values()).filter(p => p.connected);
      let maxScore = 0;
      for (const p of activePlayers) {
        if ((gs.scores[p.id] || 0) > maxScore) maxScore = gs.scores[p.id];
      }

      if (maxScore >= gs.targetScore) {
        gs.phase = 'game-over';
        const rankings = activePlayers.map(p => ({
          id: p.id,
          name: p.name,
          score: gs.scores[p.id] || 0
        })).sort((a, b) => b.score - a.score);

        // Pontuação para o Ranking Geral do Lobby (apenas no fim da partida):
        if (rankings[0]) {
          const p1 = room.players.get(rankings[0].id);
          if (p1) p1.score += 50;
        }
        if (rankings[1]) {
          const p2 = room.players.get(rankings[1].id);
          if (p2) p2.score += 25;
        }
        if (rankings[2]) {
          const p3 = room.players.get(rankings[2].id);
          if (p3) p3.score += 10;
        }

        io.to(roomCode).emit('game:cartas:game-over', {
          rankings,
          targetScore: gs.targetScore
        });
        broadcastRoomState(roomCode);
      } else {
        gs.czarIndex++;
        startCartasRound(room, io, roomCode);
      }
    }
  }
};

gameHandlers['cartas'] = gameHandlers['cartas-contra-humanidade'];

// --- DIGITE DIREITO ---
// Battle royale de digitação (módulo próprio: server/digite-direito.js)
gameHandlers['digite-direito'] = require('./server/digite-direito').createHandler({ broadcastRoomState });

// Briga de rua battle royale (módulo próprio: server/vem-na-mao.js)
gameHandlers['vem-na-mao'] = require('./server/vem-na-mao').createHandler({ broadcastRoomState });

// ==================== SOCKET.IO HANDLERS ====================

io.on('connection', (socket) => {
  console.log(`[+] Conectado: ${socket.id}`);

  // Enviar lista de jogos
  socket.emit('game-list', GAME_LIST);

  // --- CRIAR SALA ---
  socket.on('room:create', (data, callback) => {
    const code = generateRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      currentGame: null,
      gameState: null,
      chatHistory: [],
      gameInterval: null
    };
    room.players.set(socket.id, {
      id: socket.id,
      name: data.playerName || 'Jogador',
      score: 0,
      isHost: true,
      connected: true
    });
    rooms.set(code, room);
    playerSockets.set(socket.id, { roomCode: code, playerName: data.playerName });
    socket.join(code);
    console.log(`[SALA] Criada: ${code} por ${data.playerName}`);
    callback({ success: true, code });
    broadcastRoomState(code);
  });

  // --- ENTRAR NA SALA ---
  socket.on('room:join', (data, callback) => {
    const code = data.roomCode?.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      callback({ success: false, error: 'Sala não encontrada!' });
      return;
    }
    if (room.players.size >= 10) {
      callback({ success: false, error: 'Sala cheia (máx. 10 jogadores)!' });
      return;
    }
    if (room.currentGame) {
      callback({ success: false, error: 'Jogo em andamento! Aguarde o fim da rodada.' });
      return;
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: data.playerName || 'Jogador',
      score: 0,
      isHost: false,
      connected: true
    });
    playerSockets.set(socket.id, { roomCode: code, playerName: data.playerName });
    socket.join(code);

    // Enviar histórico de chat
    socket.emit('chat:history', room.chatHistory.slice(-50));

    console.log(`[SALA] ${data.playerName} entrou em ${code}`);
    callback({ success: true, code });

    // Notificar na sala
    io.to(code).emit('chat:message', {
      type: 'system',
      text: `${data.playerName} entrou na sala!`,
      timestamp: Date.now()
    });
    broadcastRoomState(code);
  });

  // --- CHAT ---
  socket.on('chat:send', (data) => {
    const info = playerSockets.get(socket.id);
    if (!info) return;
    const room = rooms.get(info.roomCode);
    if (!room) return;

    const msg = {
      type: 'player',
      name: info.playerName,
      text: data.text.substring(0, 200),
      timestamp: Date.now()
    };
    room.chatHistory.push(msg);
    if (room.chatHistory.length > 100) room.chatHistory.shift();
    io.to(info.roomCode).emit('chat:message', msg);
  });

  // --- INICIAR JOGO ---
  socket.on('game:start', (data) => {
    const info = playerSockets.get(socket.id);
    if (!info) return;
    const room = rooms.get(info.roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) return;

    const gameId = data.gameId;
    const gameDef = GAME_LIST.find(g => g.id === gameId);
    if (!gameDef) return;
    if (room.players.size < gameDef.minPlayers) {
      socket.emit('game:error', { message: `Mínimo de ${gameDef.minPlayers} jogadores para este jogo!` });
      return;
    }

    const prevHandler = room.currentGame && gameHandlers[room.currentGame];
    if (prevHandler && prevHandler.stop) prevHandler.stop(room);

    room.currentGame = gameId;
    io.to(info.roomCode).emit('game:starting', { gameId, gameName: gameDef.name, icon: gameDef.icon });

    const handler = gameHandlers[gameId];
    if (handler) {
      setTimeout(() => handler.start(room, io, info.roomCode), 1500);
    }

    io.to(info.roomCode).emit('chat:message', {
      type: 'system',
      text: `🎮 Jogo iniciado: ${gameDef.icon} ${gameDef.name}`,
      timestamp: Date.now()
    });
  });

  // --- AÇÃO DO JOGO ---
  socket.on('game:action', (data) => {
    const info = playerSockets.get(socket.id);
    if (!info) return;
    const room = rooms.get(info.roomCode);
    if (!room || !room.currentGame) return;

    const handler = gameHandlers[room.currentGame];
    if (handler && handler.handleAction) {
      handler.handleAction(room, io, info.roomCode, socket, data);
    }
  });

  // --- VOLTAR AO LOBBY ---
  socket.on('game:back-to-lobby', () => {
    const info = playerSockets.get(socket.id);
    if (!info) return;
    const room = rooms.get(info.roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) return;

    const lobbyHandler = room.currentGame && gameHandlers[room.currentGame];
    if (lobbyHandler && lobbyHandler.stop) lobbyHandler.stop(room);
    if (room.gameInterval) clearInterval(room.gameInterval);
    if (room.gameState?.turnTimer) clearTimeout(room.gameState.turnTimer);
    if (room.gameState?.votingTimer) clearTimeout(room.gameState.votingTimer);
    room.currentGame = null;
    room.gameState = null;
    io.to(info.roomCode).emit('game:ended');
    broadcastRoomState(info.roomCode);
  });

  // --- RESETAR PONTOS ---
  socket.on('room:reset-scores', () => {
    const info = playerSockets.get(socket.id);
    if (!info) return;
    const room = rooms.get(info.roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) return;

    for (const [, p] of room.players) {
      p.score = 0;
    }
    io.to(info.roomCode).emit('chat:message', {
      type: 'system',
      text: '🔄 Pontuações resetadas!',
      timestamp: Date.now()
    });
    broadcastRoomState(info.roomCode);
  });

  // --- DESCONECTAR ---
  socket.on('disconnect', () => {
    const info = playerSockets.get(socket.id);
    if (!info) return;
    const room = rooms.get(info.roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (player) player.connected = false;

    // Jogos com tratamento próprio de desconexão (ex.: Death Ball elimina o jogador na hora)
    const dcHandler = room.currentGame && gameHandlers[room.currentGame];
    if (dcHandler && dcHandler.onDisconnect) {
      try { dcHandler.onDisconnect(room, io, info.roomCode, socket.id); } catch (e) { console.error('[onDisconnect]', e); }
    }

    io.to(info.roomCode).emit('chat:message', {
      type: 'system',
      text: `${info.playerName} saiu da sala.`,
      timestamp: Date.now()
    });

    // Remover jogador após timeout
    setTimeout(() => {
      const r = rooms.get(info.roomCode);
      if (!r) return;
      const p = r.players.get(socket.id);
      if (p && !p.connected) {
        r.players.delete(socket.id);
        playerSockets.delete(socket.id);

        // Se era o host, transferir
        if (r.hostId === socket.id && r.players.size > 0) {
          const newHost = r.players.entries().next().value;
          r.hostId = newHost[0];
          newHost[1].isHost = true;
        }

        if (r.players.size === 0) {
          const emptyHandler = r.currentGame && gameHandlers[r.currentGame];
          if (emptyHandler && emptyHandler.stop) emptyHandler.stop(r);
          if (r.gameInterval) clearInterval(r.gameInterval);
          rooms.delete(info.roomCode);
          console.log(`[SALA] Removida: ${info.roomCode} (vazia)`);
        } else {
          broadcastRoomState(info.roomCode);
        }
      }
    }, 30000);

    broadcastRoomState(info.roomCode);
    console.log(`[-] Desconectado: ${socket.id} (${info.playerName})`);
  });
});

// ==================== INICIAR SERVIDOR ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Hub de Jogos rodando em http://localhost:${PORT}`);
});
