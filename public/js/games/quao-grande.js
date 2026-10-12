/**
 * Quão Grande É? — Cliente
 * Modo Duelo 1v1 / Grupo: Estique o objeto, exploda o oponente, 4 vidas, skins e ranking!
 * Frase de destaque: "Quão grande é realmente? Adivinha o tamanho, ganhe o duelo!"
 */
(() => {
  const { socket, DOM } = GameHub;

  let currentSkin = 'wood';

  const SKINS = {
    wood: { name: 'Madeira Rústica', icon: '🪵', bg: 'linear-gradient(90deg, #8B4513, #D2691E, #8B4513)', border: '#A0522D' },
    steel: { name: 'Aço Polido', icon: '⚔️', bg: 'linear-gradient(90deg, #708090, #E0E6ED, #708090)', border: '#B0C4DE' },
    gold: { name: 'Ouro Puro', icon: '👑', bg: 'linear-gradient(90deg, #B8860B, #FFD700, #DAA520)', border: '#FFE4B5' },
    neon: { name: 'Neon Cyber', icon: '⚡', bg: 'linear-gradient(90deg, #7c6aff, #4ae3c0, #ff6ab0)', border: '#4ae3c0' }
  };

  socket.on('game:grande:start', (data) => {
    // Render lives
    const myId = socket.id;
    const myLives = data.lives ? (data.lives[myId] ?? 4) : 4;
    const hearts = '❤️'.repeat(myLives) + '🖤'.repeat(Math.max(0, 4 - myLives));

    DOM.gameArea.innerHTML = `
      <div class="game-content" style="gap: var(--gap-sm); max-width: 500px;">
        <div style="background: rgba(255, 167, 38, 0.15); border: 1px solid var(--accent-warning); border-radius: var(--radius-full); padding: 4px 16px; font-size: 0.8rem; font-weight: 700; color: var(--accent-warning);">
          ⚔️ “Quão grande é realmente? Adivinha o tamanho, ganhe o duelo!”
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-top: 4px;">
          <div style="font-size: 0.85rem; color: var(--accent-primary); font-weight: 600;">${data.category}</div>
          <div style="font-size: 1rem;" id="qg-lives" title="4 Vidas no Duelo">${hearts}</div>
        </div>

        <div class="game-emoji-large" style="font-size: 3.5rem;">${data.emoji}</div>
        <h2 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0;">${GameHub.escapeHtml(data.name)}</h2>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">Unidade: <strong>${data.unit}</strong></p>

        <!-- Barra que estica dinamicamente com a skin selecionada -->
        <div style="width: 100%; height: 50px; background: rgba(0,0,0,0.3); border-radius: var(--radius-md); padding: 6px; box-sizing: border-box; display: flex; align-items: center; border: 1px solid rgba(255,255,255,0.1); margin: var(--gap-xs) 0;">
          <div id="qg-stretchy-bar" style="width: 20%; height: 100%; background: ${SKINS[currentSkin].bg}; border: 1px solid ${SKINS[currentSkin].border}; border-radius: var(--radius-sm); transition: width 0.05s linear; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; font-size: 0.75rem; font-weight: 800; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">
            📏
          </div>
        </div>

        <!-- Seletor de skin -->
        <div style="display: flex; gap: 6px; justify-content: center; margin-bottom: 4px;">
          ${Object.entries(SKINS).map(([key, s]) => `
            <button class="btn btn-ghost btn-sm qg-skin-btn ${currentSkin === key ? 'active' : ''}" data-skin="${key}" style="padding: 4px 10px; font-size: 0.75rem; border: 1px solid ${currentSkin === key ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)'};">
              ${s.icon} ${s.name.split(' ')[0]}
            </button>
          `).join('')}
        </div>

        <!-- Input e Slider -->
        <div class="game-number-input" style="margin: 0;">
          <input type="number" id="grande-input" placeholder="0" step="1" min="0" autocomplete="off" style="max-width: 160px; font-size: 1.3rem;">
          <span class="unit-label">${data.unit.split(' ')[0]}</span>
        </div>

        <div style="width: 100%;">
          <input type="range" class="game-slider" id="grande-slider" min="1" max="10000" value="300">
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
            <span>1</span>
            <span id="grande-slider-val" style="color: var(--accent-primary); font-weight: 700;">300</span>
            <span>10.000</span>
          </div>
        </div>

        <button class="btn btn-confirm btn-lg" id="grande-submit" style="width: 100%; margin-top: 4px;">
          <span class="btn-icon">💥</span> Esticar & Atacar!
        </button>
        <p id="grande-status" style="font-size: 0.8rem; color: var(--text-muted); margin: 0;"></p>
      </div>
    `;

    const input = document.getElementById('grande-input');
    const slider = document.getElementById('grande-slider');
    const sliderVal = document.getElementById('grande-slider-val');
    const stretchyBar = document.getElementById('qg-stretchy-bar');
    const btn = document.getElementById('grande-submit');
    const status = document.getElementById('grande-status');

    function updateStretch(val) {
      // Stretch percentage across 0 to 10000
      const pct = Math.min(100, Math.max(5, (Math.log10(val || 1) / 4) * 100));
      if (stretchyBar) {
        stretchyBar.style.width = `${pct}%`;
      }
    }

    // Skin buttons
    document.querySelectorAll('.qg-skin-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.qg-skin-btn').forEach(btn => {
          btn.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        currentSkin = b.dataset.skin;
        b.style.borderColor = 'var(--accent-primary)';
        if (stretchyBar) {
          stretchyBar.style.background = SKINS[currentSkin].bg;
          stretchyBar.style.borderColor = SKINS[currentSkin].border;
        }
        AudioEngine.click();
      });
    });

    slider.addEventListener('input', () => {
      input.value = slider.value;
      sliderVal.textContent = parseInt(slider.value).toLocaleString('pt-BR');
      updateStretch(parseFloat(slider.value));
    });

    input.addEventListener('input', () => {
      if (input.value) {
        slider.value = Math.min(10000, Math.max(1, parseInt(input.value)));
        sliderVal.textContent = parseInt(input.value).toLocaleString('pt-BR');
        updateStretch(parseFloat(input.value));
      }
    });

    btn.addEventListener('click', () => {
      const value = parseFloat(input.value);
      if (isNaN(value) || value <= 0) {
        GameHub.showToast('Digite um valor maior que 0!', 'error');
        return;
      }
      AudioEngine.hit();
      socket.emit('game:action', { action: 'guess', value, skin: currentSkin });
      btn.disabled = true;
      input.disabled = true;
      slider.disabled = true;
      status.innerHTML = GameHub.showWaiting('Aguardando os outros duelistas...');
    });

    input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') btn.click();
    });
  });

  socket.on('game:grande:guessed', (data) => {
    const status = document.getElementById('grande-status');
    if (status) {
      status.innerHTML = `<span style="color: var(--accent-primary)">${data.count}/${data.total}</span> duelistas esticaram`;
    }
  });

  socket.on('game:grande:results', (data) => {
    AudioEngine.gameEnd();

    let duelHtml = '';
    if (data.explodedName) {
      duelHtml = `
        <div style="background: rgba(255, 82, 82, 0.15); border: 2px dashed var(--accent-error); border-radius: var(--radius-md); padding: var(--gap-md); margin: var(--gap-md) 0; animation: shake 0.5s ease;">
          <p style="font-size: 1.8rem; margin: 0;">💥💣</p>
          <p style="font-weight: 800; color: var(--accent-error); font-size: 1.1rem;">
            ${GameHub.escapeHtml(data.explodedName)} foi explodido no duelo!
          </p>
          <p style="font-size: 0.85rem; color: var(--text-muted);">-1 Vida</p>
        </div>
      `;
    }

    GameHub.renderResults(data.results.map(r => ({
      name: r.name,
      rank: r.rank,
      detail: `${r.guess.toLocaleString('pt-BR')} (${r.pctOff}% off) • ${'❤️'.repeat(r.lives || 4)}`,
      points: r.points
    })), `
      ${duelHtml}
      <div style="margin-top: var(--gap-md); padding: var(--gap-md); background: var(--bg-glass); border-radius: var(--radius-md); text-align: center;">
        <p style="font-size: 2.2rem; margin: 0;">${data.emoji}</p>
        <p style="font-size: 1.1rem; font-weight: 700; color: var(--accent-primary);">
          ${GameHub.escapeHtml(data.objectName)}
        </p>
        <p style="font-size: 1.5rem; font-family: var(--font-display); font-weight: 800; color: var(--accent-tertiary); margin-top: 4px;">
          Tamanho real: ${data.realSize.toLocaleString('pt-BR')} ${data.unit}
        </p>
      </div>
    `);
  });
})();
