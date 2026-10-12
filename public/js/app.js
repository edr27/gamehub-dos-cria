/**
 * GameHub — Cliente Principal
 * Gerencia navegação, salas, chat e delegação para jogos
 */

// ==================== SOCKET & STATE ====================

const socket = io({ transports: ['websocket', 'polling'] });

const state = {
  playerName: '',
  roomCode: '',
  isHost: false,
  currentGame: null,
  gameList: [],
  chatOpen: false,
  unreadChat: 0
};

// ==================== DOM REFS ====================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  // Screens
  screenHome: $('#screen-home'),
  screenRoom: $('#screen-room'),
  screenGame: $('#screen-game'),

  // Home
  playerNameInput: $('#player-name'),
  btnCreateRoom: $('#btn-create-room'),
  roomCodeInput: $('#room-code-input'),
  btnJoinRoom: $('#btn-join-room'),

  // Room
  btnLeaveRoom: $('#btn-leave-room'),
  displayRoomCode: $('#display-room-code'),
  btnCopyCode: $('#btn-copy-code'),
  headerAvatarsRow: $('#header-avatars-row'),
  playerCount: $('#player-count'),
  playersList: $('#players-list'),
  gamesGrid: $('#games-grid'),
  btnResetScores: $('#btn-reset-scores'),

  // Chat
  chatToggle: $('#chat-toggle'),
  chatContainer: $('#chat-container'),
  btnCloseChat: $('#btn-close-chat'),
  chatMessages: $('#chat-messages'),
  chatInput: $('#chat-input'),
  btnSendChat: $('#btn-send-chat'),
  chatBadge: $('#chat-badge'),

  // Game
  btnBackLobby: $('#btn-back-lobby'),
  gameIcon: $('#game-icon'),
  gameTitle: $('#game-title'),
  gameRoomCode: $('#game-room-code-display'),
  gameArea: $('#game-area'),

  // Results
  resultsOverlay: $('#results-overlay'),
  resultsTitle: $('#results-title'),
  resultsContent: $('#results-content'),
  btnResultsClose: $('#btn-results-close'),

  // Toast
  toastContainer: $('#toast-container')
};

// ==================== NAVIGATION ====================

function showScreen(screenId) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(`#screen-${screenId}`).classList.add('active');
}

// ==================== TOAST ====================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ==================== HOME SCREEN ====================

// Carregar nome salvo
const savedName = localStorage.getItem('gh_playerName');
if (savedName) DOM.playerNameInput.value = savedName;

DOM.btnCreateRoom.addEventListener('click', () => {
  const name = DOM.playerNameInput.value.trim();
  if (!name) {
    showToast('Digite seu nome!', 'error');
    DOM.playerNameInput.focus();
    return;
  }
  AudioEngine.click();
  state.playerName = name;
  localStorage.setItem('gh_playerName', name);

  DOM.btnCreateRoom.disabled = true;
  socket.emit('room:create', { playerName: name }, (res) => {
    DOM.btnCreateRoom.disabled = false;
    if (res.success) {
      state.roomCode = res.code;
      state.isHost = true;
      AudioEngine.success();
      enterRoom();
    } else {
      showToast(res.error || 'Erro ao criar sala', 'error');
    }
  });
});

DOM.btnJoinRoom.addEventListener('click', () => {
  const name = DOM.playerNameInput.value.trim();
  const code = DOM.roomCodeInput.value.trim().toUpperCase();
  if (!name) {
    showToast('Digite seu nome!', 'error');
    DOM.playerNameInput.focus();
    return;
  }
  if (!code || code.length < 4) {
    showToast('Digite o código da sala!', 'error');
    DOM.roomCodeInput.focus();
    return;
  }
  AudioEngine.click();
  state.playerName = name;
  localStorage.setItem('gh_playerName', name);

  DOM.btnJoinRoom.disabled = true;
  socket.emit('room:join', { playerName: name, roomCode: code }, (res) => {
    DOM.btnJoinRoom.disabled = false;
    if (res.success) {
      state.roomCode = res.code;
      state.isHost = false;
      AudioEngine.success();
      enterRoom();
    } else {
      showToast(res.error || 'Erro ao entrar', 'error');
      AudioEngine.error();
    }
  });
});

// Enter on inputs
DOM.playerNameInput.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') DOM.btnCreateRoom.click();
});
DOM.roomCodeInput.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') DOM.btnJoinRoom.click();
});
DOM.roomCodeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

// ==================== ROOM SCREEN ====================

function enterRoom() {
  showScreen('room');
  DOM.displayRoomCode.textContent = state.roomCode;
  DOM.gameRoomCode.textContent = state.roomCode;
  updateHostVisibility();
  renderPlayers();
  renderGamesGrid();
}

DOM.btnLeaveRoom.addEventListener('click', () => {
  AudioEngine.click();
  location.reload();
});

DOM.btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    showToast('Código copiado! 📋', 'success');
    AudioEngine.click();
  });
});

DOM.btnResetScores.addEventListener('click', () => {
  AudioEngine.click();
  socket.emit('room:reset-scores');
});

function updateHostVisibility() {
  $$('.host-only').forEach(el => {
    if (state.isHost) {
      el.style.display = '';
      el.classList.add('is-host');
    } else {
      if (el.classList.contains('game-card')) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    }
  });

  const hostHint = $('#host-hint');
  if (hostHint) {
    hostHint.textContent = state.isHost ? '✨ Você é o Host — escolha um jogo! 👑' : 'Aguardando o Host iniciar um jogo...';
  }

  const waitingHost = $('#results-waiting-host');
  if (waitingHost) {
    waitingHost.style.display = state.isHost ? 'none' : 'block';
  }
}

// ==================== AVATARS & ICONS ====================

function getPlayerAvatarSvg(name, index, size = 44) {
  const avatars = [
    // 0: Boy, stylish brown hair, blue jacket, pink background (matches PlayerOne in screenshot!)
    `<svg viewBox="0 0 60 60" width="${size}" height="${size}">
      <defs>
        <radialGradient id="av_bg0_${size}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#ff6b8b"/>
          <stop offset="100%" stop-color="#f43f5e"/>
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="30" fill="url(#av_bg0_${size})"/>
      <path d="M12 58 C12 44 20 40 30 40 C40 40 48 44 48 58 Z" fill="#2563eb"/>
      <path d="M25 40 L30 48 L35 40 Z" fill="#f8fafc"/>
      <rect x="26" y="34" width="8" height="8" rx="2" fill="#fed7aa"/>
      <ellipse cx="30" cy="26" rx="11" ry="12" fill="#fed7aa"/>
      <circle cx="26" cy="25" r="1.5" fill="#1e293b"/>
      <circle cx="34" cy="25" r="1.5" fill="#1e293b"/>
      <path d="M27 30 Q30 33 33 30" stroke="#b45309" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M18 22 C18 13 23 11 30 11 C37 11 42 14 42 21 C40 18 36 17 31 17 C26 17 22 19 18 22 Z" fill="#78350f"/>
    </svg>`,
    // 1: Girl, pink hair, purple top, cyan background (matches PlayerTwo in screenshot!)
    `<svg viewBox="0 0 60 60" width="${size}" height="${size}">
      <defs>
        <radialGradient id="av_bg1_${size}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="100%" stop-color="#0284c7"/>
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="30" fill="url(#av_bg1_${size})"/>
      <path d="M12 58 C12 44 20 40 30 40 C40 40 48 44 48 58 Z" fill="#9333ea"/>
      <rect x="26" y="34" width="8" height="8" rx="2" fill="#fed7aa"/>
      <ellipse cx="30" cy="26" rx="11" ry="12" fill="#fed7aa"/>
      <circle cx="26" cy="25" r="1.5" fill="#1e293b"/>
      <circle cx="34" cy="25" r="1.5" fill="#1e293b"/>
      <path d="M27 30 Q30 33 33 30" stroke="#e11d48" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M18 23 C17 14 22 11 30 11 C38 11 43 14 42 23 C40 19 36 17 30 17 C24 17 20 19 18 23 Z" fill="#f43f5e"/>
      <path d="M17 23 C16 30 18 34 19 36" stroke="#f43f5e" stroke-width="3" stroke-linecap="round" fill="none"/>
      <path d="M43 23 C44 30 42 34 41 36" stroke="#f43f5e" stroke-width="3" stroke-linecap="round" fill="none"/>
    </svg>`,
    // 2: Curly hair girl, warm yellow top, amber background (matches PlayerThree in screenshot!)
    `<svg viewBox="0 0 60 60" width="${size}" height="${size}">
      <defs>
        <radialGradient id="av_bg2_${size}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#fbbf24"/>
          <stop offset="100%" stop-color="#d97706"/>
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="30" fill="url(#av_bg2_${size})"/>
      <path d="M12 58 C12 44 20 40 30 40 C40 40 48 44 48 58 Z" fill="#ea580c"/>
      <rect x="26" y="34" width="8" height="8" rx="2" fill="#b45309"/>
      <circle cx="20" cy="22" r="7" fill="#451a03"/>
      <circle cx="40" cy="22" r="7" fill="#451a03"/>
      <circle cx="30" cy="15" r="9" fill="#451a03"/>
      <circle cx="23" cy="16" r="7" fill="#451a03"/>
      <circle cx="37" cy="16" r="7" fill="#451a03"/>
      <ellipse cx="30" cy="27" rx="10.5" ry="11.5" fill="#b45309"/>
      <circle cx="26" cy="26" r="1.5" fill="#1e293b"/>
      <circle cx="34" cy="26" r="1.5" fill="#1e293b"/>
      <path d="M27 31 Q30 34 33 31" stroke="#451a03" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    </svg>`,
    // 3: Boy with cool cap & cyan shirt, purple background
    `<svg viewBox="0 0 60 60" width="${size}" height="${size}">
      <defs>
        <radialGradient id="av_bg3_${size}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#c084fc"/>
          <stop offset="100%" stop-color="#7e22ce"/>
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="30" fill="url(#av_bg3_${size})"/>
      <path d="M12 58 C12 44 20 40 30 40 C40 40 48 44 48 58 Z" fill="#06b6d4"/>
      <rect x="26" y="34" width="8" height="8" rx="2" fill="#fed7aa"/>
      <ellipse cx="30" cy="27" rx="10.5" ry="11.5" fill="#fed7aa"/>
      <circle cx="26" cy="27" r="1.5" fill="#1e293b"/>
      <circle cx="34" cy="27" r="1.5" fill="#1e293b"/>
      <path d="M27 31 Q30 33.5 33 31" stroke="#b45309" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M18 22 C18 15 23 12 30 12 C37 12 42 15 42 22 Z" fill="#e11d48"/>
      <path d="M15 22 C21 21 39 21 45 22 L46 24 L14 24 Z" fill="#be123c"/>
    </svg>`,
    // 4: Cool girl with glasses, teal shirt, emerald background
    `<svg viewBox="0 0 60 60" width="${size}" height="${size}">
      <defs>
        <radialGradient id="av_bg4_${size}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#34d399"/>
          <stop offset="100%" stop-color="#059669"/>
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="30" fill="url(#av_bg4_${size})"/>
      <path d="M12 58 C12 44 20 40 30 40 C40 40 48 44 48 58 Z" fill="#14b8a6"/>
      <rect x="26" y="34" width="8" height="8" rx="2" fill="#fde68a"/>
      <ellipse cx="30" cy="26" rx="10.5" ry="11.5" fill="#fde68a"/>
      <circle cx="25.5" cy="25" r="3.5" fill="none" stroke="#1e293b" stroke-width="1.3"/>
      <circle cx="34.5" cy="25" r="3.5" fill="none" stroke="#1e293b" stroke-width="1.3"/>
      <line x1="29" y1="25" x2="31" y2="25" stroke="#1e293b" stroke-width="1.3"/>
      <circle cx="25.5" cy="25" r="1.2" fill="#1e293b"/>
      <circle cx="34.5" cy="25" r="1.2" fill="#1e293b"/>
      <path d="M27 31 Q30 33.5 33 31" stroke="#b45309" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M18 23 C18 14 23 12 30 12 C37 12 42 14 42 23 C40 19 36 16 30 16 C24 16 20 19 18 23 Z" fill="#92400e"/>
    </svg>`,
    // 5: Boy with headphones, orange jacket, magenta background
    `<svg viewBox="0 0 60 60" width="${size}" height="${size}">
      <defs>
        <radialGradient id="av_bg5_${size}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#f472b6"/>
          <stop offset="100%" stop-color="#db2777"/>
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="30" fill="url(#av_bg5_${size})"/>
      <path d="M12 58 C12 44 20 40 30 40 C40 40 48 44 48 58 Z" fill="#f97316"/>
      <rect x="26" y="34" width="8" height="8" rx="2" fill="#fed7aa"/>
      <ellipse cx="30" cy="26" rx="10.5" ry="11.5" fill="#fed7aa"/>
      <circle cx="26" cy="26" r="1.5" fill="#1e293b"/>
      <circle cx="34" cy="26" r="1.5" fill="#1e293b"/>
      <path d="M27 31 Q30 33.5 33 31" stroke="#b45309" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M20 21 C20 13 24 12 30 12 C36 12 40 13 40 21 Z" fill="#18181b"/>
      <path d="M17 25 C17 17 22 13 30 13 C38 13 43 17 43 25" stroke="#3b82f6" stroke-width="2.5" fill="none"/>
      <rect x="15" y="23" width="4" height="8" rx="2" fill="#1d4ed8"/>
      <rect x="41" y="23" width="4" height="8" rx="2" fill="#1d4ed8"/>
    </svg>`,
    // 6: Character with beanie hat, rose background
    `<svg viewBox="0 0 60 60" width="${size}" height="${size}">
      <defs>
        <radialGradient id="av_bg6_${size}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#fb7185"/>
          <stop offset="100%" stop-color="#e11d48"/>
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="30" fill="url(#av_bg6_${size})"/>
      <path d="M12 58 C12 44 20 40 30 40 C40 40 48 44 48 58 Z" fill="#8b5cf6"/>
      <rect x="26" y="34" width="8" height="8" rx="2" fill="#fed7aa"/>
      <ellipse cx="30" cy="27" rx="10.5" ry="11.5" fill="#fed7aa"/>
      <circle cx="26" cy="27" r="1.5" fill="#1e293b"/>
      <circle cx="34" cy="27" r="1.5" fill="#1e293b"/>
      <path d="M27 31 Q30 34 33 31" stroke="#b45309" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M18 21 C18 13 23 10 30 10 C37 10 42 13 42 21 Z" fill="#10b981"/>
      <rect x="17" y="19" width="26" height="5" rx="2.5" fill="#059669"/>
    </svg>`,
    // 7: Cool blonde character, violet/indigo background
    `<svg viewBox="0 0 60 60" width="${size}" height="${size}">
      <defs>
        <radialGradient id="av_bg7_${size}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#818cf8"/>
          <stop offset="100%" stop-color="#4f46e5"/>
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="30" fill="url(#av_bg7_${size})"/>
      <path d="M12 58 C12 44 20 40 30 40 C40 40 48 44 48 58 Z" fill="#ec4899"/>
      <rect x="26" y="34" width="8" height="8" rx="2" fill="#fed7aa"/>
      <ellipse cx="30" cy="26" rx="10.5" ry="11.5" fill="#fed7aa"/>
      <circle cx="26" cy="25" r="1.5" fill="#1e293b"/>
      <circle cx="34" cy="25" r="1.5" fill="#1e293b"/>
      <path d="M27 30 Q30 32.5 33 30" stroke="#b45309" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M19 22 C19 13 24 11 30 11 C36 11 41 13 41 22 C39 20 35 17 30 17 C25 17 21 20 19 22 Z" fill="#facc15"/>
    </svg>`
  ];
  let idx = 0;
  if (typeof index === 'number') {
    idx = Math.abs(index) % avatars.length;
  } else if (name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
    idx = Math.abs(hash) % avatars.length;
  }
  return avatars[idx];
}

const GAME_ICONS = {
  'ritmo': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="drumBody" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#9333ea"/>
        <stop offset="100%" stop-color="#4c1d95"/>
      </linearGradient>
      <linearGradient id="drumHead" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#fdf4ff"/>
        <stop offset="100%" stop-color="#e9d5ff"/>
      </linearGradient>
      <filter id="glowRitmo">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <path d="M12 36 Q8 45 12 54 M6 30 Q0 45 6 60" stroke="#00f0ff" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.85" filter="url(#glowRitmo)"/>
    <path d="M78 36 Q82 45 78 54 M84 30 Q90 45 84 60" stroke="#ec4899" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.85" filter="url(#glowRitmo)"/>
    <line x1="22" y1="20" x2="38" y2="40" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
    <circle cx="38" cy="40" r="3" fill="#f59e0b"/>
    <line x1="68" y1="20" x2="52" y2="40" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
    <circle cx="52" cy="40" r="3" fill="#f59e0b"/>
    <path d="M22 46 C22 56 68 56 68 46 L68 62 C68 70 22 70 22 62 Z" fill="url(#drumBody)"/>
    <path d="M25 48 L32 63 M45 49 L45 65 M65 48 L58 63" stroke="#00f0ff" stroke-width="1.8" opacity="0.7"/>
    <ellipse cx="45" cy="62" rx="23" ry="6" fill="#3b0764"/>
    <ellipse cx="45" cy="45" rx="23" ry="7.5" fill="url(#drumHead)" stroke="#00f0ff" stroke-width="2.5" filter="url(#glowRitmo)"/>
    <ellipse cx="45" cy="45" rx="17" ry="5" fill="none" stroke="#d8b4fe" stroke-width="1" stroke-dasharray="3,3"/>
  </svg>`,

  'pesos-medidas': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="protGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#00f0ff"/>
        <stop offset="100%" stop-color="#ec4899"/>
      </linearGradient>
      <filter id="glowAngulo">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <polygon points="20,72 74,72 20,18" fill="rgba(0, 240, 255, 0.12)" stroke="#00f0ff" stroke-width="2" stroke-linejoin="round" opacity="0.6"/>
    <polygon points="26,67 58,67 26,35" fill="none" stroke="#00f0ff" stroke-width="1.5" opacity="0.4"/>
    <path d="M22 65 A28 28 0 0 1 78 65 Z" fill="rgba(236, 72, 153, 0.15)" stroke="url(#protGrad)" stroke-width="2.8" filter="url(#glowAngulo)"/>
    <line x1="50" y1="37" x2="50" y2="42" stroke="#ffffff" stroke-width="1.5"/>
    <line x1="33" y1="42" x2="36" y2="46" stroke="#ffffff" stroke-width="1.5"/>
    <line x1="67" y1="42" x2="64" y2="46" stroke="#ffffff" stroke-width="1.5"/>
    <circle cx="50" cy="65" r="4" fill="#00f0ff" filter="url(#glowAngulo)"/>
    <line x1="50" y1="65" x2="68" y2="42" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" filter="url(#glowAngulo)"/>
    <polygon points="68,42 63,45 66,48" fill="#ffffff"/>
  </svg>`,

  'cronometro-cego': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="goldRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fef08a"/>
        <stop offset="40%" stop-color="#eab308"/>
        <stop offset="100%" stop-color="#ca8a04"/>
      </linearGradient>
      <radialGradient id="dialFace" cx="40%" cy="40%" r="60%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#fef9c3"/>
      </radialGradient>
      <filter id="glowGold">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <circle cx="45" cy="15" r="7" fill="none" stroke="url(#goldRim)" stroke-width="3"/>
    <rect x="42" y="19" width="6" height="6" rx="1.5" fill="url(#goldRim)"/>
    <circle cx="45" cy="52" r="28" fill="url(#goldRim)" filter="url(#glowGold)"/>
    <circle cx="45" cy="52" r="23" fill="url(#dialFace)"/>
    <line x1="45" y1="33" x2="45" y2="37" stroke="#854d0e" stroke-width="2" stroke-linecap="round"/>
    <line x1="45" y1="67" x2="45" y2="71" stroke="#854d0e" stroke-width="2" stroke-linecap="round"/>
    <line x1="26" y1="52" x2="30" y2="52" stroke="#854d0e" stroke-width="2" stroke-linecap="round"/>
    <line x1="60" y1="52" x2="64" y2="52" stroke="#854d0e" stroke-width="2" stroke-linecap="round"/>
    <line x1="45" y1="52" x2="45" y2="39" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>
    <line x1="45" y1="52" x2="57" y2="47" stroke="#e11d48" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="45" cy="52" r="3" fill="#ca8a04"/>
    <polygon points="68,26 70,30 74,32 70,34 68,38 66,34 62,32 66,30" fill="#fde047"/>
    <polygon points="22,34 23,37 26,38 23,39 22,42 21,39 18,38 21,37" fill="#fde047"/>
  </svg>`,

  'quem-escreveu': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <filter id="noteGlow">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <linearGradient id="paperGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#f1f5f9"/>
      </linearGradient>
    </defs>
    <rect x="25" y="18" width="42" height="54" rx="4" fill="url(#paperGrad)" stroke="#cbd5e1" stroke-width="1.5" transform="rotate(-4 46 45)"/>
    <line x1="31" y1="36" x2="61" y2="34" stroke="#93c5fd" stroke-width="1.5"/>
    <line x1="31" y1="44" x2="61" y2="42" stroke="#93c5fd" stroke-width="1.5"/>
    <line x1="31" y1="52" x2="61" y2="50" stroke="#93c5fd" stroke-width="1.5"/>
    <line x1="31" y1="60" x2="52" y2="58" stroke="#93c5fd" stroke-width="1.5"/>
    <circle cx="28" cy="22" r="2.5" fill="#3b82f6"/>
    <circle cx="36" cy="21.5" r="2.5" fill="#3b82f6"/>
    <circle cx="44" cy="21" r="2.5" fill="#3b82f6"/>
    <circle cx="52" cy="20.5" r="2.5" fill="#3b82f6"/>
    <circle cx="60" cy="20" r="2.5" fill="#3b82f6"/>
    <text x="32" y="32" font-family="Space Grotesk, sans-serif" font-weight="900" font-size="14" fill="#fbbf24" filter="url(#noteGlow)">?</text>
    <text x="46" y="29" font-family="Space Grotesk, sans-serif" font-weight="900" font-size="16" fill="#38bdf8" filter="url(#noteGlow)">?</text>
    <g transform="translate(48, 22) rotate(42)">
      <polygon points="0,0 8,0 4,32" fill="#f59e0b"/>
      <polygon points="0,0 8,0 4,-6" fill="#f43f5e"/>
      <polygon points="3,26 5,26 4,33" fill="#1e293b"/>
    </g>
  </svg>`,

  'ia-falsa': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="frameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="100%" stop-color="#1d4ed8"/>
      </linearGradient>
      <filter id="eyeGlow">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect x="18" y="20" width="50" height="42" rx="5" fill="#0f172a" stroke="url(#frameGrad)" stroke-width="2.5"/>
    <clipPath id="picClip">
      <rect x="21" y="23" width="44" height="36" rx="3"/>
    </clipPath>
    <g clip-path="url(#picClip)">
      <rect x="20" y="20" width="48" height="40" fill="#38bdf8"/>
      <circle cx="30" cy="30" r="4.5" fill="#fde047"/>
      <polygon points="18,59 36,38 52,59" fill="#15803d"/>
      <polygon points="34,59 50,33 66,59" fill="#22c55e"/>
    </g>
    <g transform="translate(56, 54)" filter="url(#eyeGlow)">
      <circle cx="12" cy="12" r="14" fill="#0b1329" stroke="#00f0ff" stroke-width="2.5"/>
      <ellipse cx="12" cy="12" rx="9" ry="6" fill="#00f0ff" opacity="0.3"/>
      <circle cx="12" cy="12" r="5" fill="#00f0ff"/>
      <circle cx="12" cy="12" r="2.5" fill="#ffffff"/>
      <line x1="0" y1="12" x2="5" y2="12" stroke="#00f0ff" stroke-width="2"/>
      <line x1="19" y1="12" x2="24" y2="12" stroke="#00f0ff" stroke-width="2"/>
    </g>
  </svg>`,

  'consenso': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="suitLeft" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3b82f6"/>
        <stop offset="100%" stop-color="#1d4ed8"/>
      </linearGradient>
      <linearGradient id="suitRight" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#6366f1"/>
        <stop offset="100%" stop-color="#4338ca"/>
      </linearGradient>
      <filter id="handGlow">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <circle cx="45" cy="45" r="22" fill="rgba(0, 229, 255, 0.18)" filter="url(#handGlow)"/>
    <path d="M12 34 L26 36 L24 56 L12 52 Z" fill="url(#suitLeft)"/>
    <rect x="25" y="36" width="4" height="18" rx="2" fill="#ffffff"/>
    <path d="M78 34 L64 36 L66 56 L78 52 Z" fill="url(#suitRight)"/>
    <rect x="61" y="36" width="4" height="18" rx="2" fill="#ffffff"/>
    <path d="M29 39 C34 39 40 43 46 47 C43 51 38 52 35 52 L29 46 Z" fill="#fed7aa"/>
    <path d="M61 39 C56 39 50 43 44 47 C47 51 52 52 55 52 L61 46 Z" fill="#fcd34d"/>
    <ellipse cx="45" cy="48" rx="9" ry="6.5" fill="#fbbf24" stroke="#d97706" stroke-width="1.5"/>
    <path d="M38 45 Q45 51 52 45" stroke="#b45309" stroke-width="1.8" fill="none"/>
    <polygon points="45,22 47,26 51,28 47,30 45,34 43,30 39,28 43,26" fill="#00e5ff" filter="url(#handGlow)"/>
  </svg>`,

  'quao-grande': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="tapeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fde047"/>
        <stop offset="100%" stop-color="#eab308"/>
      </linearGradient>
      <filter id="tapeGlow">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect x="16" y="24" width="42" height="42" rx="12" fill="#1e293b" stroke="#facc15" stroke-width="3"/>
    <circle cx="37" cy="45" r="14" fill="url(#tapeGrad)"/>
    <circle cx="37" cy="45" r="6" fill="#0f172a"/>
    <rect x="56" y="41" width="22" height="8" rx="1" fill="#fef08a" filter="url(#tapeGlow)"/>
    <line x1="61" y1="41" x2="61" y2="45" stroke="#1e293b" stroke-width="1.5"/>
    <line x1="67" y1="41" x2="67" y2="46" stroke="#1e293b" stroke-width="1.8"/>
    <line x1="73" y1="41" x2="73" y2="45" stroke="#1e293b" stroke-width="1.5"/>
    <rect x="76" y="39" width="3" height="12" rx="1" fill="#94a3b8"/>
  </svg>`,

  'temperatura': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="flameGrad" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#f97316"/>
        <stop offset="50%" stop-color="#ef4444"/>
        <stop offset="100%" stop-color="#fde047"/>
      </linearGradient>
      <linearGradient id="iceGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#00f0ff"/>
        <stop offset="100%" stop-color="#3b82f6"/>
      </linearGradient>
      <filter id="tempGlow">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <path d="M22 66 C14 56 16 42 26 34 C25 44 32 46 32 38 C36 48 34 60 22 66 Z" fill="url(#flameGrad)" filter="url(#tempGlow)"/>
    <g transform="translate(64, 46)" stroke="url(#iceGrad)" stroke-width="2.5" stroke-linecap="round" filter="url(#tempGlow)">
      <line x1="0" y1="-14" x2="0" y2="14"/>
      <line x1="-12" y1="0" x2="12" y2="0"/>
      <line x1="-8" y1="-8" x2="8" y2="8"/>
      <line x1="-8" y1="8" x2="8" y2="-8"/>
    </g>
    <rect x="41" y="16" width="8" height="42" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
    <circle cx="45" cy="62" r="9" fill="#ef4444" stroke="#f8fafc" stroke-width="1.5"/>
    <rect x="43" y="32" width="4" height="26" fill="#ef4444"/>
  </svg>`,

  'historia-cadeia': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="bookCover" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#06b6d4"/>
        <stop offset="100%" stop-color="#8b5cf6"/>
      </linearGradient>
      <filter id="magicGlow">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <path d="M45 54 C35 50 20 52 14 57 L14 30 C20 26 35 24 45 28 Z" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
    <path d="M45 54 C55 50 70 52 76 57 L76 30 C70 26 55 24 45 28 Z" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
    <path d="M45 54 L45 28" stroke="#8b5cf6" stroke-width="2.5"/>
    <path d="M12 59 C20 54 35 52 45 56 C55 52 70 54 78 59" stroke="url(#bookCover)" stroke-width="3" fill="none"/>
    <ellipse cx="38" cy="24" rx="8" ry="4.5" fill="none" stroke="#00f0ff" stroke-width="2.5" transform="rotate(-30 38 24)" filter="url(#magicGlow)"/>
    <ellipse cx="46" cy="18" rx="8" ry="4.5" fill="none" stroke="#a855f7" stroke-width="2.5" transform="rotate(25 46 18)" filter="url(#magicGlow)"/>
    <ellipse cx="54" cy="23" rx="8" ry="4.5" fill="none" stroke="#00f0ff" stroke-width="2.5" transform="rotate(-15 54 23)" filter="url(#magicGlow)"/>
  </svg>`,

  'estime': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="boxTop" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#d97706"/>
        <stop offset="100%" stop-color="#b45309"/>
      </linearGradient>
      <linearGradient id="boxSide" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#b45309"/>
        <stop offset="100%" stop-color="#78350f"/>
      </linearGradient>
      <filter id="boxGlow">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <polygon points="45,18 72,32 45,46 18,32" fill="url(#boxTop)"/>
    <polygon points="18,32 45,46 45,72 18,58" fill="url(#boxSide)"/>
    <polygon points="45,46 72,32 72,58 45,72" fill="#92400e"/>
    <polygon points="45,18 50,21 23,35 18,32" fill="#fef08a" opacity="0.6"/>
    <path d="M12 66 L78 66" stroke="#facc15" stroke-width="5" stroke-linecap="round" filter="url(#boxGlow)"/>
    <line x1="24" y1="64" x2="24" y2="68" stroke="#1e293b" stroke-width="1.5"/>
    <line x1="36" y1="64" x2="36" y2="68" stroke="#1e293b" stroke-width="1.5"/>
    <line x1="48" y1="64" x2="48" y2="68" stroke="#1e293b" stroke-width="1.5"/>
    <line x1="60" y1="64" x2="60" y2="68" stroke="#1e293b" stroke-width="1.5"/>
  </svg>`,

  'death-ball': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <linearGradient id="skullFlame" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#00f0ff"/>
        <stop offset="60%" stop-color="#8b5cf6"/>
        <stop offset="100%" stop-color="#ec4899"/>
      </linearGradient>
      <filter id="flameGlow">
        <feGaussianBlur stdDeviation="4.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <path d="M22 45 C15 30 25 15 45 8 C55 18 68 15 68 35 C78 48 70 65 60 70 C40 85 28 65 22 45 Z" fill="url(#skullFlame)" filter="url(#flameGlow)" opacity="0.85"/>
    <ellipse cx="45" cy="46" rx="18" ry="16" fill="#f8fafc"/>
    <rect x="36" y="56" width="18" height="11" rx="3" fill="#e2e8f0"/>
    <line x1="41" y1="57" x2="41" y2="66" stroke="#475569" stroke-width="1.5"/>
    <line x1="45" y1="57" x2="45" y2="66" stroke="#475569" stroke-width="1.5"/>
    <line x1="49" y1="57" x2="49" y2="66" stroke="#475569" stroke-width="1.5"/>
    <ellipse cx="37" cy="46" rx="5" ry="6" fill="#1e1b4b"/>
    <ellipse cx="53" cy="46" rx="5" ry="6" fill="#1e1b4b"/>
    <circle cx="37" cy="46" r="2" fill="#00f0ff" filter="url(#flameGlow)"/>
    <circle cx="53" cy="46" r="2" fill="#00f0ff" filter="url(#flameGlow)"/>
    <polygon points="45,52 43,56 47,56" fill="#475569"/>
  </svg>`,

  'cartas-contra-humanidade': `<svg viewBox="0 0 90 90" class="game-svg-icon">
    <defs>
      <filter id="cardsGlow">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <g transform="translate(34, 46) rotate(-14) translate(-34, -46)">
      <rect x="18" y="20" width="30" height="44" rx="4" fill="#0f172a" stroke="#475569" stroke-width="1.5" filter="url(#cardsGlow)"/>
      <circle cx="33" cy="40" r="7" fill="none" stroke="#f8fafc" stroke-width="1.5"/>
      <circle cx="31" cy="38" r="1" fill="#f8fafc"/>
      <circle cx="35" cy="38" r="1" fill="#f8fafc"/>
      <path d="M30 43 Q33 40 36 43" stroke="#f8fafc" stroke-width="1.5" fill="none"/>
    </g>
    <g transform="translate(56, 46) rotate(12) translate(-56, -46)">
      <rect x="42" y="20" width="30" height="44" rx="4" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" filter="url(#cardsGlow)"/>
      <circle cx="57" cy="40" r="7" fill="none" stroke="#0f172a" stroke-width="1.5"/>
      <circle cx="55" cy="38" r="1" fill="#0f172a"/>
      <circle cx="59" cy="38" r="1" fill="#0f172a"/>
      <path d="M54 41 Q57 45 60 41" stroke="#0f172a" stroke-width="1.5" fill="none"/>
    </g>
  </svg>`
};

// ==================== RENDER PLAYERS & RANKING ====================

function renderPlayers() {
  const players = state.players || [];
  const sorted = [...players].sort((a, b) => b.score - a.score);

  // Player count in header
  if (DOM.playerCount) {
    DOM.playerCount.textContent = sorted.length;
  }

  // Left column: ranking panel
  if (DOM.playersList) {
    if (sorted.length === 0) {
      DOM.playersList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 20px 0;">
          Aguardando jogadores entrarem...
        </div>
      `;
    } else {
      DOM.playersList.innerHTML = sorted.map((p, i) => {
        const avatarSvg = getPlayerAvatarSvg(p.name, i, 44);
        const hostCrown = p.isHost ? '<span class="crown-icon" title="Host da Sala">👑</span>' : '';
        const disconnected = p.connected ? '' : ' player-disconnected';
        return `
          <div class="ranking-player-card${disconnected}">
            <div class="ranking-player-avatar">${avatarSvg}</div>
            <div class="ranking-player-info">
              <div class="ranking-player-name-row">
                <span class="ranking-player-rank">${i + 1}º</span>
                <span class="ranking-player-name">${escapeHtml(p.name)}</span>
                ${hostCrown}
              </div>
              <div class="ranking-player-score">(${p.score} pts)</div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Top-right header avatars row
  if (DOM.headerAvatarsRow) {
    let html = '';
    const maxSlots = 8;
    sorted.forEach((p, idx) => {
      const avatarSvg = getPlayerAvatarSvg(p.name, idx, 32);
      html += `<div class="header-avatar-slot active" title="${escapeHtml(p.name)}">${avatarSvg}</div>`;
    });
    for (let i = sorted.length; i < maxSlots; i++) {
      html += `
        <div class="header-avatar-slot empty" title="Vaga livre">
          <svg viewBox="0 0 24 24" class="silhouette-icon"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
        </div>
      `;
    }
    DOM.headerAvatarsRow.innerHTML = html;
  }
}

// ==================== ROOM STATE ====================

socket.on('room:state', (data) => {
  state.roomCode = data.code;
  state.isHost = data.hostId === socket.id;
  state.players = data.players || [];

  renderPlayers();
  updateHostVisibility();
  renderGamesGrid();
});

// ==================== GAMES LIST ====================

socket.on('game-list', (games) => {
  state.gameList = games;
  renderGamesGrid();
});

function renderGamesGrid() {
  if (!state.gameList || state.gameList.length === 0) return;
  DOM.gamesGrid.innerHTML = state.gameList.map(game => {
    const iconSvg = GAME_ICONS[game.id] || `<div class="game-emoji-fallback">${game.icon}</div>`;
    const isHighlighted = (game.id === 'consenso' || game.id === 'cartas-contra-humanidade') ? 'highlighted' : '';
    return `
      <div class="game-card ${isHighlighted} host-only ${state.isHost ? 'is-host' : ''}"
           data-game-id="${game.id}"
           style="--card-color: ${game.color}; cursor: ${state.isHost ? 'pointer' : 'default'}">
        <div class="game-card-icon-wrapper">${iconSvg}</div>
        <div class="game-card-name">${escapeHtml(game.name)}</div>
        <div class="game-card-desc">${escapeHtml(game.desc)}</div>
        <div class="game-card-players-badge">${game.minPlayers}-${game.maxPlayers} jogadores</div>
      </div>
    `;
  }).join('');
}

// Event delegation for game selection
DOM.gamesGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.game-card');
  if (!card) return;
  const gameId = card.dataset.gameId;
  const gameDef = state.gameList?.find(g => g.id === gameId);
  if (gameDef && gameDef.externalUrl) {
    if (typeof AudioEngine !== 'undefined') AudioEngine.click();
    window.location.href = gameDef.externalUrl;
    return;
  }
  if (!state.isHost) {
    showToast('Apenas o Host pode iniciar um jogo!', 'info');
    if (typeof AudioEngine !== 'undefined') AudioEngine.error();
    return;
  }
  if (!gameId) return;
  if (typeof AudioEngine !== 'undefined') AudioEngine.click();
  socket.emit('game:start', { gameId });
});

// ==================== CHAT ====================

DOM.chatToggle.addEventListener('click', () => {
  state.chatOpen = !state.chatOpen;
  DOM.chatContainer.classList.toggle('hidden', !state.chatOpen);
  if (state.chatOpen) {
    state.unreadChat = 0;
    DOM.chatBadge.classList.add('hidden');
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
    DOM.chatInput.focus();
  }
});

if (DOM.btnCloseChat) {
  DOM.btnCloseChat.addEventListener('click', (e) => {
    e.stopPropagation();
    state.chatOpen = false;
    DOM.chatContainer.classList.add('hidden');
  });
}

DOM.btnSendChat.addEventListener('click', sendChatMessage);
DOM.chatInput.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const text = DOM.chatInput.value.trim();
  if (!text) return;
  socket.emit('chat:send', { text });
  DOM.chatInput.value = '';
}

socket.on('chat:message', (msg) => {
  appendChatMessage(msg);
  if (!state.chatOpen) {
    state.unreadChat++;
    DOM.chatBadge.textContent = state.unreadChat;
    DOM.chatBadge.classList.remove('hidden');
  }
});

socket.on('chat:history', (messages) => {
  messages.forEach(msg => appendChatMessage(msg));
});

function appendChatMessage(msg) {
  const div = document.createElement('div');
  if (msg.type === 'system') {
    div.className = 'chat-msg chat-msg-system';
    div.textContent = msg.text;
  } else {
    div.className = 'chat-msg chat-msg-player';
    div.innerHTML = `<span class="chat-msg-name">${escapeHtml(msg.name)}:</span><span class="chat-msg-text">${escapeHtml(msg.text)}</span>`;
  }
  DOM.chatMessages.appendChild(div);
  DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

// ==================== GAME LIFECYCLE ====================

socket.on('game:starting', (data) => {
  state.currentGame = data.gameId;
  DOM.gameIcon.textContent = data.icon;
  DOM.gameTitle.textContent = data.gameName;
  DOM.resultsOverlay.classList.add('hidden');
  AudioEngine.gameStart();

  // Mostrar tela do jogo com loading
  showScreen('game');
  DOM.gameArea.innerHTML = `
    <div class="game-loading">
      <div class="spinner"></div>
      <p>Preparando ${data.icon} ${data.gameName}...</p>
    </div>
  `;
});

socket.on('game:ended', () => {
  state.currentGame = null;
  DOM.resultsOverlay.classList.add('hidden');
  showScreen('room');
  renderPlayers();
  renderGamesGrid();
  AudioEngine.gameEnd();
});

socket.on('game:error', (data) => {
  showToast(data.message, 'error');
  AudioEngine.error();
});

DOM.btnBackLobby.addEventListener('click', () => {
  AudioEngine.click();
  socket.emit('game:back-to-lobby');
});

DOM.btnResultsClose.addEventListener('click', () => {
  AudioEngine.click();
  socket.emit('game:back-to-lobby');
});

// ==================== UTILITY ====================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderResults(results, extraHtml = '') {
  DOM.resultsContent.innerHTML = results.map((r, i) => `
    <div class="result-row" style="animation-delay: ${i * 0.1}s">
      <span class="result-rank">${r.rank || i + 1}º</span>
      <span class="result-name">${escapeHtml(r.name)}</span>
      <span class="result-detail">${r.detail || ''}</span>
      <span class="result-points">+${r.points} pts</span>
    </div>
  `).join('') + (extraHtml || '');

  DOM.resultsOverlay.classList.remove('hidden');
  AudioEngine.reveal();
}

// Show waiting indicator
function showWaiting(text = 'Aguardando outros jogadores...') {
  return `
    <div class="waiting-indicator">
      <div class="waiting-dots">
        <div class="waiting-dot"></div>
        <div class="waiting-dot"></div>
        <div class="waiting-dot"></div>
      </div>
      <p>${text}</p>
    </div>
  `;
}

// Global game area access
window.GameHub = {
  socket,
  state,
  DOM,
  showToast,
  renderResults,
  showWaiting,
  escapeHtml,
  showScreen,
  AudioEngine: typeof AudioEngine !== 'undefined' ? AudioEngine : null
};

// Connection status
socket.on('connect', () => {
  console.log('✅ Conectado ao servidor');
});

socket.on('disconnect', () => {
  showToast('Desconectado! Reconectando...', 'error');
});

socket.on('reconnect', () => {
  showToast('Reconectado!', 'success');
});
