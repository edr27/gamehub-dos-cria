/**
 * Rinha.io — Cliente de Rede (Socket.IO)
 * ========================================
 * Gerencia conexão com servidor autoritativo, envio de inputs a 60Hz,
 * recepção de snapshots, predição local com reconciliação full-state,
 * interpolação de jogadores remotos e medição de RTT.
 *
 * Decisão: Socket.IO apenas (sem WS nativo) para eliminar bugs de
 * transporte duplo. Socket.IO já handle reconnect/heartbeat/rooms.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./rinha-config.js'), require('./rinha-engine.js'));
  } else {
    root.RinhaNet = factory(root.RinhaConfig, root.RinhaEngine);
  }
}(typeof self !== 'undefined' ? self : this, function (Config, Engine) {
  'use strict';

  var TICK_MS = 1000 / Config.TICK_RATE; // ~16.667ms
  var INPUT_BUFFER_SIZE = 128;           // ~2s de inputs pendentes
  var HISTORY_SIZE = 128;                // ~2s de world states para reconciliação
  var PING_INTERVAL = 1000;              // medir RTT a cada 1s
  var RECONCILE_BLEND_FRAMES = 5;        // frames para suavizar correção

  /**
   * @constructor
   * @param {object} opts - Opções nomeadas
   * @param {string} opts.roomCode - Código da sala
   * @param {string} opts.playerName - Nome do jogador
   * @param {string} opts.fighterId - Lutador escolhido
   * @param {Function} opts.onSnapshot - Callback(snapshot) ao receber estado do server
   * @param {Function} opts.onRoomState - Callback(roomState) ao receber estado da sala
   * @param {Function} opts.onCountdown - Callback(data) na contagem regressiva
   * @param {Function} opts.onMatchOver - Callback(data) no fim da partida
   * @param {Function} opts.onEmote - Callback(data) ao receber emote
   * @param {Function} opts.onChat - Callback(data) ao receber mensagem de chat
   * @param {Function} opts.onPlayerJoined - Callback(data) quando alguém entra
   * @param {Function} opts.onPlayerLeft - Callback(data) quando alguém sai
   * @param {Function} opts.onConnect - Callback() ao conectar
   * @param {Function} opts.onDisconnect - Callback(reason) ao desconectar
   */
  function NetClient(opts) {
    if (!opts || !opts.roomCode) throw new Error('NetClient requer opts.roomCode');

    this.roomCode = opts.roomCode;
    this.playerName = opts.playerName || 'Jogador';
    this.fighterId = opts.fighterId || 'faisca';
    this.localPlayerId = null; // será definido pelo servidor

    // Callbacks
    this._cb = {
      snapshot: opts.onSnapshot || function () {},
      roomState: opts.onRoomState || function () {},
      countdown: opts.onCountdown || function () {},
      matchOver: opts.onMatchOver || function () {},
      emote: opts.onEmote || function () {},
      chat: opts.onChat || function () {},
      playerJoined: opts.onPlayerJoined || function () {},
      playerLeft: opts.onPlayerLeft || function () {},
      connect: opts.onConnect || function () {},
      disconnect: opts.onDisconnect || function () {}
    };

    // Estado da conexão
    this.socket = null;
    this.connected = false;
    this.destroyed = false;

    // Buffer de inputs não-confirmados: array de { tick, input }
    this.inputBuffer = [];

    // Histórico de world states locais para reconciliação
    this.worldHistory = new Array(HISTORY_SIZE);
    for (var i = 0; i < HISTORY_SIZE; i++) this.worldHistory[i] = null;

    // Estados de jogadores remotos para interpolação
    // remoteStates[playerId] = { prev: {...}, next: {...}, prevTick, nextTick }
    this.remoteStates = {};

    // Correção visual suave
    this.correctionBlend = null;

    // RTT measurement
    this.rttMs = -1;
    this.avgRttMs = -1;
    this._pingTimer = null;
    this._lastPingSent = 0;

    // Tick tracking
    this.serverTick = 0;
    this.lastAckedTick = 0;

    // Stats de debug
    this.stats = {
      packetsReceived: 0,
      avgPacketSize: 0,
      reconcileCount: 0,
      hardSnapCount: 0
    };

    this._connect();
  }

  // ==================== CONEXÃO ====================

  NetClient.prototype._connect = function () {
    var self = this;

    // REUTILIZAR o socket do hub — NUNCA criar nova conexão Socket.IO
    // Criar nova conexão causa conflito de listeners e travamento no grab/throw
    var hubSocket = (window.GameHub && window.GameHub.socket) ? window.GameHub.socket : null;

    if (!hubSocket) {
      console.error('[RinhaNet] Socket do hub não disponível!');
      return;
    }

    this.socket = hubSocket;
    this.connected = hubSocket.connected || false;
    this._ownsSocket = false; // NÃO somos donos deste socket — não desconectar no destroy

    // Se já conectado, enviar join imediatamente
    if (this.connected) {
      console.log('[RinhaNet] Reutilizando socket do hub (já conectado)');
      this.socket.emit('rinha:join', {
        roomCode: self.roomCode,
        playerName: self.playerName,
        fighterId: self.fighterId
      });
      this._startPingLoop();
      self._cb.connect();
    }

    // Escutar eventos de conexão caso ainda não esteja conectado
    this.socket.on('connect', function () {
      if (self.destroyed) return;
      self.connected = true;
      console.log('[RinhaNet] Socket do hub conectado');

      self.socket.emit('rinha:join', {
        roomCode: self.roomCode,
        playerName: self.playerName,
        fighterId: self.fighterId
      });

      self._startPingLoop();
      self._cb.connect();
    });

    this.socket.on('disconnect', function (reason) {
      self.connected = false;
      self._stopPingLoop();
      console.log('[RinhaNet] Socket do hub desconectado:', reason);
      self._cb.disconnect(reason);
    });

    // === Handlers de eventos do servidor ===

    this.socket.on('rinha:room_state', function (data) {
      if (self.destroyed) return;
      // Se recebemos nosso ID pela primeira vez
      if (data.localPlayerId && !self.localPlayerId) {
        self.localPlayerId = data.localPlayerId;
      }
      self._cb.roomState(data);
    });

    this.socket.on('rinha:snapshot', function (data) {
      if (self.destroyed) return;
      self._handleSnapshot(data);
    });

    this.socket.on('rinha:countdown', function (data) {
      if (self.destroyed) return;
      self._cb.countdown(data);
    });

    this.socket.on('rinha:match_over', function (data) {
      if (self.destroyed) return;
      self._cb.matchOver(data);
    });

    this.socket.on('rinha:emote', function (data) {
      if (self.destroyed) return;
      self._cb.emote(data);
    });

    this.socket.on('rinha:chat', function (data) {
      if (self.destroyed) return;
      self._cb.chat(data);
    });

    this.socket.on('rinha:player_joined', function (data) {
      if (self.destroyed) return;
      self._cb.playerJoined(data);
    });

    this.socket.on('rinha:player_left', function (data) {
      if (self.destroyed) return;
      // Limpar estado remoto do jogador que saiu
      delete self.remoteStates[data.playerId];
      self._cb.playerLeft(data);
    });

    this.socket.on('rinha:pong', function (data) {
      if (self.destroyed) return;
      var now = Date.now();
      var rtt = now - (data.time || self._lastPingSent);
      self.rttMs = rtt;
      // Média móvel exponencial
      if (self.avgRttMs < 0) {
        self.avgRttMs = rtt;
      } else {
        self.avgRttMs = self.avgRttMs * 0.8 + rtt * 0.2;
      }
    });
  };

  // ==================== ENVIO DE INPUTS ====================

  /**
   * Envia input para o servidor e armazena no buffer para reconciliação.
   * @param {number} tick - Tick atual do cliente
   * @param {object} input - Input serializado { t, mx, my, ax, ay, btn }
   */
  NetClient.prototype.sendInput = function (tick, input) {
    if (!this.connected || this.destroyed) return;

    // Armazenar no buffer circular
    this.inputBuffer.push({ tick: tick, input: input });
    if (this.inputBuffer.length > INPUT_BUFFER_SIZE) {
      this.inputBuffer.shift();
    }

    // Enviar ao servidor
    this.socket.emit('rinha:input', input);
  };

  /**
   * Armazena estado local do mundo para uso na reconciliação.
   * Deve ser chamado após cada step local.
   * @param {number} tick - Tick correspondente
   * @param {object} worldState - Clone do estado do mundo
   */
  NetClient.prototype.storeWorldState = function (tick, worldState) {
    this.worldHistory[tick % HISTORY_SIZE] = worldState;
  };

  // ==================== RECEPÇÃO DE SNAPSHOT ====================

  NetClient.prototype._handleSnapshot = function (snapshot) {
    this.stats.packetsReceived++;

    // Track packet size (aproximado via JSON string length)
    var size = JSON.stringify(snapshot).length;
    this.stats.avgPacketSize = this.stats.avgPacketSize * 0.9 + size * 0.1;

    var serverTick = snapshot.t || 0;

    // Full snapshot: substituir tudo
    if (snapshot.full || this.serverTick === 0) {
      this.serverTick = serverTick;
      this.lastAckedTick = serverTick;
      this._cb.snapshot(snapshot);
      return;
    }

    // Delta snapshot: aplicar mudanças
    if (snapshot.d) {
      this.serverTick = serverTick;

      // Atualizar lastAckedTick e limpar inputs confirmados
      if (serverTick > this.lastAckedTick) {
        this.lastAckedTick = serverTick;
        // Remover inputs que o servidor já processou
        while (this.inputBuffer.length > 0 && this.inputBuffer[0].tick <= serverTick) {
          this.inputBuffer.shift();
        }
      }

      // Reconciliação do jogador local
      if (this.localPlayerId && snapshot.d.players && snapshot.d.players[this.localPlayerId]) {
        this._reconcile(serverTick, snapshot.d.players[this.localPlayerId]);
      }

      // Atualizar estados remotos para interpolação
      if (snapshot.d.players) {
        for (var pid in snapshot.d.players) {
          if (pid === this.localPlayerId) continue;
          this._updateRemoteState(pid, snapshot.d.players[pid], serverTick);
        }
      }
    }

    // Passar events para o renderer/HUD
    if (snapshot.events) {
      this._cb.snapshot({ events: snapshot.events, tick: serverTick });
    }
  };

  // ==================== RECONCILIAÇÃO FULL-STATE ====================

  /**
   * Reconcilia o estado local do jogador com o estado autoritativo do servidor.
   * Re-simula todos os inputs não-confirmados usando o engine completo.
   */
  NetClient.prototype._reconcile = function (serverTick, serverPlayerState) {
    // Encontrar o world state base correspondente ao tick do servidor
    var baseWorld = this.worldHistory[serverTick % HISTORY_SIZE];

    if (!baseWorld) {
      // Sem histórico: hard snap
      this.stats.hardSnapCount++;
      this._cb.snapshot({
        reconcile: true,
        playerState: serverPlayerState,
        tick: serverTick
      });
      return;
    }

    // Coletar inputs não-confirmados (ticks > serverTick)
    var unackedInputs = [];
    for (var i = 0; i < this.inputBuffer.length; i++) {
      if (this.inputBuffer[i].tick > serverTick) {
        unackedInputs.push(this.inputBuffer[i]);
      }
    }

    if (unackedInputs.length === 0) {
      // Nada para re-simular: usar estado do servidor diretamente
      this._cb.snapshot({
        reconcile: true,
        playerState: serverPlayerState,
        tick: serverTick
      });
      return;
    }

    // Clonar mundo base e substituir jogador local com estado do servidor
    var reconWorld = Engine.cloneWorld(baseWorld);
    reconWorld.players[this.localPlayerId] = Engine.clonePlayer(serverPlayerState);

    // Re-simular cada input não-confirmado
    for (var j = 0; j < unackedInputs.length; j++) {
      var entry = unackedInputs[j];
      var inputMap = {};
      inputMap[this.localPlayerId] = entry.input;
      // Inputs remotos são desconhecidos para ticks futuros → zeros
      Engine.step(reconWorld, inputMap);
    }

    this.stats.reconcileCount++;

    // Verificar divergência para blend visual
    var localP = reconWorld.players[this.localPlayerId];
    var divergence = 0;
    if (localP) {
      var dx = localP.x - serverPlayerState.x;
      var dy = localP.y - serverPlayerState.y;
      divergence = Math.sqrt(dx * dx + dy * dy);
    }

    // Enviar estado reconciliado
    this._cb.snapshot({
      reconcile: true,
      playerState: localP || serverPlayerState,
      tick: serverTick + unackedInputs.length,
      divergence: divergence,
      unackedCount: unackedInputs.length
    });

    // Se divergência grande, iniciar blend suave
    if (divergence > 2.0 && divergence < 20.0) {
      this.correctionBlend = {
        fromX: serverPlayerState.x,
        fromY: serverPlayerState.y,
        toX: localP ? localP.x : serverPlayerState.x,
        toY: localP ? localP.y : serverPlayerState.y,
        framesLeft: RECONCILE_BLEND_FRAMES
      };
    }
  };

  // ==================== INTERPOLAÇÃO DE REMOTOS ====================

  NetClient.prototype._updateRemoteState = function (playerId, state, tick) {
    if (!this.remoteStates[playerId]) {
      this.remoteStates[playerId] = {
        prev: state,
        next: state,
        prevTick: tick,
        nextTick: tick
      };
      return;
    }

    var rs = this.remoteStates[playerId];

    // Se este é um tick mais recente, avançar
    if (tick >= rs.nextTick) {
      rs.prev = rs.next;
      rs.prevTick = rs.nextTick;
      rs.next = state;
      rs.nextTick = tick;
    }
  };

  /**
   * Retorna posição interpolada de um jogador remoto para renderização suave.
   * @param {string} playerId
   * @param {number} renderAlpha - Fração [0..1] entre prev e next tick
   * @returns {object|null} Estado interpolado ou null se não conhecido
   */
  NetClient.prototype.getInterpolatedRemote = function (playerId, renderAlpha) {
    var rs = this.remoteStates[playerId];
    if (!rs) return null;

    var alpha = renderAlpha || 0;
    alpha = Math.max(0, Math.min(1, alpha));

    return {
      x: rs.prev.x + (rs.next.x - rs.prev.x) * alpha,
      y: rs.prev.y + (rs.next.y - rs.prev.y) * alpha,
      facing: lerpAngle(rs.prev.facing || 0, rs.next.facing || 0, alpha),
      state: rs.next.state,       // estado muda instantaneamente
      stateTicks: rs.next.stateTicks,
      hp: rs.next.hp,
      posture: rs.next.posture,
      stamina: rs.next.stamina,
      momentum: rs.next.momentum,
      comboCount: rs.next.comboCount,
      alive: rs.next.alive,
      flashTimer: rs.next.flashTimer,
      fighterId: rs.next.fighterId,
      name: rs.next.name
    };
  };

  /**
   * Retorna correção blend ativa (se houver) para suavizar reconciliação.
   * @returns {object|null} { x, y } corrigido ou null
   */
  NetClient.prototype.getCorrectionBlend = function () {
    if (!this.correctionBlend || this.correctionBlend.framesLeft <= 0) {
      this.correctionBlend = null;
      return null;
    }

    var cb = this.correctionBlend;
    var progress = 1 - (cb.framesLeft / RECONCILE_BLEND_FRAMES);
    cb.framesLeft--;

    return {
      x: cb.fromX + (cb.toX - cb.fromX) * progress,
      y: cb.fromY + (cb.toY - cb.fromY) * progress
    };
  };

  // ==================== AÇÕES DO JOGADOR ====================

  NetClient.prototype.sendReady = function (fighterId, ready) {
    if (!this.connected) return;
    this.socket.emit('rinha:ready', { fighterId: fighterId, ready: ready });
  };

  NetClient.prototype.sendSetMode = function (mode) {
    if (!this.connected) return;
    this.socket.emit('rinha:set-mode', { mode: mode });
  };

  NetClient.prototype.sendRematch = function () {
    if (!this.connected) return;
    this.socket.emit('rinha:rematch', {});
  };

  NetClient.prototype.sendEmote = function (emoji) {
    if (!this.connected) return;
    this.socket.emit('rinha:emote', { emoji: emoji });
  };

  NetClient.prototype.sendChat = function (text) {
    if (!this.connected) return;
    this.socket.emit('rinha:chat', { text: text });
  };

  NetClient.prototype.sendSpectate = function () {
    if (!this.connected) return;
    this.socket.emit('rinha:spectate', {});
  };

  // ==================== PING / RTT ====================

  NetClient.prototype._startPingLoop = function () {
    var self = this;
    this._stopPingLoop();
    this._pingTimer = setInterval(function () {
      if (!self.connected || self.destroyed) return;
      self._lastPingSent = Date.now();
      self.socket.emit('rinha:ping', { time: self._lastPingSent });
    }, PING_INTERVAL);
  };

  NetClient.prototype._stopPingLoop = function () {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  };

  /**
   * Retorna RTT médio em ms, ou -1 se não medido ainda.
   */
  NetClient.prototype.getPing = function () {
    return this.avgRttMs >= 0 ? Math.round(this.avgRttMs) : -1;
  };

  // ==================== DEBUG STATS ====================

  NetClient.prototype.getStats = function () {
    return {
      rttMs: this.getPing(),
      packetsReceived: this.stats.packetsReceived,
      avgPacketSize: Math.round(this.stats.avgPacketSize),
      reconcileCount: this.stats.reconcileCount,
      hardSnapCount: this.stats.hardSnapCount,
      pendingInputs: this.inputBuffer.length,
      serverTick: this.serverTick,
      lastAckedTick: this.lastAckedTick,
      connected: this.connected
    };
  };

  // ==================== CLEANUP ====================

  /**
   * Desconecta e limpa todos os recursos. DEVE ser chamado ao sair do jogo.
   */
  NetClient.prototype.destroy = function () {
    this.destroyed = true;
    this._stopPingLoop();

    if (this.socket) {
      // Apenas remover listeners específicos do Rinha, NÃO desconectar
      // pois o socket é compartilhado com o hub (_ownsSocket === false)
      if (!this._ownsSocket) {
        this.socket.off('rinha:snapshot');
        this.socket.off('rinha:room_state');
        this.socket.off('rinha:countdown');
        this.socket.off('rinha:match_over');
        this.socket.off('rinha:emote');
        this.socket.off('rinha:chat');
        this.socket.off('rinha:player_joined');
        this.socket.off('rinha:player_left');
        this.socket.off('rinha:pong');
        this.socket.off('connect');
        this.socket.off('disconnect');
      } else {
        // Socket próprio (fallback): desconectar normalmente
        this.socket.removeAllListeners();
        this.socket.disconnect();
      }
      this.socket = null;
    }

    this.inputBuffer = [];
    for (var i = 0; i < HISTORY_SIZE; i++) this.worldHistory[i] = null;
    this.remoteStates = {};
    this.correctionBlend = null;
    this.connected = false;
  };

  // ==================== UTILITÁRIOS ====================

  /**
   * Interpolação linear de ângulos (shortest path).
   */
  function lerpAngle(a, b, t) {
    var diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
  }

  return NetClient;
}));