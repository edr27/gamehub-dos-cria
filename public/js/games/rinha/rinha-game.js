/**
 * Rinha.io — Orquestrador Principal (Cliente)
 * =============================================
 * Integra todos os módulos do jogo: lobby UI, seleção de lutador,
 * arena de combate com game loop (rAF + acumulador fixo), predição local,
 * rede, HUD, renderer, modo treino e integração com o hub.
 *
 * Este é o ponto de entrada chamado pelo hub quando o jogo inicia.
 */
(function () {
  'use strict';

  // Módulos (disponíveis como globais via <script> tags no index.html)
  var Config = window.RinhaConfig;
  var Engine = window.RinhaEngine;
  var InputManager = window.RinhaInput;
  var Renderer = window.RinhaRenderer;
  var HUD = window.RinhaHUD;
  var NetClient = window.RinhaNet;
  var TrainingMode = window.RinhaTraining;

  if (!Config || !Engine) {
    console.error('[RinhaGame] Módulos não carregados!');
    return;
  }

  // ==================== ESTADO DO JOGO ====================

  var state = {
    phase: 'idle',         // idle, lobby, countdown, fighting, results, training
    roomCode: null,
    localPlayerId: null,
    playerName: '',
    fighterId: 'faisca',
    isReady: false,
    isSpectator: false,
    mode: '1v1',           // 1v1, ffa, 2v2
    sessionScores: {},     // playerId -> vitórias na sessão
    matchState: null,      // { round, scores, phase }
    net: null,
    input: null,
    renderer: null,
    hud: null,
    training: null,
    world: null,           // mundo local para predição
    canvas: null,
    container: null,
    rafId: null,
    lastTime: 0,
    accumulator: 0,
    renderAlpha: 0,
    cleanupFns: []         // funções de cleanup ao sair
  };

  var TICK_MS = 1000 / Config.TICK_RATE;

  // ==================== INTEGRAÇÃO COM O HUB ====================

  /**
   * Chamado pelo hub quando o jogo Rinha é iniciado.
   * @param {object} hubCtx - Contexto do hub { socket, state, DOM, roomCode, playerName }
   */
  function initRinha(hubCtx) {
    if (!hubCtx) {
      console.error('[RinhaGame] hubCtx não fornecido!');
      return;
    }

    // Proteção contra re-inicialização múltipla (listeners duplicados)
    if (state.phase !== 'idle' && state.container) {
      console.warn('[RinhaGame] Já inicializado, ignorando chamada duplicada');
      return;
    }

    state.roomCode = hubCtx.roomCode || hubCtx.state?.roomCode;
    state.playerName = hubCtx.playerName || hubCtx.state?.playerName || 'Jogador';
    state.phase = 'lobby';

    // Obter container do jogo
    var gameArea = document.getElementById('game-area');
    if (!gameArea) {
      console.error('[RinhaGame] #game-area não encontrado!');
      return;
    }

    // Limpar conteúdo anterior
    gameArea.innerHTML = '';

    // Criar estrutura do jogo
    state.container = document.createElement('div');
    state.container.className = 'rinha-container';
    state.container.innerHTML = '' +
      '<div class="rinha-lobby" id="rinha-lobby"></div>' +
      '<div class="rinha-arena hidden" id="rinha-arena">' +
        '<canvas id="rinha-canvas"></canvas>' +
        '<div id="rinha-hud-container"></div>' +
      '</div>' +
      '<div class="rinha-results hidden" id="rinha-results"></div>';
    gameArea.appendChild(state.container);

    // Renderizar lobby
    renderLobby();

    // Conectar à rede
    connectNetwork(hubCtx.socket);
  }

  // ==================== LOBBY UI ====================

  function renderLobby() {
    var lobbyEl = document.getElementById('rinha-lobby');
    if (!lobbyEl) return;

    lobbyEl.classList.remove('hidden');
    document.getElementById('rinha-arena').classList.add('hidden');
    document.getElementById('rinha-results').classList.add('hidden');

    lobbyEl.innerHTML = '' +
      '<div class="rl-header">' +
        '<h2 class="rl-title">⚔️ RINHA.IO</h2>' +
        '<p class="rl-subtitle">Arena de Combate Multiplayer</p>' +
      '</div>' +
      '<div class="rl-content">' +
        '<div class="rl-section">' +
          '<h3 class="rl-section-title">Escolha seu Lutador</h3>' +
          '<div class="rl-fighter-cards">' +
            buildFighterCard('faisca') +
            buildFighterCard('golias') +
          '</div>' +
        '</div>' +
        '<div class="rl-section">' +
          '<h3 class="rl-section-title">Modo de Jogo</h3>' +
          '<div class="rl-mode-selector">' +
            '<button class="rl-mode-btn active" data-mode="1v1">1v1 Rei da Mesa</button>' +
            '<button class="rl-mode-btn" data-mode="ffa">Free-for-All</button>' +
            '<button class="rl-mode-btn" data-mode="2v2">2v2 Equipes</button>' +
          '</div>' +
        '</div>' +
        '<div class="rl-section">' +
          '<h3 class="rl-section-title">Jogadores na Sala</h3>' +
          '<div class="rl-roster" id="rl-roster">Carregando...</div>' +
        '</div>' +
      '</div>' +
      '<div class="rl-actions">' +
        '<button class="rl-btn rl-btn-ready" id="rl-btn-ready">PRONTO</button>' +
        '<button class="rl-btn rl-btn-train" id="rl-btn-train">🏋️ Treinar Offline</button>' +
      '</div>';

    // Event listeners
    bindLobbyEvents(lobbyEl);
  }

  function buildFighterCard(fighterId) {
    var f = Config.FIGHTERS[fighterId];
    var selected = state.fighterId === fighterId ? ' selected' : '';
    return '' +
      '<div class="rl-fighter-card' + selected + '" data-fighter="' + fighterId + '">' +
        '<div class="rl-fc-name">' + f.name + '</div>' +
        '<div class="rl-fc-desc">' + f.desc + '</div>' +
        '<div class="rl-fc-stats">' +
          '<span>❤️ ' + f.hp + '</span>' +
          '<span>⚡ ' + f.speed + '</span>' +
          '<span>💪 ' + f.staminaMax + '</span>' +
        '</div>' +
      '</div>';
  }

  function bindLobbyEvents(lobbyEl) {
    var self = this;

    // Fighter selection
    var cards = lobbyEl.querySelectorAll('.rl-fighter-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        var fid = this.getAttribute('data-fighter');
        selectFighter(fid);
        // Update visual
        for (var j = 0; j < cards.length; j++) cards[j].classList.remove('selected');
        this.classList.add('selected');
      });
    }

    // Mode selection
    var modeBtns = lobbyEl.querySelectorAll('.rl-mode-btn');
    for (var m = 0; m < modeBtns.length; m++) {
      modeBtns[m].addEventListener('click', function () {
        var mode = this.getAttribute('data-mode');
        setMode(mode);
        for (var n = 0; n < modeBtns.length; n++) modeBtns[n].classList.remove('active');
        this.classList.add('active');
      });
    }

    // Ready button
    var readyBtn = lobbyEl.querySelector('#rl-btn-ready');
    if (readyBtn) {
      readyBtn.addEventListener('click', function () {
        toggleReady();
      });
    }

    // Training button
    var trainBtn = lobbyEl.querySelector('#rl-btn-train');
    if (trainBtn) {
      trainBtn.addEventListener('click', function () {
        startOfflineTraining();
      });
    }
  }

  function selectFighter(fighterId) {
    state.fighterId = fighterId;
    if (state.net) {
      state.net.sendReady(fighterId, state.isReady);
    }
  }

  function setMode(mode) {
    state.mode = mode;
    if (state.net) {
      state.net.sendSetMode(mode);
    }
  }

  function toggleReady() {
    state.isReady = !state.isReady;
    var btn = document.getElementById('rl-btn-ready');
    if (btn) {
      btn.textContent = state.isReady ? 'CANCELAR PRONTO' : 'PRONTO';
      btn.classList.toggle('ready-active', state.isReady);
    }
    if (state.net) {
      state.net.sendReady(state.fighterId, state.isReady);
    }
  }

  // ==================== REDE ====================

  function connectNetwork(existingSocket) {
    // Destruir instância anterior para evitar listeners duplicados
    if (state.net) {
      state.net.destroy();
      state.net = null;
    }

    state.net = new NetClient({
      roomCode: state.roomCode,
      playerName: state.playerName,
      fighterId: state.fighterId,

      onConnect: function () {
        console.log('[RinhaGame] Conectado à sala:', state.roomCode);
      },

      onDisconnect: function (reason) {
        console.warn('[RinhaGame] Desconectado:', reason);
      },

      onRoomState: function (data) {
        handleRoomState(data);
      },

      onSnapshot: function (data) {
        handleSnapshot(data);
      },

      onCountdown: function (data) {
        handleCountdown(data);
      },

      onMatchOver: function (data) {
        handleMatchOver(data);
      },

      onEmote: function (data) {
        // Exibir emote no HUD ou overlay
        console.log('[RinhaGame] Emote:', data);
      },

      onChat: function (data) {
        console.log('[RinhaGame] Chat:', data);
      },

      onPlayerJoined: function (data) {
        updateRoster(data);
      },

      onPlayerLeft: function (data) {
        updateRoster(data);
      }
    });
  }

  function handleRoomState(data) {
    if (data.localPlayerId) {
      state.localPlayerId = data.localPlayerId;
    }
    if (data.mode) {
      state.mode = data.mode;
    }
    if (data.sessionScores) {
      state.sessionScores = data.sessionScores;
    }

    // Atualizar roster se tiver lista de participantes
    if (data.participants) {
      renderRoster(data.participants);
    }
  }

  function handleSnapshot(data) {
    if (state.phase !== 'fighting') return;

    // Processar eventos visuais
    if (data.events && state.renderer) {
      state.renderer.processEvents(data.events);
    }

    // Reconciliação ou atualização direta
    if (data.reconcile) {
      // Aplicar estado reconciliado ao jogador local
      if (data.playerState && state.world && state.world.players[state.localPlayerId]) {
        var lp = state.world.players[state.localPlayerId];
        var sp = data.playerState;
        // Substituir campos críticos
        lp.x = sp.x; lp.y = sp.y;
        lp.vx = sp.vx; lp.vy = sp.vy;
        lp.facing = sp.facing;
        lp.hp = sp.hp; lp.posture = sp.posture;
        lp.stamina = sp.stamina; lp.momentum = sp.momentum;
        lp.state = sp.state; lp.stateTicks = sp.stateTicks;
        lp.currentAction = sp.currentAction;
        lp.comboCount = sp.comboCount; lp.comboTimer = sp.comboTimer;
        lp.alive = sp.alive;
        lp.invulnFrames = sp.invulnFrames;
        lp.hasHitThisAction = sp.hasHitThisAction;
      }
    } else if (data.full && data.players) {
      // Full snapshot: substituir todo o mundo
      applyFullSnapshot(data);
    }

    // Atualizar estados remotos para interpolação
    if (data.d && data.d.players && state.net) {
      for (var pid in data.d.players) {
        if (pid === state.localPlayerId) continue;
        // Remote states são gerenciados internamente pelo NetClient
      }
    }
  }

  function applyFullSnapshot(snapshot) {
    if (!state.world) return;

    for (var pid in snapshot.players) {
      var sp = snapshot.players[pid];
      if (state.world.players[pid]) {
        // Atualizar jogador existente
        var p = state.world.players[pid];
        for (var key in sp) {
          if (sp.hasOwnProperty(key)) p[key] = sp[key];
        }
      } else {
        // Criar novo jogador
        state.world.players[pid] = Engine.clonePlayer(sp);
      }
    }

    if (snapshot.scores) state.matchState = { scores: snapshot.scores, round: snapshot.round };
  }

  function handleCountdown(data) {
    state.phase = 'countdown';

    // Transicionar para arena
    document.getElementById('rinha-lobby').classList.add('hidden');
    document.getElementById('rinha-arena').classList.remove('hidden');
    document.getElementById('rinha-results').classList.add('hidden');

    // Inicializar arena se ainda não foi feito
    if (!state.canvas) {
      initArena();
    }

    // Mostrar contagem regressiva
    showCountdownOverlay(data.seconds || data.count || 3);
  }

  function handleMatchOver(data) {
    state.phase = 'results';
    stopGameLoop();

    // Mostrar tela de resultados
    showResults(data);
  }

  // ==================== ARENA & GAME LOOP ====================

  function initArena() {
    state.canvas = document.getElementById('rinha-canvas');
    if (!state.canvas) return;

    // Inicializar renderer
    state.renderer = new Renderer(state.canvas);
    state.renderer.setStates(Engine.States);

    // Inicializar HUD
    var hudContainer = document.getElementById('rinha-hud-container');
    if (hudContainer) {
      state.hud = new HUD(hudContainer, function (emoji) {
        if (state.net) state.net.sendEmote(emoji);
      });
    }

    // Inicializar input
    state.input = new InputManager(state.canvas);

    // Criar mundo local para predição
    state.world = Engine.createWorld('default', Date.now());
    state.world.phase = 'fighting';

    // Resize handler
    var onResize = function () {
      if (state.renderer) state.renderer.resize();
    };
    window.addEventListener('resize', onResize);
    state.cleanupFns.push(function () {
      window.removeEventListener('resize', onResize);
    });

    // Iniciar game loop
    startGameLoop();
  }

  function startGameLoop() {
    state.lastTime = performance.now();
    state.accumulator = 0;
    state.phase = 'fighting';

    function loop(now) {
      if (state.phase !== 'fighting') return;

      var dt = now - state.lastTime;
      state.lastTime = now;

      // Cap delta time para evitar spiral of death
      if (dt > 100) dt = 100;

      state.accumulator += dt;

      // Fixed timestep simulation
      while (state.accumulator >= TICK_MS) {
        simulateTick();
        state.accumulator -= TICK_MS;
      }

      // Render alpha para interpolação
      state.renderAlpha = state.accumulator / TICK_MS;

      // Render
      renderFrame();

      state.rafId = requestAnimationFrame(loop);
    }

    state.rafId = requestAnimationFrame(loop);
  }

  function simulateTick() {
    if (!state.world || !state.input) return;

    // Amostrar input local
    var input = state.input.sample(state.world.tick);

    // Enviar ao servidor
    if (state.net) {
      state.net.sendInput(state.world.tick, input);
    }

    // Predição local: step com input do jogador local
    var inputs = {};
    inputs[state.localPlayerId] = input;

    // Para jogadores remotos, usar último estado conhecido (zeros por enquanto)
    // A interpolação acontece apenas no render

    var events = Engine.step(state.world, inputs);

    // Processar eventos localmente para feedback imediato
    if (state.renderer) {
      state.renderer.processEvents(events);
    }

    // Armazenar estado para reconciliação
    if (state.net) {
      state.net.storeWorldState(state.world.tick, Engine.cloneWorld(state.world));
    }
  }

  function renderFrame() {
    if (!state.renderer || !state.world) return;

    // Construir world view com interpolação para remotos
    var renderWorld = state.world;

    // Aplicar interpolação aos jogadores remotos
    if (state.net) {
      var playerIds = Object.keys(renderWorld.players);
      for (var i = 0; i < playerIds.length; i++) {
        var pid = playerIds[i];
        if (pid === state.localPlayerId) continue;

        var interp = state.net.getInterpolatedRemote(pid, state.renderAlpha);
        if (interp) {
          renderWorld.players[pid].x = interp.x;
          renderWorld.players[pid].y = interp.y;
          renderWorld.players[pid].facing = interp.facing;
        }
      }

      // Aplicar correction blend ao jogador local se ativo
      var blend = state.net.getCorrectionBlend();
      if (blend && renderWorld.players[state.localPlayerId]) {
        renderWorld.players[state.localPlayerId].x = blend.x;
        renderWorld.players[state.localPlayerId].y = blend.y;
      }
    }

    // Renderizar
    state.renderer.render(renderWorld, state.localPlayerId, {
      showDebug: false,
      playerColors: Object.keys(renderWorld.players)
    });

    // Atualizar HUD
    if (state.hud) {
      var ping = state.net ? state.net.getPing() : -1;
      state.hud.update(renderWorld, state.localPlayerId, ping, state.sessionScores, state.matchState);
    }
  }

  function stopGameLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  // ==================== COUNTDOWN OVERLAY ====================

  function showCountdownOverlay(seconds) {
    var arena = document.getElementById('rinha-arena');
    if (!arena) return;

    var overlay = document.createElement('div');
    overlay.className = 'rinha-countdown-overlay';
    overlay.textContent = seconds;
    arena.appendChild(overlay);

    var count = seconds;
    var interval = setInterval(function () {
      count--;
      if (count > 0) {
        overlay.textContent = count;
      } else if (count === 0) {
        overlay.textContent = 'LUTE!';
      } else {
        clearInterval(interval);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
    }, 1000);
  }

  // ==================== RESULTS SCREEN ====================

  function showResults(data) {
    var resultsEl = document.getElementById('rinha-results');
    if (!resultsEl) return;

    resultsEl.classList.remove('hidden');
    document.getElementById('rinha-arena').classList.add('hidden');

    var winnerName = '?';
    if (data.winnerId && state.world && state.world.players[data.winnerId]) {
      winnerName = state.world.players[data.winnerId].name || 'Vencedor';
    }

    resultsEl.innerHTML = '' +
      '<div class="rr-card">' +
        '<h2 class="rr-title">🏆 FIM DE PARTIDA</h2>' +
        '<div class="rr-winner">' + escapeHtml(winnerName) + ' venceu!</div>' +
        '<div class="rr-stats">' +
          (data.stats ? JSON.stringify(data.stats) : '') +
        '</div>' +
        '<div class="rr-actions">' +
          '<button class="rr-btn rr-btn-rematch" id="rr-btn-rematch">🔄 Revanche</button>' +
          '<button class="rr-btn rr-btn-lobby" id="rr-btn-lobby">← Voltar ao Lobby</button>' +
        '</div>' +
      '</div>';

    // Bind buttons
    var rematchBtn = resultsEl.querySelector('#rr-btn-rematch');
    if (rematchBtn) {
      rematchBtn.addEventListener('click', function () {
        if (state.net) state.net.sendRematch();
        resultsEl.classList.add('hidden');
        document.getElementById('rinha-lobby').classList.remove('hidden');
        state.phase = 'lobby';
      });
    }

    var lobbyBtn = resultsEl.querySelector('#rr-btn-lobby');
    if (lobbyBtn) {
      lobbyBtn.addEventListener('click', function () {
        exitToHub();
      });
    }
  }

  // ==================== ROSTER ====================

  function renderRoster(participants) {
    var rosterEl = document.getElementById('rl-roster');
    if (!rosterEl) return;

    if (!participants || participants.length === 0) {
      rosterEl.innerHTML = '<p class="rl-roster-empty">Aguardando jogadores...</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < participants.length; i++) {
      var p = participants[i];
      var readyClass = p.ready ? ' ready' : '';
      var roleLabel = p.isSpectator ? '👁️ Espectador' : (p.ready ? '✅ Pronto' : '⏳ Aguardando');
      html += '' +
        '<div class="rl-roster-item' + readyClass + '">' +
          '<span class="rl-ri-name">' + escapeHtml(p.name || '?') + '</span>' +
          '<span class="rl-ri-fighter">' + (p.fighterId || '-') + '</span>' +
          '<span class="rl-ri-status">' + roleLabel + '</span>' +
        '</div>';
    }
    rosterEl.innerHTML = html;
  }

  function updateRoster(data) {
    // Simplificado: re-renderizar quando receber join/leave
    // O room_state completo virá em seguida
  }

  // ==================== TREINO OFFLINE ====================

  function startOfflineTraining() {
    state.phase = 'training';

    // Esconder lobby
    document.getElementById('rinha-lobby').classList.add('hidden');
    document.getElementById('rinha-arena').classList.remove('hidden');

    // Inicializar canvas se necessário
    if (!state.canvas) {
      state.canvas = document.getElementById('rinha-canvas');
    }

    // Criar renderer se necessário
    if (!state.renderer) {
      state.renderer = new Renderer(state.canvas);
      state.renderer.setStates(Engine.States);
    }

    // Iniciar modo de treino
    state.training = new TrainingMode({
      canvas: state.canvas,
      renderer: state.renderer,
      onExit: function () {
        state.training = null;
        state.phase = 'lobby';
        document.getElementById('rinha-arena').classList.add('hidden');
        document.getElementById('rinha-lobby').classList.remove('hidden');
      }
    });

    state.training.start(state.fighterId);
  }

  // ==================== CLEANUP & SAÍDA ====================

  function exitToHub() {
    // Parar tudo
    stopGameLoop();

    if (state.training) {
      state.training.stop();
      state.training = null;
    }

    if (state.input) {
      state.input.destroy();
      state.input = null;
    }

    if (state.hud) {
      state.hud.destroy();
      state.hud = null;
    }

    if (state.net) {
      state.net.destroy();
      state.net = null;
    }

    // Executar cleanup functions registradas
    for (var i = 0; i < state.cleanupFns.length; i++) {
      state.cleanupFns[i]();
    }
    state.cleanupFns = [];

    // Limpar DOM
    if (state.container && state.container.parentNode) {
      state.container.parentNode.removeChild(state.container);
    }
    state.container = null;
    state.canvas = null;
    state.renderer = null;
    state.world = null;

    // Notificar hub para voltar ao lobby
    if (window.GameHub && window.GameHub.socket) {
      window.GameHub.socket.emit('game:back-to-lobby');
    }

    state.phase = 'idle';
  }

  // ==================== UTILITÁRIOS ====================

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ==================== REGISTRO NO HUB ====================

  // Expor função de inicialização globalmente
  window.initRinha = initRinha;
  window.exitRinha = exitToHub;

  // Integração via evento socket direto (padrão usado por todos os jogos do hub)
  // O app.js emite 'game:starting' com { gameId, gameName, icon }
  // Cada jogo escuta e verifica se é o seu gameId
  // Proteção contra registro duplicado: flag global impede múltiplos listeners
  if (window.GameHub && window.GameHub.socket && !window._rinhaListenersRegistered) {
    window._rinhaListenersRegistered = true;

    window.GameHub.socket.on('game:starting', function (data) {
      if (data && (data.gameId === 'rinha' || data.gameId === 'rinha-io')) {
        // Pequeno delay para garantir que o DOM do game-area já foi preparado pelo app.js
        setTimeout(function () {
          initRinha({
            socket: window.GameHub.socket,
            state: window.GameHub.state,
            DOM: window.GameHub.DOM,
            roomCode: window.GameHub.state ? window.GameHub.state.roomCode : null,
            playerName: window.GameHub.state ? window.GameHub.state.playerName : 'Jogador'
          });
        }, 100);
      }
    });

    window.GameHub.socket.on('game:ended', function () {
      if (state.phase !== 'idle') {
        exitToHub();
      }
    });
  }

})();