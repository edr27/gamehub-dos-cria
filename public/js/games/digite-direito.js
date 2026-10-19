/**
 * Digite Direito v3 — Cliente Completo
 * ======================================
 * Regras implementadas:
 * - Fases com múltiplas frases; ENTER confirma cada frase.
 * - Erro reseta a frase atual imediatamente (não bloqueia).
 * - 3 erros acumulados → roleta-russa server-side (1/6).
 * - Animação 2D cinematográfica do revólver (Canvas).
 * - Sobreviveu → erros zeram, continua na mesma frase reiniciada.
 * - Eliminado → fora da partida.
 * - Vitória quando restar ≤1 jogador vivo.
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

  // ==================== ESTADO LOCAL ====================
  var state = {
    myId: socket.id,
    phrases: [],
    currentPhraseIndex: 0,
    typed: '',
    errors: 0,
    totalErrors: 0,
    alive: true,
    inRoulette: false,
    phaseIndex: 0,
    phaseNumber: 1,
    players: {},
    roundActive: false,
    _keyHandler: null,
    rouletteCanvas: null,
    rouletteCtx: null,
    rouletteAnimId: null
  };

  // ==================== EVENTOS DO SERVIDOR ====================
  socket.on('game:digite:phase-start', function (data) {
    resetInputState();
    state.phrases = data.phrases || [];
    state.currentPhraseIndex = 0;
    state.phaseIndex = data.phaseIndex || 0;
    state.phaseNumber = data.phaseNumber || 1;
    state.players = data.players || {};
    state.roundActive = true;
    state.alive = true;
    state.inRoulette = false;
    renderGame();
    bindGlobalInput();
    if (AudioEngine && AudioEngine.gameStart) AudioEngine.gameStart();
  });

  socket.on('game:digite:player-update', function (data) {
    if (state.players[data.id]) {
      for (var k in data) {
        if (k !== 'id') state.players[data.id][k] = data[k];
      }
    }
    if (data.id === state.myId) {
      // Usar.hasOwnProperty para distinguir 0 de undefined
      state.errors = (data.errors !== undefined) ? data.errors : state.errors;
      state.totalErrors = (data.totalErrors !== undefined) ? data.totalErrors : state.totalErrors;
      state.alive = (data.alive !== undefined) ? data.alive : state.alive;
      state.inRoulette = (data.inRoulette !== undefined) ? !!data.inRoulette : state.inRoulette;
      if (data.currentPhraseIndex !== undefined) {
        state.currentPhraseIndex = data.currentPhraseIndex;
        state.typed = '';
      }
      console.log('[DD] player-update MY:', JSON.stringify({errors: state.errors, inRoulette: state.inRoulette, alive: state.alive}));
    }
    updateHUD();
  });

  socket.on('game:digite:player-progress', function (data) {
    if (state.players[data.id]) {
      state.players[data.id].phraseProgress = data.phraseProgress || 0;
    }
    updatePlayerList();
  });

  socket.on('game:digite:roulette-result', function (data) {
    state.inRoulette = true;
    unbindGlobalInput();
    playRouletteAnimation(data.eliminated, function () {
      if (data.eliminated) {
        state.alive = false;
        showEliminatedScreen();
      } else {
        socket.emit('game:action', { action: 'roulette-survived' });
        state.inRoulette = false;
        state.typed = '';
        bindGlobalInput();
        refreshPhrase();
        updateHUD();
      }
    });
  });

  socket.on('game:digite:player-eliminated', function (data) {
    if (state.players[data.id]) {
      state.players[data.id].alive = false;
    }
    updatePlayerList();
  });

  socket.on('game:digite:phase-complete', function (data) {
    unbindGlobalInput();
    state.roundActive = false;
    showPhaseComplete(data.nextPhaseIn || 3);
  });

  socket.on('game:digite:gameover', function (data) {
    unbindGlobalInput();
    state.roundActive = false;
    showGameOver(data);
    if (AudioEngine && AudioEngine.gameEnd) AudioEngine.gameEnd();
  });

  // ==================== INPUT GLOBAL (WINDOW KEYDOWN) ====================
  function bindGlobalInput() {
    unbindGlobalInput();
    state._keyHandler = function (e) {
      if (!state.roundActive || !state.alive || state.inRoulette) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      var phrase = state.phrases[state.currentPhraseIndex];
      if (!phrase) return;

      // ENTER: confirmar frase completa
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.typed === phrase) {
          socket.emit('game:action', {
            action: 'phrase-complete',
            phraseIndex: state.currentPhraseIndex
          });
          state.currentPhraseIndex++;
          state.typed = '';
          if (AudioEngine && AudioEngine.success) AudioEngine.success();
          refreshPhrase();
          updateHUD();
        }
        return;
      }

      // Backspace: apagar último caractere (NÃO remove erros já contados)
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (state.typed.length > 0) {
          state.typed = state.typed.slice(0, -1);
          refreshPhrase();
        }
        return;
      }

      // Tab: prevenir
      if (e.key === 'Tab') { e.preventDefault(); return; }

      // Apenas caracteres imprimíveis
      if (e.key.length !== 1) return;
      e.preventDefault();

      var pos = state.typed.length;
      var expected = phrase[pos];
      if (expected === undefined) return;

      if (e.key === expected) {
        state.typed += e.key;
        if (AudioEngine && AudioEngine.click) AudioEngine.click();
        // Enviar progresso parcial
        socket.emit('game:action', {
          action: 'progress',
          phraseProgress: Math.round((state.typed.length / phrase.length) * 100)
        });
      } else {
        // ERRO: resetar frase inteira, contar erro
        state.typed = '';
        if (AudioEngine && AudioEngine.error) AudioEngine.error();
        shakePhrase();
        socket.emit('game:action', { action: 'error' });
      }
      refreshPhrase();
    };
    window.addEventListener('keydown', state._keyHandler, true);
  }

  function unbindGlobalInput() {
    if (state._keyHandler) {
      window.removeEventListener('keydown', state._keyHandler, true);
      state._keyHandler = null;
    }
  }

  // ==================== RENDERIZAÇÃO PRINCIPAL ====================
  function renderGame() {
    var html = '<div class="dd-container">';

    // Header: fase + timer visual
    html += '<div class="dd-header">';
    html += '<div class="dd-phase-badge">FASE ' + state.phaseNumber + '</div>';
    html += '<div class="dd-alive-count" id="dd-alive">' + countAlive() + ' vivos</div>';
    html += '</div>';

    // Barra de erros (perigo visual)
    html += '<div class="dd-errors-wrap">';
    html += '<div class="dd-errors-label">ERROS ACUMULADOS</div>';
    html += '<div class="dd-errors-bar"><div class="dd-errors-fill" id="dd-err-fill" style="width:0%"></div></div>';
    html += '<div class="dd-errors-val" id="dd-err-val">0 / 3</div>';
    html += '</div>';

    // Progresso das frases
    html += '<div class="dd-progress-wrap">';
    html += '<div class="dd-progress-label">FRASE ' + (state.currentPhraseIndex + 1) + ' / ' + state.phrases.length + '</div>';
    html += '<div class="dd-progress-bar"><div class="dd-progress-fill" id="dd-prog-fill" style="width:0%"></div></div>';
    html += '</div>';

    // Frase para digitar
    html += '<div class="dd-phrase-box" id="dd-phrase-box">';
    html += buildPhraseHTML();
    html += '</div>';

    // Instrução
    html += '<div class="dd-hint">⌨️ Digite exatamente · ENTER para confirmar · Erro reinicia a frase</div>';

    // Lista de jogadores
    html += '<div class="dd-players" id="dd-players">';
    html += buildPlayersHTML();
    html += '</div>';

    html += '</div>';
    DOM.gameArea.innerHTML = html;
    updateHUD();
  }

  function buildPhraseHTML() {
    var phrase = state.phrases[state.currentPhraseIndex];
    if (!phrase) return '<span class="dd-char dd-cursor">_</span>';
    var html = '';
    for (var i = 0; i < phrase.length; i++) {
      var ch = phrase[i];
      var cls = 'dd-char';
      if (i < state.typed.length) {
        cls += ' dd-correct';
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
      var cls = 'dd-player';
      if (isMe) cls += ' dd-me';
      if (!p.alive) cls += ' dd-dead';
      if (p.inRoulette) cls += ' dd-roulette';
      if (p.errors >= 2 && p.alive) cls += ' dd-danger';

      html += '<div class="' + cls + '">';
      html += '<div class="dd-pname">' + escapeHtml(p.name) + (isMe ? ' (você)' : '') + '</div>';
      html += '<div class="dd-pstatus">';
      if (!p.alive) {
        html += '<span class="dd-dead-tag">💀 ELIMINADO</span>';
      } else if (p.inRoulette) {
        html += '<span class="dd-roulette-tag">🎰 ROLETA</span>';
      } else {
        html += '<span>❤️ ' + (3 - (p.errors || 0)) + '/3</span>';
        html += '<span>📝 ' + (p.currentPhraseIndex || 0) + '/' + state.phrases.length + '</span>';
      }
      html += '</div>';
      html += '</div>';
    }
    return html;
  }

  function refreshPhrase() {
    var box = document.getElementById('dd-phrase-box');
    if (box) box.innerHTML = buildPhraseHTML();
  }

  function updateHUD() {
    // Barra de erros
    var errFill = document.getElementById('dd-err-fill');
    var errVal = document.getElementById('dd-err-val');
    if (errFill) {
      var pct = Math.min(100, (state.errors / 3) * 100);
      errFill.style.width = pct + '%';
      if (state.errors >= 2) errFill.style.background = '#ef4444';
      else if (state.errors >= 1) errFill.style.background = '#f59e0b';
      else errFill.style.background = '#06b6d4';
    }
    if (errVal) errVal.textContent = state.errors + ' / 3';

    // Progresso de frases
    var progFill = document.getElementById('dd-prog-fill');
    if (progFill && state.phrases.length > 0) {
      var fpct = Math.min(100, ((state.currentPhraseIndex) / state.phrases.length) * 100);
      progFill.style.width = fpct + '%';
    }

    // Contador de vivos
    var aliveEl = document.getElementById('dd-alive');
    if (aliveEl) aliveEl.textContent = countAlive() + ' vivos';

    updatePlayerList();
  }

  function updatePlayerList() {
    var container = document.getElementById('dd-players');
    if (container) container.innerHTML = buildPlayersHTML();
  }

  function countAlive() {
    var count = 0;
    for (var id in state.players) {
      if (state.players[id].alive) count++;
    }
    return count;
  }

  function shakePhrase() {
    var box = document.getElementById('dd-phrase-box');
    if (!box) return;
    box.classList.remove('dd-shake');
    void box.offsetWidth;
    box.classList.add('dd-shake');
  }

  // ==================== TELA DE ELIMINADO ====================
  function showEliminatedScreen() {
    DOM.gameArea.innerHTML =
      '<div class="dd-eliminated-card">' +
      '<div class="dd-skull">💀</div>' +
      '<h2 class="dd-elim-title">ELIMINADO</h2>' +
      '<p class="dd-elim-desc">A roleta-russa não foi generosa desta vez.</p>' +
      '<p class="dd-elim-stats">Erros totais: ' + state.totalErrors + '</p>' +
      '</div>';
  }

  // ==================== TELA DE FASE COMPLETA ====================
  function showPhaseComplete(nextIn) {
    DOM.gameArea.innerHTML =
      '<div class="dd-phase-card">' +
      '<h2 class="dd-phase-title">✅ FASE ' + state.phaseNumber + ' COMPLETA</h2>' +
      '<p class="dd-phase-desc">Próxima fase em ' + nextIn + 's...</p>' +
      '</div>';
  }

  // ==================== TELA DE GAME OVER ====================
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
        html += '<div class="dd-frank-row' + (r.alive ? ' dd-frank-alive' : '') + '">';
        html += '<span>' + (i + 1) + 'º ' + escapeHtml(r.name) + '</span>';
        html += '<span>' + (r.alive ? '🟢 Vivo' : '💀') + ' | Erros: ' + r.totalErrors + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    DOM.gameArea.innerHTML = html;
  }

  // ==================== ROLETA-RUSSA: ANIMAÇÃO 2D CINEMATOGRÁFICA ====================
  function playRouletteAnimation(eliminated, onComplete) {
    // Criar overlay fullscreen com canvas
    var overlay = document.createElement('div');
    overlay.className = 'dd-roulette-overlay';
    overlay.innerHTML = '<canvas id="dd-roulette-canvas"></canvas>';
    document.body.appendChild(overlay);

    var canvas = document.getElementById('dd-roulette-canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    var ctx = canvas.getContext('2d');
    state.rouletteCanvas = canvas;
    state.rouletteCtx = ctx;

    var W = canvas.width;
    var H = canvas.height;
    var cx = W / 2;
    var cy = H / 2;

    // Sequência da animação (tempos em ms)
    var timeline = [
      { t: 0, label: 'darken' },
      { t: 800, label: 'gun-appear' },
      { t: 2000, label: 'bullet-insert' },
      { t: 3200, label: 'spin' },
      { t: 5000, label: 'slowdown' },
      { t: 6200, label: 'pause' },
      { t: 7000, label: 'result' },
      { t: 9000, label: 'end' }
    ];

    var startTime = performance.now();
    var gunScale = 0;
    var bulletVisible = false;
    var spinAngle = 0;
    var spinSpeed = 0;
    var resultShown = false;
    var endCalled = false;

    function drawGun(ctx, x, y, scale, rotation) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.rotate(rotation);

      // Cano do revólver
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(-120, -15, 200, 30);
      // Detalhe do cano
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(-120, -12, 195, 24);
      // Brilho no cano
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(-110, -10, 180, 8);

      // Tambor (cilindro)
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(0, 0, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Câmaras do tambor (6)
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * Math.PI * 2 + spinAngle;
        var chamberX = Math.cos(a) * 20;
        var chamberY = Math.sin(a) * 20;
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(chamberX, chamberY, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Cabo
      ctx.fillStyle = '#3d2b1f';
      ctx.beginPath();
      ctx.moveTo(30, 10);
      ctx.lineTo(60, 70);
      ctx.lineTo(90, 75);
      ctx.lineTo(95, 50);
      ctx.lineTo(50, 10);
      ctx.closePath();
      ctx.fill();
      // Detalhe do cabo
      ctx.strokeStyle = '#2a1f15';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Gatilho
      ctx.fillStyle = '#555';
      ctx.beginPath();
      ctx.arc(40, 25, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    function drawBullet(ctx, x, y, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);

      // Cápsula
      ctx.fillStyle = '#b8860b';
      ctx.fillRect(-6, -12, 12, 24);
      // Ponta
      ctx.fillStyle = '#cd7f32';
      ctx.beginPath();
      ctx.arc(0, -12, 6, Math.PI, 0);
      ctx.fill();
      // Base
      ctx.fillStyle = '#8b6914';
      ctx.fillRect(-7, 10, 14, 4);
      // Brilho
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-3, -10, 3, 18);

      ctx.restore();
    }

    function frame(now) {
      var elapsed = now - startTime;
      ctx.clearRect(0, 0, W, H);

      // Fundo escuro com vinheta
      ctx.fillStyle = 'rgba(0,0,0,0.92)';
      ctx.fillRect(0, 0, W, H);

      // Vinheta radial
      var grad = ctx.createRadialGradient(cx, cy, H * 0.2, cx, cy, H * 0.8);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Determinar fase atual
      var phase = 'darken';
      for (var i = timeline.length - 1; i >= 0; i--) {
        if (elapsed >= timeline[i].t) { phase = timeline[i].label; break; }
      }

      // Fase: gun-appear
      if (phase === 'gun-appear' || elapsed >= 800) {
        var appearT = Math.min(1, (elapsed - 800) / 1000);
        gunScale = easeOutBack(appearT);
      }

      // Fase: bullet-insert
      if (phase === 'bullet-insert' || elapsed >= 2000) {
        bulletVisible = true;
      }

      // Fase: spin
      if (phase === 'spin' || elapsed >= 3200) {
        spinSpeed = 15;
      }

      // Fase: slowdown
      if (phase === 'slowdown' || elapsed >= 5000) {
        var slowT = Math.min(1, (elapsed - 5000) / 1200);
        spinSpeed = 15 * (1 - easeInOutCubic(slowT));
      }

      // Fase: pause
      if (phase === 'pause' || elapsed >= 6200) {
        spinSpeed = 0;
      }

      spinAngle += spinSpeed * 0.016;

      // Desenhar revólver
      if (gunScale > 0.01) {
        drawGun(ctx, cx, cy - 30, gunScale, 0);
      }

      // Desenhar bala (animada entrando no tambor)
      if (bulletVisible && elapsed < 3200) {
        var bulletT = Math.min(1, (elapsed - 2000) / 800);
        var bx = cx + 200 * (1 - bulletT);
        var by = cy - 30;
        drawBullet(ctx, bx, by, easeOutCubic(bulletT));
      }

      // Texto de suspense
      if (phase === 'spin' || phase === 'slowdown' || phase === 'pause') {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = 'bold 18px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('O tambor gira...', cx, cy + 120);
      }

      // Fase: result
      if (phase === 'result' && !resultShown) {
        resultShown = true;
      }
      if (resultShown && elapsed >= 7000) {
        // Flash
        var flashT = Math.min(1, (elapsed - 7000) / 200);
        if (eliminated) {
          ctx.fillStyle = 'rgba(239, 68, 68,' + (flashT * 0.4) + ')';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 48px Outfit, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('BANG!', cx, cy - 80);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 24px Outfit, sans-serif';
          ctx.fillText('ELIMINADO', cx, cy + 140);
        } else {
          ctx.fillStyle = 'rgba(34, 197, 94,' + (flashT * 0.3) + ')';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#22c55e';
          ctx.font = 'bold 48px Outfit, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('*CLICK*', cx, cy - 80);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 24px Outfit, sans-serif';
          ctx.fillText('SOBREVIVEU', cx, cy + 140);
        }
      }

      // Fase: end
      if (phase === 'end' && !endCalled) {
        endCalled = true;
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          state.rouletteCanvas = null;
          state.rouletteCtx = null;
          if (onComplete) onComplete();
        }, 1500);
      }

      if (!endCalled) {
        state.rouletteAnimId = requestAnimationFrame(frame);
      }
    }

    state.rouletteAnimId = requestAnimationFrame(frame);
  }

  // Easing functions para animação
  function easeOutBack(t) {
    var s = 1.70158;
    return (--t) * t * ((s + 1) * t + s) + 1;
  }
  function easeOutCubic(t) { return (--t) * t * t + 1; }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
  }

  // ==================== UTILITÁRIOS ====================
  function resetInputState() {
    unbindGlobalInput();
    state.typed = '';
    state.errors = 0;
    state.totalErrors = 0;
    state.currentPhraseIndex = 0;
    state.inRoulette = false;
    state.roundActive = false;
    if (state.rouletteAnimId) {
      cancelAnimationFrame(state.rouletteAnimId);
      state.rouletteAnimId = null;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Cleanup
  socket.on('game:ended', function () { resetInputState(); });
  window.addEventListener('beforeunload', function () { unbindGlobalInput(); });
})();