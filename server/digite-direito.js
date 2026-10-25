/**
 * Digite Direito v4 — Battle Royale de digitação (inspirado em "Final Sentence")
 * ==============================================================================
 * Regras
 * - A partida é uma sequência de CICLOS. Em cada ciclo todos recebem o MESMO texto
 *   (cada vez mais longo) e um tempo-limite. É uma corrida: quem termina primeiro pontua mais.
 * - Cada jogador tem um revólver de 6 câmaras com 1 bala em posição secreta.
 *   A cada 4 erros ele puxa o gatilho (chance 1/6, depois 1/5, 1/4... — as câmaras vazias
 *   já gastas não voltam). O 1º lugar de cada ciclo RECARREGA o tambor (volta a 1/6).
 * - Quando só resta UM jogador vivo sem terminar, ele é o último: é ELIMINADO na hora,
 *   a menos que a roleta já tenha matado alguém neste ciclo.
 * - Tempo esgotado: todos que não terminaram puxam o gatilho; se ninguém morreu no ciclo,
 *   o de menor progresso é eliminado.
 * - Último vivo vence. Com 2 vivos é o DUELO FINAL: quem terminar primeiro ganha.
 *
 * O servidor é a autoridade: recebe as teclas e decide acertos, erros, gatilhos e chegada.
 * Estado interno em room.dd (room.gameState só leva { gameId, phase } para o room:state).
 */
'use strict';
const { performance } = require('perf_hooks');

const PREFIX = 'game:digite:';
const now = () => performance.now();
const COLORS = ['#f59e0b', '#38bdf8', '#f472b6', '#4ade80', '#a78bfa', '#fb7185', '#facc15', '#2dd4bf', '#fb923c', '#94a3b8'];

const CFG = Object.freeze({
  STRIKE_ERRORS: 4,       // erros para puxar o gatilho
  CHAMBERS: 6,
  PULL_MS: 2600,          // duração da "cena" do gatilho (jogador fica travado)
  INTRO_MS: 2600,         // apresentação do ciclo
  COUNTDOWN_MS: 3000,
  RESOLVE_MS: 3600,       // pausa dramática entre ciclos
  TICK_MS: 50,            // loop do servidor
  BROADCAST_EVERY: 2,     // progresso a 10 Hz
  MAX_KEYS_PER_MSG: 40,
});

// Frases originais com clima de suspense. Os ciclos juntam frases até o tamanho-alvo.
const SENTENCES = [
  'A porta rangeu sozinha no fim do corredor.',
  'Ninguém na sala ousava olhar para o relógio.',
  'O último a terminar não volta para casa.',
  'A luz piscou duas vezes e então apagou.',
  'Cada tecla errada aproxima o fim.',
  'O tambor gira e o silêncio pesa.',
  'Ele contou as balas e sorriu sem motivo.',
  'Havia seis cadeiras e apenas um vencedor.',
  'O papel tremia entre os dedos suados.',
  'Lá fora a chuva apagava todas as pegadas.',
  'A máquina de escrever não perdoa ninguém.',
  'Respire fundo e não olhe para trás.',
  'O relógio da parede parou às três horas.',
  'Quem hesita perde a vez e a vida.',
  'A sorte escolhe sempre o mais confiante.',
  'Todos juraram que a arma estava vazia.',
  'Uma gota caiu sobre a última palavra.',
  'O homem de chapéu anotava cada erro.',
  'Não existe segunda chance nesta mesa.',
  'O cheiro de pólvora ainda estava no ar.',
  'Ela digitou a confissão sem piscar.',
  'O telefone tocou e ninguém atendeu.',
  'Cada segundo custa mais caro que o anterior.',
  'As paredes ouviam tudo o que era dito.',
  'O vencedor leva o silêncio dos outros.',
  'Ele sabia que a sexta câmara era a pior.',
  'A frase final ainda não foi escrita.',
  'Mãos firmes valem mais que dedos rápidos.',
  'O medo escreve devagar e erra depressa.',
  'Uma vela queimava sobre a mesa de madeira.',
  'O jogo só termina quando sobra um.',
  'Os olhos dele seguiam cada letra na tela.',
  'Nada é mais alto que um clique no escuro.',
  'Ela guardou a última bala no bolso do casaco.',
  'O corredor parecia mais longo a cada passo.',
  'Errar uma vez é azar, errar três é destino.',
  'A tinta borrou o nome do próximo da lista.',
  'Ninguém lembra quem chegou em segundo lugar.',
  'Ele digitava como quem desarma uma bomba.',
  'O ventilador de teto girava sem pressa.',
  'Havia um mapa rasgado sob a cadeira.',
  'A pressa é a melhor amiga do erro.',
  'O carteiro trouxe uma carta sem remetente.',
  'Quando a música parou, todos congelaram.',
  'O preço da vitória foi pago em silêncio.',
  'Três batidas na porta e depois mais nada.',
  'A janela estava aberta, mas ninguém fugiu.',
  'Cada linha escrita é um passo para a saída.',
  'O detetive guardou a caneta e suspirou.',
  'O destino tem pressa e não aceita desculpas.',
];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Igualdade tolerante a acentos (á=a, ç=c), mas sensível a maiúsculas e pontuação. */
const _norm = new Map();
function base(ch) {
  let r = _norm.get(ch);
  if (r === undefined) { r = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); _norm.set(ch, r); }
  return r;
}
function sameChar(typed, expected) { return typed === expected || base(typed) === base(expected); }

function targetLen(cycle) { return [0, 55, 85, 115, 140, 160][Math.min(cycle, 5)] + (cycle > 5 ? (cycle - 5) * 10 : 0); }
function timeLimitMs(len, cycle) {
  const cps = Math.min(3.8, 2.45 + 0.25 * (cycle - 1)); // ritmo mínimo exigido sobe a cada ciclo
  return Math.round((len / cps + 5) * 1000);
}

function createHandler({ broadcastRoomState }) {

  function emit(g, ev, data) { g.io.to(g.roomCode).emit(PREFIX + ev, data); }

  // ==================== CICLO DE VIDA ====================
  function start(room, io, roomCode) {
    stop(room);
    const humans = Array.from(room.players.values()).filter(p => p.connected !== false);
    const solo = humans.length === 1;
    const players = humans.map((h, i) => makePlayer(i, h.id, h.name, false));
    if (solo) {
      [['Datilógrafa', 4.6, 0.025], ['Escrivão', 4.0, 0.02], ['Repórter', 5.2, 0.035]].forEach(([n, cps, err]) => {
        const p = makePlayer(players.length, 'bot_' + n, n, true);
        p.bot = { cps, err, acc: 0, pause: 0 };
        players.push(p);
      });
    }
    const g = {
      io, room, roomCode, players, byId: new Map(players.map(p => [p.id, p])), solo,
      cycle: 0, text: '', phase: 'waiting', phaseEndsAt: 0, startAt: 0, endAt: 0,
      finishCount: 0, deathsThisCycle: 0, deck: shuffle(SENTENCES.slice()), deckPos: 0,
      tickN: 0, timer: null, stopped: false, elimOrder: [],
    };
    room.dd = g;
    room.gameState = { gameId: 'digite-direito', phase: 'playing' };
    emit(g, 'start', {
      solo, chambers: CFG.CHAMBERS, strike: CFG.STRIKE_ERRORS,
      players: players.map(p => ({ i: p.i, id: p.id, name: p.name, color: p.color, isBot: p.isBot })),
    });
    g.timer = setInterval(() => tick(g), CFG.TICK_MS);
    setTimeout(() => { if (!g.stopped) beginCycle(g); }, 3200); // tempo para ler as regras
  }

  function stop(room) {
    const g = room && room.dd;
    if (!g) return;
    g.stopped = true;
    if (g.timer) clearInterval(g.timer);
    g.timer = null;
    room.dd = null;
  }

  function makePlayer(i, id, name, isBot) {
    return {
      i, id, name: String(name || 'Jogador').slice(0, 20), isBot, color: COLORS[i % COLORS.length],
      alive: true, connected: true, pos: 0, strikeErr: 0, finishedAt: 0, place: 0,
      chambers: CFG.CHAMBERS, bullet: Math.floor(Math.random() * CFG.CHAMBERS), spent: 0,
      pull: null, // { resolveAt, dies }
      score: 0, elimPlace: 0, elimCause: '',
      st: { keys: 0, correct: 0, errors: 0, pulls: 0, wins: 0, typingMs: 0, chars: 0, bestWpm: 0 },
      bot: null, lastKeyAt: 0,
    };
  }

  const alive = (g) => g.players.filter(p => p.alive);

  // ==================== CICLOS ====================
  function nextText(g, len) {
    const parts = [];
    let total = 0;
    while (total < len || parts.length === 0) {
      if (g.deckPos >= g.deck.length) { g.deck = shuffle(SENTENCES.slice()); g.deckPos = 0; }
      const s = g.deck[g.deckPos++];
      parts.push(s); total += s.length + 1;
      if (total > len * 1.25) break;
    }
    return parts.join(' ');
  }

  function beginCycle(g) {
    if (g.stopped) return;
    g.cycle++;
    g.text = nextText(g, targetLen(g.cycle));
    g.finishCount = 0;
    g.deathsThisCycle = 0;
    const t = now();
    g.phase = 'intro';
    g.startAt = t + CFG.INTRO_MS + CFG.COUNTDOWN_MS;
    const limit = timeLimitMs(g.text.length, g.cycle);
    g.endAt = g.startAt + limit;
    for (const p of g.players) {
      p.pos = 0; p.strikeErr = 0; p.finishedAt = 0; p.place = 0; p.counted = false;
      if (p.bot) { p.bot.acc = 0; p.bot.pause = 0; p.bot.cps = p.bot.cps * (0.97 + Math.random() * 0.08); }
    }
    const al = alive(g);
    emit(g, 'cycle', {
      n: g.cycle, text: g.text, limitMs: limit, startIn: g.startAt - t, duel: al.length === 2,
      alive: al.map(p => p.i), chambers: g.players.map(p => p.chambers),
    });
  }

  function tick(g) {
    if (g.stopped || g.room.dd !== g) return;
    if (!g.players.some(p => !p.isBot && p.connected)) { stop(g.room); return; }
    const t = now();
    g.tickN++;

    if (g.phase === 'intro' && t >= g.startAt) g.phase = 'typing';

    // gatilhos pendentes
    for (const p of g.players) if (p.pull && t >= p.pull.resolveAt) resolvePull(g, p, t);

    if (g.phase === 'typing') {
      updateBots(g, t);
      if (t >= g.endAt) timeUp(g, t);
      else checkCycleEnd(g, t);
    } else if (g.phase === 'timeup') {
      if (!g.players.some(p => p.pull)) finishTimeUp(g, t);
    } else if (g.phase === 'resolve' && t >= g.phaseEndsAt) {
      if (alive(g).length <= 1 || (g.solo && !alive(g).some(p => !p.isBot))) gameOver(g);
      else beginCycle(g);
    }

    if (g.tickN % CFG.BROADCAST_EVERY === 0 && (g.phase === 'typing' || g.phase === 'timeup')) {
      const arr = [];
      for (const p of g.players) arr.push(p.i, p.pos, p.strikeErr, p.alive ? 1 : 0, p.place, p.chambers, p.pull ? 1 : 0);
      g.io.to(g.roomCode).volatile.emit(PREFIX + 't', { left: Math.max(0, Math.round(g.endAt - t)), p: arr });
    }
  }

  // ==================== DIGITAÇÃO ====================
  function typeChars(g, p, s, t) {
    if (!p.alive || p.pull || p.finishedAt || g.phase !== 'typing' || t < g.startAt) return;
    const text = g.text;
    for (const ch of s) {
      if (p.pull || p.finishedAt) break;
      p.st.keys++;
      if (!p.lastKeyAt) p.lastKeyAt = t;
      if (sameChar(ch, text[p.pos])) {
        p.pos++; p.st.correct++;
        if (p.pos >= text.length) { finish(g, p, t); break; }
      } else {
        p.st.errors++; p.strikeErr++;
        if (p.strikeErr >= CFG.STRIKE_ERRORS) { startPull(g, p, t, 'errors'); break; }
      }
    }
  }

  function finish(g, p, t) {
    p.finishedAt = t;
    p.place = ++g.finishCount;
    const secs = Math.max(0.5, (t - g.startAt) / 1000);
    const wpm = Math.round((g.text.length / 5) / (secs / 60));
    p.st.typingMs += t - g.startAt; p.st.chars += g.text.length;
    p.st.bestWpm = Math.max(p.st.bestWpm, wpm);
    const pts = [0, 10, 6, 4][p.place] || 2;
    p.score += pts;
    let reload = false;
    if (p.place === 1) {
      p.st.wins++;
      if (p.chambers < CFG.CHAMBERS) { // recarrega o tambor: volta a 1/6
        p.chambers = CFG.CHAMBERS; p.spent = 0; p.bullet = Math.floor(Math.random() * CFG.CHAMBERS);
        reload = true;
      }
    }
    emit(g, 'finish', { i: p.i, place: p.place, wpm, secs: Math.round(secs * 10) / 10, pts, reload, chambers: p.chambers });
  }

  // ==================== ROLETA ====================
  function startPull(g, p, t, reason, delay = 0) {
    // câmara atual: a bala dispara se a câmara gasta atual for a da bala
    const dies = p.spent === p.bullet;
    p.pull = { resolveAt: t + delay + CFG.PULL_MS, dies };
    p.st.pulls++;
    emit(g, 'pull', { i: p.i, chambers: p.chambers, ms: CFG.PULL_MS, delay, reason });
  }

  function resolvePull(g, p, t) {
    const dies = p.pull.dies;
    p.pull = null;
    p.strikeErr = 0;
    if (dies) {
      emit(g, 'pull-result', { i: p.i, died: true, chambers: p.chambers });
      eliminate(g, p, 'roleta', t);
    } else {
      p.spent++; p.chambers--;
      p.score += 3; // sobreviveu ao gatilho
      emit(g, 'pull-result', { i: p.i, died: false, chambers: p.chambers });
    }
  }

  /** Soma o trecho digitado (parcial) às estatísticas de velocidade, uma vez por ciclo. */
  function accountPartial(g, p, t) {
    if (p.finishedAt || p.counted || !g.startAt || t <= g.startAt) return;
    p.counted = true;
    p.st.typingMs += Math.min(t, g.endAt) - g.startAt;
    p.st.chars += p.pos;
  }

  function eliminate(g, p, cause, t) {
    if (!p.alive) return;
    accountPartial(g, p, t);
    p.alive = false; p.pull = null;
    p.elimCause = cause;
    p.elimPlace = alive(g).length + 1;
    g.elimOrder.push(p.i);
    if (g.phase === 'typing' || g.phase === 'timeup') g.deathsThisCycle++;
    emit(g, 'eliminated', { i: p.i, cause, place: p.elimPlace, pos: p.pos, len: g.text.length });
  }

  // ==================== FIM DO CICLO ====================
  function checkCycleEnd(g, t) {
    const al = alive(g);
    if (g.solo && !al.some(p => !p.isBot)) { endCycle(g, t); return; }
    if (al.length <= 1) { endCycle(g, t); return; }
    if (al.some(p => p.pull)) return; // espera os gatilhos resolverem
    const pending = al.filter(p => !p.finishedAt);
    if (pending.length === 0) {
      // todos terminaram juntos: o último a chegar é o último lugar
      if (!g.deathsThisCycle) {
        const lastP = al.reduce((a, b) => (b.finishedAt > a.finishedAt ? b : a));
        eliminate(g, lastP, 'ultimo', t);
      }
      endCycle(g, t);
    } else if (pending.length === 1) {
      if (!g.deathsThisCycle) eliminate(g, pending[0], 'ultimo', t);
      endCycle(g, t);
    }
  }

  function timeUp(g, t) {
    g.phase = 'timeup';
    const pullers = alive(g).filter(p => !p.finishedAt && !p.pull);
    emit(g, 'timeup', { pullers: pullers.map(p => p.i) });
    // os gatilhos começam após 0,9 s (tempo para a tela anunciar)
    pullers.forEach(p => startPull(g, p, t, 'tempo', 900));
  }

  function finishTimeUp(g, t) {
    const al = alive(g);
    if (!g.deathsThisCycle && al.length > 1) {
      const pend = al.filter(p => !p.finishedAt);
      if (pend.length) {
        const worst = pend.reduce((a, b) => (b.pos < a.pos || (b.pos === a.pos && b.st.errors > a.st.errors)) ? b : a);
        eliminate(g, worst, 'ultimo', t);
      }
    }
    endCycle(g, t);
  }

  function endCycle(g, t) {
    if (g.phase === 'resolve') return;
    g.phase = 'resolve';
    for (const p of g.players) if (p.alive) accountPartial(g, p, t);
    g.phaseEndsAt = t + CFG.RESOLVE_MS;
    const al = alive(g);
    emit(g, 'cycle-end', {
      n: g.cycle, alive: al.map(p => p.i), nextIn: CFG.RESOLVE_MS,
      over: al.length <= 1 || (g.solo && !al.some(p => !p.isBot)),
      scores: g.players.map(p => p.score),
    });
  }

  function gameOver(g) {
    const al = alive(g);
    let champ = al.length === 1 ? al[0] : null;
    if (!champ && al.length > 1) champ = al.reduce((a, b) => (b.score > a.score ? b : a));
    if (!champ) champ = g.players.find(p => p.i === g.elimOrder[g.elimOrder.length - 1]) || g.players[0];
    champ.score += 30;
    champ.elimPlace = 1;
    // colocação: campeão 1º; demais pela ordem inversa de eliminação; vivos restantes (solo) depois do campeão
    const ranked = [champ];
    al.filter(p => p !== champ).sort((a, b) => b.score - a.score).forEach(p => ranked.push(p));
    g.elimOrder.slice().reverse().forEach(i => { const p = g.players[i]; if (!ranked.includes(p)) ranked.push(p); });
    g.players.forEach(p => { if (!ranked.includes(p)) ranked.push(p); });

    for (const p of g.players) {
      if (p.isBot) continue;
      const rp = g.room.players.get(p.id);
      if (rp) rp.score += p.score;
    }
    emit(g, 'gameover', {
      winner: champ.i, cycles: g.cycle,
      rankings: ranked.map((p, k) => {
        const acc = p.st.keys ? Math.round((p.st.correct / p.st.keys) * 1000) / 10 : 0;
        const wpm = p.st.typingMs ? Math.round((p.st.chars / 5) / (p.st.typingMs / 60000)) : 0;
        return {
          i: p.i, name: p.name, color: p.color, isBot: p.isBot, place: k + 1, score: p.score,
          cause: p === champ ? '' : p.elimCause, wpm, bestWpm: p.st.bestWpm, acc,
          pulls: p.st.pulls, wins: p.st.wins, errors: p.st.errors,
        };
      }),
    });
    g.room.gameState = { gameId: 'digite-direito', phase: 'results' };
    stop(g.room);
    broadcastRoomState(g.roomCode);
  }

  // ==================== BOTS ====================
  function updateBots(g, t) {
    if (t < g.startAt) return;
    const dt = CFG.TICK_MS / 1000;
    for (const p of g.players) {
      if (!p.bot || !p.alive || p.pull || p.finishedAt) continue;
      const b = p.bot;
      if (b.pause > 0) { b.pause -= dt; continue; }
      b.acc += b.cps * dt * (0.6 + Math.random() * 0.8);
      while (b.acc >= 1 && !p.pull && !p.finishedAt) {
        b.acc -= 1;
        if (Math.random() < b.err) {
          typeChars(g, p, '§', t);
          b.pause = 0.25 + Math.random() * 0.4; // "se recompondo" depois do erro
          break;
        }
        typeChars(g, p, g.text[p.pos], t);
      }
    }
  }

  // ==================== AÇÕES ====================
  function handleAction(room, io, roomCode, socket, data) {
    const g = room.dd;
    if (!g || !data) return;
    const p = g.byId.get(socket.id);
    if (!p || p.isBot) return;
    const t = now();
    if (data.action === 'keys') {
      if (typeof data.s !== 'string' || !data.s.length) return;
      const s = Array.from(data.s).slice(0, CFG.MAX_KEYS_PER_MSG).join('');
      typeChars(g, p, s, t);
    } else if (data.action === 'ping') {
      socket.emit(PREFIX + 'pong', { c: data.c });
    }
  }

  function onDisconnect(room, io, roomCode, socketId) {
    const g = room.dd;
    if (!g) return;
    const p = g.byId.get(socketId);
    if (!p) return;
    p.connected = false;
    if (p.alive) eliminate(g, p, 'saiu', now());
  }

  return { start, stop, handleAction, onDisconnect, _tick: tick, CFG };
}

module.exports = { createHandler, SENTENCES, sameChar };
