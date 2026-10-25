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
  const done = () => {
    showToast(`Código ${state.roomCode} copiado. Cola no grupo da galera.`, 'success');
    AudioEngine.click();
    DOM.btnCopyCode.classList.remove('is-copied'); void DOM.btnCopyCode.offsetWidth;
    DOM.btnCopyCode.classList.add('is-copied');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(state.roomCode).then(done, done);
  else done();
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
    hostHint.textContent = state.isHost ? 'Você é o host: toque num cartaz para começar.' : 'O host escolhe o jogo. Fica ligado.';
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

// Ícones de carimbo: uma cor só (currentColor), herdam a tinta do cartaz
const GAME_ICONS = {
  'ritmo': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><ellipse cx="45" cy="38" rx="26" ry="9"/><path d="M19 38v22c0 5 12 9 26 9s26-4 26-9V38"/><path d="M28 18l14 16M62 18L48 34"/><path d="M19 52l26 8 26-8" stroke-width="4"/></g></svg>`,
  'pesos-medidas': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M14 64a31 31 0 0 1 62 0z"/><path d="M45 64L63 40"/><circle cx="45" cy="64" r="3" fill="currentColor" stroke="none"/><path d="M24 54l4 3M45 41v5M66 54l-4 3" stroke-width="4"/></g></svg>`,
  'cronometro-cego': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="45" cy="52" r="24"/><path d="M38 20h14M45 20v8M64 30l5-5"/><path d="M45 52V38"/><path d="M16 58l58-18" stroke-width="8"/></g></svg>`,
  'quem-escreveu': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M58 14l18 18-34 34-22 4 4-22z"/><path d="M50 22l18 18"/><path d="M24 66l8-8"/><circle cx="24" cy="66" r="2" fill="currentColor" stroke="none"/></g></svg>`,
  'ia-falsa': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><rect x="14" y="18" width="62" height="54" rx="2"/><path d="M14 62l18-18 12 12 10-10 22 22"/><circle cx="58" cy="34" r="6" fill="currentColor" stroke="none"/></g></svg>`,
  'consenso': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M12 22h38v24H30l-10 9v-9h-8z"/><path d="M40 40h38v24h-8v9l-10-9H40z"/></g></svg>`,
  'quao-grande': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M14 58L58 14l18 18-44 44z"/><path d="M29 43l7 7M38 34l5 5M47 25l7 7M23 49l4 4M32 40l4 4M41 31l4 4" stroke-width="4"/></g></svg>`,
  'temperatura': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M38 56V18a7 7 0 0 1 14 0v38"/><circle cx="45" cy="64" r="12"/><circle cx="45" cy="64" r="6" fill="currentColor" stroke="none"/><path d="M45 58V28"/><path d="M60 24h8M60 34h6M60 44h8" stroke-width="4"/></g></svg>`,
  'historia-cadeia': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M45 26c-8-6-20-7-31-4v42c11-3 23-2 31 4 8-6 20-7 31-4V22c-11-3-23-2-31 4z"/><path d="M45 26v42"/></g></svg>`,
  'estime': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M45 20l26 12v26L45 70 19 58V32z"/><path d="M19 32l26 12 26-12M45 44v26"/><path d="M78 30v30M74 34l4-4 4 4M74 56l4 4 4-4" stroke-width="4"/></g></svg>`,
  'death-ball': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="52" cy="46" r="24" fill="currentColor" stroke="none"/><circle cx="44" cy="44" r="5" fill="var(--ico-hole, #efeee9)" stroke="none"/><circle cx="60" cy="44" r="5" fill="var(--ico-hole, #efeee9)" stroke="none"/><path d="M8 34h12M4 46h14M8 58h12"/></g></svg>`,
  'cartas-contra-humanidade': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><rect x="14" y="22" width="34" height="48" rx="3" transform="rotate(-12 31 46)" fill="currentColor" stroke="none"/><rect x="42" y="18" width="34" height="48" rx="3" transform="rotate(10 59 42)"/></g></svg>`,
  'digite-direito': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="45" cy="45" r="28"/><circle cx="45" cy="27" r="5" fill="currentColor" stroke="none"/><circle cx="60.6" cy="36" r="5"/><circle cx="60.6" cy="54" r="5"/><circle cx="45" cy="63" r="5"/><circle cx="29.4" cy="54" r="5"/><circle cx="29.4" cy="36" r="5"/></g></svg>`,
  'vem-na-mao': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><rect x="24" y="28" width="38" height="34" rx="9" fill="currentColor" stroke="none"/><path d="M36 30v14M48 30v14" stroke="var(--ico-hole, #efeee9)" stroke-width="4"/><path d="M24 50h-6c-4 0-6 3-6 6v0c0 4 3 6 6 6h10" /><path d="M70 20l8-6M74 36h10M70 52l8 6"/></g></svg>`,
  'rinha': `<svg viewBox="0 0 90 90" class="game-svg-icon lb-ico" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M20 20l44 44M70 20L26 64"/><path d="M58 68l10-10M22 58l10 10" /></g></svg>`
};

// ==================== RENDER PLAYERS & RANKING ====================

// Tintas do muro de lambe-lambe (mesma ordem do hub.css)
const LB_INKS = ['pink', 'yellow', 'green', 'blue'];

function stampAvatar(name, index, cls = '') {
  const ink = LB_INKS[index % LB_INKS.length];
  const initial = escapeHtml((name || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="lb-stamp ink-${ink} ${cls}" aria-hidden="true">${initial}</span>`;
}

function renderPlayers() {
  const players = state.players || [];
  const sorted = [...players].sort((a, b) => b.score - a.score);
  // cor fixa por pessoa (ordem de entrada), não pela posição no ranking
  const order = new Map(players.map((p, i) => [p.id, i]));

  if (DOM.playerCount) DOM.playerCount.textContent = sorted.length;

  if (DOM.playersList) {
    if (sorted.length === 0) {
      DOM.playersList.innerHTML = `<p class="lb-roll-empty">Ninguém por aqui ainda. Mande o código da sala pra galera.</p>`;
    } else {
      DOM.playersList.innerHTML = sorted.map((p, i) => {
        const me = p.id === socket.id;
        const pts = p.score === 1 ? '1 ponto' : `${p.score} pontos`;
        return `
          <div class="lb-roll-row${p.connected ? '' : ' is-away'}${me ? ' is-me' : ''}">
            <span class="lb-roll-pos">${i + 1}</span>
            ${stampAvatar(p.name, order.get(p.id) || 0)}
            <span class="lb-roll-name">${escapeHtml(p.name)}${me ? ' <em>(você)</em>' : ''}${p.isHost ? ' <span class="lb-host" title="Host da sala">host</span>' : ''}</span>
            <span class="lb-roll-pts">${pts}</span>
          </div>`;
      }).join('');
    }
  }

  if (DOM.headerAvatarsRow) {
    DOM.headerAvatarsRow.innerHTML = players.map((p, i) =>
      `<span title="${escapeHtml(p.name)}">${stampAvatar(p.name, i, 'lb-stamp-sm' + (p.connected ? '' : ' is-away'))}</span>`).join('');
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

// Jogos em destaque ganham cartaz duplo no muro
const LB_FEATURED = new Set(['vem-na-mao', 'death-ball', 'digite-direito', 'cartas-contra-humanidade', 'consenso']);

function renderGamesGrid() {
  if (!state.gameList || state.gameList.length === 0) return;
  DOM.gamesGrid.innerHTML = state.gameList.map((game, i) => {
    const iconSvg = GAME_ICONS[game.id] || `<div class="game-emoji-fallback">${game.icon}</div>`;
    const ink = LB_INKS[i % LB_INKS.length];
    // inclinação estável por jogo (não muda a cada render)
    let h = 0; for (const c of game.id) h = (h * 31 + c.charCodeAt(0)) | 0;
    const tilt = ((Math.abs(h) % 7) - 3) * 0.45;
    const featured = LB_FEATURED.has(game.id) ? ' is-featured' : '';
    const range = game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers} a ${game.maxPlayers}`;
    return `
      <div class="game-card lb-gp ink-${ink}${featured} host-only ${state.isHost ? 'is-host' : ''}"
           data-game-id="${game.id}" style="--tilt:${tilt}deg"
           ${state.isHost ? 'role="button" tabindex="0"' : ''} aria-label="${escapeHtml(game.name)}">
        <span class="lb-tape" aria-hidden="true"></span>
        <div class="lb-gp-head"><span class="lb-gp-name">${escapeHtml(game.name)}</span></div>
        <div class="lb-gp-body">
          <div class="lb-gp-icon">${iconSvg}</div>
          <p class="lb-gp-desc">${escapeHtml(game.desc)}</p>
        </div>
        <div class="lb-gp-foot">${range} jogadores</div>
      </div>`;
  }).join('');
}

// Teclado: Enter/Espaço num cartaz focado inicia o jogo
DOM.gamesGrid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.game-card');
  if (!card) return;
  e.preventDefault();
  card.click();
});

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
  const idx = Math.max(0, (state.gameList || []).findIndex(g => g.id === data.gameId));
  const ink = LB_INKS[idx % LB_INKS.length];
  DOM.gameArea.innerHTML = `
    <div class="game-loading lb-loading">
      <div class="lb-loading-poster ink-${ink}">
        <span class="lb-tape" aria-hidden="true"></span>
        <div class="lb-loading-ico">${GAME_ICONS[data.gameId] || ''}</div>
        <div class="lb-loading-name${data.gameName.length > 12 ? ' is-long' : ''}">${escapeHtml(data.gameName)}</div>
      </div>
      <p class="lb-loading-msg">Colando o cartaz… o jogo começa em instantes.</p>
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
