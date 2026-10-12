/**
 * Consenso — Cliente
 * Torneio da Mente Coletiva: Sincronize suas respostas com os outros jogadores!
 */
(() => {
  const { socket, DOM } = GameHub;

  let timerInterval = null;
  let hasSubmitted = false;
  let currentRoundInfo = null;

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function startTimer(seconds) {
    stopTimer();
    const timerFill = document.getElementById('consenso-timer-fill');
    if (!timerFill) return;

    timerFill.style.width = '100%';
    timerFill.className = 'estime-timer-fill';

    const startTime = Date.now();
    const durationMs = (seconds || 35) * 1000;
    const endTime = startTime + durationMs;

    timerInterval = setInterval(() => {
      const remainingMs = Math.max(0, endTime - Date.now());
      const pct = (remainingMs / durationMs) * 100;

      if (timerFill) {
        timerFill.style.width = `${pct}%`;
        if (remainingMs < 8000) {
          timerFill.className = 'estime-timer-fill danger';
        } else if (remainingMs < 16000) {
          timerFill.className = 'estime-timer-fill warning';
        }
      }

      if (remainingMs <= 0) {
        stopTimer();
      }
    }, 200);
  }

  // 1. Fase de Pergunta
  socket.on('game:consenso:question', (data) => {
    stopTimer();
    hasSubmitted = false;
    currentRoundInfo = data;

    try { AudioEngine.gameStart(); } catch (e) {}

    const isOvelha = !!data.isOvelhaNegra;
    const isGolden = !!data.isGoldenRound;

    let modeBadgeHtml = '';
    let instructionHtml = '';

    if (isOvelha) {
      modeBadgeHtml = '<span class="consenso-mode-badge ovelha">🐺 Rodada 3: Ovelha Negra</span>';
      instructionHtml = `
        <div class="consenso-instruction-banner ovelha">
          🐺 <strong>REGRA ANTI-CONSENSO:</strong> Tente dar uma resposta válida que <strong>NINGUÉM MAIS</strong> vai dar!<br>
          Quem for a única ovelha negra garante <strong>+30 pts</strong>! Se alguém repetir sua resposta, ambos zeram!
        </div>
      `;
    } else if (isGolden) {
      modeBadgeHtml = '<span class="consenso-mode-badge golden">🌟 Rodada Final de Ouro</span>';
      instructionHtml = `
        <div class="consenso-instruction-banner">
          🌟 <strong>RODADA DECISIVA:</strong> Todos os pontos da rodada valem em <strong>DOBRO (2x)</strong>!<br>
          Conecte sua mente com a maioria para disparar no placar!
        </div>
      `;
    } else {
      modeBadgeHtml = '<span class="consenso-mode-badge">🧠 Consenso Clássico</span>';
      instructionHtml = `
        <div class="consenso-instruction-banner">
          💡 <strong>OBJETIVO:</strong> Pense na resposta que a <strong>MAIORIA</strong> dos jogadores vai escrever.<br>
          Quanto mais pessoas derem a mesma resposta que você, mais pontos você ganha!
        </div>
      `;
    }

    DOM.gameArea.innerHTML = `
      <div class="consenso-wrapper">
        <!-- Top Bar -->
        <div class="consenso-top-bar">
          <div class="consenso-round-badge">
            <span>🧠 RODADA ${data.round} DE ${data.totalRounds}</span>
          </div>
          <div>${modeBadgeHtml}</div>
        </div>

        <!-- Timer Bar -->
        <div class="estime-timer-track">
          <div class="estime-timer-fill" id="consenso-timer-fill"></div>
        </div>

        <!-- Prompt Card -->
        <div class="consenso-prompt-card">
          <div style="display: flex; justify-content: center; margin-bottom: 8px;">
            <span class="estime-category-badge">🏷️ ${GameHub.escapeHtml(data.category || 'Geral')}</span>
          </div>
          <div class="consenso-prompt-emoji">${data.emoji || '🤝'}</div>
          <h2 class="consenso-prompt-text">${GameHub.escapeHtml(data.question)}</h2>

          ${instructionHtml}

          <!-- Form de Resposta -->
          <div id="consenso-form-wrap">
            <div class="consenso-input-box">
              <input type="text" id="consenso-answer" class="consenso-text-input" 
                placeholder="Digite sua resposta aqui..." maxlength="45" autocomplete="off" spellcheck="false">
              <button class="btn btn-primary btn-lg" id="consenso-submit" style="padding: 0 22px;">
                <span>✨</span> Enviar
              </button>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 8px;">
              💡 Dica: digite uma palavra ou termo simples e direto.
            </div>
          </div>

          <div id="consenso-status" style="margin-top: 14px; font-size: 0.88rem; color: var(--text-secondary);">
            Aguardando respostas...
          </div>
        </div>
      </div>
    `;

    const input = document.getElementById('consenso-answer');
    const submitBtn = document.getElementById('consenso-submit');
    const formWrap = document.getElementById('consenso-form-wrap');
    const statusText = document.getElementById('consenso-status');

    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendAnswer();
        }
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', sendAnswer);
    }

    function sendAnswer() {
      if (hasSubmitted) return;
      const val = input ? input.value.trim() : '';
      if (!val) {
        GameHub.showToast('Digite uma resposta antes de enviar!', 'error');
        return;
      }

      hasSubmitted = true;
      try { AudioEngine.tap(); } catch (e) {}

      socket.emit('game:action', { action: 'answer', answer: val });

      if (formWrap) {
        formWrap.innerHTML = `
          <div style="padding: 16px; background: rgba(26, 188, 156, 0.08); border-radius: var(--radius-md); border: 1px dashed rgba(26, 188, 156, 0.4); text-align: center;">
            <div style="font-size: 1.1rem; font-weight: 700; color: #1abc9c; margin-bottom: 4px;">
              ✓ Resposta Enviada: "${GameHub.escapeHtml(val)}"
            </div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">
              ${GameHub.showWaiting('Aguardando os outros jogadores responderem...')}
            </div>
          </div>
        `;
      }
    }

    startTimer(data.timeLimit || 35);
  });

  // 2. Progresso de Respostas
  socket.on('game:consenso:answered', (data) => {
    const statusText = document.getElementById('consenso-status');
    if (statusText) {
      statusText.innerHTML = `
        <span style="color: #1abc9c; font-weight: 800;">${data.count}/${data.total}</span> jogadores responderam
      `;
    }
  });

  // 3. Resultados da Rodada
  socket.on('game:consenso:results', (data) => {
    stopTimer();

    if (data.isUnanimous) {
      try { AudioEngine.correct(); } catch (e) {}
    } else {
      try { AudioEngine.gameEnd(); } catch (e) {}
    }

    const mySid = socket.id;
    const isOvelha = !!data.isOvelhaNegra;
    const isGolden = !!data.isGoldenRound;
    const totalPlayersInRound = data.results.length || 1;

    // Constrói Gráfico de Barras com as respostas agrupadas
    const chartHtml = data.frequencies.map((f, idx) => {
      const pct = Math.max(10, Math.round((f.count / totalPlayersInRound) * 100));
      const isTopWinner = (!isOvelha && idx === 0 && f.count > 1);
      const isOvelhaWinner = (isOvelha && f.count === 1);

      let cardClass = 'consenso-bar-card';
      let badgeHtml = '';

      if (isTopWinner) {
        cardClass += ' top-winner';
        badgeHtml = '<span class="consenso-freq-badge top">👑 Mais Popular</span>';
      } else if (isOvelhaWinner) {
        cardClass += ' ovelha-winner';
        badgeHtml = '<span class="consenso-freq-badge ovelha">🐺 Ovelha Única (+30 pts)</span>';
      }

      const chipsHtml = f.players.map(p => {
        const isMe = (p.sid === mySid);
        return `
          <div class="consenso-player-chip ${isMe ? 'my-chip' : ''}">
            <span class="consenso-player-chip-dot" style="background: ${p.color || '#1abc9c'};"></span>
            <span>${GameHub.escapeHtml(p.name)}${isMe ? ' (Você)' : ''}</span>
          </div>
        `;
      }).join('');

      return `
        <div class="${cardClass}">
          <div class="consenso-bar-header">
            <div class="consenso-word-title">
              <span>${GameHub.escapeHtml(f.word)}</span>
              ${badgeHtml}
            </div>
            <div class="consenso-freq-count">
              ${f.count} ${f.count === 1 ? 'voto' : 'votos'} <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">(${pct}%)</span>
            </div>
          </div>
          <div class="consenso-bar-track">
            <div class="consenso-bar-fill" style="width: ${pct}%;"></div>
          </div>
          <div class="consenso-players-chips">
            ${chipsHtml}
          </div>
        </div>
      `;
    }).join('');

    // Banner de Sintonia Unânime se ocorreu
    let unanimousHtml = '';
    if (data.isUnanimous) {
      unanimousHtml = `
        <div class="consenso-unanimous-banner">
          <span>🧠✨</span>
          <div>MENTE COLETIVA TOTAL! 100% de Sintonia (+25 pts Bônus)</div>
        </div>
      `;
    }

    // Box de Afinidades Telepáticas
    let affinitiesHtml = '';
    if (data.affinities && data.affinities.length > 0) {
      const topAffinities = data.affinities.slice(0, 3);
      affinitiesHtml = `
        <div class="consenso-affinities-box">
          <div style="font-weight: 700; color: #1abc9c; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            <span>⚡</span> Sintonias da Rodada:
          </div>
          ${topAffinities.map(a => `
            <div class="consenso-affinity-row">
              <span>🤝</span>
              <span><strong>${GameHub.escapeHtml(a.p1)}</strong> e <strong>${GameHub.escapeHtml(a.p2)}</strong> pensaram igual em <em>"${GameHub.escapeHtml(a.word)}"</em>!</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Tabela de Pontuação desta rodada
    const standingsHtml = data.results.map((r, i) => {
      const isMe = (r.sid === mySid);
      const roomPlayer = data.scores.find(s => s.id === r.sid || s.name === r.name);
      const totalScore = roomPlayer ? roomPlayer.score : 0;

      return `
        <div class="estime-res-row ${isMe ? 'highlight' : ''}">
          <div class="estime-res-left">
            <span class="estime-res-rank">${i + 1}º</span>
            <div>
              <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                <span>${GameHub.escapeHtml(r.name)}${isMe ? ' (Você)' : ''}</span>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">
                Resposta: "<strong>${GameHub.escapeHtml(r.rawAnswer || r.answer)}</strong>"
                ${r.matches > 1 ? `(${r.matches} coincidências)` : ''}
              </div>
            </div>
          </div>
          <div style="text-align: right;">
            <div class="estime-res-points" style="color: ${r.points > 0 ? '#1abc9c' : 'var(--text-muted)'}; font-size: 1.05rem;">
              +${r.points} <span style="font-size: 0.75rem; color: var(--text-secondary);">pts</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              Total: <strong>${totalScore}</strong>
            </div>
          </div>
        </div>
      `;
    }).join('');

    DOM.gameArea.innerHTML = `
      <div class="consenso-wrapper">
        <!-- Top Bar -->
        <div class="consenso-top-bar">
          <div class="consenso-round-badge">
            <span>📊 RESULTADOS: RODADA ${data.round} DE ${data.totalRounds}</span>
          </div>
          <div class="consenso-mode-badge ${isOvelha ? 'ovelha' : (isGolden ? 'golden' : '')}">
            ${isOvelha ? '🐺 Ovelha Negra' : (isGolden ? '🌟 Final de Ouro' : '🧠 Consenso')}
          </div>
        </div>

        ${unanimousHtml}

        <!-- Pergunta Resumo -->
        <div class="consenso-prompt-card" style="padding: 16px; margin-bottom: 4px;">
          <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 4px;">
            🏷️ ${GameHub.escapeHtml(data.category || 'Geral')} • Pergunta:
          </div>
          <div style="font-family: var(--font-display); font-size: 1.15rem; font-weight: 800; color: #fff;">
            ${GameHub.escapeHtml(data.question)}
          </div>
        </div>

        <!-- Gráfico de Frequências -->
        <div class="consenso-chart-box">
          <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
            <span>📊</span> Mapa de Mentes (Respostas mais votadas):
          </div>
          ${chartHtml}
        </div>

        ${affinitiesHtml}

        <!-- Classificação da Rodada -->
        <div class="consenso-prompt-card" style="text-align: left; padding: 16px;">
          <h3 style="font-family: var(--font-display); font-size: 1rem; color: var(--text-primary); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
            <span>🏅</span> Pontuação da Rodada
          </h3>
          <div class="estime-results-list">
            ${standingsHtml}
          </div>
        </div>

        <!-- Botão de Ação -->
        <div style="margin-top: 10px;">
          <button class="btn btn-primary btn-lg" id="consenso-next-btn" style="width: 100%;">
            ${data.isLastRound 
              ? '🏆 Ver Campeão do Torneio' 
              : `➡️ Próxima Rodada (${data.round + 1}/${data.totalRounds})`}
          </button>
        </div>
      </div>
    `;

    const nextBtn = document.getElementById('consenso-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        try { AudioEngine.click(); } catch (e) {}
        socket.emit('game:action', { action: 'next-round' });
        nextBtn.disabled = true;
        nextBtn.innerHTML = GameHub.showWaiting('Carregando próxima rodada...');
      });
    }
  });

  // 4. Encerramento do Torneio (Game Over com Pódio 3D)
  socket.on('game:consenso:gameover', (data) => {
    stopTimer();
    try { AudioEngine.gameEnd(); } catch (e) {}

    const rankings = data.rankings || [];
    const first = rankings[0] || { name: 'Campeão', score: 0 };
    const second = rankings[1] || null;
    const third = rankings[2] || null;

    DOM.gameArea.innerHTML = `
      <div class="consenso-wrapper">
        <div style="text-align: center; margin-bottom: 12px;">
          <div style="font-size: 2.8rem; margin-bottom: 6px;">🏆</div>
          <h2 style="font-family: var(--font-display); font-size: 1.8rem; font-weight: 900; color: #fff; margin-bottom: 4px;">
            Grande Final do Consenso!
          </h2>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">
            O jogador mais conectado com a mente de todos foi coroado!
          </p>
        </div>

        <!-- Pódio 3D -->
        <div class="estime-podium-wrap">
          ${second ? `
            <div class="estime-podium-col silver">
              <div style="font-size: 1.5rem; margin-bottom: 4px;">🥈</div>
              <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary); text-align: center; max-width: 85px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${GameHub.escapeHtml(second.name)}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 6px;">
                ${second.score} pts
              </div>
              <div class="estime-podium-step">2</div>
            </div>
          ` : ''}

          <div class="estime-podium-col gold">
            <div style="font-size: 2rem; margin-bottom: 4px;">👑</div>
            <div style="font-size: 0.95rem; font-weight: 800; color: #ffd700; text-align: center; max-width: 95px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${GameHub.escapeHtml(first.name)}
            </div>
            <div style="font-size: 0.8rem; color: #ffd700; margin-bottom: 6px; font-weight: 700;">
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

        <!-- Classificação Geral Final -->
        <div class="consenso-prompt-card" style="text-align: left; padding: 16px;">
          <h3 style="font-family: var(--font-display); font-size: 1rem; color: var(--text-primary); margin-bottom: 10px;">
            🏅 Classificação Geral Final
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
                  ${r.score} <span style="font-size: 0.75rem; color: var(--text-secondary);">pts</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Botão Voltar ao Lobby -->
        <div style="margin-top: 10px;">
          <button class="btn btn-secondary btn-lg" id="consenso-back-lobby-btn" style="width: 100%;">
            🏠 Voltar ao Lobby
          </button>
        </div>
      </div>
    `;

    const backBtn = document.getElementById('consenso-back-lobby-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        try { AudioEngine.click(); } catch (e) {}
        socket.emit('game:back-to-lobby');
      });
    }
  });
})();
