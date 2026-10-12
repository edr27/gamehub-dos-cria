/**
 * Estime — Cliente
 * Torneio Survival Battle Royale — 3 Vidas
 * Escala Expandida: de Centímetros a Centenas de Metros!
 */
(() => {
  const { socket, DOM } = GameHub;

  // Banco Expandido de Referências para o Comparador de Escala
  const ALL_REFERENCES = [
    // Centímetros (cm)
    { name: 'Moeda R$ 1', value: 2.7, unit: 'cm', emoji: '🪙', label: '2.7 cm' },
    { name: 'Palito Fósforo', value: 4.2, unit: 'cm', emoji: '🔥', label: '4.2 cm' },
    { name: 'Cartão Crédito', value: 8.56, unit: 'cm', emoji: '💳', label: '8.6 cm' },
    { name: 'Caneta BIC', value: 14.9, unit: 'cm', emoji: '🖊️', label: '14.9 cm' },
    { name: 'Mão Aberta', value: 18.0, unit: 'cm', emoji: '✋', label: '18 cm' },
    { name: 'Folha A4', value: 29.7, unit: 'cm', emoji: '📄', label: '29.7 cm' },
    { name: 'Pizza Grande', value: 35.0, unit: 'cm', emoji: '🍕', label: '35 cm' },
    { name: 'Skate Street', value: 80.0, unit: 'cm', emoji: '🛹', label: '80 cm' },
    { name: 'Violão Acústico', value: 100.0, unit: 'cm', emoji: '🎸', label: '100 cm' },

    // Metros (m)
    { name: 'Humano Médio', value: 1.75, unit: 'm', emoji: '🧍', label: '1.75 m' },
    { name: 'Porta Padrão', value: 2.10, unit: 'm', emoji: '🚪', label: '2.1 m' },
    { name: 'Elefante Africano', value: 3.50, unit: 'm', emoji: '🐘', label: '3.5 m' },
    { name: 'Fusca', value: 4.07, unit: 'm', emoji: '🚗', label: '4.1 m' },
    { name: 'Girafa Adulta', value: 5.50, unit: 'm', emoji: '🦒', label: '5.5 m' },
    { name: 'Ônibus Urbano', value: 12.5, unit: 'm', emoji: '🚌', label: '12.5 m' },
    { name: 'Baleia Azul', value: 30.0, unit: 'm', emoji: '🐋', label: '30 m' },
    { name: 'Cristo Redentor', value: 38.0, unit: 'm', emoji: '✝️', label: '38 m' },
    { name: 'Coliseu de Roma', value: 48.0, unit: 'm', emoji: '🏛️', label: '48 m' },
    { name: 'Boeing 747', value: 70.6, unit: 'm', emoji: '✈️', label: '70.6 m' },
    { name: 'Estátua Liberdade', value: 93.0, unit: 'm', emoji: '🗽', label: '93 m' },
    { name: 'Campo de Futebol', value: 105.0, unit: 'm', emoji: '⚽', label: '105 m' },
    { name: 'Pirâmide de Gizé', value: 138.8, unit: 'm', emoji: '🔺', label: '139 m' },
    { name: 'Navio Titanic', value: 269.0, unit: 'm', emoji: '🚢', label: '269 m' },
    { name: 'Torre Eiffel', value: 330.0, unit: 'm', emoji: '🗼', label: '330 m' },
    { name: 'Empire State', value: 381.0, unit: 'm', emoji: '🏙️', label: '381 m' },
    { name: 'Burj Khalifa', value: 828.0, unit: 'm', emoji: '✨', label: '828 m' }
  ];

  let currentGameState = null;
  let timerInterval = null;
  let activeReference = null;
  let currentGuess = 0;
  let hasSubmitted = false;

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function renderHearts(count) {
    let html = '';
    for (let i = 0; i < 3; i++) {
      if (i < count) {
        html += `<span class="estime-heart-alive">❤️</span>`;
      } else {
        html += `<span class="estime-heart-dead">💔</span>`;
      }
    }
    return html;
  }

  function getStepConfig(maxScale, unit) {
    if (unit === 'cm') {
      if (maxScale <= 15) {
        return { step: 0.1, major: 1, minor: 0.2, decimals: 1, quickSteps: [-2, -0.5, -0.1, 0.1, 0.5, 2] };
      }
      if (maxScale <= 35) {
        return { step: 0.5, major: 5, minor: 1, decimals: 1, quickSteps: [-5, -1, -0.5, 0.5, 1, 5] };
      }
      if (maxScale <= 100) {
        return { step: 1, major: 10, minor: 2, decimals: 0, quickSteps: [-10, -5, -1, 1, 5, 10] };
      }
      return { step: 2, major: 20, minor: 5, decimals: 0, quickSteps: [-20, -5, -2, 2, 5, 20] };
    }

    // unit === 'm'
    if (maxScale <= 6) {
      return { step: 0.05, major: 1, minor: 0.2, decimals: 2, quickSteps: [-1, -0.5, -0.1, 0.1, 0.5, 1] };
    }
    if (maxScale <= 25) {
      return { step: 0.1, major: 5, minor: 1, decimals: 1, quickSteps: [-5, -2, -0.5, 0.5, 2, 5] };
    }
    if (maxScale <= 60) {
      return { step: 0.5, major: 10, minor: 2, decimals: 1, quickSteps: [-10, -5, -1, 1, 5, 10] };
    }
    if (maxScale <= 150) {
      return { step: 1, major: 25, minor: 5, decimals: 0, quickSteps: [-25, -10, -2, 2, 10, 25] };
    }
    if (maxScale <= 350) {
      return { step: 2, major: 50, minor: 10, decimals: 0, quickSteps: [-50, -20, -5, 5, 20, 50] };
    }
    if (maxScale <= 600) {
      return { step: 5, major: 100, minor: 20, decimals: 0, quickSteps: [-100, -50, -10, 10, 50, 100] };
    }
    return { step: 10, major: 200, minor: 50, decimals: 0, quickSteps: [-200, -100, -25, 25, 100, 200] };
  }

  function renderRulerSvg(maxScale, unit) {
    const cfg = getStepConfig(maxScale, unit);
    const width = 1000;
    const height = 38;
    const ticks = [];

    // Linha horizontal base
    ticks.push(`<line x1="0" y1="2" x2="${width}" y2="2" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>`);

    const countMajor = Math.floor(maxScale / cfg.major);
    const countMinor = Math.floor(maxScale / cfg.minor);

    // Minor ticks
    for (let i = 0; i <= countMinor; i++) {
      const val = i * cfg.minor;
      if (val > maxScale) break;
      const x = (val / maxScale) * width;
      ticks.push(`<line x1="${x.toFixed(1)}" y1="2" x2="${x.toFixed(1)}" y2="10" stroke="rgba(255,255,255,0.2)" stroke-width="1.2"/>`);
    }

    // Major ticks com numeração
    for (let i = 0; i <= countMajor; i++) {
      const val = i * cfg.major;
      if (val > maxScale) break;
      const x = (val / maxScale) * width;
      ticks.push(`<line x1="${x.toFixed(1)}" y1="2" x2="${x.toFixed(1)}" y2="18" stroke="rgba(255,255,255,0.7)" stroke-width="2"/>`);
      ticks.push(`<text x="${x.toFixed(1)}" y="32" font-size="11" font-weight="700" fill="rgba(255,255,255,0.8)" text-anchor="middle" font-family="Space Grotesk, sans-serif">${val}${unit}</text>`);
    }

    return `<svg class="estime-ruler-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${ticks.join('')}</svg>`;
  }

  // Início de Rodada
  socket.on('game:estime:start', (data) => {
    stopTimer();
    currentGameState = data;
    hasSubmitted = false;
    activeReference = null;

    const mySid = socket.id;
    const myLives = data.lives ? (data.lives[mySid] ?? 3) : 3;
    const isSpectator = myLives <= 0;

    // Ponto médio inicial intuitivo
    currentGuess = Math.round((data.maxScale * 0.35) * 10) / 10;
    const cfg = getStepConfig(data.maxScale, data.unit);

    // Filtra referências compatíveis com unidade e tamanho
    const availableReferences = ALL_REFERENCES.filter(r => r.unit === data.unit && r.value <= data.maxScale * 0.95);

    try { AudioEngine.gameStart(); } catch (e) {}

    // Dashboard de Vidas de todos os jogadores
    const livesList = Object.entries(data.lives || {});

    DOM.gameArea.innerHTML = `
      <div class="estime-wrapper">
        <!-- Dashboard de Vidas (Survival) -->
        <div class="estime-lives-dashboard">
          <div class="estime-my-lives-box">
            <span style="font-size: 0.8rem; font-weight: 800; color: #ff5252; text-transform: uppercase;">
              ${isSpectator ? '💀 Você foi eliminado' : 'Suas Vidas:'}
            </span>
            <div class="estime-hearts-display">
              ${renderHearts(myLives)}
            </div>
          </div>

          <div class="estime-other-lives-row">
            <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">BATALHA:</span>
            ${livesList.map(([sid, l]) => {
              const p = GameHub.state.players?.get?.(sid);
              const pName = sid === mySid ? 'Você' : (p?.name || 'Jogador');
              return `
                <div class="estime-player-chip-sm ${l <= 0 ? 'dead' : ''}">
                  <strong>${GameHub.escapeHtml(pName)}</strong>
                  <span>${l > 0 ? '❤️'.repeat(l) : '💀'}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Top Bar -->
        <div class="estime-top-bar">
          <div class="estime-round-pill">
            <span>⚔️ RODADA ${data.round}</span>
            <small style="color: var(--accent-tertiary); margin-left: 4px;">(${data.aliveCount} vivos)</small>
          </div>
          <div class="estime-category-badge">🏷️ ${GameHub.escapeHtml(data.category)}</div>
        </div>

        <!-- Timer Bar -->
        <div class="estime-timer-track">
          <div class="estime-timer-fill" id="estime-timer-fill"></div>
        </div>

        <!-- Alerta de Espectador -->
        ${isSpectator ? `
          <div class="estime-spectator-alert">
            <span>👁️</span> <strong>Você foi eliminado!</strong> Acompanhe as estimativas dos sobreviventes!
          </div>
        ` : ''}

        <!-- Object Card -->
        <div class="estime-card">
          <div class="estime-object-emoji">${data.emoji}</div>
          <h2 class="estime-object-title">${GameHub.escapeHtml(data.name)}</h2>
          <div class="estime-object-target">
            <span>Qual é o</span>
            <span class="estime-target-highlight">${GameHub.escapeHtml(data.dimension)}</span>
            <span>em <strong>${data.unit === 'm' ? 'metros (m)' : 'centímetros (cm)'}</strong>?</span>
          </div>

          <!-- Value Display -->
          <div class="estime-value-center">
            <span class="estime-big-val" id="estime-val-text">${currentGuess.toFixed(cfg.decimals)}</span>
            <span class="estime-big-unit">${data.unit}</span>
          </div>

          <!-- Ruler & Preview Box -->
          <div class="estime-ruler-box">
            <!-- Visualizer Bar -->
            <div class="estime-preview-bar-wrap" id="estime-bar-wrap">
              <div class="estime-preview-ghost" id="estime-preview-ghost" style="display: none;"></div>
              <div class="estime-preview-bar" id="estime-preview-bar"></div>
            </div>

            <!-- Precision Ruler Ticks -->
            ${renderRulerSvg(data.maxScale, data.unit)}

            <!-- Range Slider -->
            <div class="estime-slider-row">
              <input type="range" class="estime-slider" id="estime-slider" 
                min="${data.minScale}" max="${data.maxScale}" step="${cfg.step}" value="${currentGuess}"
                ${isSpectator ? 'disabled' : ''}>
            </div>
          </div>

          <!-- Quick Step Buttons -->
          ${!isSpectator ? `
            <div class="estime-quick-btns">
              ${cfg.quickSteps.map(s => `
                <button class="estime-step-btn" data-step="${s}">
                  ${s > 0 ? '+' + s : s}
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <!-- Scale Comparator Drawer -->
        ${availableReferences.length > 0 ? `
          <div class="estime-comparator-drawer">
            <div class="estime-comparator-title">
              <span>📏 Comparador de Escala (${data.unit === 'm' ? 'Animais e Monumentos' : 'Objetos do Cotidiano'})</span>
            </div>
            <div class="estime-ref-chips">
              ${availableReferences.map((ref, idx) => `
                <div class="estime-ref-chip" data-idx="${idx}">
                  <span>${ref.emoji}</span>
                  <strong>${ref.name}</strong>
                  <small>(${ref.label})</small>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Submit & Status Area -->
        ${!isSpectator ? `
          <div class="estime-submit-row">
            <button class="estime-submit-btn" id="estime-submit-btn">
              <span>📐</span> Confirmar Palpite
            </button>
            <div id="estime-status-text" style="font-size: 0.85rem; color: var(--text-muted); text-align: center;"></div>
          </div>
        ` : `
          <div id="estime-status-text" style="font-size: 0.85rem; color: var(--text-muted); text-align: center; margin-top: 8px;">
            Aguardando os jogadores vivos enviarem seus chutes...
          </div>
        `}
      </div>
    `;

    const slider = document.getElementById('estime-slider');
    const valText = document.getElementById('estime-val-text');
    const previewBar = document.getElementById('estime-preview-bar');
    const previewGhost = document.getElementById('estime-preview-ghost');
    const submitBtn = document.getElementById('estime-submit-btn');
    const statusText = document.getElementById('estime-status-text');
    const timerFill = document.getElementById('estime-timer-fill');

    function updateVisuals(newVal, playSound = false) {
      currentGuess = Math.max(data.minScale, Math.min(data.maxScale, Math.round(newVal * 100) / 100));
      if (slider) slider.value = currentGuess;
      if (valText) valText.textContent = currentGuess.toFixed(cfg.decimals);
      
      const pct = (currentGuess / data.maxScale) * 100;
      if (previewBar) previewBar.style.width = `${pct}%`;

      if (playSound) {
        try { AudioEngine.click(); } catch (e) {}
      }
    }

    updateVisuals(currentGuess, false);

    if (slider) {
      slider.addEventListener('input', (e) => {
        updateVisuals(parseFloat(e.target.value), false);
      });
    }

    document.querySelectorAll('.estime-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (hasSubmitted || isSpectator) return;
        const step = parseFloat(btn.dataset.step);
        updateVisuals(currentGuess + step, true);
      });
    });

    document.querySelectorAll('.estime-ref-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const idx = parseInt(chip.dataset.idx, 10);
        const ref = availableReferences[idx];
        if (!ref) return;

        try { AudioEngine.hover(); } catch (e) {}

        if (activeReference && activeReference.name === ref.name) {
          activeReference = null;
          chip.classList.remove('active');
          if (previewGhost) previewGhost.style.display = 'none';
        } else {
          document.querySelectorAll('.estime-ref-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          activeReference = ref;

          const ghostPct = (ref.value / data.maxScale) * 100;
          if (previewGhost) {
            previewGhost.style.display = 'flex';
            previewGhost.style.width = `${ghostPct}%`;
            previewGhost.innerHTML = `<span>${ref.emoji} ${ref.name} (${ref.label})</span>`;
          }
        }
      });
    });

    function submitGuess() {
      if (hasSubmitted || isSpectator) return;
      hasSubmitted = true;

      try { AudioEngine.tap(); } catch (e) {}
      socket.emit('game:action', { action: 'guess', value: currentGuess });

      if (slider) slider.disabled = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳</span> Palpite Enviado: ${currentGuess} ${data.unit}`;
      }
      if (statusText) {
        statusText.innerHTML = GameHub.showWaiting('Aguardando os outros jogadores...');
      }
    }

    if (submitBtn) submitBtn.addEventListener('click', submitGuess);

    // Timer de 30 segundos
    let timeLeft = data.timeLimit || 30;
    const totalTime = timeLeft;

    timerInterval = setInterval(() => {
      timeLeft--;
      if (timerFill) {
        const pct = Math.max(0, (timeLeft / totalTime) * 100);
        timerFill.style.width = `${pct}%`;

        if (timeLeft <= 5) {
          timerFill.className = 'estime-timer-fill danger';
        } else if (timeLeft <= 10) {
          timerFill.className = 'estime-timer-fill warning';
        }
      }

      if (timeLeft <= 0) {
        stopTimer();
        if (!hasSubmitted && !isSpectator) submitGuess();
      }
    }, 1000);
  });

  socket.on('game:estime:guessed', (data) => {
    const statusText = document.getElementById('estime-status-text');
    if (statusText && hasSubmitted) {
      statusText.innerHTML = `<span style="color: var(--accent-tertiary); font-weight: 700;">👥 ${data.count}/${data.total} palpites recebidos</span>`;
    }
  });

  // Revelação Dramática da Rodada & Dano / Eliminação
  socket.on('game:estime:reveal', (data) => {
    stopTimer();
    const mySid = socket.id;
    const hasBullseye = data.results.some(r => r.isBullseye);

    if (data.loserDied) {
      try { AudioEngine.hit(); } catch (e) {}
    } else if (data.loserName) {
      try { AudioEngine.hit(); } catch (e) {}
    } else if (hasBullseye) {
      try { AudioEngine.correct(); } catch (e) {}
    } else {
      try { AudioEngine.notification(); } catch (e) {}
    }

    const realPct = Math.min(100, Math.max(0, (data.realValue / data.maxScale) * 100));

    DOM.gameArea.innerHTML = `
      <div class="estime-wrapper">
        <!-- Top Bar -->
        <div class="estime-top-bar">
          <div class="estime-round-pill">
            <span>⚔️ RESULTADO DA RODADA ${data.round}</span>
          </div>
          <div class="estime-category-badge">🔍 REVELAÇÃO</div>
        </div>

        <!-- Banner de Eliminação / Dano de Vida -->
        ${data.loserDied ? `
          <div class="estime-eliminated-banner">
            <span>💀</span> <strong>${GameHub.escapeHtml(data.loserName)}</strong> errou mais e FOI ELIMINADO DA PARTIDA!
          </div>
        ` : (data.loserName ? `
          <div class="estime-damage-banner">
            <span>💔</span> <strong>${GameHub.escapeHtml(data.loserName)}</strong> teve a pior estimativa e PERDEU 1 VIDA!
          </div>
        ` : '')}

        <!-- Hero Card com Tamanho Real -->
        <div class="estime-reveal-hero">
          <div style="font-size: 2.2rem; margin-bottom: 2px;">${data.emoji}</div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; color: var(--text-primary); margin-bottom: 2px;">
            ${GameHub.escapeHtml(data.objectName)}
          </h2>
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 6px;">
            ${data.dimension}
          </p>
          <div class="estime-reveal-num">
            ${data.realValue} <span style="font-size: 1.6rem; color: var(--text-primary);">${data.unit}</span>
          </div>
        </div>

        <!-- Bullseye Alert se houver -->
        ${hasBullseye ? `
          <div class="estime-bullseye-badge">
            <span>🎯</span> NA MOSCA! Erro menor que 3% (+25 BÔNUS DE PRECISÃO!)
          </div>
        ` : ''}

        <!-- Régua Comparativa Horizontal com Laser e Pins -->
        <div class="estime-reveal-ruler-track" id="estime-reveal-track">
          <div class="estime-ruler-center-line"></div>
          ${renderRulerSvg(data.maxScale, data.unit)}

          <!-- Laser Dourado do Valor Real -->
          <div class="estime-gold-laser" style="left: ${realPct}%;">
            <span class="estime-gold-laser-tag">👑 REAL: ${data.realValue} ${data.unit}</span>
          </div>

          <!-- Marcadores / Pinos de cada jogador vivo -->
          ${data.results.map((r, i) => {
            if (r.guess === null) return '';
            const guessPct = Math.min(100, Math.max(0, (r.guess / data.maxScale) * 100));
            const diffSign = r.guess > data.realValue ? `+${r.diff}` : `-${r.diff}`;
            const diffColor = r.isBullseye ? '#4ae3c0' : (r.sid === data.loserSid ? '#ff5252' : '#7c6aff');

            return `
              <div class="estime-player-pin" style="left: ${guessPct}%; animation-delay: ${0.2 + i * 0.15}s;">
                <div class="estime-pin-avatar" style="background: ${r.color || '#7c6aff'};">
                  ${r.name.charAt(0).toUpperCase()}
                </div>
                <div class="estime-pin-label" style="border-color: ${diffColor};">
                  <strong>${GameHub.escapeHtml(r.name)}</strong>: ${r.guess}${data.unit} (${r.diff === 0 ? '🎯 Exato' : diffSign})
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Curiosidade Educativa -->
        ${data.fact ? `
          <div class="estime-fact-box">
            <strong>💡 Você Sabia?</strong>
            ${GameHub.escapeHtml(data.fact)}
          </div>
        ` : ''}

        <!-- Tabela de Classificação da Rodada com Vidas Atualizadas -->
        <div class="estime-card" style="padding: 16px; text-align: left;">
          <h3 style="font-family: var(--font-display); font-size: 1rem; color: var(--text-primary); margin-bottom: 10px; display: flex; justify-content: space-between;">
            <span>📊 Sobrevivência na Rodada</span>
            <span style="font-size: 0.8rem; color: var(--text-muted);">${data.stillAliveCount} jogadores vivos</span>
          </h3>
          <div class="estime-results-list">
            ${data.results.map(r => `
              <div class="estime-res-row ${r.sid === mySid ? 'highlight' : ''} ${r.sid === data.loserSid ? 'border-danger' : ''}">
                <div class="estime-res-left">
                  <span class="estime-res-rank">${r.rank}º</span>
                  <div>
                    <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary);">
                      ${GameHub.escapeHtml(r.name)} ${r.sid === mySid ? '<span style="font-size: 0.7rem; color: var(--accent-tertiary);">(Você)</span>' : ''}
                      ${r.isBullseye ? '🎯' : ''}
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-muted);">
                      ${r.guess !== null ? `Palpite: ${r.guess} ${data.unit} (Erro: ${r.pctErr}%)` : 'Não respondeu'}
                    </div>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 0.95rem;">
                    ${renderHearts(r.lives)}
                  </div>
                  <div style="font-size: 0.72rem; color: var(--text-muted);">
                    +${r.points} pts
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Botão Próxima Rodada / Ver Vencedor -->
        <div style="margin-top: 6px;">
          <button class="btn ${data.isGameOver ? 'btn-confirm' : 'btn-primary'} btn-lg" id="estime-next-btn" style="width: 100%;">
            ${data.isGameOver ? '👑 Ver Grande Vencedor da Batalha!' : `⚔️ Próxima Rodada (${data.stillAliveCount} Vivos) ➡️`}
          </button>
        </div>
      </div>
    `;

    const nextBtn = document.getElementById('estime-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        try { AudioEngine.click(); } catch (e) {}
        nextBtn.disabled = true;
        nextBtn.innerHTML = 'Carregando próxima etapa...';
        socket.emit('game:action', { action: 'next-round' });
      });
    }
  });

  // Fim de Jogo: Coroação do Último Sobrevivente
  socket.on('game:estime:gameover', (data) => {
    stopTimer();
    try { AudioEngine.gameEnd(); } catch (e) {}

    const rankings = data.rankings || [];
    const winner = rankings[0] || { name: 'Campeão', score: 0, lives: 3 };

    DOM.gameArea.innerHTML = `
      <div class="estime-wrapper">
        <div class="estime-reveal-header">
          <div style="font-size: 3.5rem; margin-bottom: 4px; animation: heartBeat 1.5s infinite;">👑</div>
          <h1 style="font-family: var(--font-display); font-size: 1.8rem; color: #ffd700;">
            ${GameHub.escapeHtml(winner.name)} Venceu a Batalha!
          </h1>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">
            O último sobrevivente após <strong>${data.totalRounds || 1} rodadas</strong> de estimativas extremas!
          </p>
        </div>

        <!-- Pódio dos Sobreviventes -->
        <div class="estime-podium-wrap">
          ${rankings[1] ? `
            <div class="estime-podium-col silver">
              <div style="font-size: 1.4rem; margin-bottom: 4px;">🥈</div>
              <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); text-align: center; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${GameHub.escapeHtml(rankings[1].name)}
              </div>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 6px;">
                ${rankings[1].score} pts
              </div>
              <div class="estime-podium-step">2</div>
            </div>
          ` : ''}

          <div class="estime-podium-col gold">
            <div style="font-size: 1.8rem; margin-bottom: 4px;">👑</div>
            <div style="font-size: 0.9rem; font-weight: 800; color: #ffd700; text-align: center; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${GameHub.escapeHtml(winner.name)}
            </div>
            <div style="font-size: 0.76rem; color: #ffd700; margin-bottom: 6px; font-weight: 700;">
              ${winner.score} pts
            </div>
            <div class="estime-podium-step">1</div>
          </div>

          ${rankings[2] ? `
            <div class="estime-podium-col bronze">
              <div style="font-size: 1.4rem; margin-bottom: 4px;">🥉</div>
              <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); text-align: center; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${GameHub.escapeHtml(rankings[2].name)}
              </div>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 6px;">
                ${rankings[2].score} pts
              </div>
              <div class="estime-podium-step">3</div>
            </div>
          ` : ''}
        </div>

        <!-- Classificação Geral Final -->
        <div class="estime-card" style="padding: 16px; text-align: left;">
          <h3 style="font-family: var(--font-display); font-size: 1rem; color: var(--text-primary); margin-bottom: 10px;">
            🏅 Classificação da Batalha
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
                    <div style="font-size: 0.75rem; color: var(--text-muted);">
                      ${r.alive ? 'Sobreviveu à Batalha' : 'Eliminado em combate'}
                    </div>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 0.9rem;">
                    ${renderHearts(r.lives)}
                  </div>
                  <div style="font-size: 0.75rem; color: var(--accent-tertiary); font-weight: 700;">
                    ${r.score} pts
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Botão Voltar ao Lobby -->
        <div style="margin-top: 8px;">
          <button class="btn btn-secondary btn-lg" id="estime-back-lobby-btn" style="width: 100%;">
            🏠 Voltar ao Lobby
          </button>
        </div>
      </div>
    `;

    const backBtn = document.getElementById('estime-back-lobby-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        try { AudioEngine.click(); } catch (e) {}
        socket.emit('game:back-to-lobby');
      });
    }
  });
})();
