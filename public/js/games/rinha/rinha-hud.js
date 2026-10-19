/**
 * Rinha.io v2 — HUD (Heads-Up Display)
 * ======================================
 * Overlay DOM com barras HP/postura/stamina/momentum por jogador,
 * combo counter, burst alert, ping, emotes e controles hint.
 * Suporta N jogadores dinamicamente.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./rinha-config.js'));
  } else {
    root.RinhaHUD = factory(root.RinhaConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (Config) {
  'use strict';

  var EMOTES = ['⚔️', '🛡️', '💀', '🔥', '😂', '👏', '😤', '🎯'];

  function HUD(container, onEmote) {
    this.container = container;
    this.onEmote = onEmote || function () {};
    this.root = null;
    this.panels = {};
    this.comboEl = null;
    this.burstEl = null;
    this.pingEl = null;
    this.roundEl = null;
    this.scoreEl = null;
    this._build();
  }

  HUD.prototype._build = function () {
    var div = document.createElement('div');
    div.className = 'rinha-hud';
    div.innerHTML =
      '<div class="rh-top"><div class="rh-round">ROUND <span class="rh-rn">1</span></div><div class="rh-sb"></div></div>' +
      '<div class="rh-players"></div>' +
      '<div class="rh-center"><div class="rh-combo hidden"><span class="rh-cc">0</span><span class="rh-cl">HITS</span></div><div class="rh-burst hidden">BURST [F]</div></div>' +
      '<div class="rh-bottom"><div class="rh-ping">-- ms</div><div class="rh-emotes"></div><div class="rh-hint">WASD mover · Mouse mirar · LClick leve · RClick pesado · Shift dash · Space guarda · E agarrão · F burst</div></div>';
    this.container.appendChild(div);
    this.root = div;
    this.comboEl = div.querySelector('.rh-combo');
    this.burstEl = div.querySelector('.rh-burst');
    this.pingEl = div.querySelector('.rh-ping');
    this.roundEl = div.querySelector('.rh-rn');
    this.scoreEl = div.querySelector('.rh-sb');
    this.playersC = div.querySelector('.rh-players');
    this.emotesC = div.querySelector('.rh-emotes');
    this._buildEmotes();
  };

  HUD.prototype._buildEmotes = function () {
    var self = this;
    this.emotesC.innerHTML = '';
    for (var i = 0; i < EMOTES.length; i++) {
      var btn = document.createElement('button');
      btn.className = 'rh-eb';
      btn.textContent = EMOTES[i];
      btn.addEventListener('click', (function (e) { return function () { self.onEmote(e); }; })(EMOTES[i]));
      this.emotesC.appendChild(btn);
    }
  };

  HUD.prototype._syncPanels = function (world, localId) {
    var ids = Object.keys(world.players).sort();
    var existing = Object.keys(this.panels);
    for (var i = 0; i < ids.length; i++) {
      if (!this.panels[ids[i]]) {
        var p = this._createPanel(ids[i], world.players[ids[i]], ids[i] === localId);
        this.panels[ids[i]] = p;
        this.playersC.appendChild(p.root);
      }
    }
    for (var j = 0; j < existing.length; j++) {
      if (!world.players[existing[j]]) {
        this.playersC.removeChild(this.panels[existing[j]].root);
        delete this.panels[existing[j]];
      }
    }
  };

  HUD.prototype._createPanel = function (pid, player, isLocal) {
    var ci = Object.keys(this.panels).concat([pid]).sort().indexOf(pid) % Config.COLORS.fighterColors.length;
    var col = Config.COLORS.fighterColors[ci];
    var div = document.createElement('div');
    div.className = 'rh-pp' + (isLocal ? ' rh-local' : '');
    div.innerHTML =
      '<div class="rh-pn" style="color:' + col + '">' + esc(player.name) + '</div>' +
      '<div class="rh-pb">' +
        '<div class="rh-br"><div class="rh-bg"><div class="rh-bf rh-hp" style="background:' + Config.COLORS.hpBar + ';width:100%"></div></div><span class="rh-bv rh-hpv">' + player.hp + '/' + player.hpMax + '</span></div>' +
        '<div class="rh-br"><div class="rh-bg rh-sm"><div class="rh-bf rh-ps" style="background:' + Config.COLORS.postureBar + ';width:0%"></div></div></div>' +
        '<div class="rh-br"><div class="rh-bg rh-sm"><div class="rh-bf rh-st" style="background:' + Config.COLORS.staminaBar + ';width:100%"></div></div></div>' +
        '<div class="rh-br"><div class="rh-bg rh-sm"><div class="rh-bf rh-mo" style="background:' + Config.COLORS.momentumBar + ';width:0%"></div></div></div>' +
      '</div>';
    return {
      root: div,
      hp: div.querySelector('.rh-hp'), hpv: div.querySelector('.rh-hpv'),
      ps: div.querySelector('.rh-ps'), st: div.querySelector('.rh-st'), mo: div.querySelector('.rh-mo')
    };
  };

  HUD.prototype.update = function (world, localId, pingMs, sessionScores, matchState) {
    if (!this.root) return;
    this._syncPanels(world, localId);
    var ids = Object.keys(world.players).sort();
    for (var i = 0; i < ids.length; i++) {
      var p = world.players[ids[i]];
      var pan = this.panels[ids[i]];
      if (!pan) continue;
      var fDef = Config.FIGHTERS[p.fighterId];
      var hpPct = Math.max(0, Math.min(100, (p.hp / p.hpMax) * 100));
      pan.hp.style.width = hpPct + '%';
      pan.hp.style.background = hpPct > 30 ? Config.COLORS.hpBar : Config.COLORS.hpBarLow;
      pan.hpv.textContent = Math.ceil(p.hp) + '/' + p.hpMax;
      pan.ps.style.width = Math.max(0, Math.min(100, (p.posture / Config.POSTURE.max) * 100)) + '%';
      pan.st.style.width = Math.max(0, Math.min(100, (p.stamina / fDef.staminaMax) * 100)) + '%';
      pan.mo.style.width = Math.max(0, Math.min(100, (p.momentum / Config.MOMENTUM.max) * 100)) + '%';
      pan.root.style.opacity = p.alive ? '1' : '0.4';
    }
    var lp = world.players[localId];
    if (lp && lp.comboCount > 1) {
      this.comboEl.classList.remove('hidden');
      this.comboEl.querySelector('.rh-cc').textContent = lp.comboCount;
      this.comboEl.style.transform = 'scale(' + (1 + Math.min(lp.comboCount * 0.05, 0.5)).toFixed(2) + ')';
    } else {
      this.comboEl.classList.add('hidden');
    }
    if (lp && lp.momentum >= Config.MOMENTUM.burstCost) this.burstEl.classList.remove('hidden');
    else this.burstEl.classList.add('hidden');
    if (pingMs >= 0) {
      this.pingEl.textContent = Math.round(pingMs) + ' ms';
      this.pingEl.style.color = pingMs < 50 ? '#22c55e' : pingMs < 100 ? '#f59e0b' : '#ef4444';
    } else {
      this.pingEl.textContent = '-- ms';
      this.pingEl.style.color = '#888';
    }
    if (matchState) {
      this.roundEl.textContent = matchState.round || 1;
      if (matchState.scores) {
        var h = '';
        var sids = Object.keys(matchState.scores).sort();
        for (var s = 0; s < sids.length; s++) {
          var sp = world.players[sids[s]];
          h += '<span class="rh-se">' + esc(sp ? sp.name : '?') + ': ' + (matchState.scores[sids[s]] || 0) + '</span>';
        }
        this.scoreEl.innerHTML = h;
      }
    }
  };

  HUD.prototype.destroy = function () {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null; this.panels = {};
  };

  function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

  return HUD;
}));