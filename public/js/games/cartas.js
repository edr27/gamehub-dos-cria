/**
 * Cartas Contra a Humanidade — Cliente Multijogador
 * Design Clássico, Minimalista e Funcional para Múltiplos Jogadores via Socket.IO
 */
(() => {
  const { socket, DOM } = GameHub;

  let currentRoundData = null;
  let currentJudgingData = null;
  let selectedCards = []; // [{ id, text }]
  let hasSubmitted = false;
  let autoAdvanceTimer = null;
  let shufflesAvailable = 1;
  let savedCardsToKeep = [];

  function clearAutoTimer() {
    if (autoAdvanceTimer) {
      clearInterval(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function getRequiredPick() {
    return currentRoundData?.blackCard?.pick || 1;
  }

  // Formata o texto da Carta Preta com prévia das cartas brancas selecionadas
  function renderBlackCardText(blackText, previewCards = []) {
    let text = GameHub.escapeHtml(blackText || '');
    const blankRegex = /_{2,}/g;
    let cardIdx = 0;

    if (blankRegex.test(text)) {
      blankRegex.lastIndex = 0;
      text = text.replace(blankRegex, () => {
        const card = previewCards[cardIdx++];
        if (card) {
          return `<span class="cartas-blank-filled">${GameHub.escapeHtml(card.text)}</span>`;
        }
        return `<span class="cartas-blank-empty">________</span>`;
      });
    } else if (previewCards.length > 0) {
      const extra = previewCards.map(c => `<span class="cartas-blank-filled">${GameHub.escapeHtml(c.text)}</span>`).join(' + ');
      text = `${text} — ${extra}`;
    }

    return text;
  }

  // ==================== 1. INÍCIO DA RODADA ====================
  socket.on('game:cartas:round-start', (data) => {
    clearAutoTimer();
    currentRoundData = data;
    currentJudgingData = null;
    selectedCards = [];
    hasSubmitted = false;
    if (typeof data.shufflesAvailable === 'number') {
      shufflesAvailable = data.shufflesAvailable;
    }

    try { AudioEngine.gameStart(); } catch (e) {}

    renderRoundView();
  });

  function renderRoundView() {
    if (!currentRoundData) return;
    const { round, isCzar, czarName, blackCard, hand, scores, targetScore } = currentRoundData;
    const pickRequired = blackCard.pick || 1;
    const myScore = scores?.[socket.id] || 0;

    const formattedBlackText = renderBlackCardText(blackCard.text, selectedCards);

    DOM.gameArea.innerHTML = `
      <div class="cartas-wrapper">
        <!-- Topo da Rodada -->
        <div class="cartas-top-bar">
          <div class="cartas-badge round-badge">
            🃏 RODADA ${round}
          </div>
          <div class="cartas-badge ${isCzar ? 'czar-badge-glow' : 'czar-badge'}">
            👑 ${isCzar ? 'VOCÊ É O CZAR' : `CZAR: ${GameHub.escapeHtml(czarName)}`}
          </div>
          <div class="cartas-badge score-badge">
            🎯 Meta: ${targetScore} pts (Você: ${myScore})
          </div>
        </div>

        <!-- Carta Preta Clássica -->
        <div class="cartas-black-card-container">
          <div class="cartas-black-card">
            <div class="cartas-black-text" id="cartas-black-text">
              ${formattedBlackText}
            </div>
            <div class="cartas-card-footer">
              <span class="cartas-brand">CARTAS CONTRA A HUMANIDADE</span>
              <span class="cartas-pick-badge">ESCOLHA ${pickRequired}</span>
            </div>
          </div>
        </div>

        <!-- Área de Ação -->
        ${isCzar ? `
          <!-- Visão do Czar: Aguardando respostas -->
          <div class="cartas-czar-waiting-panel">
            <div class="cartas-czar-icon">👑</div>
            <h3 class="cartas-czar-title">Você é o Czar da Rodada!</h3>
            <p class="cartas-czar-desc">
              Leia a carta preta em voz alta. Seus amigos estão escolhendo as cartas mais absurdas e politicamente incorretas para te impressionar.
            </p>
            <div class="cartas-progress-box">
              <div class="cartas-progress-status" id="cartas-czar-progress-text">
                ⏳ Aguardando jogadores enviarem suas cartas...
              </div>
              <div class="cartas-progress-track">
                <div class="cartas-progress-fill" id="cartas-czar-progress-fill" style="width: 0%;"></div>
              </div>
            </div>
          </div>
        ` : `
          <!-- Visão do Jogador: Escolha de Cartas da Mão -->
          <div class="cartas-player-submit-panel">
            <div class="cartas-submit-bar">
              <div class="cartas-instruction">
                ${hasSubmitted ? '✅ Carta enviada! Aguardando os demais jogadores...' : `Escolha <strong>${pickRequired}</strong> ${pickRequired > 1 ? 'cartas' : 'carta'} da sua mão:`}
              </div>
              <div class="cartas-action-buttons">
                ${!hasSubmitted ? `
                  <button class="cartas-btn-shuffle" id="cartas-btn-shuffle" ${shufflesAvailable <= 0 ? 'disabled' : ''} title="${shufflesAvailable > 0 ? 'Troque todas as cartas e salve até 3 favoritas (1x por jornada)' : 'Você já usou seu único shuffle desta partida'}">
                    🔀 ${shufflesAvailable > 0 ? 'Trocar Mão (1x)' : 'Shuffle Usado (0/1)'}
                  </button>
                  <button class="btn btn-primary cartas-btn-submit" id="cartas-submit-btn" disabled>
                    Confirmar Resposta (${selectedCards.length}/${pickRequired})
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- Mão de 10 Cartas Brancas -->
            <div class="cartas-hand-grid" id="cartas-hand-grid">
              ${hand.map((card) => {
                const isSelected = selectedCards.some(c => c.id === card.id);
                const orderIndex = selectedCards.findIndex(c => c.id === card.id) + 1;
                return `
                  <div class="cartas-white-card ${isSelected ? 'selected' : ''} ${hasSubmitted ? 'disabled' : ''}" 
                       data-card-id="${card.id}" 
                       data-card-text="${GameHub.escapeHtml(card.text)}">
                    ${isSelected && pickRequired > 1 ? `<div class="cartas-order-tag">${orderIndex}ª</div>` : ''}
                    <div class="cartas-white-text">${GameHub.escapeHtml(card.text)}</div>
                    <div class="cartas-card-footer dark">
                      <span class="cartas-brand">CARTAS BRANCAS</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `}
      </div>

      <!-- Container do Modal de Shuffle (injetado sob demanda) -->
      <div id="cartas-modal-container"></div>
    `;

    if (!isCzar && !hasSubmitted) {
      setupHandInteractions();
    }
  }

  function setupHandInteractions() {
    const cardElements = document.querySelectorAll('.cartas-white-card');
    const submitBtn = document.getElementById('cartas-submit-btn');
    const shuffleBtn = document.getElementById('cartas-btn-shuffle');
    const pickRequired = getRequiredPick();

    cardElements.forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        if (hasSubmitted) return;
        const cardId = cardEl.dataset.cardId;
        const cardText = cardEl.dataset.cardText;

        try { AudioEngine.tap(); } catch (e) {}

        const existingIdx = selectedCards.findIndex(c => c.id === cardId);
        if (existingIdx !== -1) {
          // Deselecionar
          selectedCards.splice(existingIdx, 1);
        } else {
          // Se já atingiu o limite de seleção, substitui
          if (selectedCards.length >= pickRequired) {
            if (pickRequired === 1) {
              selectedCards = [{ id: cardId, text: cardText }];
            } else {
              // No pick 2, remove a primeira e adiciona a nova
              selectedCards.shift();
              selectedCards.push({ id: cardId, text: cardText });
            }
          } else {
            selectedCards.push({ id: cardId, text: cardText });
          }
        }

        // Atualiza UI da mão e da Carta Preta em tempo real
        updateCardSelectionUI();
      });
    });

    if (shuffleBtn && shufflesAvailable > 0) {
      shuffleBtn.addEventListener('click', () => {
        if (hasSubmitted || shufflesAvailable <= 0) return;
        try { AudioEngine.click(); } catch (e) {}
        openShuffleModal();
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        if (selectedCards.length !== pickRequired || hasSubmitted) return;

        try { AudioEngine.click(); } catch (e) {}
        hasSubmitted = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando...';

        socket.emit('game:action', {
          action: 'submit',
          cardIds: selectedCards.map(c => c.id)
        });
      });
    }
  }

  // ==================== MODAL DE SHUFFLE COM ATÉ 3 CARTAS SALVAS ====================
  function openShuffleModal() {
    const modalContainer = document.getElementById('cartas-modal-container');
    if (!modalContainer || !currentRoundData) return;

    savedCardsToKeep = [];
    const hand = currentRoundData.hand || [];

    modalContainer.innerHTML = `
      <div class="cartas-shuffle-modal" id="cartas-shuffle-modal">
        <div class="cartas-shuffle-dialog">
          <div class="cartas-shuffle-header">
            <div class="cartas-shuffle-title-row">
              <span style="font-size: 1.6rem;">🔀</span>
              <h3>Trocar Cartas (Shuffle Único da Partida)</h3>
            </div>
            <p class="cartas-shuffle-desc">
              Você pode renovar toda a sua mão <strong>apenas uma vez por jornada</strong>. Clique nas cartas abaixo para <strong>salvar até 3 cartas</strong> que você deseja manter. Todas as cartas não salvas serão descartadas e trocadas por novas!
            </p>
          </div>

          <div class="cartas-shuffle-counter-bar">
            <span>Cartas Salvas para Manter: <strong id="cartas-modal-counter">0 / 3</strong></span>
            <span class="cartas-shuffle-badge">1 Uso Por Partida</span>
          </div>

          <div class="cartas-shuffle-cards-list" id="cartas-modal-cards-list">
            ${hand.map(c => `
              <div class="cartas-shuffle-item" data-id="${c.id}">
                <div class="cartas-shuffle-item-text">${GameHub.escapeHtml(c.text)}</div>
                <div class="cartas-shuffle-item-status">Toque para Salvar</div>
              </div>
            `).join('')}
          </div>

          <div class="cartas-shuffle-footer">
            <button class="btn btn-secondary" id="cartas-modal-cancel-btn">Cancelar</button>
            <button class="btn btn-primary" id="cartas-modal-confirm-btn">
              ✨ Confirmar Troca (Manter 0 cartas)
            </button>
          </div>
        </div>
      </div>
    `;

    const modalEl = document.getElementById('cartas-shuffle-modal');
    const counterEl = document.getElementById('cartas-modal-counter');
    const confirmBtn = document.getElementById('cartas-modal-confirm-btn');
    const cancelBtn = document.getElementById('cartas-modal-cancel-btn');
    const items = modalContainer.querySelectorAll('.cartas-shuffle-item');

    items.forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const idx = savedCardsToKeep.indexOf(id);

        if (idx !== -1) {
          // Remover
          savedCardsToKeep.splice(idx, 1);
          item.classList.remove('is-saved');
          const tag = item.querySelector('.cartas-save-tag');
          if (tag) tag.remove();
          const status = item.querySelector('.cartas-shuffle-item-status');
          if (status) status.textContent = 'Toque para Salvar';
          try { AudioEngine.tap(); } catch (e) {}
        } else {
          // Salvar (até 3)
          if (savedCardsToKeep.length >= 3) {
            try { AudioEngine.error(); } catch (e) {}
            GameHub.showToast('⚠️ Você já atingiu o limite de 3 cartas salvas!');
            return;
          }
          savedCardsToKeep.push(id);
          item.classList.add('is-saved');
          const tag = document.createElement('div');
          tag.className = 'cartas-save-tag';
          tag.textContent = '📌 SALVA';
          item.prepend(tag);
          const status = item.querySelector('.cartas-shuffle-item-status');
          if (status) status.textContent = '✅ Salva para a nova mão';
          try { AudioEngine.click(); } catch (e) {}
        }

        if (counterEl) {
          counterEl.textContent = `${savedCardsToKeep.length} / 3`;
        }
        if (confirmBtn) {
          confirmBtn.textContent = `✨ Confirmar Troca (Manter ${savedCardsToKeep.length} cartas)`;
        }
      });
    });

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        try { AudioEngine.click(); } catch (e) {}
        modalContainer.innerHTML = '';
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Trocando cartas...';
        try { AudioEngine.success(); } catch (e) {}

        socket.emit('game:action', {
          action: 'shuffle-hand',
          keepCardIds: savedCardsToKeep
        });
      });
    }
  }

  function closeShuffleModal() {
    const modalContainer = document.getElementById('cartas-modal-container');
    if (modalContainer) modalContainer.innerHTML = '';
  }

  // Confirmação do Shuffle recebida do Servidor
  socket.on('game:cartas:hand-shuffled', (data) => {
    shufflesAvailable = 0;
    if (currentRoundData) {
      currentRoundData.hand = data.hand;
    }
    selectedCards = [];
    closeShuffleModal();
    try { AudioEngine.success(); } catch (e) {}
    GameHub.showToast(`✨ Mão renovada com sucesso! Você salvou ${data.savedCount || 0} cartas.`);
    renderRoundView();
  });

  socket.on('game:cartas:error', (data) => {
    try { AudioEngine.error(); } catch (e) {}
    GameHub.showToast(`⚠️ ${data.message || 'Erro ao realizar ação'}`);
  });

  function updateCardSelectionUI() {
    const pickRequired = getRequiredPick();
    const submitBtn = document.getElementById('cartas-submit-btn');
    const blackTextEl = document.getElementById('cartas-black-text');

    // Atualiza preview no texto da carta preta
    if (blackTextEl && currentRoundData) {
      blackTextEl.innerHTML = renderBlackCardText(currentRoundData.blackCard.text, selectedCards);
    }

    // Atualiza botões e classes das cartas
    document.querySelectorAll('.cartas-white-card').forEach(cardEl => {
      const cardId = cardEl.dataset.cardId;
      const isSelected = selectedCards.some(c => c.id === cardId);
      const orderTag = cardEl.querySelector('.cartas-order-tag');

      cardEl.classList.toggle('selected', isSelected);

      if (isSelected && pickRequired > 1) {
        const orderIdx = selectedCards.findIndex(c => c.id === cardId) + 1;
        if (!orderTag) {
          const tag = document.createElement('div');
          tag.className = 'cartas-order-tag';
          tag.textContent = `${orderIdx}ª`;
          cardEl.prepend(tag);
        } else {
          orderTag.textContent = `${orderIdx}ª`;
        }
      } else if (orderTag) {
        orderTag.remove();
      }
    });

    if (submitBtn) {
      submitBtn.disabled = (selectedCards.length !== pickRequired);
      submitBtn.textContent = `Confirmar Resposta (${selectedCards.length}/${pickRequired})`;
    }
  }

  // ==================== 2. CONFIRMAÇÃO DE ENVIO ====================
  socket.on('game:cartas:submitted-ack', (data) => {
    hasSubmitted = true;
    try { AudioEngine.success(); } catch (e) {}

    const submitPanel = document.querySelector('.cartas-player-submit-panel');
    if (submitPanel) {
      submitPanel.innerHTML = `
        <div class="cartas-submitted-banner">
          <div class="cartas-submitted-icon">✅</div>
          <h3>Sua resposta foi enviada com sucesso!</h3>
          <p>Aguardando os outros jogadores terminarem para o Czar iniciar o julgamento.</p>
          <div class="cartas-submitted-preview-row">
            ${selectedCards.map((c, i) => `
              <div class="cartas-white-card mini">
                <div class="cartas-white-text">${GameHub.escapeHtml(c.text)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
  });

  // ==================== 3. PROGRESSO DOS ENVIOS ====================
  socket.on('game:cartas:submission-progress', (data) => {
    const progressText = document.getElementById('cartas-czar-progress-text');
    const progressFill = document.getElementById('cartas-czar-progress-fill');

    if (progressText && progressFill) {
      const pct = Math.min(100, Math.round((data.submittedCount / data.totalNeeded) * 100));
      progressText.textContent = `🃏 ${data.submittedCount} de ${data.totalNeeded} jogadores enviaram suas cartas`;
      progressFill.style.width = `${pct}%`;
    }
  });

  // ==================== 4. FASE DE JULGAMENTO ====================
  socket.on('game:cartas:judging-start', (data) => {
    clearAutoTimer();
    currentJudgingData = data;

    try { AudioEngine.notification(); } catch (e) {}

    renderJudgingView();
  });

  function renderJudgingView() {
    if (!currentJudgingData) return;
    const { blackCard, czarId, czarName, submissions } = currentJudgingData;
    const isCzar = (socket.id === czarId);

    DOM.gameArea.innerHTML = `
      <div class="cartas-wrapper">
        <!-- Topo -->
        <div class="cartas-top-bar">
          <div class="cartas-badge round-badge">
            ⚖️ JULGAMENTO DO CZAR
          </div>
          <div class="cartas-badge ${isCzar ? 'czar-badge-glow' : 'czar-badge'}">
            👑 ${isCzar ? 'SUA VEZ DE JULGAR!' : `CZAR: ${GameHub.escapeHtml(czarName)}`}
          </div>
        </div>

        <!-- Carta Preta Pinned -->
        <div class="cartas-black-card-container compact">
          <div class="cartas-black-card">
            <div class="cartas-black-text">
              ${GameHub.escapeHtml(blackCard.text)}
            </div>
            <div class="cartas-card-footer">
              <span class="cartas-brand">CARTAS CONTRA A HUMANIDADE</span>
            </div>
          </div>
        </div>

        <!-- Instruções de Julgamento -->
        <div class="cartas-judging-instruction">
          ${isCzar ? `
            <p>👇 Clique nas cartas viradas para revelá-las e escolha a mais hilária como <strong>Vencedora</strong>:</p>
          ` : `
            <p>👀 O Czar <strong>${GameHub.escapeHtml(czarName)}</strong> está lendo e avaliando as respostas da mesa...</p>
          `}
        </div>

        <!-- Grid de Cartas Submetidas Anônimas -->
        <div class="cartas-judging-grid" id="cartas-judging-grid">
          ${submissions.map((sub, idx) => {
            const isRevealed = sub.revealed;
            return `
              <div class="cartas-submission-card ${isRevealed ? 'revealed' : 'facedown'}" 
                   id="sub-card-${sub.subId}" 
                   data-sub-id="${sub.subId}">
                ${!isRevealed ? `
                  <div class="cartas-facedown-body ${isCzar ? 'clickable' : ''}">
                    <div class="cartas-facedown-icon">🃏</div>
                    <div class="cartas-facedown-label">RESPOSTA #${idx + 1}</div>
                    ${isCzar ? `<div class="cartas-facedown-hint">Toque para Revelar 👁️</div>` : ''}
                  </div>
                ` : `
                  <div class="cartas-revealed-body">
                    <div class="cartas-revealed-cards">
                      ${sub.cards.map(c => `
                        <div class="cartas-white-text">${GameHub.escapeHtml(c.text)}</div>
                      `).join('<div class="cartas-card-divider">+</div>')}
                    </div>
                    ${isCzar ? `
                      <button class="btn btn-warning cartas-pick-winner-btn" data-sub-id="${sub.subId}">
                        🏆 Escolher Vencedora
                      </button>
                    ` : ''}
                  </div>
                `}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    if (isCzar) {
      setupJudgingInteractions();
    }
  }

  function setupJudgingInteractions() {
    // Revelar carta ao clicar nela virada para baixo
    document.querySelectorAll('.cartas-submission-card.facedown').forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        const subId = cardEl.dataset.subId;
        try { AudioEngine.reveal(); } catch (e) {}
        socket.emit('game:action', {
          action: 'reveal-card',
          subId
        });
      });
    });

    // Escolher vencedora
    document.querySelectorAll('.cartas-pick-winner-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subId = btn.dataset.subId;
        try { AudioEngine.success(); } catch (e) {}
        btn.disabled = true;
        btn.textContent = 'Escolhendo...';
        socket.emit('game:action', {
          action: 'judge',
          subId
        });
      });
    });
  }

  // ==================== 5. CARTA REVELADA AO VIVO ====================
  socket.on('game:cartas:card-revealed', (data) => {
    try { AudioEngine.reveal(); } catch (e) {}

    if (currentJudgingData) {
      const sub = currentJudgingData.submissions.find(s => s.subId === data.subId);
      if (sub) sub.revealed = true;
    }

    const cardEl = document.getElementById(`sub-card-${data.subId}`);
    if (cardEl && currentJudgingData) {
      const sub = currentJudgingData.submissions.find(s => s.subId === data.subId);
      if (sub) {
        const isCzar = (socket.id === currentJudgingData.czarId);
        cardEl.className = 'cartas-submission-card revealed animate-flip';
        cardEl.innerHTML = `
          <div class="cartas-revealed-body">
            <div class="cartas-revealed-cards">
              ${sub.cards.map(c => `
                <div class="cartas-white-text">${GameHub.escapeHtml(c.text)}</div>
              `).join('<div class="cartas-card-divider">+</div>')}
            </div>
            ${isCzar ? `
              <button class="btn btn-warning cartas-pick-winner-btn" data-sub-id="${sub.subId}">
                🏆 Escolher Vencedora
              </button>
            ` : ''}
          </div>
        `;

        if (isCzar) {
          const btn = cardEl.querySelector('.cartas-pick-winner-btn');
          if (btn) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              btn.disabled = true;
              btn.textContent = 'Escolhendo...';
              socket.emit('game:action', {
                action: 'judge',
                subId: sub.subId
              });
            });
          }
        }
      }
    }
  });

  // ==================== 6. VENCEDOR DA RODADA ====================
  socket.on('game:cartas:round-winner', (data) => {
    clearAutoTimer();
    try { AudioEngine.success(); } catch (e) {}

    const isCzar = (socket.id === currentRoundData?.czarId);
    const isHost = GameHub.state?.isHost;
    let countdown = 12;

    DOM.gameArea.innerHTML = `
      <div class="cartas-wrapper">
        <!-- Banner de Vitória -->
        <div class="cartas-winner-spotlight">
          <div class="cartas-trophy-anim">🏆</div>
          <h2 class="cartas-winner-title">
            Vencedor da Rodada: <span class="winner-name-highlight">${GameHub.escapeHtml(data.winnerName)}</span>
          </h2>
          <div class="cartas-winner-pts-badge">+1 Ponto para o humorista!</div>

          <!-- Frase Completa Vencedora -->
          <div class="cartas-completed-sentence-box">
            <div class="cartas-completed-label">A COMBINAÇÃO VENCEDORA:</div>
            <div class="cartas-completed-text">
              "${GameHub.escapeHtml(data.completedSentence)}"
            </div>
          </div>
        </div>

        <!-- Placar da Sala -->
        <div class="cartas-scoreboard-box">
          <h4 class="cartas-scoreboard-title">📊 Placar Desta Partida (Rodadas Vencidas)</h4>
          <div class="cartas-scoreboard-list">
            ${data.players.map(p => {
              const score = data.scores[p.id] || 0;
              const isWinRound = (p.id === data.winnerId);
              return `
                <div class="cartas-score-chip ${isWinRound ? 'highlight' : ''}">
                  <span class="chip-name">${GameHub.escapeHtml(p.name)}</span>
                  <span class="chip-score">${score} rodadas</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Botão Próxima Rodada -->
        <div class="cartas-next-round-bar">
          ${(isCzar || isHost) ? `
            <button class="btn btn-primary btn-lg cartas-btn-next" id="cartas-btn-next-round">
              Próxima Rodada ➡️ <span id="cartas-countdown-span">(${countdown}s)</span>
            </button>
          ` : `
            <div class="cartas-waiting-next">
              Aguardando o Czar ou Host iniciar a próxima rodada <span id="cartas-countdown-span">(${countdown}s)</span>...
            </div>
          `}
        </div>
      </div>
    `;

    const countdownSpan = document.getElementById('cartas-countdown-span');
    const nextBtn = document.getElementById('cartas-btn-next-round');

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        clearAutoTimer();
        try { AudioEngine.click(); } catch (e) {}
        socket.emit('game:action', { action: 'next-round' });
      });
    }

    // Auto-avanço após 12 segundos para a jogatina não travar
    autoAdvanceTimer = setInterval(() => {
      countdown--;
      if (countdownSpan) countdownSpan.textContent = `(${countdown}s)`;
      if (countdown <= 0) {
        clearAutoTimer();
        if (isCzar || isHost) {
          socket.emit('game:action', { action: 'next-round' });
        }
      }
    }, 1000);
  });

  // ==================== 7. FIM DE JOGO (PODIUM) ====================
  socket.on('game:cartas:game-over', (data) => {
    clearAutoTimer();
    try { AudioEngine.gameEnd(); } catch (e) {}

    const rankings = data.rankings || [];
    const first = rankings[0];
    const second = rankings[1];
    const third = rankings[2];

    DOM.gameArea.innerHTML = `
      <div class="cartas-wrapper">
        <div class="cartas-winner-spotlight">
          <div style="font-size: 3.5rem; margin-bottom: 8px;">👑</div>
          <h1 style="font-family: var(--font-display); font-size: 1.8rem; color: #fff; margin-bottom: 6px;">
            CAMPEÃO DA PARTIDA!
          </h1>
          <p style="color: var(--text-secondary); margin-bottom: 24px;">
            Atingiu o objetivo de ${data.targetScore} vitórias com as respostas mais perversas.
          </p>

          <!-- Pódio -->
          <div class="estime-podium-wrap" style="margin: 20px 0 30px;">
            ${second ? `
              <div class="estime-podium-col silver">
                <div style="font-size: 1.6rem; margin-bottom: 4px;">🥈</div>
                <div class="podium-name">${GameHub.escapeHtml(second.name)}</div>
                <div class="podium-score">${second.score} pts</div>
                <div class="estime-podium-step">2</div>
              </div>
            ` : ''}

            ${first ? `
              <div class="estime-podium-col gold">
                <div style="font-size: 2.2rem; margin-bottom: 4px;">🥇</div>
                <div class="podium-name" style="font-size: 1rem; color: #ffd700;">${GameHub.escapeHtml(first.name)}</div>
                <div class="podium-score" style="color: #ffd700; font-weight: 800;">${first.score} pts</div>
                <div class="estime-podium-step">1</div>
              </div>
            ` : ''}

            ${third ? `
              <div class="estime-podium-col bronze">
                <div style="font-size: 1.4rem; margin-bottom: 4px;">🥉</div>
                <div class="podium-name">${GameHub.escapeHtml(third.name)}</div>
                <div class="podium-score">${third.score} pts</div>
                <div class="estime-podium-step">3</div>
              </div>
            ` : ''}
          </div>

          <!-- Tabela Completa -->
          <div class="cartas-scoreboard-box" style="margin-bottom: 24px;">
            <h4 class="cartas-scoreboard-title">🏆 Placar Final Desta Partida</h4>
            <div class="estime-results-list">
              ${rankings.map((r, i) => `
                <div class="estime-res-row">
                  <div class="estime-res-left">
                    <span class="estime-res-rank">${i + 1}º</span>
                    <span style="font-weight: 700; color: #fff;">${GameHub.escapeHtml(r.name)}</span>
                  </div>
                  <div class="estime-res-points">${r.score} rodadas ganhas</div>
                </div>
              `).join('')}
            </div>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 12px; text-align: center;">
              ⭐ Os bônus desta partida foram somados ao <strong>Ranking Geral do Lobby</strong>.
            </p>
          </div>

          <!-- Voltar ao Lobby -->
          <button class="btn btn-secondary btn-lg" id="cartas-back-lobby-btn" style="width: 100%; max-width: 320px;">
            🏠 Voltar ao Lobby
          </button>
        </div>
      </div>
    `;

    const backBtn = document.getElementById('cartas-back-lobby-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        try { AudioEngine.click(); } catch (e) {}
        socket.emit('game:back-to-lobby');
      });
    }
  });
})();
