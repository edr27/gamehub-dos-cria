/**
 * Cronômetro Cego — Cliente
 * Conte 10 segundos mentalmente e aperte quando achar que chegou!
 * Modo especial: Ficar parado enquanto o grupo conversa.
 */
(() => {
  const { socket, DOM } = GameHub;

  socket.on('game:cronometro:start', (data) => {
    const isConversa = data.mode === 'conversa';
    DOM.gameArea.innerHTML = `
      <div class="game-content">
        <div class="game-emoji-large">${isConversa ? '🗣️' : '⏱️'}</div>
        <h2 style="font-family: var(--font-display)">${isConversa ? 'Modo Conversa!' : 'Cronômetro Cego'}</h2>
        ${isConversa ? `
          <div style="background: rgba(255, 167, 38, 0.15); border: 1px solid var(--accent-warning); border-radius: var(--radius-md); padding: var(--gap-sm) var(--gap-md); max-width: 420px; margin-bottom: var(--gap-sm);">
            <p style="color: var(--accent-warning); font-size: 0.9rem; font-weight: 700;">
              🤫 DESAFIO: Ficar parado enquanto o grupo conversa!
            </p>
            <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">
              Falem, contem piadas ou façam barulho para atrapalhar a contagem mental uns dos outros!
            </p>
          </div>
        ` : ''}
        <p class="game-instruction">
          Aperte para iniciar a contagem mental.<br>
          Aperte novamente quando achar que passaram <strong>${data.targetTime / 1000} segundos</strong>.<br>
          <em>Sem olhar relógio ou cronômetro!</em>
        </p>
        <button class="tap-button" id="cronometro-btn">▶️</button>
        <p id="cronometro-status" class="game-instruction" style="font-size: 0.9rem; color: var(--text-muted);">
          Toque para começar
        </p>
      </div>
    `;

    let started = false;
    const btn = document.getElementById('cronometro-btn');
    const status = document.getElementById('cronometro-status');

    btn.addEventListener('click', () => {
      if (!started) {
        started = true;
        btn.textContent = '⏹️';
        btn.classList.add('tapped');
        status.textContent = 'Contando mentalmente... Aperte quando chegar a 10s!';
        status.style.color = 'var(--accent-warning)';
        AudioEngine.countdown(3);
        socket.emit('game:action', { action: 'press-start' });
      } else {
        btn.disabled = true;
        btn.textContent = '✅';
        status.textContent = 'Enviado! Aguardando outros jogadores...';
        status.style.color = 'var(--accent-tertiary)';
        AudioEngine.tap();
        socket.emit('game:action', { action: 'press-stop' });
      }
    });
  });

  socket.on('game:cronometro:started', () => {
    // Started confirmation
  });

  socket.on('game:cronometro:stopped', (data) => {
    const status = document.getElementById('cronometro-status');
    if (status) {
      const sec = (data.elapsed / 1000).toFixed(2);
      status.innerHTML = `Você apertou em <strong>${sec}s</strong> (desvio: ±${(data.diff / 1000).toFixed(2)}s)`;
    }
  });

  socket.on('game:cronometro:results', (data) => {
    const results = data.results || data;
    const isConversa = data.mode === 'conversa';
    AudioEngine.gameEnd();
    GameHub.renderResults(results.map(r => ({
      name: r.name,
      rank: r.rank,
      detail: `${(r.elapsed / 1000).toFixed(2)}s (±${(r.diff / 1000).toFixed(2)}s)`,
      points: r.points
    })), `
      <div style="margin-top: var(--gap-md); padding: var(--gap-md); background: var(--bg-glass); border-radius: var(--radius-md); text-align: center;">
        <p style="color: var(--text-muted); font-size: 0.85rem;">Tempo alvo: <strong>10.00 segundos</strong></p>
        ${isConversa ? '<p style="color: var(--accent-warning); font-size: 0.8rem; margin-top: 4px;">🗣️ Modo Conversa Ativo — a conversa atrapalhou?</p>' : ''}
      </div>
    `);
  });
})();
