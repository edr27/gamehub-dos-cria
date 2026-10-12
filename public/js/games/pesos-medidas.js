/**
 * Adivinhe o Ângulo (Memorização Visual de Ponteiro)
 * O jogador memoriza a posição do ponteiro (sem números!) e tenta reproduzir com precisão.
 */
(() => {
  const { socket, DOM } = GameHub;

  let timerInterval = null;
  let hasSubmitted = false;
  let currentAngle = 90; // Ângulo interativo do jogador
  let isDragging = false;
  let autoAdvanceTimer = null;

  const CX = 190;
  const CY = 175;
  const RADIUS = 135;

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (autoAdvanceTimer) {
      clearInterval(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function degToCoords(deg, r = RADIUS) {
    const rad = (deg * Math.PI) / 180;
    return {
      x: CX + r * Math.cos(rad),
      y: CY - r * Math.sin(rad)
    };
  }

  // Gera o mostrador visual limpo (SEM NÚMEROS)
  function renderCleanDialSvg(mode, targetAngle = 0, playerAngle = 90, allResults = []) {
    // Modo 'show': exibe o ponteiro alvo para memorizar
    // Modo 'guess': exibe apenas o ponteiro do jogador para ajustar
    // Modo 'results': exibe o alvo original + ponteiros dos jogadores sobrepostos

    let targetCoords = degToCoords(targetAngle);
    let playerCoords = degToCoords(playerAngle);

    return `
      <svg width="380" height="210" viewBox="0 0 380 210" class="angulo-clean-svg" id="angulo-interactive-svg">
        <defs>
          <radialGradient id="dialGlow" cx="50%" cy="100%" r="90%">
            <stop offset="0%" stop-color="rgba(0, 229, 255, 0.12)" />
            <stop offset="100%" stop-color="rgba(10, 15, 30, 0.95)" />
          </radialGradient>
          <filter id="laserGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="targetGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4.5" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <!-- Fundo Semicircular do Mostrador -->
        <path d="M ${CX - RADIUS} ${CY} A ${RADIUS} ${RADIUS} 0 0 1 ${CX + RADIUS} ${CY} Z" 
          fill="url(#dialGlow)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="2" />

        <!-- Linha Base Horizontal Neutra (Sem marcações numéricas) -->
        <line x1="${CX - RADIUS - 16}" y1="${CY}" x2="${CX + RADIUS + 16}" y2="${CY}" 
          stroke="rgba(255, 255, 255, 0.25)" stroke-width="2.5" stroke-linecap="round" />

        <!-- Arco Externo Suave -->
        <path d="M ${CX - RADIUS} ${CY} A ${RADIUS} ${RADIUS} 0 0 1 ${CX + RADIUS} ${CY}" 
          fill="none" stroke="rgba(255, 255, 255, 0.18)" stroke-width="3" stroke-dasharray="4 6" />

        ${mode === 'show' ? `
          <!-- PONTEIRO ALVO PARA MEMORIZAR (Luminoso, sem números) -->
          <line id="angulo-show-needle" x1="${CX}" y1="${CY}" x2="${targetCoords.x}" y2="${targetCoords.y}" 
            stroke="#ff2a75" stroke-width="4.5" stroke-linecap="round" filter="url(#targetGlow)" />
          
          <circle cx="${targetCoords.x}" cy="${targetCoords.y}" r="8" fill="#ff2a75" stroke="#ffffff" stroke-width="2.5" filter="url(#targetGlow)" />
          <circle cx="${targetCoords.x}" cy="${targetCoords.y}" r="3" fill="#ffffff" />
        ` : ''}

        ${mode === 'guess' ? `
          <!-- PONTEIRO INTERATIVO DO JOGADOR (Para ajustar na posição memorizada) -->
          <line id="angulo-interactive-needle" x1="${CX}" y1="${CY}" x2="${playerCoords.x}" y2="${playerCoords.y}" 
            stroke="#00e5ff" stroke-width="4" stroke-linecap="round" filter="url(#laserGlow)" />
          
          <!-- Knob de Ajuste na Ponta -->
          <circle id="angulo-interactive-knob" cx="${playerCoords.x}" cy="${playerCoords.y}" r="15" 
            fill="#00e5ff" stroke="#ffffff" stroke-width="3" filter="url(#laserGlow)" style="cursor: grab;" />
          <circle cx="${playerCoords.x}" cy="${playerCoords.y}" r="5" fill="#ffffff" pointer-events="none" />
        ` : ''}

        ${mode === 'results' ? `
          <!-- REVELAÇÃO: PONTEIRO ALVO ORIGINAL (Em Ouro/Verde) -->
          <line x1="${CX}" y1="${CY}" x2="${targetCoords.x}" y2="${targetCoords.y}" 
            stroke="#ffd700" stroke-width="4.5" stroke-linecap="round" filter="url(#targetGlow)" />
          <circle cx="${targetCoords.x}" cy="${targetCoords.y}" r="8" fill="#ffd700" stroke="#fff" stroke-width="2" />

          <!-- PONTEIROS DOS JOGADORES SOBREPOSTOS -->
          ${allResults.map(r => {
            const pCoord = degToCoords(r.guess);
            const isMe = (r.sid === socket.id);
            return `
              <line x1="${CX}" y1="${CY}" x2="${pCoord.x}" y2="${pCoord.y}" 
                stroke="${r.color || '#00e5ff'}" stroke-width="${isMe ? 3.5 : 2}" stroke-linecap="round" opacity="${isMe ? 1 : 0.75}" />
              <circle cx="${pCoord.x}" cy="${pCoord.y}" r="${isMe ? 7 : 5}" fill="${r.color || '#00e5ff'}" stroke="#fff" stroke-width="1.5" />
            `;
          }).join('')}
        ` : ''}

        <!-- Ponto Central Pivot -->
        <circle cx="${CX}" cy="${CY}" r="10" fill="#0c1824" stroke="rgba(255, 255, 255, 0.4)" stroke-width="2.5" />
        <circle cx="${CX}" cy="${CY}" r="4" fill="#ffffff" />
      </svg>
    `;
  }

  // ==================== 1. FASE DE MEMORIZAÇÃO (SHOW) ====================
  socket.on('game:angulo:show', (data) => {
    stopTimer();
    hasSubmitted = false;
    currentAngle = 90; // Reseta o ponteiro neutro para a próxima fase

    try { AudioEngine.notification(); } catch (e) {}

    const totalSeconds = (data.showDuration || 2500) / 1000;
    let secondsLeft = Math.ceil(totalSeconds);

    DOM.gameArea.innerHTML = `
      <div class="angulo-clean-wrapper">
        <!-- Top Bar -->
        <div class="angulo-clean-top">
          <div class="angulo-badge round">
            🎯 RODADA ${data.round} DE ${data.totalRounds}
          </div>
          <div class="angulo-badge memorize-pulse">
            👁️ MEMORIZE A POSIÇÃO!
          </div>
        </div>

        <!-- Instrução -->
        <div class="angulo-clean-instruction">
          <h2 class="memorize-title">Olhe atentamente para o ponteiro!</h2>
          <p class="memorize-subtitle">Ele vai sumir em <span id="angulo-show-countdown">${secondsLeft}</span>s e você terá que colocá-lo exatamente aí.</p>
        </div>

        <!-- Mostrador com o Ponteiro Alvo (Sem números) -->
        <div class="angulo-dial-box">
          ${renderCleanDialSvg('show', data.targetAngle)}
        </div>

        <!-- Barra de Tempo de Memorização -->
        <div class="angulo-memo-timer-track">
          <div class="angulo-memo-timer-fill" id="angulo-memo-fill"></div>
        </div>
      </div>
    `;

    const timerFill = document.getElementById('angulo-memo-fill');
    if (timerFill) {
      timerFill.style.transition = `width ${data.showDuration}ms linear`;
      setTimeout(() => { timerFill.style.width = '0%'; }, 50);
    }

    const countdownEl = document.getElementById('angulo-show-countdown');
    timerInterval = setInterval(() => {
      secondsLeft--;
      if (countdownEl && secondsLeft > 0) {
        countdownEl.textContent = secondsLeft;
      }
      if (secondsLeft <= 0) {
        clearInterval(timerInterval);
      }
    }, 1000);
  });

  // ==================== 2. FASE DE AJUSTE (GUESS) ====================
  socket.on('game:angulo:guess-phase', (data) => {
    stopTimer();
    hasSubmitted = false;

    try { AudioEngine.tap(); } catch (e) {}

    DOM.gameArea.innerHTML = `
      <div class="angulo-clean-wrapper">
        <!-- Top Bar -->
        <div class="angulo-clean-top">
          <div class="angulo-badge round">
            🎯 RODADA ${data.round} DE ${data.totalRounds}
          </div>
          <div class="angulo-badge guess-active">
            ✋ SUA VEZ DE AJUSTAR
          </div>
        </div>

        <!-- Timer Bar -->
        <div class="estime-timer-track">
          <div class="estime-timer-fill" id="angulo-timer-fill"></div>
        </div>

        <!-- Instrução -->
        <div class="angulo-clean-instruction">
          <h2 class="guess-title">Ajuste o ponteiro para a posição memorizada:</h2>
          <p class="guess-subtitle">Arraste no mostrador ou use o controle deslizante abaixo.</p>
        </div>

        <!-- Mostrador Interativo (Ponteiro do jogador, sem números) -->
        <div class="angulo-dial-box" id="angulo-dial-container">
          ${renderCleanDialSvg('guess', 0, currentAngle)}
        </div>

        <!-- Controles de Ajuste do Jogador -->
        <div class="angulo-controls-box">
          <div class="angulo-slider-row">
            <button class="angulo-tune-btn" id="angulo-tune-minus" title="Ajuste fino para a esquerda">◀</button>
            <input type="range" min="0" max="180" step="0.5" value="${currentAngle}" id="angulo-range-slider" class="angulo-clean-slider" />
            <button class="angulo-tune-btn" id="angulo-tune-plus" title="Ajuste fino para a direita">▶</button>
          </div>

          <!-- Botão Confirmar -->
          <div style="margin-top: 14px;">
            <button class="btn btn-primary btn-lg angulo-confirm-btn" id="angulo-btn-confirm">
              Confirmar Posição 🎯
            </button>
          </div>
        </div>
      </div>
    `;

    setupInteractiveControls(data.timeLimit || 15);
  });

  function setupInteractiveControls(timeLimit) {
    const slider = document.getElementById('angulo-range-slider');
    const btnConfirm = document.getElementById('angulo-btn-confirm');
    const btnMinus = document.getElementById('angulo-tune-minus');
    const btnPlus = document.getElementById('angulo-tune-plus');
    const svgEl = document.getElementById('angulo-interactive-svg');

    // Timer regressivo
    startGuessTimer(timeLimit);

    function updateNeedle(newAngle) {
      currentAngle = Math.max(0, Math.min(180, Math.round(newAngle * 10) / 10));
      if (slider) slider.value = currentAngle;

      const p = degToCoords(currentAngle);
      const needle = document.getElementById('angulo-interactive-needle');
      const knob = document.getElementById('angulo-interactive-knob');

      if (needle) {
        needle.setAttribute('x2', p.x);
        needle.setAttribute('y2', p.y);
      }
      if (knob) {
        knob.setAttribute('cx', p.x);
        knob.setAttribute('cy', p.y);
      }
    }

    if (slider) {
      slider.addEventListener('input', (e) => {
        updateNeedle(parseFloat(e.target.value));
      });
    }

    if (btnMinus) {
      btnMinus.addEventListener('click', () => {
        try { AudioEngine.tap(); } catch (e) {}
        updateNeedle(currentAngle - 1);
      });
    }

    if (btnPlus) {
      btnPlus.addEventListener('click', () => {
        try { AudioEngine.tap(); } catch (e) {}
        updateNeedle(currentAngle + 1);
      });
    }

    // Interação direta tocando / arrastando no mostrador
    if (svgEl) {
      function handleSvgPointer(e) {
        const rect = svgEl.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const scaleX = 380 / rect.width;
        const scaleY = 210 / rect.height;

        const svgX = (clientX - rect.left) * scaleX;
        const svgY = (clientY - rect.top) * scaleY;

        const dx = svgX - CX;
        const dy = CY - svgY; // Inverte Y no SVG

        let deg = Math.atan2(dy, dx) * (180 / Math.PI);
        if (deg < 0) deg = 0;
        if (deg > 180) deg = 180;

        updateNeedle(deg);
      }

      svgEl.addEventListener('mousedown', (e) => {
        if (hasSubmitted) return;
        isDragging = true;
        handleSvgPointer(e);
      });

      window.addEventListener('mousemove', (e) => {
        if (isDragging && !hasSubmitted) {
          handleSvgPointer(e);
        }
      });

      window.addEventListener('mouseup', () => {
        isDragging = false;
      });

      svgEl.addEventListener('touchstart', (e) => {
        if (hasSubmitted) return;
        isDragging = true;
        handleSvgPointer(e);
      }, { passive: true });

      window.addEventListener('touchmove', (e) => {
        if (isDragging && !hasSubmitted) {
          handleSvgPointer(e);
        }
      }, { passive: true });

      window.addEventListener('touchend', () => {
        isDragging = false;
      });
    }

    // Botão Confirmar
    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => {
        if (hasSubmitted) return;
        submitGuess();
      });
    }
  }

  function submitGuess() {
    hasSubmitted = true;
    try { AudioEngine.click(); } catch (e) {}

    const btn = document.getElementById('angulo-btn-confirm');
    const controlsBox = document.querySelector('.angulo-controls-box');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
    }

    socket.emit('game:action', {
      action: 'guess',
      value: currentAngle
    });

    if (controlsBox) {
      controlsBox.innerHTML = `
        <div class="angulo-waiting-badge">
          ✅ Posição registrada! Aguardando os outros jogadores...
        </div>
      `;
    }
  }

  function startGuessTimer(seconds) {
    const timerFill = document.getElementById('angulo-timer-fill');
    if (!timerFill) return;

    timerFill.style.width = '100%';
    const durationMs = seconds * 1000;
    const endTime = Date.now() + durationMs;

    timerInterval = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now());
      const pct = (remaining / durationMs) * 100;

      if (timerFill) {
        timerFill.style.width = `${pct}%`;
        if (remaining < 4000) {
          timerFill.className = 'estime-timer-fill danger';
        } else if (remaining < 8000) {
          timerFill.className = 'estime-timer-fill warning';
        }
      }

      if (remaining <= 0) {
        clearInterval(timerInterval);
        if (!hasSubmitted) submitGuess();
      }
    }, 200);
  }

  // Progresso de respostas recebidas
  socket.on('game:angulo:guessed', (data) => {
    // Atualização visual sutil caso queira
  });

  // ==================== 3. RESULTADOS DA RODADA ====================
  socket.on('game:angulo:results', (data) => {
    stopTimer();
    try { AudioEngine.reveal(); } catch (e) {}

    const myResult = data.results.find(r => r.sid === socket.id);
    const isHost = GameHub.state?.isHost;
    let countdown = 8;

    DOM.gameArea.innerHTML = `
      <div class="angulo-clean-wrapper">
        <!-- Top Bar -->
        <div class="angulo-clean-top">
          <div class="angulo-badge round">
            🎯 RESULTADO — RODADA ${data.round} DE ${data.totalRounds}
          </div>
          ${myResult?.isBullseye ? `
            <div class="angulo-badge bullseye-glow">
              🎯 NA MOSCA! PERFEITO!
            </div>
          ` : ''}
        </div>

        <!-- Mostrador de Revelação com o Alvo Original + Palpites -->
        <div class="angulo-dial-box">
          ${renderCleanDialSvg('results', data.targetAngle, 0, data.results)}
        </div>

        <!-- Legenda Visual Limpa -->
        <div class="angulo-results-legend">
          <div class="legend-chip target">
            <span class="legend-color-dot gold"></span> 🎯 Posição Correta
          </div>
          <div class="legend-chip player">
            <span class="legend-color-dot cyan"></span> ✋ Sua Escolha ${myResult ? `(Erro: ${myResult.diff}°)` : ''}
          </div>
        </div>

        <!-- Classificação da Rodada (Quem chegou mais perto) -->
        <div class="angulo-results-card">
          <h3 class="results-card-title">🏆 Ranking da Rodada (Menor Desvio Vence)</h3>
          <div class="estime-results-list">
            ${data.results.map((r, i) => `
              <div class="estime-res-row ${r.sid === socket.id ? 'active-player' : ''}">
                <div class="estime-res-left">
                  <span class="estime-res-rank">${i + 1}º</span>
                  <div>
                    <span style="font-weight: 800; color: #fff;">${GameHub.escapeHtml(r.name)}</span>
                    <span style="font-size: 0.8rem; color: var(--text-secondary); margin-left: 8px;">
                      Diferença: <strong>${r.diff}°</strong> ${r.isBullseye ? '🎯' : ''}
                    </span>
                  </div>
                </div>
                <div class="estime-res-points">
                  +${r.points} <span style="font-size: 0.75rem; color: var(--text-secondary);">pts</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Botão Próxima Rodada -->
        <div style="margin-top: 10px;">
          ${isHost ? `
            <button class="btn btn-primary btn-lg angulo-confirm-btn" id="angulo-btn-next-round">
              Próxima Rodada ➡️ <span id="angulo-countdown-span">(${countdown}s)</span>
            </button>
          ` : `
            <p style="color: var(--text-muted); font-size: 0.9rem; font-style: italic;">
              Aguardando o Host iniciar a próxima rodada <span id="angulo-countdown-span">(${countdown}s)</span>...
            </p>
          `}
        </div>
      </div>
    `;

    const countdownSpan = document.getElementById('angulo-countdown-span');
    const nextBtn = document.getElementById('angulo-btn-next-round');

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        stopTimer();
        try { AudioEngine.click(); } catch (e) {}
        socket.emit('game:action', { action: 'next-round' });
      });
    }

    autoAdvanceTimer = setInterval(() => {
      countdown--;
      if (countdownSpan) countdownSpan.textContent = `(${countdown}s)`;
      if (countdown <= 0) {
        stopTimer();
        if (isHost) {
          socket.emit('game:action', { action: 'next-round' });
        }
      }
    }, 1000);
  });

  // ==================== 4. PÓDIO FINAL ====================
  socket.on('game:angulo:gameover', (data) => {
    stopTimer();
    try { AudioEngine.gameEnd(); } catch (e) {}

    const rankings = data.rankings || [];
    const first = rankings[0];
    const second = rankings[1];
    const third = rankings[2];

    DOM.gameArea.innerHTML = `
      <div class="angulo-clean-wrapper">
        <div style="font-size: 3.5rem; margin-bottom: 4px;">👑</div>
        <h1 style="font-family: var(--font-display); font-size: 1.8rem; color: #fff; margin-bottom: 4px;">
          MESTRE DO OLHO CLÍNICO!
        </h1>
        <p style="color: var(--text-secondary); margin-bottom: 20px;">
          Quem teve a melhor memória espacial e chegou mais perto do ponteiro.
        </p>

        <!-- Pódio -->
        <div class="estime-podium-wrap" style="margin-bottom: 24px;">
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
              <div class="podium-name" style="font-size: 1.05rem; color: #ffd700;">${GameHub.escapeHtml(first.name)}</div>
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

        <!-- Classificação Geral -->
        <div class="angulo-results-card" style="margin-bottom: 20px;">
          <h3 class="results-card-title">📊 Classificação Geral Final</h3>
          <div class="estime-results-list">
            ${rankings.map((r, i) => `
              <div class="estime-res-row ${r.id === socket.id ? 'active-player' : ''}">
                <div class="estime-res-left">
                  <span class="estime-res-rank">${i + 1}º</span>
                  <div>
                    <span style="font-weight: 800; color: #fff;">${GameHub.escapeHtml(r.name)}</span>
                    <span style="font-size: 0.8rem; color: var(--text-secondary); margin-left: 8px;">
                      Erro médio: ±${r.avgDiff}°
                    </span>
                  </div>
                </div>
                <div class="estime-res-points">${r.score} pts</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Voltar ao Lobby -->
        <button class="btn btn-secondary btn-lg" id="angulo-back-lobby-btn" style="width: 100%; max-width: 320px;">
          🏠 Voltar ao Lobby
        </button>
      </div>
    `;

    const backBtn = document.getElementById('angulo-back-lobby-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        try { AudioEngine.click(); } catch (e) {}
        socket.emit('game:back-to-lobby');
      });
    }
  });
})();
