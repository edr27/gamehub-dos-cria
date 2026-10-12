/**
 * UI CONTROLLER & AUDIO FOR CARTAS CONTRA A HUMANIDADE
 * Visual Clássico, Minimalista e Direto ao Ponto (Cards Against Humanity Original)
 */

// Sound Effects via Web Audio API (zero dependências externas)
const SoundFX = {
  ctx: null,
  enabled: true,

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  playClick() {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch (e) { }
  },

  playFlip() {
    if (!this.enabled || !this.ctx) return;
    try {
      const bufferSize = this.ctx.sampleRate * 0.08;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, this.ctx.currentTime);
      filter.Q.setValueAtTime(1.5, this.ctx.currentTime);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start();
    } catch (e) { }
  },

  playSuspense() {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(180, this.ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.35);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.5);
    } catch (e) { }
  },

  playTada() {
    if (!this.enabled || !this.ctx) return;
    try {
      const notes = [261.63, 329.63, 392.00, 523.25];
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        const startTime = this.ctx.currentTime + idx * 0.08;
        osc.frequency.setValueAtTime(freq, startTime);
        const dur = idx === 3 ? 0.5 : 0.12;
        gain.gain.setValueAtTime(0.22, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + dur);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + dur);
      });
    } catch (e) { }
  }
};

// UI Manager
class UIManager {
  constructor() {
    this.appEl = document.getElementById('cch-app');
    this.selectedCardIds = []; // Mão do jogador ativo
    this.selectedJudgeId = null; // Seleção do Czar
    this.revealedCards = {}; // Map de cartas viradas no julgamento
    this.confettiCanvas = null;
    this.confettiCtx = null;
    this.confettiParticles = [];
  }

  init() {
    // Escuta mudanças de estado do jogo
    cchGame.onStateChange = (state, data) => this.render(state, data);

    // Cria canvas de confete se não existir
    this.initConfetti();

    // Renderiza tela inicial
    this.render(cchGame.state);

    // Modo de teste visual para ver pódio final
    if (typeof window !== 'undefined' && window.location && window.location.search && window.location.search.includes('test=game_over')) {
      cchGame.players[0].score = 5;
      cchGame.players[1].score = 3;
      cchGame.players[2].score = 1;
      cchGame.state = 'GAME_OVER';
      this.render('GAME_OVER');
      return;
    }

    // Desbloqueia Web Audio no primeiro toque
    const unlockAudio = () => {
      SoundFX.init();
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
  }

  showToast(message, type = 'info') {
    const existing = document.querySelector('.cch-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `cch-toast cch-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('cch-toast-show'), 10);
    setTimeout(() => {
      toast.classList.remove('cch-toast-show');
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  // Confetti Engine
  initConfetti() {
    let canvas = document.getElementById('cch-confetti-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'cch-confetti-canvas';
      canvas.style.position = 'fixed';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '99999';
      document.body.appendChild(canvas);
    }
    this.confettiCanvas = canvas;
    if (canvas && typeof canvas.getContext === 'function') {
      this.confettiCtx = canvas.getContext('2d');
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', () => {
        if (this.confettiCanvas) {
          this.confettiCanvas.width = window.innerWidth;
          this.confettiCanvas.height = window.innerHeight;
        }
      });
    }
    if (this.confettiCanvas) {
      this.confettiCanvas.width = window.innerWidth || 1000;
      this.confettiCanvas.height = window.innerHeight || 800;
    }
  }

  fireConfetti() {
    if (!this.confettiCtx || !this.confettiCanvas) return;
    this.confettiParticles = [];
    const colors = ['#ffffff', '#ff2a75', '#ffd700', '#00f2fe', '#8b5cf6'];
    for (let i = 0; i < 90; i++) {
      this.confettiParticles.push({
        x: Math.random() * this.confettiCanvas.width,
        y: -10 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 5,
        vy: 2.5 + Math.random() * 4.5,
        rot: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 10,
        size: 7 + Math.random() * 8,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }

    let frame = 0;
    const animate = () => {
      if (frame > 160 || !this.confettiCtx) {
        if (this.confettiCtx) this.confettiCtx.clearRect(0, 0, this.confettiCanvas.width, this.confettiCanvas.height);
        return;
      }
      this.confettiCtx.clearRect(0, 0, this.confettiCanvas.width, this.confettiCanvas.height);
      this.confettiParticles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        this.confettiCtx.save();
        this.confettiCtx.translate(p.x, p.y);
        this.confettiCtx.rotate((p.rot * Math.PI) / 180);
        this.confettiCtx.fillStyle = p.color;
        this.confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        this.confettiCtx.restore();
      });
      frame++;
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        window.requestAnimationFrame(animate);
      }
    };
    animate();
  }

  // Render principal acionado pela máquina de estados
  render(state, data = {}) {
    if (!this.appEl) return;

    switch (state) {
      case 'SETUP':
        this.renderSetup();
        break;
      case 'CZAR_READS':
        this.renderCzarReads();
        break;
      case 'PASS_DEVICE':
        this.renderPassDevice();
        break;
      case 'PLAYER_SUBMIT':
        this.renderPlayerSubmit();
        break;
      case 'PASS_TO_CZAR':
        this.renderPassToCzar();
        break;
      case 'CZAR_JUDGE':
        this.renderCzarJudge();
        break;
      case 'ROUND_REVEAL':
        this.renderRoundReveal(data);
        break;
      case 'GAME_OVER':
        this.renderGameOver();
        break;
      default:
        this.renderSetup();
    }
  }

  // ==========================================
  // TELA: SETUP (CLÁSSICA, LIMPA E DIRETA)
  // ==========================================
  renderSetup() {
    const totalBlack = (typeof BLACK_CARDS !== 'undefined' ? BLACK_CARDS.length : 359);
    const totalWhite = (typeof WHITE_CARDS !== 'undefined' ? WHITE_CARDS.length : 1254);

    let html = `
      <div class="cch-screen cch-setup-classic">
        <header class="cch-classic-hero">
          <h1 class="cch-classic-title">Cartas Contra a Humanidade</h1>
          <p class="cch-classic-tagline">Um jogo de festa para pessoas horríveis.</p>
          <div class="cch-deck-stat-badge">
            🃏 ${totalBlack} Cartas Pretas • ✉️ ${totalWhite.toLocaleString('pt-BR')} Cartas Brancas
          </div>
        </header>

        <div class="cch-classic-card">
          <!-- Jogadores -->
          <div class="cch-setup-section">
            <div class="cch-section-title-row">
              <h3>👥 Jogadores na mesa:</h3>
              <span class="cch-muted">Mínimo 3 (Passa o celular)</span>
            </div>

            <div class="cch-player-input-row">
              <input type="text" id="cch-player-name-input" class="cch-input" placeholder="Digite o nome..." maxlength="18" />
              <button id="cch-add-player-btn" class="cch-btn cch-btn-primary">+ Adicionar</button>
            </div>

            <div class="cch-player-list">
              ${cchGame.players.map((p, idx) => `
                <div class="cch-player-tag">
                  <span class="cch-player-name">${idx + 1}. ${this.escapeHtml(p.name)}</span>
                  ${cchGame.players.length > 3 ? `<button class="cch-remove-btn" onclick="uiManager.removePlayer('${p.id}')" title="Remover">✕</button>` : ''}
                </div>
              `).join('')}
            </div>

            <div class="cch-quick-add-row">
              <span class="cch-muted">Adicionar rápido:</span>
              <button class="cch-btn-sm" onclick="uiManager.addQuickPlayer('Carol')">+ Carol</button>
              <button class="cch-btn-sm" onclick="uiManager.addQuickPlayer('Pedro')">+ Pedro</button>
              <button class="cch-btn-sm" onclick="uiManager.addQuickPlayer('Mari')">+ Mari</button>
            </div>
          </div>

          <hr class="cch-classic-divider" />

          <!-- Configurações Rápidas -->
          <div class="cch-setup-section">
            <div class="cch-config-row">
              <label for="cch-target-val"><strong>Pontos para Vencer:</strong></label>
              <select id="cch-target-val" class="cch-select" onchange="uiManager.setTargetScore(this.value)">
                <option value="3" ${cchGame.config.targetScore === 3 ? 'selected' : ''}>3 Pontos (Partida Rápida)</option>
                <option value="5" ${cchGame.config.targetScore === 5 ? 'selected' : ''}>5 Pontos (Recomendado)</option>
                <option value="7" ${cchGame.config.targetScore === 7 ? 'selected' : ''}>7 Pontos (Clássico)</option>
                <option value="10" ${cchGame.config.targetScore === 10 ? 'selected' : ''}>10 Pontos (Longo)</option>
              </select>
            </div>

            <div class="cch-config-row-checkbox">
              <label class="cch-simple-check">
                <input type="checkbox" ${cchGame.config.randoCardrissian ? 'checked' : ''} onchange="uiManager.toggleRando(this.checked)">
                <span>🤖 <strong>Rando Cardrissian</strong> (Bot que joga uma carta aleatória por rodada)</span>
              </label>
            </div>
          </div>

          <!-- Botão Principal de Iniciar -->
          <div class="cch-start-row">
            <button id="cch-start-game-btn" class="cch-btn cch-btn-start" onclick="uiManager.startGame()">
              INICIAR O JOGO
            </button>
          </div>
        </div>

        <div class="cch-classic-footer">
          <button class="cch-link-btn" onclick="uiManager.openCardEditor()">✏️ Adicionar Cartas Próprias</button>
          <span class="cch-footer-sep">•</span>
          <button class="cch-link-btn" onclick="uiManager.openHallOfFame()">🏆 Melhores Jogadas</button>
          <span class="cch-footer-sep">•</span>
          <button class="cch-link-btn" onclick="uiManager.toggleSound()">${SoundFX.enabled ? '🔊 Som Ativo' : '🔇 Mudo'}</button>
        </div>
      </div>
    `;

    this.appEl.innerHTML = html;

    const input = document.getElementById('cch-player-name-input');
    const addBtn = document.getElementById('cch-add-player-btn');
    if (input && addBtn) {
      addBtn.onclick = () => {
        const val = input.value.trim();
        if (val) {
          cchGame.addPlayer(val);
          SoundFX.playClick();
          this.renderSetup();
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addBtn.click();
      });
    }
  }

  addQuickPlayer(name) {
    cchGame.addPlayer(name);
    SoundFX.playClick();
    this.renderSetup();
  }

  removePlayer(id) {
    cchGame.removePlayer(id);
    SoundFX.playClick();
    this.renderSetup();
  }

  setTargetScore(val) {
    cchGame.updateConfig({ targetScore: parseInt(val, 10) });
  }

  toggleRando(checked) {
    SoundFX.playClick();
    cchGame.updateConfig({ randoCardrissian: checked });
  }

  toggleSound() {
    SoundFX.enabled = !SoundFX.enabled;
    this.renderSetup();
    this.showToast(SoundFX.enabled ? 'Sons ativados' : 'Sons desativados', 'info');
  }

  startGame() {
    SoundFX.playClick();
    const res = cchGame.startGame();
    if (!res.success) {
      this.showToast(res.message, 'warning');
      return;
    }
    SoundFX.playTada();
  }

  // ==========================================
  // TELA: CZAR_READS (Czar lê a Carta Preta)
  // ==========================================
  renderCzarReads() {
    const czar = cchGame.getCzarPlayer();
    const blackCard = cchGame.currentBlackCard;

    let html = `
      <div class="cch-screen cch-center-flow">
        <header class="cch-round-header">
          <span class="cch-round-number">RODADA ${cchGame.roundNumber}</span>
          <span class="cch-czar-badge">👑 CZAR: ${this.escapeHtml(czar.name)}</span>
        </header>

        <div class="cch-spotlight">
          <p class="cch-instruction">📢 <strong>${this.escapeHtml(czar.name)}</strong>, leia a carta preta em voz alta:</p>

          <div class="cch-card-black cch-card-giant">
            <div class="cch-card-content">
              ${this.formatBlackCardText(blackCard.text)}
            </div>
            <div class="cch-card-footer">
              <span>CARTAS CONTRA A HUMANIDADE</span>
              <span class="cch-pick-tag">ESCOLHA ${blackCard.pick || 1}</span>
            </div>
          </div>

          <button class="cch-btn cch-btn-start" onclick="uiManager.confirmCzarRead()">
            Todos ouviram! Passar o aparelho 📱
          </button>
        </div>
      </div>
    `;

    this.appEl.innerHTML = html;
  }

  confirmCzarRead() {
    SoundFX.playClick();
    cchGame.confirmCzarRead();
  }

  // ==========================================
  // TELA: PASS_DEVICE (Cortina de Privacidade)
  // ==========================================
  renderPassDevice() {
    const player = cchGame.getCurrentSubmittingPlayer();
    if (!player) return;

    let html = `
      <div class="cch-screen cch-center-flow">
        <div class="cch-privacy-box">
          <div class="cch-privacy-icon">🔒</div>
          <h2>Passe o aparelho discretamente para:</h2>
          <div class="cch-target-player">${this.escapeHtml(player.name)}</div>
          <p class="cch-privacy-notice">Ninguém mais olhe para a tela!</p>
          <button class="cch-btn cch-btn-start" onclick="uiManager.unlockPlayerHand()">
            Sou ${this.escapeHtml(player.name)}, ver minhas cartas
          </button>
        </div>
      </div>
    `;

    this.appEl.innerHTML = html;
  }

  unlockPlayerHand() {
    SoundFX.playClick();
    this.selectedCardIds = [];
    cchGame.unlockPlayerHand();
  }

  // ==========================================
  // TELA: PLAYER_SUBMIT (Jogador Escolhe Cartas)
  // ==========================================
  renderPlayerSubmit() {
    const player = cchGame.getCurrentSubmittingPlayer();
    const blackCard = cchGame.currentBlackCard;
    const needed = blackCard.pick || 1;
    const isReady = this.selectedCardIds.length === needed;

    let previewHtml = this.getSentencePreview(blackCard.text, this.selectedCardIds, player.hand);

    let html = `
      <div class="cch-screen cch-play-screen">
        <header class="cch-play-header">
          <span>👤 Sua vez: <strong>${this.escapeHtml(player.name)}</strong></span>
          <span>Escolha <strong>${needed}</strong> carta${needed > 1 ? 's' : ''}</span>
        </header>

        <!-- Carta Preta Mini Preview -->
        <div class="cch-card-black cch-card-compact">
          <div class="cch-card-content">${previewHtml}</div>
          <div class="cch-card-footer">
            <span>CARTAS CONTRA A HUMANIDADE</span>
            <span class="cch-pick-tag">ESCOLHA ${needed}</span>
          </div>
        </div>

        <!-- Mão de Cartas Brancas -->
        <div class="cch-hand-section">
          <div class="cch-hand-grid">
            ${player.hand.map(c => {
              const selIdx = this.selectedCardIds.indexOf(c.id);
              const isSelected = selIdx !== -1;
              return `
                <div class="cch-card-white ${isSelected ? 'selected' : ''}" onclick="uiManager.toggleCardSelection('${c.id}')">
                  ${isSelected && needed > 1 ? `<div class="cch-order-badge">${selIdx + 1}ª</div>` : ''}
                  ${isSelected && needed === 1 ? `<div class="cch-order-badge">✓</div>` : ''}
                  <div class="cch-card-content">${this.escapeHtml(c.text)}</div>
                  <div class="cch-card-footer"><span>CARTAS BRANCAS</span></div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Barra Inferior de Confirmação -->
        <div class="cch-bottom-bar">
          <span>Selecionadas: <strong>${this.selectedCardIds.length} de ${needed}</strong></span>
          <button class="cch-btn cch-btn-start ${isReady ? '' : 'disabled'}" ${isReady ? '' : 'disabled'} onclick="uiManager.submitSelectedCards()">
            Confirmar Envio Anônimo 🚀
          </button>
        </div>
      </div>
    `;

    this.appEl.innerHTML = html;
  }

  toggleCardSelection(cardId) {
    SoundFX.playClick();
    const needed = cchGame.currentBlackCard.pick || 1;
    const idx = this.selectedCardIds.indexOf(cardId);

    if (idx !== -1) {
      this.selectedCardIds.splice(idx, 1);
    } else {
      if (needed === 1) {
        this.selectedCardIds = [cardId];
      } else {
        if (this.selectedCardIds.length >= needed) {
          this.selectedCardIds.shift();
        }
        this.selectedCardIds.push(cardId);
      }
    }
    this.renderPlayerSubmit();
  }

  getSentencePreview(blackText, selectedIds, hand) {
    if (!selectedIds.length) {
      return this.formatBlackCardText(blackText);
    }

    let cardsMap = {};
    hand.forEach(c => cardsMap[c.id] = c.text);

    let parts = blackText.split('________');
    if (parts.length > 1) {
      let combined = '';
      for (let i = 0; i < parts.length; i++) {
        combined += this.escapeHtml(parts[i]);
        if (i < parts.length - 1) {
          const cardId = selectedIds[i];
          if (cardId && cardsMap[cardId]) {
            combined += `<span class="cch-blank-filled">${this.escapeHtml(cardsMap[cardId])}</span>`;
          } else {
            combined += `<span class="cch-blank">________</span>`;
          }
        }
      }
      return combined;
    } else {
      let answers = selectedIds.map(id => `<span class="cch-blank-filled">${this.escapeHtml(cardsMap[id] || '')}</span>`).join(' + ');
      return `${this.escapeHtml(blackText)}<br><br>👉 ${answers}`;
    }
  }

  submitSelectedCards() {
    const player = cchGame.getCurrentSubmittingPlayer();
    const needed = cchGame.currentBlackCard.pick || 1;
    if (this.selectedCardIds.length !== needed) return;

    SoundFX.playFlip();
    cchGame.submitPlayerCards(player.id, [...this.selectedCardIds]);
    this.selectedCardIds = [];
  }

  // ==========================================
  // TELA: PASS_TO_CZAR (Devolver para o Czar)
  // ==========================================
  renderPassToCzar() {
    const czar = cchGame.getCzarPlayer();

    let html = `
      <div class="cch-screen cch-center-flow">
        <div class="cch-privacy-box">
          <div class="cch-privacy-icon">👑</div>
          <h2>Todas as cartas foram enviadas!</h2>
          <p>Devolva o aparelho para o Czar da rodada:</p>
          <div class="cch-target-player">${this.escapeHtml(czar.name)}</div>
          <button class="cch-btn cch-btn-start" onclick="uiManager.openCzarJudging()">
            Sou o Czar, abrir o julgamento 🎭
          </button>
        </div>
      </div>
    `;

    this.appEl.innerHTML = html;
  }

  openCzarJudging() {
    SoundFX.playClick();
    SoundFX.playSuspense();
    this.selectedJudgeId = null;
    this.revealedCards = {};
    cchGame.openCzarJudging();
  }

  // ==========================================
  // TELA: CZAR_JUDGE (Czar Revela e Julga)
  // ==========================================
  renderCzarJudge() {
    const czar = cchGame.getCzarPlayer();
    const blackCard = cchGame.currentBlackCard;
    const submissions = cchGame.roundSubmissions;

    let html = `
      <div class="cch-screen cch-judge-screen">
        <header class="cch-round-header">
          <span class="cch-czar-badge">👑 JULGAMENTO DO CZAR: ${this.escapeHtml(czar.name)}</span>
        </header>

        <div class="cch-card-black cch-card-compact">
          <div class="cch-card-content">${this.formatBlackCardText(blackCard.text)}</div>
          <div class="cch-card-footer">
            <span>CARTAS CONTRA A HUMANIDADE</span>
            <span class="cch-pick-tag">JULGAMENTO</span>
          </div>
        </div>

        <p class="cch-instruction">👇 Toque nas cartas viradas para revelá-las para a mesa:</p>

        <div class="cch-judge-grid">
          ${submissions.map((sub, idx) => {
            const isRevealed = !!this.revealedCards[sub.id];
            const isSelected = this.selectedJudgeId === sub.id;

            return `
              <div class="cch-judge-item ${isRevealed ? 'revealed' : 'facedown'} ${isSelected ? 'selected' : ''}" onclick="uiManager.handleSubmissionClick('${sub.id}')">
                ${!isRevealed ? `
                  <div class="cch-card-back">
                    <span class="cch-back-logo">CCH</span>
                    <span class="cch-back-label">Toque para revelar #${idx + 1}</span>
                  </div>
                ` : `
                  <div class="cch-card-revealed-list">
                    ${sub.cards.map(c => `
                      <div class="cch-card-white">
                        <div class="cch-card-content">${this.escapeHtml(c.text)}</div>
                      </div>
                    `).join('')}
                  </div>
                  ${isSelected ? `<div class="cch-picked-indicator">✓ ESCOLHIDA</div>` : ''}
                `}
              </div>
            `;
          }).join('')}
        </div>

        <div class="cch-judge-action-bar">
          <button class="cch-btn cch-btn-start ${this.selectedJudgeId ? '' : 'disabled'}" ${this.selectedJudgeId ? '' : 'disabled'} onclick="uiManager.confirmWinner()">
            Eleger Como a Vencedora da Rodada 🏆
          </button>
        </div>
      </div>
    `;

    this.appEl.innerHTML = html;
  }

  handleSubmissionClick(subId) {
    if (!this.revealedCards[subId]) {
      this.revealedCards[subId] = true;
      SoundFX.playFlip();
    } else {
      this.selectedJudgeId = subId;
      SoundFX.playClick();
    }
    this.renderCzarJudge();
  }

  confirmWinner() {
    if (!this.selectedJudgeId) return;
    SoundFX.playTada();
    cchGame.pickWinner(this.selectedJudgeId);
  }

  // ==========================================
  // TELA: ROUND_REVEAL (Vencedor da Rodada)
  // ==========================================
  renderRoundReveal(data) {
    const { winningSubmission, winnerPlayer, isRando } = data;
    const blackCard = cchGame.currentBlackCard;

    this.fireConfetti();

    let completedText = this.buildFullCompletedSentence(blackCard.text, winningSubmission.cards);

    let html = `
      <div class="cch-screen cch-center-flow">
        <div class="cch-reveal-box">
          <span class="cch-pill-badge">VENCEDOR DA RODADA ${cchGame.roundNumber}</span>
          <h2 class="cch-winner-heading">
            ${isRando ? '🤖 Rando Cardrissian venceu a mesa!' : `🎉 ${this.escapeHtml(winnerPlayer.name)} levou a carta!`}
          </h2>

          <div class="cch-quote-card">
            <p class="cch-quote-text">"${completedText}"</p>
            <span class="cch-quote-author">— ${isRando ? 'Rando Cardrissian (Bot)' : this.escapeHtml(winnerPlayer.name)}</span>
          </div>

          <div class="cch-score-chips">
            ${cchGame.players.map(p => `
              <div class="cch-score-chip ${p.id === winnerPlayer.id ? 'active' : ''}">
                ${this.escapeHtml(p.name)}: <strong>${p.score} pts</strong>
              </div>
            `).join('')}
          </div>

          <button class="cch-btn cch-btn-start" onclick="uiManager.nextRound()">
            ${cchGame.checkGameOver() ? 'Ver o Vencedor Final 🏆' : 'Próxima Rodada ➡️'}
          </button>
        </div>
      </div>
    `;

    this.appEl.innerHTML = html;
  }

  buildFullCompletedSentence(blackText, whiteCards) {
    let parts = blackText.split('________');
    if (parts.length > 1) {
      let res = '';
      for (let i = 0; i < parts.length; i++) {
        res += parts[i];
        if (i < parts.length - 1 && whiteCards[i]) {
          res += ` [${whiteCards[i].text.toUpperCase()}] `;
        }
      }
      return res;
    } else {
      return `${blackText} 👉 ${whiteCards.map(c => `[${c.text.toUpperCase()}]`).join(' + ')}`;
    }
  }

  nextRound() {
    SoundFX.playClick();
    cchGame.nextRound();
  }

  // ==========================================
  // TELA: GAME_OVER (Fim de Jogo e Pódio)
  // ==========================================
  renderGameOver() {
    SoundFX.playTada();
    this.fireConfetti();

    const ranking = cchGame.getLeaderboard();
    const winner = ranking[0];

    let html = `
      <div class="cch-screen cch-center-flow">
        <div class="cch-victory-box">
          <div class="cch-trophy">🏆</div>
          <span class="cch-pill-badge">CAMPEÃO DA PARTIDA</span>
          <h1 class="cch-victory-name">${this.escapeHtml(winner.name)}</h1>
          <div class="cch-victory-title">${winner.title}</div>
          <p class="cch-muted">${winner.score} pontos acumulados</p>

          <div class="cch-podium-table">
            ${ranking.map((p, idx) => `
              <div class="cch-podium-row ${idx === 0 ? 'first' : ''}">
                <span class="cch-podium-pos">#${idx + 1}</span>
                <span class="cch-podium-name">${this.escapeHtml(p.name)}</span>
                <span class="cch-podium-pts">${p.score} pts</span>
              </div>
            `).join('')}
          </div>

          <div class="cch-victory-buttons">
            <button class="cch-btn cch-btn-start" onclick="uiManager.playAgain()">Jogar Novamente</button>
            <a href="../" class="cch-link-btn">Voltar ao Hub de Jogos</a>
          </div>
        </div>
      </div>
    `;

    this.appEl.innerHTML = html;
  }

  playAgain() {
    SoundFX.playClick();
    cchGame.resetGame();
    this.renderSetup();
  }

  // ==========================================
  // MODAIS (Editor & Hall of Fame)
  // ==========================================
  openCardEditor() {
    SoundFX.playClick();
    const custom = DeckManager.getCustomCards();

    let modal = document.createElement('div');
    modal.className = 'cch-modal-overlay';
    modal.id = 'cch-editor-modal';
    modal.innerHTML = `
      <div class="cch-modal-card">
        <div class="cch-modal-header">
          <h3>✏️ Criar Cartas Próprias</h3>
          <button class="cch-modal-close" onclick="this.closest('.cch-modal-overlay').remove()">✕</button>
        </div>
        <div class="cch-modal-body">
          <div class="cch-form-group">
            <label>Tipo de Carta:</label>
            <select id="cch-card-type" class="cch-select" onchange="document.getElementById('cch-pick-group').style.display = this.value === 'black' ? 'block' : 'none'">
              <option value="white">Carta Branca (Resposta)</option>
              <option value="black">Carta Preta (Frase com lacuna)</option>
            </select>
          </div>
          <div class="cch-form-group" id="cch-pick-group" style="display: none;">
            <label>Quantidade de Lacunas:</label>
            <select id="cch-card-pick" class="cch-select">
              <option value="1">1 lacuna (________)</option>
              <option value="2">2 lacunas</option>
            </select>
          </div>
          <div class="cch-form-group">
            <label>Texto da Carta:</label>
            <textarea id="cch-card-text" class="cch-textarea" placeholder="Digite sua piada interna aqui..."></textarea>
          </div>
          <button class="cch-btn cch-btn-primary" onclick="uiManager.saveCustomCard()">+ Salvar Carta</button>

          <hr class="cch-classic-divider" />
          <h4>Suas cartas salvas (${custom.black.length + custom.white.length}):</h4>
          <div class="cch-custom-list">
            ${[...custom.black, ...custom.white].length === 0 ? '<p class="cch-muted">Nenhuma carta personalizada criada ainda.</p>' : ''}
            ${custom.black.map(c => `
              <div class="cch-custom-item black">
                <span>[PRETA] ${this.escapeHtml(c.text)}</span>
                <button onclick="uiManager.deleteCustomCard('${c.id}')">✕</button>
              </div>
            `).join('')}
            ${custom.white.map(c => `
              <div class="cch-custom-item white">
                <span>[BRANCA] ${this.escapeHtml(c.text)}</span>
                <button onclick="uiManager.deleteCustomCard('${c.id}')">✕</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  saveCustomCard() {
    const type = document.getElementById('cch-card-type').value;
    const text = document.getElementById('cch-card-text').value.trim();
    const pick = type === 'black' ? parseInt(document.getElementById('cch-card-pick').value, 10) : 1;

    if (!text) {
      this.showToast('Digite o texto da carta!', 'warning');
      return;
    }

    DeckManager.addCustomCard(type, text, pick);
    SoundFX.playClick();
    this.showToast('Carta salva no baralho!', 'info');

    const modal = document.getElementById('cch-editor-modal');
    if (modal) modal.remove();
    this.openCardEditor();
  }

  deleteCustomCard(id) {
    DeckManager.removeCustomCard(id);
    SoundFX.playClick();
    const modal = document.getElementById('cch-editor-modal');
    if (modal) modal.remove();
    this.openCardEditor();
  }

  openHallOfFame() {
    SoundFX.playClick();
    const fame = DeckManager.getHallOfFame();

    let modal = document.createElement('div');
    modal.className = 'cch-modal-overlay';
    modal.innerHTML = `
      <div class="cch-modal-card">
        <div class="cch-modal-header">
          <h3>🏆 Melhores Combos Salvos</h3>
          <button class="cch-modal-close" onclick="this.closest('.cch-modal-overlay').remove()">✕</button>
        </div>
        <div class="cch-modal-body">
          <div class="cch-fame-list">
            ${fame.length === 0 ? '<p class="cch-muted">Nenhum combo registrado ainda. Jogue uma partida!</p>' : ''}
            ${fame.map((item, idx) => `
              <div class="cch-fame-item">
                <span class="cch-fame-num">#${idx + 1}</span>
                <div class="cch-fame-info">
                  <strong>"${this.escapeHtml(item.combo)}"</strong>
                  <small>Vencedor: ${this.escapeHtml(item.winner)} • Czar: ${this.escapeHtml(item.czar)}</small>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  formatBlackCardText(text) {
    return text.replace(/________/g, '<span class="cch-blank">________</span>');
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Instancia global
window.uiManager = new UIManager();
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.uiManager.init());
  } else {
    window.uiManager.init();
  }
}
