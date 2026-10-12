/**
 * História em Cadeia — Cliente Cinematográfico Definitivo
 * - Mecânica central: Uma palavra por vez, preservando rigorosamente a contribuição de cada jogador
 * - Estrutura narrativa em 4 Atos: O Começo, A Complicação, O Caos, O Desfecho
 * - Contagem regressiva épica de abertura
 * - Teleprompter interativo com destaque de palavras e autores
 * - Narração cinematográfica sincronizada em português brasileiro (Web Speech API)
 *   com estilos: Épico/Trailer, Documentário, Conto de Fantasia e Comédia
 * - Sistema de conquistas, estatísticas e histórico de histórias no navegador
 * - Votação de prêmios da sala e botões de copiar/compartilhar
 */
(() => {
  const { socket, DOM } = GameHub;

  // Estado da partida local
  let currentStory = {
    category: null,
    initialSentence: '',
    totalWords: 32,
    turnDuration: 20,
    currentWriter: '',
    currentWriterId: '',
    act: null,
    storyWords: [],
    fullText: '',
    startTime: 0
  };

  let turnTimerInterval = null;
  let turnSecondsLeft = 20;
  let turnTotalSeconds = 20;
  let isMyTurn = false;

  // Narração por Voz
  const synth = window.speechSynthesis || null;
  let isNarrating = false;
  let isNarrationPaused = false;
  let narrationWordSpans = [];
  let narrationCurrentIdx = -1;
  let narrationSpeed = 1.0;
  let narrationStyle = 'epic'; // 'epic' | 'documentary' | 'fantasy' | 'comedy'

  // Perfil Local e Histórico
  function getLocalProfile() {
    try {
      const data = localStorage.getItem('gh_historia_profile');
      if (data) return JSON.parse(data);
    } catch (e) {}
    return { xp: 0, level: 1, storiesCompleted: 0, wordsContributed: 0, achievements: [] };
  }

  function saveLocalProfile(profile) {
    try {
      localStorage.setItem('gh_historia_profile', JSON.stringify(profile));
    } catch (e) {}
  }

  function getLocalHistory() {
    try {
      const data = localStorage.getItem('gh_historia_history');
      if (data) return JSON.parse(data);
    } catch (e) {}
    return [];
  }

  function saveStoryToHistory(entry) {
    try {
      const history = getLocalHistory();
      history.unshift(entry);
      if (history.length > 20) history.pop(); // Guarda até 20 crônicas
      localStorage.setItem('gh_historia_history', JSON.stringify(history));
    } catch (e) {}
  }

  function addLocalXP(amount, achievementId = null, achievementName = null) {
    const profile = getLocalProfile();
    profile.xp += amount;
    profile.level = Math.floor(profile.xp / 150) + 1;
    let unlockedNew = false;

    if (achievementId && !profile.achievements.includes(achievementId)) {
      profile.achievements.push(achievementId);
      unlockedNew = true;
    }

    saveLocalProfile(profile);

    if (unlockedNew && achievementName) {
      GameHub.showToast(`🏆 Conquista Desbloqueada: ${achievementName}! (+50 XP)`, 'success');
      if (AudioEngine && AudioEngine.success) AudioEngine.success();
    }

    return profile;
  }

  // Timer do Turno
  function clearTurnCountdown() {
    if (turnTimerInterval) {
      clearInterval(turnTimerInterval);
      turnTimerInterval = null;
    }
  }

  function startTurnCountdown(seconds, myTurn) {
    clearTurnCountdown();
    turnSecondsLeft = seconds;
    turnTotalSeconds = seconds;

    const fill = document.getElementById('historia-timer-fill');
    const label = document.getElementById('historia-timer-label');

    function updateView() {
      const pct = Math.max(0, Math.min(100, (turnSecondsLeft / turnTotalSeconds) * 100));
      if (fill) {
        fill.style.width = pct + '%';
        if (turnSecondsLeft <= 5) fill.classList.add('urgent');
        else fill.classList.remove('urgent');
      }
      if (label) {
        label.textContent = `${turnSecondsLeft}s`;
        if (turnSecondsLeft <= 5) label.classList.add('urgent');
        else label.classList.remove('urgent');
      }
    }

    updateView();

    turnTimerInterval = setInterval(() => {
      turnSecondsLeft--;
      if (turnSecondsLeft <= 0) {
        clearTurnCountdown();
        updateView();
      } else {
        updateView();
        if (myTurn && turnSecondsLeft <= 5 && AudioEngine && AudioEngine.countdown) {
          AudioEngine.countdown(turnSecondsLeft);
        }
      }
    }, 1000);
  }

  function spawnFloatingReaction(emoji) {
    const el = document.createElement('div');
    el.className = 'historia-floating-emoji';
    el.textContent = emoji;
    const randomX = Math.floor(Math.random() * 60) + 20;
    el.style.left = `${randomX}%`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function stopSpeechNarration() {
    if (synth) synth.cancel();
    isNarrating = false;
    isNarrationPaused = false;
    narrationCurrentIdx = -1;
    document.querySelectorAll('.historia-word-span').forEach(s => s.classList.remove('spoken'));
    const btnPlay = document.getElementById('historia-narrate-play');
    if (btnPlay) btnPlay.innerHTML = '<span class="btn-icon">🎙️</span> Ouvir Narração';
    const btnPause = document.getElementById('historia-narrate-pause');
    if (btnPause) btnPause.style.display = 'none';
    const btnStop = document.getElementById('historia-narrate-stop');
    if (btnStop) btnStop.style.display = 'none';
  }

  // --- REAÇÕES AO VIVO ---
  socket.on('game:historia:reaction', (data) => {
    spawnFloatingReaction(data.emoji);
  });

  socket.on('game:historia:error', (data) => {
    GameHub.showToast(data.message || 'Erro na palavra', 'error');
    if (AudioEngine && AudioEngine.error) AudioEngine.error();
  });

  // --- 1. CONTAGEM REGRESSIVA ÉPICA (3... 2... 1...) ---
  socket.on('game:historia:countdown', (data) => {
    stopSpeechNarration();
    clearTurnCountdown();
    const cat = data.category || { icon: '📖', name: 'História em Cadeia', color: '#8e44ad' };

    DOM.gameArea.innerHTML = `
      <div class="historia-container">
        <div class="historia-countdown-box">
          <span class="historia-badge" style="border-color: ${cat.color}; color: ${cat.color}; font-size: 1rem; padding: 6px 16px;">
            ${cat.icon} ${GameHub.escapeHtml(cat.name)}
          </span>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; color: var(--text-secondary); margin: 0;">
            A história vai começar em...
          </h2>
          <div class="historia-countdown-num">${data.seconds}</div>
          <div style="background: var(--bg-glass-strong); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 14px 20px; max-width: 540px; margin-top: 10px;">
            <p style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Frase de Abertura:</p>
            <p style="font-style: italic; font-size: 1.05rem; color: var(--text-primary); line-height: 1.5; margin: 0;">
              "${GameHub.escapeHtml(data.initialSentence)}"
            </p>
          </div>
        </div>
      </div>
    `;

    if (AudioEngine && AudioEngine.countdown) {
      AudioEngine.countdown(data.seconds);
    }
  });

  // --- 2. INÍCIO DA PARTIDA ---
  socket.on('game:historia:round-start', (data) => {
    currentStory = {
      category: data.category,
      initialSentence: data.initialSentence,
      totalWords: data.totalWords,
      turnDuration: data.turnDuration || 20,
      currentWriter: data.currentWriter,
      currentWriterId: data.currentWriterId,
      act: data.act,
      storyWords: [],
      fullText: data.fullText,
      startTime: Date.now()
    };

    renderActiveGameScreen();
  });

  // --- 3. PALAVRA ADICIONADA ---
  socket.on('game:historia:word-added', (data) => {
    currentStory.storyWords.push({
      word: data.word,
      author: data.author,
      authorId: data.authorId,
      wordIndex: data.wordIndex,
      actNumber: data.act?.actNumber || 1
    });

    currentStory.fullText = data.fullText;
    currentStory.currentWriter = data.nextWriter;
    currentStory.currentWriterId = data.nextWriterId;
    currentStory.act = data.act;
    currentStory.turnDuration = data.turnDuration || 20;

    // Se o elemento da palavra pode ser adicionado diretamente ao teleprompter
    appendWordToTeleprompter(data.word, data.author, data.wordIndex, data.act?.actNumber || 1);

    // Atualiza cabeçalho e caixa do turno
    updateGameHeaderAndTurnBox();

    // Se for minha vez, toca som e dá foco
    if (socket.id === data.nextWriterId) {
      isMyTurn = true;
      if (AudioEngine && AudioEngine.notification) AudioEngine.notification();
      const input = document.getElementById('historia-word-input');
      if (input) {
        input.disabled = false;
        input.value = '';
        input.focus();
      }
    } else {
      isMyTurn = false;
    }

    startTurnCountdown(currentStory.turnDuration, isMyTurn);
  });

  // --- 4. TRANSIÇÃO DE ATO ---
  socket.on('game:historia:act-change', (data) => {
    if (AudioEngine && AudioEngine.powerHit) AudioEngine.powerHit();
    else if (AudioEngine && AudioEngine.success) AudioEngine.success();

    // Exibir banner cinematográfico flutuante
    const banner = document.createElement('div');
    banner.className = 'historia-act-banner';
    banner.innerHTML = `
      <span style="font-size: 1.5rem;">${data.icon}</span>
      <div>
        <div style="font-size: 1.05rem; font-weight: 800;">${GameHub.escapeHtml(data.title)}</div>
        <div style="font-size: 0.78rem; opacity: 0.9; font-weight: 400;">${GameHub.escapeHtml(data.desc)}</div>
      </div>
    `;
    const container = document.querySelector('.historia-container');
    if (container) {
      container.appendChild(banner);
      setTimeout(() => banner.remove(), 3200);
    }
  });

  // --- 5. RENDERIZAÇÃO DA TELA DE JOGO EM ANDAMENTO ---
  function renderActiveGameScreen() {
    isMyTurn = (socket.id === currentStory.currentWriterId);
    const cat = currentStory.category || { icon: '📖', name: 'História em Cadeia', color: '#8e44ad' };
    const act = currentStory.act || { actNumber: 1, title: 'ATO I — O COMEÇO', icon: '🌅', desc: 'Início da narrativa.' };

    DOM.gameArea.innerHTML = `
      <div class="historia-container">
        <!-- Cabeçalho da Partida -->
        <div class="historia-header-card">
          <div class="historia-badges-row">
            <span class="historia-badge" style="border-color: ${cat.color}; color: ${cat.color};">
              ${cat.icon} ${GameHub.escapeHtml(cat.name)}
            </span>
            <span class="historia-badge" id="historia-act-badge" style="color: var(--accent-tertiary);">
              ${act.icon} ${GameHub.escapeHtml(act.title)}
            </span>
            <span class="historia-badge" id="historia-progress-badge">
              Palavra ${currentStory.storyWords.length}/${currentStory.totalWords}
            </span>
          </div>

          <!-- Barra de Atos Narrativos -->
          <div class="historia-acts-track">
            <div class="historia-act-segment ${act.actNumber >= 1 ? 'active' : ''}" title="Ato I"></div>
            <div class="historia-act-segment ${act.actNumber >= 2 ? 'active' : ''}" title="Ato II"></div>
            <div class="historia-act-segment ${act.actNumber >= 3 ? 'active' : ''}" title="Ato III"></div>
            <div class="historia-act-segment ${act.actNumber >= 4 ? 'active' : ''}" title="Ato IV"></div>
          </div>

          <!-- Timer Bar -->
          <div class="historia-timer-wrap">
            <div class="historia-timer-bar">
              <div class="historia-timer-fill" id="historia-timer-fill" style="width: 100%"></div>
            </div>
            <span class="historia-timer-text" id="historia-timer-label">${currentStory.turnDuration}s</span>
          </div>
        </div>

        <!-- Teleprompter / Área da História -->
        <div class="historia-teleprompter" id="historia-teleprompter">
          <span class="historia-starter-sentence">"${GameHub.escapeHtml(currentStory.initialSentence)}"</span>
          <span id="historia-words-stream"></span>
        </div>

        <!-- Caixa de Ação do Turno -->
        <div class="historia-turn-box ${isMyTurn ? 'my-turn' : ''}" id="historia-turn-box">
          <div id="historia-turn-content">
            ${renderTurnBoxContent()}
          </div>
        </div>

        <!-- Painel de Reações da Plateia -->
        <div class="historia-reactions-panel">
          <span style="font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">
            Reações em tempo real (envie para a sala):
          </span>
          <div class="historia-reactions-row">
            ${['🔥', '😱', '👏', '🍿', '✍️', '🤯', '😂', '⭐'].map(emoji => `
              <button class="historia-react-btn" data-emoji="${emoji}">${emoji}</button>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    bindTurnEvents();
    bindReactionEvents();
    startTurnCountdown(currentStory.turnDuration, isMyTurn);

    if (isMyTurn && AudioEngine && AudioEngine.notification) {
      AudioEngine.notification();
    }
  }

  function renderTurnBoxContent() {
    isMyTurn = (socket.id === currentStory.currentWriterId);
    if (isMyTurn) {
      return `
        <div class="historia-single-word-wrap">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--accent-tertiary); font-weight: 700; font-size: 0.95rem;">
              ✨ SUA VEZ! Adicione UMA palavra:
            </span>
            <span style="font-size: 0.75rem; color: var(--text-muted);">
              Apenas 1 palavra (pontuação opcional)
            </span>
          </div>

          <div class="historia-input-row">
            <input
              type="text"
              id="historia-word-input"
              class="historia-single-input"
              placeholder="Digite sua palavra..."
              maxlength="30"
              autocomplete="off"
              autofocus
            />
            <button class="btn btn-primary" id="historia-btn-send" style="padding: 10px 18px;">
              <span class="btn-icon">✍️</span> Enviar
            </button>
            <button class="btn btn-ghost btn-sm" id="historia-btn-pass" title="Passar a vez">
              Passar
            </button>
          </div>

          <!-- Botões de Pontuação Rápida -->
          <div class="historia-puncts-row">
            <span style="font-size: 0.75rem; color: var(--text-muted); margin-right: 4px;">Anexar pontuação:</span>
            ${['.', ',', '!', '?', '...', '-'].map(p => `
              <button type="button" class="historia-punct-btn" data-punct="${p}">${p}</button>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      return `
        <div style="text-align: center; padding: 4px 0;">
          <p style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">
            ✍️ <strong style="color: var(--accent-secondary);">${GameHub.escapeHtml(currentStory.currentWriter)}</strong> está jogando agora...
          </p>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">
            Aguarde sua vez enquanto a história se desenvolve!
          </p>
        </div>
      `;
    }
  }

  function updateGameHeaderAndTurnBox() {
    const actBadge = document.getElementById('historia-act-badge');
    const progBadge = document.getElementById('historia-progress-badge');
    const turnBox = document.getElementById('historia-turn-box');
    const turnContent = document.getElementById('historia-turn-content');

    if (actBadge && currentStory.act) {
      actBadge.innerHTML = `${currentStory.act.icon} ${GameHub.escapeHtml(currentStory.act.title)}`;
    }
    if (progBadge) {
      progBadge.textContent = `Palavra ${currentStory.storyWords.length}/${currentStory.totalWords}`;
    }

    // Atualiza segmentos da barra de atos
    const actNum = currentStory.act?.actNumber || 1;
    document.querySelectorAll('.historia-act-segment').forEach((seg, i) => {
      if (i + 1 === actNum) {
        seg.className = 'historia-act-segment active';
      } else if (i + 1 < actNum) {
        seg.className = 'historia-act-segment done';
      } else {
        seg.className = 'historia-act-segment';
      }
    });

    if (turnBox && turnContent) {
      isMyTurn = (socket.id === currentStory.currentWriterId);
      if (isMyTurn) turnBox.classList.add('my-turn');
      else turnBox.classList.remove('my-turn');

      turnContent.innerHTML = renderTurnBoxContent();
      bindTurnEvents();
    }
  }

  function appendWordToTeleprompter(word, author, index, actNumber) {
    const stream = document.getElementById('historia-words-stream');
    const teleprompter = document.getElementById('historia-teleprompter');
    if (!stream) return;

    // Remove animação de palavra anterior
    document.querySelectorAll('.historia-word-span.newly-added').forEach(el => el.classList.remove('newly-added'));

    const span = document.createElement('span');
    span.className = 'historia-word-span newly-added';
    span.dataset.index = index;
    span.dataset.author = author;
    span.innerHTML = `
      ${GameHub.escapeHtml(word)}
      <span class="historia-word-tooltip">#${index} por <strong>${GameHub.escapeHtml(author)}</strong> (Ato ${actNumber})</span>
    `;

    stream.appendChild(document.createTextNode(' '));
    stream.appendChild(span);

    // Rola para a palavra mais recente
    if (teleprompter) {
      teleprompter.scrollTop = teleprompter.scrollHeight;
    }
  }

  function bindTurnEvents() {
    const input = document.getElementById('historia-word-input');
    const btnSend = document.getElementById('historia-btn-send');
    const btnPass = document.getElementById('historia-btn-pass');

    if (!input || !btnSend) return;

    input.focus();

    // Bloqueia espaços para garantir estritamente UMA palavra
    input.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        GameHub.showToast('Digite apenas UMA palavra por vez!', 'error');
        if (AudioEngine && AudioEngine.wrong) AudioEngine.wrong();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        sendWord();
      }
    });

    // Botões de pontuação rápida
    document.querySelectorAll('.historia-punct-btn').forEach(b => {
      b.addEventListener('click', () => {
        const p = b.dataset.punct;
        input.value = input.value.trimEnd() + p;
        input.focus();
        if (AudioEngine && AudioEngine.tap) AudioEngine.tap();
      });
    });

    function sendWord() {
      const raw = input.value.trim();
      if (!raw) {
        GameHub.showToast('Digite uma palavra!', 'error');
        return;
      }
      if (/\s/.test(raw)) {
        GameHub.showToast('Envie apenas UMA palavra por vez!', 'error');
        return;
      }

      btnSend.disabled = true;
      input.disabled = true;
      clearTurnCountdown();

      if (AudioEngine && AudioEngine.tap) AudioEngine.tap();

      socket.emit('game:action', { action: 'add-word', word: raw });

      // Salva progresso no perfil local
      const profile = getLocalProfile();
      profile.wordsContributed = (profile.wordsContributed || 0) + 1;
      saveLocalProfile(profile);
      addLocalXP(10);
    }

    btnSend.addEventListener('click', sendWord);

    if (btnPass) {
      btnPass.addEventListener('click', () => {
        btnPass.disabled = true;
        clearTurnCountdown();
        socket.emit('game:action', { action: 'pass' });
      });
    }
  }

  function bindReactionEvents() {
    document.querySelectorAll('.historia-react-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        if (AudioEngine && AudioEngine.tap) AudioEngine.tap();
        socket.emit('game:action', { action: 'react', emoji });
        spawnFloatingReaction(emoji);
      });
    });
  }

  // --- 6. A ESTREIA DA HISTÓRIA (THE PREMIÈRE) ---
  socket.on('game:historia:story-complete', (data) => {
    clearTurnCountdown();
    stopSpeechNarration();

    if (AudioEngine && AudioEngine.gameEnd) {
      AudioEngine.gameEnd();
    }

    const cat = data.category || { icon: '📖', name: 'História em Cadeia', color: '#8e44ad' };
    const words = data.words || [];
    const fullText = data.fullText || '';
    const title = data.title || 'A Crônica Coletiva';
    const authors = data.authors || [];

    // Salvar no histórico local
    saveStoryToHistory({
      id: Date.now(),
      title,
      category: cat,
      date: new Date().toLocaleDateString('pt-BR'),
      fullText,
      wordsCount: words.length,
      authors
    });

    // Conquista: Sobrevivente Narrativo
    addLocalXP(100, 'survivor', 'Sobrevivente Narrativo');

    // Conquista: O Último Poeta para quem fez o último turno
    const lastWord = words[words.length - 1];
    if (lastWord && lastWord.authorId === socket.id) {
      addLocalXP(50, 'last_poet', 'O Último Poeta');
    }

    DOM.resultsOverlay.classList.remove('hidden');
    DOM.resultsTitle.textContent = '🎬 A Grande Estreia';

    DOM.resultsContent.innerHTML = `
      <div class="historia-container">
        <!-- Caixa da Première -->
        <div class="historia-premiere-box">
          <div class="historia-premiere-header">
            <span class="historia-badge" style="border-color: ${cat.color}; color: ${cat.color}; margin-bottom: 6px;">
              ${cat.icon} ${GameHub.escapeHtml(cat.name)}
            </span>
            <h1 class="historia-premiere-title">
              "${GameHub.escapeHtml(title)}"
            </h1>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 4px 0 0 0;">
              Uma obra criada coletivamente por: ${authors.map(a => `<strong style="color: var(--accent-tertiary);">${GameHub.escapeHtml(a)}</strong>`).join(', ')}
            </p>
          </div>

          <!-- Controles de Narração por Voz (Web Speech API) -->
          <div class="historia-speech-bar">
            <select class="historia-speech-style-select" id="historia-voice-style">
              <option value="epic">🎬 Trailer Épico</option>
              <option value="documentary">🎙️ Documentário Dramático</option>
              <option value="fantasy">🧙‍♂️ Conto de Fantasia</option>
              <option value="comedy">🤪 Narrador de Comédia</option>
            </select>
            <button class="btn btn-primary btn-sm" id="historia-narrate-play">
              <span class="btn-icon">🎙️</span> Ouvir Narração
            </button>
            <button class="btn btn-secondary btn-sm" id="historia-narrate-pause" style="display: none;">
              <span class="btn-icon">⏸️</span> Pausar
            </button>
            <button class="btn btn-ghost btn-sm" id="historia-narrate-stop" style="display: none;">
              <span class="btn-icon">⏹️</span> Parar
            </button>
            <button class="btn btn-secondary btn-sm" id="historia-btn-copy">
              <span class="btn-icon">📋</span> Copiar Texto
            </button>
            <button class="btn btn-ghost btn-sm" id="historia-btn-share">
              <span class="btn-icon">📤</span> Compartilhar
            </button>
          </div>

          <!-- Teleprompter com a História Completa Interativa -->
          <div class="historia-teleprompter" style="max-height: 280px;" id="historia-premiere-text">
            <span class="historia-starter-sentence">"${GameHub.escapeHtml(data.initialSentence)}"</span>
            ${words.map((w, idx) => `
              <span class="historia-word-span" id="premiere-word-${idx}" data-idx="${idx}">
                ${GameHub.escapeHtml(w.word)}
                <span class="historia-word-tooltip">#${idx + 1} por <strong>${GameHub.escapeHtml(w.author)}</strong> (Ato ${w.actNumber || '?'})</span>
              </span>
            `).join(' ')}
          </div>

          <!-- Estatísticas da Partida -->
          <div class="historia-stats-grid">
            <div class="historia-stat-pill">
              <div class="historia-stat-val">${data.stats?.totalWords || words.length}</div>
              <div class="historia-stat-lbl">Palavras Criadas</div>
            </div>
            <div class="historia-stat-pill">
              <div class="historia-stat-val">${authors.length}</div>
              <div class="historia-stat-lbl">Autores</div>
            </div>
            <div class="historia-stat-pill">
              <div class="historia-stat-val">${Math.round((data.stats?.durationMs || 60000) / 1000)}s</div>
              <div class="historia-stat-lbl">Duração</div>
            </div>
            <div class="historia-stat-pill">
              <div class="historia-stat-val" style="font-size: 1rem; color: var(--accent-warning);">
                ${GameHub.escapeHtml(data.stats?.longestWord || '—')}
              </div>
              <div class="historia-stat-lbl">Maior Palavra</div>
            </div>
          </div>

          <!-- Votação Rápida de Prêmios (The Oscars) -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 14px; margin-top: 14px;">
            <h4 style="font-family: var(--font-display); color: var(--accent-warning); margin-bottom: 8px; font-size: 1rem;">
              🏆 Votação da Sala: Escolha seus momentos favoritos!
            </h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
              <div>
                <label style="font-size: 0.78rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">🌟 Melhor Momento:</label>
                <select class="historia-speech-style-select" id="vote-best" style="width: 100%;">
                  ${words.map((w, i) => `<option value="${i}">#${i + 1} "${GameHub.escapeHtml(w.word)}" (${GameHub.escapeHtml(w.author)})</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">😂 Mais Engraçada:</label>
                <select class="historia-speech-style-select" id="vote-funny" style="width: 100%;">
                  ${words.map((w, i) => `<option value="${i}">#${i + 1} "${GameHub.escapeHtml(w.word)}" (${GameHub.escapeHtml(w.author)})</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">🤯 Maior Reviravolta:</label>
                <select class="historia-speech-style-select" id="vote-twist" style="width: 100%;">
                  ${words.map((w, i) => `<option value="${i}">#${i + 1} "${GameHub.escapeHtml(w.word)}" (${GameHub.escapeHtml(w.author)})</option>`).join('')}
                </select>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" id="historia-btn-vote" style="margin-top: 10px; width: 100%;">
              Confirmar Votos da Sala (+XP)
            </button>
          </div>

          <!-- Ações da Estreia -->
          <div style="display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap;">
            <button class="btn btn-primary btn-lg host-only" id="historia-btn-play-again">
              <span class="btn-icon">🔄</span> Jogar Novamente com o Grupo
            </button>
            <button class="btn btn-ghost btn-sm" id="historia-btn-open-history">
              <span class="btn-icon">📜</span> Ver Histórico Salvo
            </button>
          </div>
        </div>
      </div>
    `;

    // --- BINDINGS DA TELA FINAL ---

    // 1. Narração por Voz
    setupPremiereSpeechEngine(data, words, title, authors);

    // 2. Votação
    const btnVote = document.getElementById('historia-btn-vote');
    if (btnVote) {
      btnVote.addEventListener('click', () => {
        const bestWord = parseInt(document.getElementById('vote-best')?.value || '0', 10);
        const funniestWord = parseInt(document.getElementById('vote-funny')?.value || '0', 10);
        const twistWord = parseInt(document.getElementById('vote-twist')?.value || '0', 10);

        socket.emit('game:action', { action: 'vote', bestWord, funniestWord, twistWord });
        btnVote.disabled = true;
        btnVote.textContent = '✓ Votos Confirmados!';
        GameHub.showToast('Seus votos foram registrados com sucesso!', 'success');
        addLocalXP(30);
      });
    }

    // 3. Copiar História
    const btnCopy = document.getElementById('historia-btn-copy');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        const formatted = `📖 "${title.toUpperCase()}"\n\n${cat.icon} Gênero: ${cat.name}\n✍️ Autores: ${authors.join(', ')}\n\n${fullText}\n\n🎬 Criado cooperativamente no GameHub!`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(formatted).then(() => {
            GameHub.showToast('📖 História copiada para o clipboard! Cole no WhatsApp ou Discord!', 'success');
          }).catch(() => {
            GameHub.showToast('Erro ao copiar.', 'error');
          });
        }
      });
    }

    // 4. Compartilhar
    const btnShare = document.getElementById('historia-btn-share');
    if (btnShare) {
      btnShare.addEventListener('click', () => {
        if (navigator.share) {
          navigator.share({
            title: `História: ${title}`,
            text: `Olha a história maluca que criamos no GameHub:\n\n"${fullText}"`
          }).catch(() => {});
        } else {
          // Fallback para cópia
          btnCopy.click();
        }
      });
    }

    // 5. Jogar Novamente
    const btnPlayAgain = document.getElementById('historia-btn-play-again');
    if (btnPlayAgain) {
      btnPlayAgain.addEventListener('click', () => {
        if (AudioEngine && AudioEngine.click) AudioEngine.click();
        socket.emit('game:action', { action: 'play-again' });
      });
    }

    // 6. Ver Histórico
    const btnOpenHistory = document.getElementById('historia-btn-open-history');
    if (btnOpenHistory) {
      btnOpenHistory.addEventListener('click', () => {
        showHistoryModal();
      });
    }
  });

  // Configuração do Sistema de Narração com Web Speech API
  function setupPremiereSpeechEngine(data, words, title, authors) {
    const btnPlay = document.getElementById('historia-narrate-play');
    const btnPause = document.getElementById('historia-narrate-pause');
    const btnStop = document.getElementById('historia-narrate-stop');
    const selectStyle = document.getElementById('historia-voice-style');

    if (!synth) {
      if (btnPlay) btnPlay.style.display = 'none';
      return;
    }

    if (selectStyle) {
      selectStyle.addEventListener('change', () => {
        narrationStyle = selectStyle.value;
      });
    }

    // Monta roteiro narrativo cinematográfico
    function getSpeechSettings(style) {
      switch (style) {
        case 'epic':
          return { pitch: 0.82, rate: 0.90 };
        case 'documentary':
          return { pitch: 1.0, rate: 0.95 };
        case 'fantasy':
          return { pitch: 1.08, rate: 0.88 };
        case 'comedy':
          return { pitch: 1.25, rate: 1.15 };
        default:
          return { pitch: 1.0, rate: 1.0 };
      }
    }

    btnPlay.addEventListener('click', () => {
      if (isNarrationPaused) {
        synth.resume();
        isNarrationPaused = false;
        btnPlay.innerHTML = '<span class="btn-icon">🎙️</span> Narrando...';
        btnPause.innerHTML = '<span class="btn-icon">⏸️</span> Pausar';
        return;
      }

      if (isNarrating) return;

      isNarrating = true;
      isNarrationPaused = false;
      btnPlay.innerHTML = '<span class="btn-icon">🎙️</span> Narrando...';
      btnPause.style.display = 'inline-flex';
      btnStop.style.display = 'inline-flex';

      const settings = getSpeechSettings(narrationStyle);

      // Frases a narrar sequencialmente
      const introText = `Apresentamos a estreia de: ${title}.`;
      const prologueText = `Início: ${data.initialSentence}`;
      const storyText = words.map(w => w.word).join(' ');
      const outroText = `E assim termina esta história criada por ${authors.join(', ')}. Fim!`;

      const playlist = [
        { text: introText, wordIdx: -1 },
        { text: prologueText, wordIdx: -1 },
        { text: storyText, wordIdx: 0, isBody: true },
        { text: outroText, wordIdx: -1 }
      ];

      let playIdx = 0;

      function speakNextTrack() {
        if (!isNarrating || playIdx >= playlist.length) {
          stopSpeechNarration();
          GameHub.showToast('🎬 Narração concluída com sucesso!', 'info');
          return;
        }

        const track = playlist[playIdx];
        playIdx++;

        const utterance = new SpeechSynthesisUtterance(track.text);
        utterance.lang = 'pt-BR';
        utterance.pitch = settings.pitch;
        utterance.rate = settings.rate;

        // Tentar obter voz nativa em português se o navegador fornecer
        const voices = synth.getVoices();
        const ptVoice = voices.find(v => v.lang.startsWith('pt') || v.lang.startsWith('pt-BR'));
        if (ptVoice) utterance.voice = ptVoice;

        if (track.isBody) {
          // Destacar palavras progressivamente
          let currentSpokenWord = 0;
          utterance.onboundary = (event) => {
            if (event.name === 'word') {
              document.querySelectorAll('.historia-word-span').forEach(s => s.classList.remove('spoken'));
              const span = document.getElementById(`premiere-word-${currentSpokenWord}`);
              if (span) {
                span.classList.add('spoken');
                span.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
              currentSpokenWord++;
            }
          };
        }

        utterance.onend = () => {
          if (isNarrating && !isNarrationPaused) {
            setTimeout(speakNextTrack, 500);
          }
        };

        utterance.onerror = () => {
          if (isNarrating) setTimeout(speakNextTrack, 300);
        };

        synth.speak(utterance);
      }

      speakNextTrack();
    });

    btnPause.addEventListener('click', () => {
      if (synth.speaking && !isNarrationPaused) {
        synth.pause();
        isNarrationPaused = true;
        btnPlay.innerHTML = '<span class="btn-icon">▶️</span> Retomar';
        btnPause.innerHTML = '<span class="btn-icon">▶️</span> Retomar';
      } else if (isNarrationPaused) {
        synth.resume();
        isNarrationPaused = false;
        btnPlay.innerHTML = '<span class="btn-icon">🎙️</span> Narrando...';
        btnPause.innerHTML = '<span class="btn-icon">⏸️</span> Pausar';
      }
    });

    btnStop.addEventListener('click', () => {
      stopSpeechNarration();
    });
  }

  // --- MODAL DE HISTÓRICO SALVO ---
  function showHistoryModal() {
    const history = getLocalHistory();
    const existing = document.getElementById('historia-history-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'historia-history-modal';
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 10000;
      display: flex; align-items: center; justify-content: center; padding: 20px;
    `;

    modal.innerHTML = `
      <div style="background: var(--bg-secondary); border: 1px solid var(--border-accent); border-radius: var(--radius-xl); max-width: 600px; width: 100%; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--shadow-lg);">
        <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; font-family: var(--font-display); color: var(--accent-tertiary);">📜 Minhas Histórias Salvas</h3>
          <button class="btn btn-ghost btn-sm" id="btn-close-hist-modal">✕</button>
        </div>
        <div style="padding: 16px 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px;">
          ${history.length === 0 ? `
            <p style="color: var(--text-muted); text-align: center; margin: 40px 0;">Nenhuma história salva ainda. Jogue uma partida!</p>
          ` : history.map(h => `
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong style="color: var(--text-primary); font-size: 1.05rem;">"${GameHub.escapeHtml(h.title)}"</strong>
                <span style="font-size: 0.75rem; color: var(--text-muted);">${h.date}</span>
              </div>
              <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4; margin: 0 0 8px 0; font-style: italic;">
                "${GameHub.escapeHtml(h.fullText.substring(0, 160))}${h.fullText.length > 160 ? '...' : ''}"
              </p>
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-muted);">
                <span>${h.wordsCount} palavras • ${h.authors?.join(', ') || 'Autores'}</span>
                <button class="btn btn-secondary btn-sm copy-hist-btn" data-text="${GameHub.escapeHtml(h.fullText)}">Copiar</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('btn-close-hist-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    modal.querySelectorAll('.copy-hist-btn').forEach(b => {
      b.addEventListener('click', () => {
        const text = b.dataset.text;
        navigator.clipboard.writeText(text).then(() => {
          GameHub.showToast('História copiada!', 'success');
        });
      });
    });
  }

  // Limpeza ao sair para o lobby
  socket.on('game:ended', () => {
    clearTurnCountdown();
    stopSpeechNarration();
  });
})();
