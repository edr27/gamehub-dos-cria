/**
 * Imagem de IA Falsa — Cliente
 * Descubra qual foto é real entre 4 opções
 */
(() => {
  const { socket, DOM } = GameHub;

  // Cores/gradientes para representar as imagens (sem imagens reais)
  const imageStyles = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)'
  ];

  socket.on('game:ia:start', (data) => {
    DOM.gameArea.innerHTML = `
      <div class="game-content">
        <div class="game-emoji-large">🖼️</div>
        <h2 style="font-family: var(--font-display)">Tema: ${GameHub.escapeHtml(data.theme)}</h2>
        <p class="game-instruction">Qual dessas imagens é <strong>REAL</strong>? As outras 3 foram geradas por IA!</p>
        <div class="vote-options" id="ia-options">
          ${data.images.map((img, i) => `
            <div class="vote-option" data-id="${img.id}" style="padding: var(--gap-lg);">
              <div style="width: 100%; aspect-ratio: 1; background: ${imageStyles[i]}; border-radius: var(--radius-md); margin-bottom: var(--gap-sm); display: flex; align-items: center; justify-content: center; font-size: 2rem;">
                ${['🌄', '🐾', '🍕', '🏙️'][i]}
              </div>
              <span style="font-size: 0.85rem;">${GameHub.escapeHtml(img.desc)}</span>
            </div>
          `).join('')}
        </div>
        <p id="ia-status" style="font-size: 0.85rem; color: var(--text-muted);">Escolha com cuidado!</p>
      </div>
    `;

    const options = document.querySelectorAll('#ia-options .vote-option');
    options.forEach(opt => {
      opt.addEventListener('click', () => {
        options.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        AudioEngine.tap();
        socket.emit('game:action', { action: 'vote', choice: parseInt(opt.dataset.id) });
        options.forEach(o => o.style.pointerEvents = 'none');
        const status = document.getElementById('ia-status');
        if (status) status.innerHTML = GameHub.showWaiting('Aguardando votos...');
      });
    });
  });

  socket.on('game:ia:voted', (data) => {
    const status = document.getElementById('ia-status');
    if (status) {
      status.innerHTML = `<span style="color: var(--accent-primary)">${data.count}/${data.total}</span> votaram`;
    }
  });

  socket.on('game:ia:results', (data) => {
    AudioEngine.gameEnd();

    // Marcar as opções
    const options = document.querySelectorAll('#ia-options .vote-option');
    options.forEach(opt => {
      const id = parseInt(opt.dataset.id);
      if (id === data.realIndex) {
        opt.classList.add('correct');
        opt.innerHTML += '<div style="margin-top: var(--gap-sm); color: var(--accent-success); font-weight: 700;">✅ REAL!</div>';
      } else {
        opt.classList.add('wrong');
        opt.innerHTML += '<div style="margin-top: var(--gap-sm); color: var(--accent-error); font-size: 0.8rem;">🤖 IA</div>';
      }
    });

    setTimeout(() => {
      GameHub.renderResults(data.results.map((r, i) => ({
        name: r.name,
        rank: i + 1,
        detail: r.correct ? '✅ Acertou!' : '❌ Errou',
        points: r.points
      })), `
        <div style="margin-top: var(--gap-md); padding: var(--gap-md); background: var(--bg-glass); border-radius: var(--radius-md); text-align: center;">
          <p style="color: var(--text-muted); font-size: 0.85rem;">
            A imagem real era: <strong style="color: var(--accent-primary);">${GameHub.escapeHtml(data.images[data.realIndex].desc)}</strong>
          </p>
        </div>
      `);
    }, 2000);
  });
})();
