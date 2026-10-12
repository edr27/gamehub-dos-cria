/**
 * Cartas Contra a Humanidade — Máquina de Estados e Lógica de Jogo
 * 100% Client-Side • Passa-o-Celular • 3 a 10 Jogadores
 * Modo Clássico & Limpo
 */

class CCHGame {
  constructor() {
    this.state = 'SETUP'; // SETUP, CZAR_READS, PASS_DEVICE, PLAYER_SUBMIT, PASS_TO_CZAR, CZAR_JUDGE, ROUND_REVEAL, GAME_OVER

    // Configurações Simples Clássicas
    this.config = {
      targetScore: 5,         // Pontos para vencer
      randoCardrissian: true  // Bot caótico
    };

    // Jogadores padrão
    this.players = [
      { id: 'p1', name: 'Renato', score: 0, hand: [] },
      { id: 'p2', name: 'Bia', score: 0, hand: [] },
      { id: 'p3', name: 'Lucas', score: 0, hand: [] }
    ];

    // Baralhos e Descarte
    this.blackDeck = [];
    this.whiteDeck = [];
    this.discardBlack = [];
    this.discardWhite = [];

    // Estado da Rodada Atual
    this.roundNumber = 0;
    this.czarIndex = 0;
    this.currentBlackCard = null;
    this.roundSubmissions = []; // [{ id, playerId, cards: [], isRando: false }]
    this.pendingPlayerQueue = []; // IDs dos jogadores que faltam submeter
    this.currentPlayerId = null;
    this.winningSubmission = null;

    // Callbacks de UI
    this.onStateChange = null;
  }

  notifyStateChange(data = {}) {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this.state, data);
    }
  }

  updateConfig(patch) {
    this.config = { ...this.config, ...patch };
  }

  // ==================== JOGADORES ====================
  addPlayer(name = '') {
    if (this.players.length >= 10) return false;
    const cleanName = name.trim() || `Jogador ${this.players.length + 1}`;
    this.players.push({
      id: 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: cleanName,
      score: 0,
      hand: []
    });
    return true;
  }

  removePlayer(id) {
    if (this.players.length <= 3) return false;
    const idx = this.players.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.players.splice(idx, 1);
      return true;
    }
    return false;
  }

  getCzarPlayer() {
    return this.players[this.czarIndex] || this.players[0];
  }

  getCurrentSubmittingPlayer() {
    return this.players.find(p => p.id === this.currentPlayerId) || null;
  }

  // ==================== INÍCIO DA PARTIDA ====================
  startGame() {
    if (this.players.length < 3) {
      return { success: false, message: 'Adicione pelo menos 3 jogadores!' };
    }

    // Carrega e embaralha baralhos oficiais do usuário
    const decks = DeckManager.buildActiveDeck();
    this.blackDeck = decks.blackDeck;
    this.whiteDeck = decks.whiteDeck;
    this.discardBlack = [];
    this.discardWhite = [];

    if (this.blackDeck.length < 5 || this.whiteDeck.length < 20) {
      return { success: false, message: 'Baralho insuficiente.' };
    }

    // Reseta pontuações e distribui 10 cartas para cada jogador
    this.players.forEach(p => {
      p.score = 0;
      p.hand = [];
      this.refillHand(p, 10);
    });

    this.roundNumber = 0;
    this.czarIndex = Math.floor(Math.random() * this.players.length);

    this.startNewRound();
    return { success: true };
  }

  refillHand(player, targetSize = 10) {
    while (player.hand.length < targetSize) {
      if (this.whiteDeck.length === 0) {
        if (this.discardWhite.length === 0) break;
        this.whiteDeck = [...this.discardWhite].sort(() => Math.random() - 0.5);
        this.discardWhite = [];
      }
      const card = this.whiteDeck.pop();
      if (card) player.hand.push(card);
    }
  }

  // ==================== CICLO DE RODADA ====================
  startNewRound() {
    this.roundNumber++;
    this.roundSubmissions = [];
    this.winningSubmission = null;

    // Gira o Czar
    if (this.roundNumber > 1) {
      this.czarIndex = (this.czarIndex + 1) % this.players.length;
    }

    // Puxa Carta Preta
    if (this.blackDeck.length === 0) {
      this.blackDeck = [...this.discardBlack].sort(() => Math.random() - 0.5);
      this.discardBlack = [];
    }
    this.currentBlackCard = this.blackDeck.pop();

    // Reabastece mãos até 10 cartas
    this.players.forEach(p => this.refillHand(p, 10));

    // Fila de quem precisa submeter (todos exceto o Czar)
    const czar = this.getCzarPlayer();
    this.pendingPlayerQueue = this.players
      .filter(p => p.id !== czar.id)
      .map(p => p.id);

    this.state = 'CZAR_READS';
    this.notifyStateChange();
  }

  confirmCzarRead() {
    this.advanceToNextSubmitter();
  }

  advanceToNextSubmitter() {
    if (this.pendingPlayerQueue.length > 0) {
      this.currentPlayerId = this.pendingPlayerQueue[0];
      this.state = 'PASS_DEVICE';
      this.notifyStateChange();
    } else {
      // Todos os jogadores humanos enviaram!
      if (this.config.randoCardrissian) {
        this.injectRandoCardrissian();
      }

      // Embaralha anonimamente as submissões
      this.roundSubmissions.sort(() => Math.random() - 0.5);

      this.state = 'PASS_TO_CZAR';
      this.notifyStateChange();
    }
  }

  unlockPlayerHand() {
    this.state = 'PLAYER_SUBMIT';
    this.notifyStateChange();
  }

  submitPlayerCards(playerId, cardIds) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    // Remove as cartas da mão do jogador
    const chosenCards = [];
    cardIds.forEach(cid => {
      const idx = player.hand.findIndex(c => c.id === cid);
      if (idx !== -1) {
        chosenCards.push(player.hand.splice(idx, 1)[0]);
      }
    });

    this.roundSubmissions.push({
      id: 'sub_' + Math.random().toString(36).substr(2, 9),
      playerId: player.id,
      cards: chosenCards,
      isRando: false
    });

    // Remove da fila
    this.pendingPlayerQueue.shift();
    this.advanceToNextSubmitter();
  }

  injectRandoCardrissian() {
    const pick = this.currentBlackCard.pick || 1;
    const randoCards = [];
    for (let i = 0; i < pick; i++) {
      if (this.whiteDeck.length === 0) {
        this.whiteDeck = [...this.discardWhite].sort(() => Math.random() - 0.5);
        this.discardWhite = [];
      }
      const card = this.whiteDeck.pop();
      if (card) randoCards.push(card);
    }

    if (randoCards.length > 0) {
      this.roundSubmissions.push({
        id: 'sub_rando_' + Math.random().toString(36).substr(2, 9),
        playerId: 'rando',
        cards: randoCards,
        isRando: true
      });
    }
  }

  openCzarJudging() {
    this.state = 'CZAR_JUDGE';
    this.notifyStateChange();
  }

  pickWinner(submissionId) {
    const sub = this.roundSubmissions.find(s => s.id === submissionId);
    if (!sub) return;

    this.winningSubmission = sub;
    let winnerPlayer = null;

    if (!sub.isRando) {
      winnerPlayer = this.players.find(p => p.id === sub.playerId);
      if (winnerPlayer) {
        winnerPlayer.score++;
      }
    } else {
      winnerPlayer = { id: 'rando', name: 'Rando Cardrissian (Bot)', score: 0 };
    }

    // Descarta cartas jogadas
    this.roundSubmissions.forEach(s => {
      s.cards.forEach(c => this.discardWhite.push(c));
    });
    this.discardBlack.push(this.currentBlackCard);

    // Registra no Hall da Fama
    DeckManager.recordHallOfFame({
      combo: this.currentBlackCard.text,
      winner: winnerPlayer.name,
      czar: this.getCzarPlayer().name
    });

    this.state = 'ROUND_REVEAL';
    this.notifyStateChange({
      winningSubmission: sub,
      winnerPlayer,
      isRando: sub.isRando
    });
  }

  checkGameOver() {
    const maxScore = Math.max(...this.players.map(p => p.score));
    return maxScore >= this.config.targetScore;
  }

  nextRound() {
    if (this.checkGameOver()) {
      this.state = 'GAME_OVER';
      this.notifyStateChange();
    } else {
      this.startNewRound();
    }
  }

  resetGame() {
    this.players.forEach(p => {
      p.score = 0;
      p.hand = [];
    });
    this.roundNumber = 0;
    this.roundSubmissions = [];
    this.state = 'SETUP';
    this.notifyStateChange();
  }

  getLeaderboard() {
    const sorted = [...this.players].sort((a, b) => b.score - a.score);
    const czarId = this.getCzarPlayer()?.id;

    const titles = [
      '👑 O Campeão do Absurdo',
      '🥈 Mente Pervertida',
      '🥉 Quinta Série Eterna',
      '🤡 Piadista Sem Noção',
      '🕊️ Cidadão de Bem',
      '🤐 O Inocente que não Engana Ninguém',
      '💩 Pura Decepção',
      '🤖 Mais Previsível que IA',
      '🍼 Bebê da Mesa',
      '💤 Entrou e Nem Percebeu'
    ];

    return sorted.map((p, idx) => ({
      ...p,
      title: titles[idx] || 'Participante',
      isCzar: p.id === czarId
    }));
  }
}

// Instância global
if (typeof window !== 'undefined') {
  window.cchGame = new CCHGame();
}
if (typeof module !== 'undefined') {
  module.exports = CCHGame;
}
