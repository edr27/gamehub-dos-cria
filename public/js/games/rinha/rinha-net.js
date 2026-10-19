/**
 * Rinha.io v2 — Cliente de Rede (Socket.IO)
 * ==========================================
 * Reutiliza o socket do hub (NUNCA cria conexão própria).
 * Buffer de inputs, reconciliação full-state, interpolação de remotos, RTT.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./rinha-config.js'), require('./rinha-engine.js'));
  } else {
    root.RinhaNet = factory(root.RinhaConfig, root.RinhaEngine);
  }
}(typeof self !== 'undefined' ? self : this, function (Config, Engine) {
  'use strict';

  var TICK_MS = 1000 / Config.TICK_RATE;
  var BUF_SIZE = 128;
  var HIST_SIZE = 128;
  var PING_INT = 1000;
  var BLEND_FRAMES = 5;

  function NetClient(opts) {
    if (!opts || !opts.roomCode) throw new Error('NetClient requer opts.roomCode');
    this.roomCode = opts.roomCode;
    this.playerName = opts.playerName || 'Jogador';
    this.fighterId = opts.fighterId || 'faísca';
    this.localPlayerId = null;
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
    this.socket = null;
    this.connected = false;
    this.destroyed = false;
    this._ownsSocket = false;
    this.inputBuffer = [];
    this.worldHistory = new Array(HIST_SIZE);
    for (var i = 0; i < HIST_SIZE; i++) this.worldHistory[i] = null;
    this.remoteStates = {};
    this.correctionBlend = null;
    this.rttMs = -1;
    this.avgRttMs = -1;
    this._pingTimer = null;
    this._lastPing = 0;
    this.serverTick = 0;
    this.lastAckedTick = 0;
    this.stats = { pkts: 0, avgSize: 0, recon: 0, snap: 0 };
    this._connect();
  }

  NetClient.prototype._connect = function () {
    var self = this;
    var hubSocket = (window.GameHub && window.GameHub.socket) ? window.GameHub.socket : null;
    if (!hubSocket) { console.error('[RinhaNet] Socket do hub não disponível!'); return; }
    this.socket = hubSocket;
    this.connected = hubSocket.connected || false;
    this._ownsSocket = false;

    if (this.connected) {
      this.socket.emit('rinha:join', { roomCode: self.roomCode, playerName: self.playerName, fighterId: self.fighterId });
      this._startPing();
      self._cb.connect();
    }

    this.socket.on('connect', function () {
      if (self.destroyed) return;
      self.connected = true;
      self.socket.emit('rinha:join', { roomCode: self.roomCode, playerName: self.playerName, fighterId: self.fighterId });
      self._startPing();
      self._cb.connect();
    });
    this.socket.on('disconnect', function (reason) {
      self.connected = false;
      self._stopPing();
      self._cb.disconnect(reason);
    });
    this.socket.on('rinha:room_state', function (data) {
      if (self.destroyed) return;
      if (data.localPlayerId && !self.localPlayerId) self.localPlayerId = data.localPlayerId;
      self._cb.roomState(data);
    });
    this.socket.on('rinha:snapshot', function (data) {
      if (self.destroyed) return;
      self._handleSnapshot(data);
    });
    this.socket.on('rinha:countdown', function (data) { if (!self.destroyed) self._cb.countdown(data); });
    this.socket.on('rinha:match_over', function (data) { if (!self.destroyed) self._cb.matchOver(data); });
    this.socket.on('rinha:emote', function (data) { if (!self.destroyed) self._cb.emote(data); });
    this.socket.on('rinha:chat', function (data) { if (!self.destroyed) self._cb.chat(data); });
    this.socket.on('rinha:player_joined', function (data) { if (!self.destroyed) self._cb.playerJoined(data); });
    this.socket.on('rinha:player_left', function (data) {
      if (self.destroyed) return;
      delete self.remoteStates[data.playerId];
      self._cb.playerLeft(data);
    });
    this.socket.on('rinha:pong', function (data) {
      if (self.destroyed) return;
      var now = Date.now();
      var rtt = now - (data.time || self._lastPing);
      self.rttMs = rtt;
      self.avgRttMs = self.avgRttMs < 0 ? rtt : self.avgRttMs * 0.8 + rtt * 0.2;
    });
  };

  NetClient.prototype.sendInput = function (tick, input) {
    if (!this.connected || this.destroyed) return;
    this.inputBuffer.push({ tick: tick, input: input });
    if (this.inputBuffer.length > BUF_SIZE) this.inputBuffer.shift();
    this.socket.emit('rinha:input', input);
  };

  NetClient.prototype.storeWorldState = function (tick, ws) {
    this.worldHistory[tick % HIST_SIZE] = ws;
  };

  NetClient.prototype._handleSnapshot = function (snap) {
    this.stats.pkts++;
    var size = JSON.stringify(snap).length;
    this.stats.avgSize = this.stats.avgSize * 0.9 + size * 0.1;
    var st = snap.t || 0;

    if (snap.full || this.serverTick === 0) {
      this.serverTick = st;
      this.lastAckedTick = st;
      this._cb.snapshot(snap);
      return;
    }

    if (snap.d) {
      this.serverTick = st;
      if (st > this.lastAckedTick) {
        this.lastAckedTick = st;
        while (this.inputBuffer.length > 0 && this.inputBuffer[0].tick <= st) this.inputBuffer.shift();
      }
      if (this.localPlayerId && snap.d.players && snap.d.players[this.localPlayerId]) {
        this._reconcile(st, snap.d.players[this.localPlayerId]);
      }
      if (snap.d.players) {
        for (var pid in snap.d.players) {
          if (pid === this.localPlayerId) continue;
          this._updateRemote(pid, snap.d.players[pid], st);
        }
      }
    }
    if (snap.events) this._cb.snapshot({ events: snap.events, tick: st });
  };

  NetClient.prototype._reconcile = function (serverTick, serverPlayer) {
    var baseWorld = this.worldHistory[serverTick % HIST_SIZE];
    if (!baseWorld) {
      this.stats.snap++;
      this._cb.snapshot({ reconcile: true, playerState: serverPlayer, tick: serverTick });
      return;
    }
    var unacked = [];
    for (var i = 0; i < this.inputBuffer.length; i++) {
      if (this.inputBuffer[i].tick > serverTick) unacked.push(this.inputBuffer[i]);
    }
    if (unacked.length === 0) {
      this._cb.snapshot({ reconcile: true, playerState: serverPlayer, tick: serverTick });
      return;
    }
    var rw = Engine.cloneWorld(baseWorld);
    rw.players[this.localPlayerId] = Engine.clonePlayer(serverPlayer);
    for (var j = 0; j < unacked.length; j++) {
      var im = {};
      im[this.localPlayerId] = unacked[j].input;
      Engine.step(rw, im);
    }
    this.stats.recon++;
    var lp = rw.players[this.localPlayerId];
    var div = 0;
    if (lp) {
      var dx = lp.x - serverPlayer.x, dy = lp.y - serverPlayer.y;
      div = Math.sqrt(dx * dx + dy * dy);
    }
    this._cb.snapshot({ reconcile: true, playerState: lp || serverPlayer, tick: serverTick + unacked.length, divergence: div });
    if (div > 2.0 && div < 20.0) {
      this.correctionBlend = { fx: serverPlayer.x, fy: serverPlayer.y, tx: lp ? lp.x : serverPlayer.x, ty: lp ? lp.y : serverPlayer.y, frames: BLEND_FRAMES };
    }
  };

  NetClient.prototype._updateRemote = function (pid, state, tick) {
    if (!this.remoteStates[pid]) {
      this.remoteStates[pid] = { prev: state, next: state, pt: tick, nt: tick };
      return;
    }
    var rs = this.remoteStates[pid];
    if (tick >= rs.nt) { rs.prev = rs.next; rs.pt = rs.nt; rs.next = state; rs.nt = tick; }
  };

  NetClient.prototype.getInterpolatedRemote = function (pid, alpha) {
    var rs = this.remoteStates[pid];
    if (!rs) return null;
    alpha = Math.max(0, Math.min(1, alpha || 0));
    return {
      x: rs.prev.x + (rs.next.x - rs.prev.x) * alpha,
      y: rs.prev.y + (rs.next.y - rs.prev.y) * alpha,
      facing: lerpAngle(rs.prev.facing || 0, rs.next.facing || 0, alpha),
      state: rs.next.state, stateTicks: rs.next.stateTicks,
      hp: rs.next.hp, posture: rs.next.posture, stamina: rs.next.stamina, momentum: rs.next.momentum,
      comboCount: rs.next.comboCount, alive: rs.next.alive, flashTimer: rs.next.flashTimer,
      fighterId: rs.next.fighterId, name: rs.next.name,
      punchProgress: rs.next.punchProgress, punchHand: rs.next.punchHand
    };
  };

  NetClient.prototype.getCorrectionBlend = function () {
    if (!this.correctionBlend || this.correctionBlend.frames <= 0) { this.correctionBlend = null; return null; }
    var cb = this.correctionBlend;
    var prog = 1 - (cb.frames / BLEND_FRAMES);
    cb.frames--;
    return { x: cb.fx + (cb.tx - cb.fx) * prog, y: cb.fy + (cb.ty - cb.fy) * prog };
  };

  NetClient.prototype.sendReady = function (fid, ready) { if (this.connected) this.socket.emit('rinha:ready', { fighterId: fid, ready: ready }); };
  NetClient.prototype.sendSetMode = function (mode) { if (this.connected) this.socket.emit('rinha:set-mode', { mode: mode }); };
  NetClient.prototype.sendRematch = function () { if (this.connected) this.socket.emit('rinha:rematch', {}); };
  NetClient.prototype.sendEmote = function (emoji) { if (this.connected) this.socket.emit('rinha:emote', { emoji: emoji }); };
  NetClient.prototype.sendChat = function (text) { if (this.connected) this.socket.emit('rinha:chat', { text: text }); };
  NetClient.prototype.sendSpectate = function () { if (this.connected) this.socket.emit('rinha:spectate', {}); };

  NetClient.prototype._startPing = function () {
    var self = this;
    this._stopPing();
    this._pingTimer = setInterval(function () {
      if (!self.connected || self.destroyed) return;
      self._lastPing = Date.now();
      self.socket.emit('rinha:ping', { time: self._lastPing });
    }, PING_INT);
  };
  NetClient.prototype._stopPing = function () { if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; } };
  NetClient.prototype.getPing = function () { return this.avgRttMs >= 0 ? Math.round(this.avgRttMs) : -1; };

  NetClient.prototype.destroy = function () {
    this.destroyed = true;
    this._stopPing();
    if (this.socket) {
      if (!this._ownsSocket) {
        this.socket.off('rinha:snapshot'); this.socket.off('rinha:room_state');
        this.socket.off('rinha:countdown'); this.socket.off('rinha:match_over');
        this.socket.off('rinha:emote'); this.socket.off('rinha:chat');
        this.socket.off('rinha:player_joined'); this.socket.off('rinha:player_left');
        this.socket.off('rinha:pong'); this.socket.off('connect'); this.socket.off('disconnect');
      } else {
        this.socket.removeAllListeners(); this.socket.disconnect();
      }
      this.socket = null;
    }
    this.inputBuffer = [];
    for (var i = 0; i < HIST_SIZE; i++) this.worldHistory[i] = null;
    this.remoteStates = {};
    this.correctionBlend = null;
    this.connected = false;
  };

  function lerpAngle(a, b, t) {
    var d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  }

  return NetClient;
}));