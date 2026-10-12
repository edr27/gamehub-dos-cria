/**
 * Temperatura do Grupo — Cliente
 * Estime a temperatura do lugar na foto/descrição
 */
(() => {
  const { socket, DOM } = GameHub;

  socket.on('game:temperatura:start', (data) => {
    DOM.gameArea.innerHTML = `
      <div class="game-content">
        <div class="game-emoji-large">${data.emoji}</div>
        <h2 style="font-family: var(--font-display); font-size: 1.3rem;">${GameHub.escapeHtml(data.name)}</h2>
        <p class="game-instruction" style="color: var(--text-muted); font-size: 0.9rem;">${GameHub.escapeHtml(data.hint)}</p>
        <p class="game-instruction">Qual é a temperatura desse lugar em <strong>°C</strong>?</p>
        <div class="game-number-input">
          <input type="number" id="temp-input" placeholder="0" step="1" autocomplete="off" style="max-width: 120px;">
          <span class="unit-label">°C</span>
        </div>
        <div id="temp-slider-area" style="width: 100%; max-width: 400px;">
          <input type="range" class="game-slider" id="temp-slider" min="-50" max="500" value="20">
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">
            <span>-50°C</span>
            <span id="temp-slider-label" style="color: var(--accent-primary); font-weight: 600;">20°C</span>
            <span>500°C</span>
          </div>
        </div>
        <button class="btn btn-confirm btn-lg" id="temp-submit">
          <span class="btn-icon">🌡️</span> Confirmar Palpite
        </button>
        <p id="temp-status" style="font-size: 0.85rem; color: var(--text-muted);"></p>
      </div>
    `;

    const input = document.getElementById('temp-input');
    const slider = document.getElementById('temp-slider');
    const sliderLabel = document.getElementById('temp-slider-label');
    const btn = document.getElementById('temp-submit');
    const status = document.getElementById('temp-status');

    // Sync slider and input
    slider.addEventListener('input', () => {
      input.value = slider.value;
      sliderLabel.textContent = `${slider.value}°C`;
    });
    input.addEventListener('input', () => {
      slider.value = input.value || 0;
      sliderLabel.textContent = `${input.value || 0}°C`;
    });

    btn.addEventListener('click', () => {
      const value = parseFloat(input.value);
      if (isNaN(value)) {
        GameHub.showToast('Digite um número!', 'error');
        return;
      }
      AudioEngine.tap();
      socket.emit('game:action', { action: 'guess', value });
      btn.disabled = true;
      input.disabled = true;
      slider.disabled = true;
      status.innerHTML = GameHub.showWaiting();
    });

    input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') btn.click();
    });
  });

  socket.on('game:temperatura:guessed', (data) => {
    const status = document.getElementById('temp-status');
    if (status) {
      status.innerHTML = `<span style="color: var(--accent-primary)">${data.count}/${data.total}</span> responderam`;
    }
  });

  socket.on('game:temperatura:results', (data) => {
    AudioEngine.gameEnd();
    GameHub.renderResults(data.results.map(r => ({
      name: r.name,
      rank: r.rank,
      detail: `${r.guess}°C (±${r.diff.toFixed(1)}°C)`,
      points: r.points
    })), `
      <div style="margin-top: var(--gap-md); padding: var(--gap-md); background: var(--bg-glass); border-radius: var(--radius-md); text-align: center;">
        <p style="font-size: 1.2rem; font-weight: 700; color: var(--accent-primary);">
          ${data.locationName}: ${data.realTemp}°C
        </p>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: var(--gap-sm);">
          Média do grupo: ${data.avgGuess}°C
        </p>
      </div>
    `);
  });
})();
