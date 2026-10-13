/**
 * Quem Escreveu Isso? — Cliente
 * Torneio de Respostas Criativas, Blefes e Adivinhação
 */
(() => {
  const { socket, DOM } = GameHub;

  let currentGameState = null;
  let timerInterval = null;
  let hasSubmittedAnswer = false;
  let hasVotedCurrent = false;

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // 1. Fase de Escrita da Pergunta
  socket.on('game:quem:question', (data) => {
    stopTimer();
    currentGameState = data;
    hasSubmittedAnswer = false;

    try { AudioEngine.gameStart(); } catch (e) {}

    // Formata reticências em destaque caso seja estilo complete a frase
    const formattedQuestion = GameHub.escapeHtml(data.question)
      .replace(/\.\.\./g, '<span class="quem-prompt-dots">...</span>');

    DOM.gameArea.innerHTML = `
      <div class="quem-wrapper">
        <!-- Top Bar -->
        <div class="quem-top-bar">
          <div class="quem-round-badge">
            <span>✍️ RODADA ${data.round} DE ${data.totalRounds}</span>
          </div>
          <div class="quem-category-badge">
            🏷️ ${GameHub.escapeHtml(data.category || 'Criatividade')}
          </div>
        </div>

        <!-- Timer Bar -->
        <div class="estime-timer-track">
          <div class="estime-timer-fill" id="quem-timer-fill"></div>
        </div>

        <!-- Prompt Card -->
        <div class="quem-prompt-card">
          <div class="quem-prompt-emoji">${data.emoji || '✍️'}</div>
          <h2 class="quem-prompt-text">${formattedQuestion}</h2>

          <!-- Textarea Input -->
          <div class="quem-input-box">
            <textarea id="quem-textarea" class="quem-textarea" 
              placeholder="Escreva sua resposta ou continuação mais engraçada e criativa..." 
              maxlength="200"></textarea>
            <div class="quem-char-counter"><span id="quem-chars">0</span>/200</div>
          </div>

          <div style="margin-top: 14px;">
            <button class="btn btn-primary btn-lg" id="quem-submit-btn" style="width: 100%;">
              <span>✨</span> Enviar Resposta Secreta
            </button>
          </div>
          <div id="quem-status-text" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px;">
            Seja criativo para que ninguém desconfie que foi você!
          </div>
        </div>
      </div>
    `;

    const textarea = document.getElementById('quem-textarea');
    const chars = document.getElementById('quem-chars');
    const submitBtn = document.getElementById('quem-submit-btn');
    const statusText = document.getElementById('quem-status-text');
    const timerFill = document.getElementById('quem-timer-fill');

    if (textarea) {
      textarea.focus();
      textarea.addEventListener('input', () => {
        if (chars) chars.textContent = textarea.value.length;
      });
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitAnswer();
        }
      });
    }

    function submitAnswer() {
      if (hasSubmittedAnswer) return;
      const text = textarea ? textarea.value.trim() : '';
      if (!text) {
        GameHub.showToast('Escreva algo antes de enviar!', 'error');
        return;
      }

      hasSubmittedAnswer = true;
      try { AudioEngine.tap(); } catch (e) {}

      socket.emit('game:action', { action: 'answer', text });

      if (textarea) textarea.disabled = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>🔒</span> Resposta Selada no Envelope!';
      }
      if (statusText) {
        statusText.innerHTML = GameHub.showWaiting('Aguardando os outros jogadores terminarem...');
      }
    }

    if (submitBtn) submitBtn.addEventListener('click', submitAnswer);

    // Timer regressivo de 60s
    let timeLeft = data.timeLimit || 60;
    const totalTime = timeLeft;

    timerInterval = setInterval(() => {
      timeLeft--;
      if (timerFill) {
        const pct = Math.max(0, (timeLeft / totalTime) * 100);
        timerFill.style.width = `${pct}%`;

        if (timeLeft <= 5) {
          timerFill.className = 'estime-timer-fill danger';
        } else if (timeLeft <= 15) {
          timerFill.className = 'estime-timer-fill warning';
        }
      }

      if (timeLeft <= 0) {
        stopTimer();
        if (!hasSubmittedAnswer) submitAnswer();
      }
    }, 1000);
  });

  // Atualização de jogadores que já responderam
  socket.on('game:quem:answered', (data) => {
    const statusText = document.getElementById('quem-status-text');
    if (statusText && hasSubmittedAnswer) {
      statusText.innerHTML = `<span style="color: var(--accent-tertiary); font-weight: 700;">👥 ${data.count}/${data.total} jogadores prontos</span>`;
    }
  });

  // 2. Fase de Votação em Cada Resposta
  socket.on('game:quem:vote-start', (data) => {
    stopTimer();
    hasVotedCurrent = false;
    const mySid = socket.id;
    const isMyAnswer = (mySid === data.authorSid);

    try { AudioEngine.notification(); } catch (e) {}

    DOM.gameArea.innerHTML = `
      <div class="quem-wrapper">
        <!-- Top Bar -->
        <div class="quem-top-bar">
          <div class="quem-round-badge">
            <span>🔍 RESPOSTA ${data.index + 1} DE ${data.total}</span>
          </div>
          <div class="quem-category-badge">🤔 QUEM ESCREVEU?</div>
        </div>

        <!-- Timer Bar -->
        <div class="estime-timer-track">
          <div class="estime-timer-fill" id="quem-timer-fill"></div>
        </div>

        <!-- Citation Quote Card -->
        <div class="quem-citation-card">
          <div class="quem-quote-mark">❝</div>
          <div class="quem-citation-text">
            "${GameHub.escapeHtml(data.text)}"
          </div>

          <!-- Mensagem se a resposta for do próprio jogador -->
          ${isMyAnswer ? `
            <div class="quem-author-notice">
              <span>🤫</span> <strong>Esta resposta é SUA!</strong> Mantenha cara de paisagem e veja quem você consegue enganar!
            </div>
          ` : `
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 4px;">
              Quem você acha que escreveu essa resposta?
            </p>
          `}

          <!-- Grid de Suspeitos -->
          ${!isMyAnswer ? `
            <div class="quem-suspects-grid" id="quem-suspects-grid">
              ${data.playerNames.map(name => `
                <button class="quem-suspect-btn" data-name="${GameHub.escapeHtml(name)}">
                  <div class="quem-suspect-avatar" style="background: #9b59b6;">
                    ${name.charAt(0).toUpperCase()}
                  </div>
                  <span class="quem-suspect-name">${GameHub.escapeHtml(name)}</span>
                </button>
              `).join('')}
            </div>
          ` : `
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 14px;">
              Aguardando os outros jogadores acusarem alguém...
            </div>
          `}

          <div id="quem-vote-status" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 12px;"></div>
        </div>
      </div>
    `;

    const timerFill = document.getElementById('quem-timer-fill');
    const voteStatus = document.getElementById('quem-vote-status');
    const buttons = document.querySelectorAll('#quem-suspects-grid .quem-suspect-btn');

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (hasVotedCurrent) return;
        hasVotedCurrent = true;

        buttons.forEach(b => {
          b.classList.remove('selected');
          b.disabled = true;
        });
        btn.classList.add('selected');

        try { AudioEngine.tap(); } catch (e) {}

        const targetName = btn.dataset.name;
        socket.emit('game:action', { action: 'vote', votedFor: targetName });

        if (voteStatus) {
          voteStatus.innerHTML = `<span style="color: var(--accent-tertiary);">Voto registrado em <strong>${GameHub.escapeHtml(targetName)}</strong>! Aguardando revelação...</span>`;
        }
      });
    });

    // Timer regressivo de 25s
    let timeLeft = data.timeLimit || 25;
    const totalTime = timeLeft;

    timerInterval = setInterval(() => {
      timeLeft--;
      if (timerFill) {
        const pct = Math.max(0, (timeLeft / totalTime) * 100);
        timerFill.style.width = `${pct}%`;

        if (timeLeft <= 5) {
          timerFill.className = 'estime-timer-fill danger';
        }
      }

      if (timeLeft <= 0) {
        stopTimer();
      }
    }, 1000);
  });

  // Atualização em tempo real de contagem de votos
  socket.on('game:quem:vote-progress', (data) => {
    const voteStatus = document.getElementById('quem-vote-status');
    if (voteStatus && !hasVotedCurrent) {
      voteStatus.innerHTML = `<span style="color: var(--text-secondary);">👥 ${data.count}/${data.total} já votaram</span>`;
    }
  });

  // 3. Revelação Dramática da Resposta
  socket.on('game:quem:reveal', (data) => {
    stopTimer();
    const mySid = socket.id;
    const isAuthor = (mySid === data.authorSid);
    const myVote = data.votes.find(v => v.voterSid === mySid);
    const myVoteCorrect = myVote ? myVote.correct : false;

    if (myVoteCorrect || (isAuthor && data.bluffsCount > 0)) {
      try { AudioEngine.correct(); } catch (e) {}
    } else {
      try { AudioEngine.reveal(); } catch (e) {}
    }

    DOM.gameArea.innerHTML = `
      <div class="quem-wrapper">
        <!-- Top Bar -->
        <div class="quem-top-bar">
          <div class="quem-round-badge">
            <span>🎉 REVELAÇÃO ${data.index + 1} DE ${data.total}</span>
          </div>
          <div class="quem-category-badge">🔍 O AUTOR REAL</div>
        </div>

        <!-- Card de Revelação -->
        <div class="quem-reveal-card">
          <div style="font-size: 2rem; margin-bottom: 4px;">🕵️‍♂️</div>
          <p style="font-size: 0.95rem; font-style: italic; color: var(--text-secondary); margin-bottom: 8px;">
            "${GameHub.escapeHtml(data.text)}"
          </p>

          <!-- Nome do Autor Real em Destaque -->
          <div class="quem-real-author-badge" style="border-color: ${data.authorColor || '#9b59b6'};">
            <span>✍️ Autor:</span>
            <strong style="color: #ffd700;">${GameHub.escapeHtml(data.realAuthor)}</strong>
            ${isAuthor ? '<small style="color: var(--accent-tertiary);">(Você!)</small>' : ''}
          </div>

          <!-- Badges de Blefe e Sucesso -->
          ${data.perfectBluff ? `
            <div>
              <div class="quem-bluff-badge" style="background: linear-gradient(135deg, #ffd700 0%, #ff8f00 100%); color: #211510;">
                <span>🏆</span> BLEFE PERFEITO! Ninguém descobriu o autor (+15 pts bônus!)
              </div>
            </div>
          ` : (data.bluffsCount > 0 ? `
            <div>
              <div class="quem-bluff-badge">
                <span>🎭</span> MESTRE DO BLEFE! Enganou ${data.bluffsCount} jogador(es) (+${data.bluffsCount * 10} pts)
              </div>
            </div>
          ` : '')}

          <!-- Lista de Votos e Acusações -->
          <div class="quem-votes-list">
            ${data.votes.length === 0 ? `
              <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 8px;">
                Nenhum jogador votou a tempo!
              </div>
            ` : data.votes.map(v => `
              <div class="quem-vote-item ${v.correct ? 'correct' : ''}">
                <div>
                  <strong>${GameHub.escapeHtml(v.voterName || v.voter)}</strong>
                  <span style="color: var(--text-muted);">acusou</span>
                  <strong>${GameHub.escapeHtml(v.guess || v.votedFor)}</strong>
                </div>
                <div>
                  ${v.correct 
                    ? '<span style="color: var(--accent-tertiary); font-weight: 700;">✅ Acertou! (+15 pts)</span>' 
                    : '<span style="color: #ff5252;">❌ Caiu no blefe</span>'}
                </div>
              </div>
            `).join('')}
          </div>

          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 14px;">
            Avançando automaticamente em instantes... ⏳
          </div>
        </div>
      </div>
    `;
  });

  // 4. Resumo Intermediário da Rodada
  socket.on('game:quem:round-summary', (data) => {
    stopTimer();
    try { AudioEngine.notification(); } catch (e) {}

    DOM.gameArea.innerHTML = `
      <div class="quem-wrapper">
        <div class="quem-top-bar">
          <div class="quem-round-badge">
            <span>📊 FIM DA RODADA ${data.round} DE ${data.totalRounds}</span>
          </div>
        </div>

        <div class="quem-prompt-card" style="text-align: left;">
          <h2 style="font-family: var(--font-display); font-size: 1.3rem; margin-bottom: 12px; color: var(--text-primary); text-align: center;">
            Placar Geral do Torneio
          </h2>
          <div class="estime-results-list">
            ${data.scores.map((p, i) => `
              <div class="estime-res-row ${p.id === socket.id ? 'highlight' : ''}">
                <div class="estime-res-left">
                  <span class="estime-res-rank">${i + 1}º</span>
                  <div>
                    <div style="font-weight: 700; color: var(--text-primary);">
                      ${GameHub.escapeHtml(p.name)}
                    </div>
                  </div>
                </div>
                <div class="estime-res-points">
                  ${p.score} <span style="font-size: 0.75rem; color: var(--text-secondary);">pts</span>
                </div>
              </div>
            `).join('')}
          </div>

          <div style="margin-top: 16px;">
            <button class="btn btn-primary btn-lg" id="quem-next-round-btn" style="width: 100%;">
              Ir para a Rodada ${data.round + 1} ➡️
            </button>
          </div>
        </div>
      </div>
    `;

    const nextBtn = document.getElementById('quem-next-round-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        try { AudioEngine.click(); } catch (e) {}
        nextBtn.disabled = true;
        nextBtn.innerHTML = 'Carregando próxima rodada...';
        socket.emit('game:action', { action: 'next-round' });
      });
    }
  });

  // 5. Resultados Finais e Pódio
  socket.on('game:quem:final-results', (data) => {
    stopTimer();
    try { AudioEngine.gameEnd(); } catch (e) {}

    const rankings = data.rankings || [];
    const first = rankings[0] || { name: 'Campeão', score: 0 };
    const second = rankings[1] || null;
    const third = rankings[2] || null;

    DOM.gameArea.innerHTML = `
      <div class="quem-wrapper">
        <div class="estime-reveal-header" style="text-align: center;">
          <div style="font-size: 3.5rem; margin-bottom: 4px;">🏆</div>
          <h1 style="font-family: var(--font-display); font-size: 1.8rem; color: #ffd700;">
            ${GameHub.escapeHtml(first.name)} é o Grande Vencedor!
          </h1>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">
            O melhor detetive e o mestre mais ardiloso do blefe!
          </p>
        </div>

        <!-- Pódio 3D -->
        <div class="estime-podium-wrap">
          ${second ? `
            <div class="estime-podium-col silver">
              <div style="font-size: 1.4rem; margin-bottom: 4px;">🥈</div>
              <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); text-align: center; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${GameHub.escapeHtml(second.name)}
              </div>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 6px;">
                ${second.score} pts
              </div>
              <div class="estime-podium-step">2</div>
            </div>
          ` : ''}

          <div class="estime-podium-col gold">
            <div style="font-size: 1.8rem; margin-bottom: 4px;">👑</div>
            <div style="font-size: 0.9rem; font-weight: 800; color: #ffd700; text-align: center; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${GameHub.escapeHtml(first.name)}
            </div>
            <div style="font-size: 0.76rem; color: #ffd700; margin-bottom: 6px; font-weight: 700;">
              ${first.score} pts
            </div>
            <div class="estime-podium-step">1</div>
          </div>

          ${third ? `
            <div class="estime-podium-col bronze">
              <div style="font-size: 1.4rem; margin-bottom: 4px;">🥉</div>
              <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); text-align: center; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${GameHub.escapeHtml(third.name)}
              </div>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 6px;">
                ${third.score} pts
              </div>
              <div class="estime-podium-step">3</div>
            </div>
          ` : ''}
        </div>

        <!-- Tabela Final -->
        <div class="quem-prompt-card" style="text-align: left; padding: 16px;">
          <h3 style="font-family: var(--font-display); font-size: 1rem; color: var(--text-primary); margin-bottom: 10px;">
            🏅 Placar Desta Partida (Quem Escreveu Isso?)
          </h3>
          <div class="estime-results-list">
            ${rankings.map((r, i) => `
              <div class="estime-res-row">
                <div class="estime-res-left">
                  <span class="estime-res-rank">${i + 1}º</span>
                  <div>
                    <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary);">
                      ${GameHub.escapeHtml(r.name)}
                    </div>
                  </div>
                </div>
                <div class="estime-res-points">
                  +${r.score} <span style="font-size: 0.75rem; color: var(--text-secondary);">pts</span>
                </div>
              </div>
            `).join('')}
          </div>
          <p style="font-size:0.75rem; color:var(--text-muted); margin-top:8px; text-align:center;">
            💡 Os pontos desta partida foram somados ao seu Ranking Geral no Lobby.
          </p>
        </div>

        <!-- Botão Voltar ao Lobby -->
        <div style="margin-top: 8px;">
          <button class="btn btn-secondary btn-lg" id="quem-back-lobby-btn" style="width: 100%;">
            🏠 Voltar ao Lobby
          </button>
        </div>
      </div>
    `;

    const backBtn = document.getElementById('quem-back-lobby-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        try { AudioEngine.click(); } catch (e) {}
        socket.emit('game:back-to-lobby');
      });
    }
  });
})();
