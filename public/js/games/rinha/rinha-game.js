/**
 * Rinha.io v2 — Orquestrador Principal (Cliente)
 * ================================================
 * Integra todos os módulos: lobby UI, seleção de lutador, arena de combate
 * com game loop (rAF + acumulador fixo), predição local, rede, HUD, renderer,
 * modo treino e integração com o hub via evento game:starting.
 */
(function () {
  'use strict';

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

  var TICK_MS = 1000 / Config.TICK_RATE;

  var state = {
    phase: 'idle',
    roomCode: null,
    localPlayerId: null,
    playerName: '',
    fighterId: 'faísca',
    isReady: false,
    mode: '1v1',
    sessionScores: {},
    matchState: null,
    net: null,
    input: null,
    renderer: null,
    hud: null,
    training: null,
    world: null,
    canvas: null,
    container: null,
    rafId: null,
    lastTime: 0,
    accumulator: 0,
    renderAlpha: 0,
    cleanupFns: []
  };

  // ==================== INTEGRAÇÃO COM O HUB ====================
  function initRinha(hubCtx) {
    if (!hubCtx) { console.error('[RinhaGame] hubCtx não fornecido!'); return; }
    if (state.phase !== 'idle' && state.container) {
      console.warn('[RinhaGame] Já inicializado, ignorando chamada duplicada');
      return;
    }
    state.roomCode = hubCtx.roomCode || (hubCtx.state ? hubCtx.state.roomCode : null);
    state.playerName = hubCtx.playerName || (hubCtx.state ? hubCtx.state.playerName : 'Jogador');
    state.phase = 'lobby';

    var gameArea = document.getElementById('game-area');
    if (!gameArea) { console.error('[RinhaGame] #game-area não encontrado!'); return; }
    gameArea.innerHTML = '';

    state.container = document.createElement('div');
    state.container.className = 'rinha-container';
    state.container.innerHTML =
      '<div class="rinha-lobby" id="rinha-lobby"></div>' +
      '<div class="rinha-arena hidden" id="rinha-arena"><canvas id="rinha-canvas"></canvas><div id="rinha-hud-container"></div></div>' +
      '<div class="rinha-results hidden" id="rinha-results"></div>';
    gameArea.appendChild(state.container);

    renderLobby();
    connectNetwork();
  }

  // ==================== LOBBY UI ====================
  function renderLobby() {
    var el = document.getElementById('rinha-lobby');
    if (!el) return;
    el.classList.remove('hidden');
    document.getElementById('rinha-arena').classList.add('hidden');
    document.getElementById('rinha-results').classList.add('hidden');

    el.innerHTML =
      '<div class="rl-header"><h2 class="rl-title">⚔️ RINHA.IO</h2><p class="rl-subtitle">Arena de Combate Multiplayer</p></div>' +
      '<div class="rl-content">' +
        '<div class="rl-section"><h3 class="rl-stitle">Escolha seu Lutador</h3><div class="rl-fcards">' +
          buildFighterCard('faísca') + buildFighterCard('golias') +
        '</div></div>' +
        '<div class="rl-section"><h3 class="rl-stitle">Modo de Jogo</h3><div class="rl-modes">' +
          '<button class="rl-mbtn active" data-mode="1v1">1v1 Rei da Mesa</button>' +
          '<button class="rl-mbtn" data-mode="ffa">Free-for-All</button>' +
          '<button class="rl-mbtn" data-mode="2v2">2v2 Equipes</button>' +
        '</div></div>' +
        '<div class="rl-section"><h3 class="rl-stitle">Jogadores na Sala</h3><div class="rl-roster" id="rl-roster">Carregando...</div></div>' +
      '</div>' +
      '<div class="rl-actions">' +
        '<button class="rl-btn rl-ready" id="rl-btn-ready">PRONTO</button>' +
        '<button class="rl-btn rl-train" id="rl-btn-train">🏋️ Treinar Offline</button>' +
      '</div>';

    bindLobbyEvents(el);
  }

  function buildFighterCard(fid) {
    var f = Config.FIGHTERS[fid];
    var sel = state.fighterId === fid ? ' selected' : '';
    return '<div class="rl-fcard' + sel + '" data-fighter="' + fid + '">' +
      '<div class="rl-fc-name">' + f.name + '</div>' +
      '<div class="rl-fc-desc">' + f.desc + '</div>' +
      '<div class="rl-fc-stats"><span>❤️ ' + f.hp + '</span><span>⚡ ' + f.speed + '</span><span>💪 ' + f.staminaMax + '</span></div>' +
    '</div>';
  }

  function bindLobbyEvents(el) {
    var cards = el.querySelectorAll('.rl-fcard');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        var fid = this.getAttribute('data-fighter');
        state.fighterId = fid;
        for (var j = 0; j < cards.length; j++) cards[j].classList.remove('selected');
        this.classList.add('selected');
        if (state.net) state.net.sendReady(fid, state.isReady);
      });
    }
    var mBtns = el.querySelectorAll('.rl-mbtn');
    for (var m = 0; m < mBtns.length; m++) {
      mBtns[m].addEventListener('click', function () {
        state.mode = this.getAttribute('data-mode');
        for (var n = 0; n < mBtns.length; n++) mBtns[n].classList.remove('active');
        this.classList.add('active');
        if (state.net) state.net.sendSetMode(state.mode);
      });
    }
    var readyBtn = el.querySelector('#rl-btn-ready');
    if (readyBtn) {
      readyBtn.addEventListener('click', function () {
        state.isReady = !state.isReady;
        readyBtn.textContent = state.isReady ? 'CANCELAR PRONTO' : 'PRONTO';
        readyBtn.classList.toggle('ready-active', state.isReady);
        if (state.net) state.net.sendReady(state.fighterId, state.isReady);
      });
    }
    var trainBtn = el.querySelector('#rl-btn-train');
    if (trainBtn) {
      trainBtn.addEventListener('click', function () { startOfflineTraining(); });
    }
  }

  // ==================== REDE ====================
  function connectNetwork() {
    if (state.net) { state.net.destroy(); state.net = null; }
    state.net = new NetClient({
      roomCode: state.roomCode,
      playerName: state.playerName,
      fighterId: state.fighterId,
      onConnect: function () { console.log('[RinhaGame] Conectado à sala:', state.roomCode); },
      onDisconnect: function (reason) { console.warn('[RinhaGame] Desconectado:', reason); },
      onRoomState: function (data) { handleRoomState(data); },
      onSnapshot: function (data) { handleSnapshot(data); },
      onCountdown: function (data) { handleCountdown(data); },
      onMatchOver: function (data) { handleMatchOver(data); },
      onEmote: function (data) { console.log('[RinhaGame] Emote:', data); },
      onChat: function (data) { console.log('[RinhaGame] Chat:', data); },
      onPlayerJoined: function () {},
      onPlayerLeft: function () {}
    });
  }

  function handleRoomState(data) {
    if (data.localPlayerId) state.localPlayerId = data.localPlayerId;
    if (data.mode) state.mode = data.mode;
    if (data.sessionScores) state.sessionScores = data.sessionScores;
    if (data.participants) renderRoster(data.participants);
  }

  function handleSnapshot(data) {
    if (state.phase !== 'fighting') return;
    if (data.events && state.renderer) state.renderer.processEvents(data.events);
    if (data.reconcile && data.playerState && state.world && state.world.players[state.localPlayerId]) {
      var lp = state.world.players[state.localPlayerId];
      var sp = data.playerState;
      lp.x = sp.x; lp.y = sp.y; lp.vx = sp.vx; lp.vy = sp.vy; lp.facing = sp.facing;
      lp.hp = sp.hp; lp.posture = sp.posture; lp.stamina = sp.stamina; lp.momentum = sp.momentum;
      lp.state = sp.state; lp.stateTicks = sp.stateTicks; lp.action = sp.action;
      lp.comboCount = sp.comboCount; lp.comboTimer = sp.comboTimer;
      lp.alive = sp.alive; lp.invuln = sp.invuln; lp.hitThisAction = sp.hitThisAction;
      lp.punchHand = sp.punchHand; lp.punchProgress = sp.punchProgress;
    } else if (data.full && data.players) {
      applyFullSnapshot(data);
    }
  }

  function applyFullSnapshot(snap) {
    if (!state.world) return;
    for (var pid in snap.players) {
      var sp = snap.players[pid];
      if (state.world.players[pid]) {
        var p = state.world.players[pid];
        for (var k in sp) { if (sp.hasOwnProperty(k)) p[k] = sp[k]; }
      } else {
        state.world.players[pid] = Engine.clonePlayer(sp);
      }
    }
    if (snap.scores) state.matchState = { scores: snap.scores, round: snap.round };
  }

  function handleCountdown(data) {
    state.phase = 'countdown';
    document.getElementById('rinha-lobby').classList.add('hidden');
    document.getElementById('rinha-arena').classList.remove('hidden');
    document.getElementById('rinha-results').classList.add('hidden');
    if (!state.canvas) initArena();
    showCountdownOverlay(data.seconds || data.count || 3);
  }

  function handleMatchOver(data) {
    state.phase = 'results';
    stopGameLoop();
    showResults(data);
  }

  // ==================== ARENA & GAME LOOP ====================
  function initArena() {
    state.canvas = document.getElementById('rinha-canvas');
    if (!state.canvas) return;
    state.renderer = new Renderer(state.canvas);
    state.renderer.setStates(Engine.States);
    var hudC = document.getElementById('rinha-hud-container');
    if (hudC) {
      state.hud = new HUD(hudC, function (emoji) { if (state.net) state.net.sendEmote(emoji); });
    }
    state.input = new InputManager(state.canvas);
    state.world = Engine.createWorld(Date.now());
    state.world.phase = 'fighting';
    var onResize = function () { if (state.renderer) state.renderer.resize(); };
    window.addEventListener('resize', onResize);
    state.cleanupFns.push(function () { window.removeEventListener('resize', onResize); });
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
      if (dt > 100) dt = 100;
      state.accumulator += dt;
      while (state.accumulator >= TICK_MS) {
        simulateTick();
        state.accumulator -= TICK_MS;
      }
      state.renderAlpha = state.accumulator / TICK_MS;
      renderFrame();
      state.rafId = requestAnimationFrame(loop);
    }
    state.rafId = requestAnimationFrame(loop);
  }

  function simulateTick() {
    if (!state.world || !state.input) return;
    var input = state.input.sample(state.world.tick);
    if (state.net) state.net.sendInput(state.world.tick, input);
    var inputs = {};
    inputs[state.localPlayerId] = input;
    var events = Engine.step(state.world, inputs);
    if (state.renderer) state.renderer.processEvents(events);
    if (state.net) state.net.storeWorldState(state.world.tick, Engine.cloneWorld(state.world));
  }

  function renderFrame() {
    if (!state.renderer || !state.world) return;
    var rw = state.world;
    if (state.net) {
      var ids = Object.keys(rw.players);
      for (var i = 0; i < ids.length; i++) {
        if (ids[i] === state.localPlayerId) continue;
        var interp = state.net.getInterpolatedRemote(ids[i], state.renderAlpha);
        if (interp) { rw.players[ids[i]].x = interp.x; rw.players[ids[i]].y = interp.y; rw.players[ids[i]].facing = interp.facing; }
      }
      var blend = state.net.getCorrectionBlend();
      if (blend && rw.players[state.localPlayerId]) {
        rw.players[state.localPlayerId].x = blend.x;
        rw.players[state.localPlayerId].y = blend.y;
      }
    }
    state.renderer.render(rw, state.localPlayerId, { showDebug: false, playerColors: Object.keys(rw.players) });
    if (state.hud) {
      var ping = state.net ? state.net.getPing() : -1;
      state.hud.update(rw, state.localPlayerId, ping, state.sessionScores, state.matchState);
    }
  }

  function stopGameLoop() {
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
  }

  // ==================== COUNTDOWN ====================
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
      if (count > 0) overlay.textContent = count;
      else if (count === 0) overlay.textContent = 'LUTE!';
      else { clearInterval(interval); if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    }, 1000);
  }

  // ==================== RESULTS ====================
  function showResults(data) {
    var el = document.getElementById('rinha-results');
    if (!el) return;
    el.classList.remove('hidden');
    document.getElementById('rinha-arena').classList.add('hidden');
    var wn = '?';
    if (data.winnerId && state.world && state.world.players[data.winnerId]) wn = state.world.players[data.winnerId].name || 'Vencedor';
    el.innerHTML =
      '<div class="rr-card"><h2 class="rr-title">🏆 FIM DE PARTIDA</h2>' +
      '<div class="rr-winner">' + esc(wn) + ' venceu!</div>' +
      '<div class="rr-actions">' +
        '<button class="rr-btn rr-rematch" id="rr-rematch">🔄 Revanche</button>' +
        '<button class="rr-btn rr-lobby" id="rr-lobby">← Voltar ao Lobby</button>' +
      '</div></div>';
    var rb = el.querySelector('#rr-rematch');
    if (rb) rb.addEventListener('click', function () {
      if (state.net) state.net.sendRematch();
      el.classList.add('hidden');
      document.getElementById('rinha-lobby').classList.remove('hidden');
      state.phase = 'lobby';
    });
    var lb = el.querySelector('#rr-lobby');
    if (lb) lb.addEventListener('click', function () { exitToHub(); });
  }

  // ==================== ROSTER ====================
  function renderRoster(participants) {
    var el = document.getElementById('rl-roster');
    if (!el) return;
    if (!participants || participants.length === 0) { el.innerHTML = '<p class="rl-empty">Aguardando jogadores...</p>'; return; }
    var html = '';
    for (var i = 0; i < participants.length; i++) {
      var p = participants[i];
      var rc = p.ready ? ' ready' : '';
      var rl = p.isSpectator ? '👁️ Espectador' : (p.ready ? '✅ Pronto' : '⏳ Aguardando');
      html += '<div class="rl-ri' + rc + '"><span class="rl-rin">' + esc(p.name) + '</span><span class="rl-rif">' + (p.fighterId || '-') + '</span><span class="rl-ris">' + rl + '</span></div>';
    }
    el.innerHTML = html;
  }

  // ==================== TREINO ====================
  function startOfflineTraining() {
    state.phase = 'training';
    document.getElementById('rinha-lobby').classList.add('hidden');
    document.getElementById('rinha-arena').classList.remove('hidden');
    if (!state.canvas) state.canvas = document.getElementById('rinha-canvas');
    if (!state.renderer) { state.renderer = new Renderer(state.canvas); state.renderer.setStates(Engine.States); }
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

  // ==================== CLEANUP ====================
  function exitToHub() {
    stopGameLoop();
    if (state.training) { state.training.stop(); state.training = null; }
    if (state.input) { state.input.destroy(); state.input = null; }
    if (state.hud) { state.hud.destroy(); state.hud = null; }
    if (state.net) { state.net.destroy(); state.net = null; }
    for (var i = 0; i < state.cleanupFns.length; i++) state.cleanupFns[i]();
    state.cleanupFns = [];
    if (state.container && state.container.parentNode) state.container.parentNode.removeChild(state.container);
    state.container = null; state.canvas = null; state.renderer = null; state.world = null;
    if (window.GameHub && window.GameHub.socket) window.GameHub.socket.emit('game:back-to-lobby');
    state.phase = 'idle';
  }

  function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

  // ==================== REGISTRO NO HUB ====================
  window.initRinha = initRinha;
  window.exitRinha = exitToHub;

  if (window.GameHub && window.GameHub.socket && !window._rinhaListenersRegistered) {
    window._rinhaListenersRegistered = true;
    window.GameHub.socket.on('game:starting', function (data) {
      if (data && (data.gameId === 'rinha' || data.gameId === 'rinha-io')) {
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
      if (state.phase !== 'idle') exitToHub();
    });
  }
})();