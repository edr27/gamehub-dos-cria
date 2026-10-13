/**
 * Rinha.io — HUD (Heads-Up Display)
 * ===================================
 * Overlay DOM sobre o canvas com informações de combate em tempo real.
 * Suporta dinamicamente N jogadores (não hardcoded a 2).
 *
 * Features: barras HP/postura/stamina/momentum por jogador, round pips,
 * combo counter animado, burst alert, ping badge, session scoreboard,
 * emote wheel rápida, e controles hint.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./rinha-config.js'));
  } else {
    root.RinhaHUD = factory(root.RinhaConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (Config) {
  'use strict';

  // Emotes disponíveis
  var EMOTES = ['⚔️', '🛡️', '💀', '🔥', '😂', '👏', '😤', '🎯'];

  /**
   * @constructor
   * @param {HTMLElement} container - Elemento pai onde o HUD será montado
   * @param {Function} onEmote - Callback quando jogador clica num emote
   */
  function HUD(container, onEmote) {
    this.container = container;
    this.onEmote = onEmote || function () {};
    this.root = null;
    this.playerPanels = {};   // playerId -> DOM elements cache
    this.comboEl = null;
    this.burstEl = null;
    this.pingEl = null;
    this.roundEl = null;
    this.scoreboardEl = null;
    this.controlsEl = null;

    this._build();
  }

  // ==================== CONSTRUÇÃO DO DOM ====================

  HUD.prototype._build = function () {
    var div = document.createElement('div');
    div.className = 'rinha-hud';
    div.innerHTML = this._template();
    this.container.appendChild(div);
    this.root = div;

    // Cache de referências
    this.comboEl = div.querySelector('.rh-combo');
    this.burstEl = div.querySelector('.rh-burst-alert');
    this.pingEl = div.querySelector('.rh-ping');
    this.roundEl = div.querySelector('.rh-round-info');
    this.scoreboardEl = div.querySelector('.rh-scoreboard');
    this.controlsEl = div.querySelector('.rh-controls-hint');
    this.playersContainer = div.querySelector('.rh-players');
    this.emoteBar = div.querySelector('.rh-emote-bar');

    // Montar botões de emote
    this._buildEmotes();
  };

  HUD.prototype._template = function () {
    return '' +
      '<div class="rh-top-bar">' +
        '<div class="rh-round-info">ROUND <span class="rh-round-num">1</span></div>' +
        '<div class="rh-scoreboard"></div>' +
      '</div>' +
      '<div class="rh-players"></div>' +
      '<div class="rh-center-layer">' +
        '<div class="rh-combo hidden">' +
          '<span class="rh-combo-count">0</span>' +
          '<span class="rh-combo-label">HITS</span>' +
        '</div>' +
        '<div class="rh-burst-alert hidden">BURST PRONTO! [F]</div>' +
      '</div>' +
      '<div class="rh-bottom-bar">' +
        '<div class="rh-ping">-- ms</div>' +
        '<div class="rh-emote-bar"></div>' +
        '<div class="rh-controls-hint">' +
          'WASD mover · Mouse mirar · LClick ataque · Shift dash · Space guarda · E grab · F burst' +
        '</div>' +
      '</div>';
  };

  HUD.prototype._buildEmotes = function () {
    var self = this;
    this.emoteBar.innerHTML = '';
    for (var i = 0; i < EMOTES.length; i++) {
      var btn = document.createElement('button');
      btn.className = 'rh-emote-btn';
      btn.textContent = EMOTES[i];
      btn.setAttribute('data-emote', EMOTES[i]);
      btn.addEventListener('click', (function (emoji) {
        return function () { self.onEmote(emoji); };
      })(EMOTES[i]));
      this.emoteBar.appendChild(btn);
    }
  };

  // ==================== PAINÉIS DE JOGADORES ====================

  /**
   * Garante que existe um painel DOM para cada jogador no mundo.
   * Remove painéis de jogadores que não existem mais.
   */
  HUD.prototype._syncPlayerPanels = function (world, localPlayerId) {
    var playerIds = Object.keys(world.players).sort();
    var existingIds = Object.keys(this.playerPanels);

    // Criar painéis novos
    for (var i = 0; i < playerIds.length; i++) {
      var pid = playerIds[i];
      if (!this.playerPanels[pid]) {
        var panel = this._createPlayerPanel(pid, world.players[pid], pid === localPlayerId);
        this.playerPanels[pid] = panel;
        this.playersContainer.appendChild(panel.root);
      }
    }

    // Remover painéis órfãos
    for (var j = 0; j < existingIds.length; j++) {
      if (!world.players[existingIds[j]]) {
        this.playersContainer.removeChild(this.playerPanels[existingIds[j]].root);
        delete this.playerPanels[existingIds[j]];
      }
    }
  };

  HUD.prototype._createPlayerPanel = function (pid, player, isLocal) {
    var fDef = Config.FIGHTERS[player.fighterId];
    var colorIdx = 0;
    // Determinar cor pelo índice na lista ordenada de IDs
    var sortedIds = Object.keys(this.playerPanels).concat([pid]).sort();
    colorIdx = sortedIds.indexOf(pid) % Config.COLORS.fighterColors.length;
    var color = Config.COLORS.fighterColors[colorIdx];

    var div = document.createElement('div');
    div.className = 'rh-player-panel' + (isLocal ? ' rh-local' : '');
    div.setAttribute('data-pid', pid);

    div.innerHTML = '' +
      '<div class="rh-p-name" style="color:' + color + '">' + escapeHtml(player.name || '?') + '</div>' +
      '<div class="rh-p-bars">' +
        '<div class="rh-bar-row rh-hp-row">' +
          '<div class="rh-bar-bg"><div class="rh-bar-fill rh-hp-fill" style="background:' + Config.COLORS.hpBar + ';width:100%"></div></div>' +
          '<span class="rh-bar-val rh-hp-val">' + player.hp + '/' + player.hpMax + '</span>' +
        '</div>' +
        '<div class="rh-bar-row rh-posture-row">' +
          '<div class="rh-bar-bg"><div class="rh-bar-fill rh-posture-fill" style="background:' + Config.COLORS.postureBar + ';width:0%"></div></div>' +
        '</div>' +
        '<div class="rh-bar-row rh-stamina-row">' +
          '<div class="rh-bar-bg"><div class="rh-bar-fill rh-stamina-fill" style="background:' + Config.COLORS.staminaBar + ';width:100%"></div></div>' +
        '</div>' +
        '<div class="rh-bar-row rh-momentum-row">' +
          '<div class="rh-bar-bg"><div class="rh-bar-fill rh-momentum-fill" style="background:' + Config.COLORS.momentumBar + ';width:0%"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="rh-p-rounds"></div>';

    return {
      root: div,
      hpFill: div.querySelector('.rh-hp-fill'),
      hpVal: div.querySelector('.rh-hp-val'),
      postureFill: div.querySelector('.rh-posture-fill'),
      staminaFill: div.querySelector('.rh-stamina-fill'),
      momentumFill: div.querySelector('.rh-momentum-fill'),
      roundsEl: div.querySelector('.rh-p-rounds'),
      nameEl: div.querySelector('.rh-p-name')
    };
  };

  // ==================== UPDATE ====================

  /**
   * Atualiza todo o HUD com dados do frame atual.
   * @param {object} world - Estado do mundo da engine
   * @param {string} localPlayerId - ID do jogador local
   * @param {number} pingMs - Latência medida em ms
   * @param {object} sessionScores - Map playerId -> vitórias na sessão
   * @param {object} matchState - { round, scores, phase }
   */
  HUD.prototype.update = function (world, localPlayerId, pingMs, sessionScores, matchState) {
    if (!this.root) return;

    // Sincronizar painéis de jogadores
    this._syncPlayerPanels(world, localPlayerId);

    // Atualizar barras de cada jogador
    var playerIds = Object.keys(world.players).sort();
    for (var i = 0; i < playerIds.length; i++) {
      var pid = playerIds[i];
      var p = world.players[pid];
      var panel = this.playerPanels[pid];
      if (!panel) continue;

      var fDef = Config.FIGHTERS[p.fighterId];

      // HP
      var hpPct = Math.max(0, Math.min(100, (p.hp / p.hpMax) * 100));
      panel.hpFill.style.width = hpPct + '%';
      panel.hpFill.style.background = hpPct > 30 ? Config.COLORS.hpBar : Config.COLORS.hpBarLow;
      panel.hpVal.textContent = Math.ceil(p.hp) + '/' + p.hpMax;

      // Postura
      var postPct = Math.max(0, Math.min(100, (p.posture / Config.POSTURE.max) * 100));
      panel.postureFill.style.width = postPct + '%';

      // Stamina
      var stamPct = Math.max(0, Math.min(100, (p.stamina / fDef.staminaMax) * 100));
      panel.staminaFill.style.width = stamPct + '%';

      // Momentum
      var momPct = Math.max(0, Math.min(100, (p.momentum / Config.MOMENTUM.max) * 100));
      panel.momentumFill.style.width = momPct + '%';

      // Opacidade se morto
      panel.root.style.opacity = p.alive ? '1' : '0.4';
    }

    // Combo counter do jogador local
    var localP = world.players[localPlayerId];
    if (localP && localP.comboCount > 1) {
      this.comboEl.classList.remove('hidden');
      this.comboEl.querySelector('.rh-combo-count').textContent = localP.comboCount;
      // Escala visual baseada no tamanho do combo
      var scale = 1 + Math.min(localP.comboCount * 0.05, 0.5);
      this.comboEl.style.transform = 'scale(' + scale.toFixed(2) + ')';
    } else {
      this.comboEl.classList.add('hidden');
      this.comboEl.style.transform = 'scale(1)';
    }

    // Burst alert
    if (localP && localP.momentum >= Config.MOMENTUM.burstCost) {
      this.burstEl.classList.remove('hidden');
    } else {
      this.burstEl.classList.add('hidden');
    }

    // Ping
    if (pingMs >= 0) {
      this.pingEl.textContent = Math.round(pingMs) + ' ms';
      this.pingEl.style.color = pingMs < 50 ? '#22c55e' : pingMs < 100 ? '#f59e0b' : '#ef4444';
    } else {
      this.pingEl.textContent = '-- ms';
      this.pingEl.style.color = '#888888';
    }

    // Round info
    if (matchState) {
      this.roundEl.querySelector('.rh-round-num').textContent = matchState.round || 1;

      // Scoreboard compacto
      if (matchState.scores) {
        var scoreHtml = '';
        var sIds = Object.keys(matchState.scores).sort();
        for (var s = 0; s < sIds.length; s++) {
          var sp = world.players[sIds[s]];
          var sName = sp ? sp.name : '?';
          var sWins = matchState.scores[sIds[s]] || 0;
          scoreHtml += '<span class="rh-sb-entry">' + escapeHtml(sName) + ': ' + sWins + '</span>';
        }
        this.scoreboardEl.innerHTML = scoreHtml;
      }
    }
  };

  // ==================== CLEANUP ====================

  HUD.prototype.destroy = function () {
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
    this.playerPanels = {};
    this.comboEl = null;
    this.burstEl = null;
    this.pingEl = null;
    this.roundEl = null;
    this.scoreboardEl = null;
    this.controlsEl = null;
    this.playersContainer = null;
    this.emoteBar = null;
  };

  // ==================== UTILITÁRIOS ====================

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return HUD;
}));