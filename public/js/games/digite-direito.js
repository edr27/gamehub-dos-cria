/**
 * Digite Direito — Cliente v2
 * ============================
 * Jogo de digitação competitiva com instabilidade e eliminação.
 * Input via window keydown (não depende de foco em input element).
 */
(function () {
  'use strict';

  var socket = window.GameHub && window.GameHub.socket;
  var DOM = window.GameHub && window.GameHub.DOM;
  var AudioEngine = window.GameHub && window.GameHub.AudioEngine;

  if (!socket || !DOM) {
    console.error('[DigiteDireito] GameHub não disponível');
    return;
  }

  // Estado local
  var state = {
    myId: socket.id,
    phrase: '',
    typed: '',
    errors: 0,
    instability: 0,
    lives: 3,
    roundTime: 30,
    timerInterval: null,
    finished: false,
    players: {},
    roundActive: false,
    _keyHandler: null // referência para cleanup
  };

  // ==================== EVENTOS DO SERVIDOR ====================
  socket.on('game:digite:start', function (data) {
    resetState();
    state.phrase = data.phrase || '';
    state.roundTime = data.timeLimit || 30;
    state.players = data.players || {};
    state.roundActive = true;
    renderGame();
    startTimer();
    bindGlobalInput();
    if (AudioEngine && AudioEngine.gameStart) AudioEngine.gameStart();
  });

  socket.on('game:digite:player-update', function (data) {
    if (state.players[data.id]) {
      state.players[data.id].progress = data.progress;
      state.players[data.id].instability = data.instability;
      state.players[data.id].lives = data.lives;
      state.players[data.id].finished = data.finished;
    }
    updatePlayerBars();
  });

  socket.on('game:digite:round-end', function (data) {
    stopTimer();
    unbindGlobalInput();
    state.roundActive = false;
    showRoundResult(data);
    if (AudioEngine && AudioEngine.reveal) AudioEngine.reveal();
  });

  socket.on('game:digite:gameover', function (data) {
    stopTimer();
    unbindGlobalInput();
    state.roundActive = false;
    showGameOver(data);
    if (AudioEngine && AudioEngine.gameEnd) AudioEngine.gameEnd();
  });

  // ==================== INPUT GLOBAL (WINDOW KEYDOWN) ====================
  function bindGlobalInput() {
    unbindGlobalInput(); // limpar anterior se existir
    state._keyHandler = function (e) {
      if (!state.roundActive || state.finished) return;

      // Ignorar teclas modificadoras e de controle
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Backspace: apagar último caractere correto
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (state.typed.length > 0) {
          state.typed = state.typed.slice(0, -1);
          refreshPhrase();
        }
        return;
      }

      // Tab: prevenir foco loss
      if (e.key === 'Tab') {
        e.preventDefault();
        return;
      }

      // Apenas caracteres imprimíveis (length === 1)
      if (e.key.length !== 1) return;

      e.preventDefault(); // Prevenir scroll, atalhos do browser, etc.

      var pos = state.typed.length;
      var expected = state.phrase[pos];
      if (expected === undefined) return; // Já completou

      if (e.key === expected) {
        // Correto
        state.typed += e.key;
        if (AudioEngine && AudioEngine.click) AudioEngine.click();
      } else {
        // Errado: adicionar instabilidade, NÃO avançar
        state.errors++;
        state.instability = Math.min(100, state.instability + 10);
        updateInstability();
        shakePhrase();
        if (AudioEngine && AudioEngine.error) AudioEngine.error();

        // Verificar se atingiu 100% de instabilidade
        if (state.instability >= 100) {
          socket.emit('game:action', { action: 'instability-trigger', instability: 100 });
          state.instability = 0; // Reseta após trigger
          updateInstability();
        }
        return; // Não avança, não envia progresso
      }

      // Verificar se completou a frase
      if (state.typed.length === state.phrase.length) {
        state.finished = true;
        socket.emit('game:action', {
          action: 'finished',
          errors: state.errors,
          timeLeft: state.roundTime
        });
        if (AudioEngine && AudioEngine.reveal) AudioEngine.reveal();
      } else {
        // Enviar progresso
        socket.emit('game:action', {
          action: 'progress',
          progress: Math.round((state.typed.length / state.phrase.length) * 100),
          instability: state.instability
        });
      }

      refreshPhrase();
    };

    window.addEventListener('keydown', state._keyHandler, true); // capture phase
  }

  function unbindGlobalInput() {
    if (state._keyHandler) {
      window.removeEventListener('keydown', state._keyHandler, true);
      state._keyHandler = null;
    }
  }

  // ==================== RENDERIZAÇÃO ====================
  function renderGame() {
    var html = '<div class="dd-container">';

    // Header com timer e vidas
    html += '<div class="dd-header">';
    html += '<div class="dd-timer" id="dd-timer">' + state.roundTime + 's</div>';
    html += '<div class="dd-lives">❤️ '.repeat(state.lives) + '</div>';
    html += '</div>';

    // Barra de instabilidade
    html += '<div class="dd-instability-wrap">';
    html += '<div class="dd-instability-label">INSTABILIDADE</div>';
    html += '<div class="dd-instability-bar"><div class="dd-instability-fill" id="dd-inst-fill" style="width:0%"></div></div>';
    html += '<div class="dd-instability-val" id="dd-inst-val">0%</div>';
    html += '</div>';

    // Frase para digitar
    html += '<div class="dd-phrase-box" id="dd-phrase-box">';
    html += buildPhraseHTML();
    html += '</div>';

    // Instrução visual (sem input hidden)
    html += '<div class="dd-hint">⌨️ Digite a frase acima usando o teclado</div>';

    // Ranking lateral dos jogadores
    html += '<div class="dd-players" id="dd-players">';
    html += buildPlayersHTML();
    html += '</div>';

    html += '</div>';

    DOM.gameArea.innerHTML = html;
  }

  function buildPhraseHTML() {
    var html = '';
    for (var i = 0; i < state.phrase.length; i++) {
      var ch = state.phrase[i];
      var cls = 'dd-char';
      if (i < state.typed.length) {
        if (state.typed[i] === ch) {
          cls += ' dd-correct';
        } else {
          cls += ' dd-wrong';
        }
      } else if (i === state.typed.length) {
        cls += ' dd-cursor';
      }
      var display = ch === ' ' ? '&nbsp;' : escapeHtml(ch);
      html += '<span class="' + cls + '">' + display + '</span>';
    }
    return html;
  }

  function buildPlayersHTML() {
    var html = '';
    var ids = Object.keys(state.players).sort();
    for (var i = 0; i < ids.length; i++) {
      var p = state.players[ids[i]];
      var isMe = ids[i] === state.myId;
      var cls = 'dd-player' + (isMe ? ' dd-me' : '') + (!p.alive ? ' dd-dead' : '');
      html += '<div class="' + cls + '" data-pid="' + ids[i] + '">';
      html += '<div class="dd-pname">' + escapeHtml(p.name) + (isMe ? ' (você)' : '') + '</div>';
      html += '<div class="dd-pbar-bg"><div class="dd-pbar-fill" style="width:' + (p.progress || 0) + '%"></div></div>';
      html += '<div class="dd-pinfo">❤️ ' + (p.lives != null ? p.lives : 3) + ' | ⚠️ ' + (p.instability || 0) + '%</div>';
      if (p.finished) html += '<div class="dd-pdone">✅</div>';
      html += '</div>';
    }
    return html;
  }

  function updatePlayerBars() {
    var container = document.getElementById('dd-players');
    if (!container) return;
    container.innerHTML = buildPlayersHTML();
  }

  function refreshPhrase() {
    var box = document.getElementById('dd-phrase-box');
    if (box) box.innerHTML = buildPhraseHTML();
  }

  function updateInstability() {
    var fill = document.getElementById('dd-inst-fill');
    var val = document.getElementById('dd-inst-val');
    if (fill) {
      fill.style.width = state.instability + '%';
      // Mudar cor baseado no nível
      if (state.instability >= 70) fill.style.background = '#ef4444';
      else if (state.instability >= 40) fill.style.background = '#f59e0b';
      else fill.style.background = '#06b6d4';
    }
    if (val) val.textContent = state.instability + '%';
  }

  function shakePhrase() {
    var box = document.getElementById('dd-phrase-box');
    if (!box) return;
    box.classList.remove('dd-shake');
    void box.offsetWidth; // force reflow para reiniciar animação
    box.classList.add('dd-shake');
  }

  // ==================== TIMER ====================
  function startTimer() {
    stopTimer();
    var remaining = state.roundTime;
    var timerEl = document.getElementById('dd-timer');
    state.timerInterval = setInterval(function () {
      remaining--;
      if (timerEl) {
        timerEl.textContent = remaining + 's';
        if (remaining <= 5) timerEl.classList.add('dd-urgent');
      }
      if (remaining <= 0) {
        stopTimer();
        if (!state.finished) {
          socket.emit('game:action', { action: 'timeout' });
        }
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  // ==================== RESULTADOS ====================
  function showRoundResult(data) {
    var html = '<div class="dd-result-card">';
    html += '<h2 class="dd-result-title">📝 FIM DO ROUND</h2>';
    if (data.rankings) {
      html += '<div class="dd-rankings">';
      for (var i = 0; i < data.rankings.length; i++) {
        var r = data.rankings[i];
        html += '<div class="dd-rank-row">';
        html += '<span class="dd-rank-pos">' + (i + 1) + 'º</span>';
        html += '<span class="dd-rank-name">' + escapeHtml(r.name) + '</span>';
        html += '<span class="dd-rank-detail">' + (r.finished ? '✅ Completou' : '❌ Não completou') + '</span>';
        html += '<span class="dd-rank-pts">+' + (r.points || 0) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    DOM.gameArea.innerHTML = html;
  }

  function showGameOver(data) {
    var winner = data.winner || 'Ninguém';
    var html = '<div class="dd-gameover-card">';
    html += '<div class="dd-trophy">🏆</div>';
    html += '<h2 class="dd-gameover-title">CAMPEÃO</h2>';
    html += '<div class="dd-winner-name">' + escapeHtml(winner) + '</div>';
    if (data.rankings) {
      html += '<div class="dd-final-rankings">';
      for (var i = 0; i < data.rankings.length; i++) {
        var r = data.rankings[i];
        html += '<div class="dd-frank-row">';
        html += '<span>' + (i + 1) + 'º ' + escapeHtml(r.name) + '</span>';
        html += '<span>' + (r.score || 0) + ' pts</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    DOM.gameArea.innerHTML = html;
  }

  // ==================== UTILITÁRIOS ====================
  function resetState() {
    stopTimer();
    unbindGlobalInput();
    state.typed = '';
    state.errors = 0;
    state.instability = 0;
    state.finished = false;
    state.roundActive = false;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Cleanup ao sair do jogo
  socket.on('game:ended', function () {
    resetState();
  });

  // Cleanup ao sair da sala ou recarregar
  window.addEventListener('beforeunload', function () {
    unbindGlobalInput();
  });
})();