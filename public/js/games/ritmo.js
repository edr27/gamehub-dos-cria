/**
 * Ritmo — Experiência Competitiva & Divertida Multi-Instrumentos
 * 5 Rodadas Escaláveis (até 14 batidas) • Bumbo, Caixa, Prato e Conga
 * Ouvir 1x só com foco total • Pads ergonômicos para mobile e PC
 * Timeline comparativa detalhada e Replay de áudio dos amigos!
 */
(() => {
  const { socket, DOM } = GameHub;

  // Metadados dos instrumentos
  const INSTRUMENTS = {
    kick:  { name: 'BUMBO', icon: '🥁', color: '#ff5252', bg: 'rgba(255,82,82,0.22)', border: '#ff5252', keys: ['a', 'arrowleft'] },
    snare: { name: 'CAIXA', icon: '👏', color: '#ffd600', bg: 'rgba(255,214,0,0.22)', border: '#ffd600', keys: ['s', ' ', 'enter', 'arrowdown'] },
    hihat: { name: 'PRATO', icon: '🔔', color: '#00e5ff', bg: 'rgba(0,229,255,0.22)', border: '#00e5ff', keys: ['d', 'arrowright'] },
    tom:   { name: 'CONGA', icon: '🪘', color: '#76ff03', bg: 'rgba(118,255,3,0.22)', border: '#76ff03', keys: ['w', 'arrowup'] }
  };

  // Estado da partida
  let currentRound = 1;
  let totalRounds = 7;
  let currentGenreName = '';
  let currentBpm = 110;
  let currentBeats = [];
  let currentInstruments = [];
  let uniqueInstruments = ['kick', 'snare'];
  let currentBeatCount = 4;
  let myTaps = []; // Array de { time, inst }
  let tapStartTime = null;
  let hasSubmitted = false;
  let autoSubmitTimeout = null;
  let nextRoundInterval = null;
  let activeAudioPlaybackTimeouts = [];

  // ==================== ÁUDIO REPLAY HELPER ====================
  function stopAllReplays() {
    activeAudioPlaybackTimeouts.forEach(t => clearTimeout(t));
    activeAudioPlaybackTimeouts = [];
  }

  function playTapSequence(taps, onFinish) {
    stopAllReplays();
    if (!taps || taps.length === 0) return;

    taps.forEach((tap, idx) => {
      const timeOffset = (typeof tap === 'number') ? tap : (tap.time || 0);
      const inst = (typeof tap === 'object' && tap.inst) ? tap.inst : 'kick';

      const t = setTimeout(() => {
        try {
          if (AudioEngine && AudioEngine.drumPlay) {
            AudioEngine.drumPlay(inst);
          } else if (AudioEngine && AudioEngine.drumBeat) {
            AudioEngine.drumBeat(inst);
          }
        } catch (e) {}

        if (idx === taps.length - 1 && typeof onFinish === 'function') {
          setTimeout(onFinish, 250);
        }
      }, timeOffset);

      activeAudioPlaybackTimeouts.push(t);
    });
  }

  // ==================== FASE 1: ESCUTA DA RODADA (1X SÓ!) ====================
  socket.on('game:ritmo:round-start', (data) => {
    stopAllReplays();
    if (nextRoundInterval) clearInterval(nextRoundInterval);

    currentRound = data.round || 1;
    totalRounds = data.totalRounds || 5;
    currentGenreName = data.genreName || 'Ritmo Misterioso';
    currentBpm = data.bpm || 110;
    currentBeats = data.beats || [0, 500, 1000, 1500];
    currentInstruments = data.instruments || currentBeats.map(() => 'kick');
    uniqueInstruments = data.uniqueInstruments || [...new Set(currentInstruments)];
    currentBeatCount = data.beatCount || currentBeats.length;
    myTaps = [];
    tapStartTime = null;
    hasSubmitted = false;

    if (DOM.resultsOverlay) DOM.resultsOverlay.classList.add('hidden');

    DOM.gameArea.innerHTML = `
      <div class="ritmo-container" style="display:flex; flex-direction:column; align-items:center; gap:14px; width:100%; max-width:740px; margin:0 auto; padding:4px 0; user-select:none;">
        
        <!-- HEADER DA RODADA -->
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:0 8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-family:var(--font-display); font-size:1.15rem; font-weight:900; background:linear-gradient(135deg,#ff9100,#ff1744); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">
              🥁 RITMO
            </span>
            <span style="font-size:0.78rem; background:rgba(255,145,0,0.18); color:#ff9100; padding:3px 10px; border-radius:var(--radius-full); font-weight:800; border:1px solid rgba(255,145,0,0.3);">
              Rodada ${currentRound} de ${totalRounds}
            </span>
            <span style="font-size:0.78rem; background:rgba(0,229,255,0.18); color:#00e5ff; padding:3px 10px; border-radius:var(--radius-full); font-weight:800; border:1px solid rgba(0,229,255,0.3);">
              ${currentBeatCount} Batidas
            </span>
          </div>
          <span style="font-size:0.78rem; background:var(--bg-glass); color:var(--text-secondary); padding:3px 12px; border-radius:var(--radius-full); font-weight:700; border:1px solid rgba(255,255,255,0.1);">
            ${GameHub.escapeHtml(currentGenreName)} • ${currentBpm} BPM
          </span>
        </div>

        <!-- CARD PRINCIPAL: FASE DE ESCUTA -->
        <div class="card" style="width:100%; display:flex; flex-direction:column; align-items:center; gap:16px; padding:28px 18px; text-align:center; position:relative; overflow:hidden; border:2px solid rgba(255,145,0,0.35); box-shadow:0 8px 32px rgba(0,0,0,0.5);">
          
          <div style="font-size:0.85rem; font-weight:900; letter-spacing:0.08em; color:#ff9100; text-transform:uppercase;">
            🔇 Silêncio Total • Ouça uma única vez!
          </div>

          <!-- CAIXA DE SOM CENTRAL DINÂMICA -->
          <div id="ritmo-speaker" style="width:125px; height:125px; border-radius:50%; background:radial-gradient(circle, #ff9100 0%, #ff1744 60%, #150006 100%); display:flex; align-items:center; justify-content:center; font-size:3.5rem; box-shadow:0 0 35px rgba(255,145,0,0.35); transition:transform 0.08s ease-out, box-shadow 0.08s ease-out;">
            🔊
          </div>

          <div>
            <h2 style="font-family:var(--font-display); font-size:1.45rem; font-weight:900; margin-bottom:4px;">
              Preste atenção no tempo e nos instrumentos!
            </h2>
            <p style="color:var(--text-muted); font-size:0.88rem; max-width:480px; margin:0 auto;">
              Sequência de <strong>${currentBeatCount} batidas</strong> com instrumentos variados.
            </p>
          </div>

          <!-- SLOTS DE BATIDAS DURANTE A ESCUTA (RESPONSIVO PARA ATÉ 14 BATIDAS) -->
          <div id="ritmo-listen-dots" style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:center; max-width:620px; margin-top:2px;">
            ${currentBeats.map((_, i) => {
              const inst = currentInstruments[i] || 'kick';
              const meta = INSTRUMENTS[inst] || INSTRUMENTS.kick;
              return `
                <div id="listen-dot-${i}" style="width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,0.08); border:2px solid rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center; font-size:0.75rem; transition:all 0.14s cubic-bezier(0.34,1.56,0.64,1);" title="${meta.name}">
                  ${meta.icon}
                </div>
              `;
            }).join('')}
          </div>

          <div style="font-size:0.78rem; color:var(--text-muted); opacity:0.85;">
            Assim que a batida acabar, os pads serão liberados na hora!
          </div>

        </div>

      </div>
    `;

    const speaker = document.getElementById('ritmo-speaker');

    // Reprodução da sequência no tempo exato
    currentBeats.forEach((time, i) => {
      const inst = currentInstruments[i] || 'kick';
      const meta = INSTRUMENTS[inst] || INSTRUMENTS.kick;

      setTimeout(() => {
        try {
          if (AudioEngine && AudioEngine.drumPlay) {
            AudioEngine.drumPlay(inst);
          } else if (AudioEngine && AudioEngine.drumBeat) {
            AudioEngine.drumBeat(inst);
          }
        } catch (e) {}

        // Pulso no alto-falante na cor do instrumento
        if (speaker) {
          speaker.textContent = meta.icon;
          speaker.style.transform = 'scale(1.26)';
          speaker.style.boxShadow = `0 0 60px ${meta.color}, 0 0 20px #ffffff`;
          setTimeout(() => {
            if (speaker) {
              speaker.style.transform = 'scale(1.0)';
              speaker.style.boxShadow = '0 0 35px rgba(255,145,0,0.35)';
            }
          }, 110);
        }

        // Iluminar slot correspondente
        const dot = document.getElementById(`listen-dot-${i}`);
        if (dot) {
          dot.style.background = meta.color;
          dot.style.borderColor = '#ffffff';
          dot.style.boxShadow = `0 0 16px ${meta.color}`;
          dot.style.transform = 'scale(1.35)';
          setTimeout(() => {
            if (dot) dot.style.transform = 'scale(1.0)';
          }, 140);
        }
      }, time);
    });
  });

  // ==================== FASE 2: REPRODUÇÃO MULTI-PADS ====================
  socket.on('game:ritmo:tap-phase', (data) => {
    myTaps = [];
    tapStartTime = null;
    hasSubmitted = false;
    currentBeatCount = data.beatCount || currentBeatCount;
    uniqueInstruments = data.uniqueInstruments || uniqueInstruments;

    try {
      AudioEngine.notification();
    } catch (e) {}

    // Ordenar instrumentos para os pads (Kick, Snare, HiHat, Tom)
    const instOrder = ['kick', 'snare', 'hihat', 'tom'];
    const activeInsts = instOrder.filter(k => uniqueInstruments.includes(k));
    if (activeInsts.length === 0) activeInsts.push('kick', 'snare');

    DOM.gameArea.innerHTML = `
      <div class="ritmo-container" style="display:flex; flex-direction:column; align-items:center; gap:14px; width:100%; max-width:740px; margin:0 auto; padding:4px 0; user-select:none;">
        
        <!-- HEADER DA RODADA -->
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:0 8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-family:var(--font-display); font-size:1.15rem; font-weight:900; background:linear-gradient(135deg,#00e5ff,#7c6aff); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">
              🥁 RITMO
            </span>
            <span style="font-size:0.78rem; background:rgba(0,229,255,0.18); color:#00e5ff; padding:3px 10px; border-radius:var(--radius-full); font-weight:800; border:1px solid rgba(0,229,255,0.3);">
              Rodada ${currentRound} de ${totalRounds}
            </span>
            <span style="font-size:0.78rem; background:rgba(255,214,0,0.18); color:#ffd600; padding:3px 10px; border-radius:var(--radius-full); font-weight:800; border:1px solid rgba(255,214,0,0.3);">
              Meta: ${currentBeatCount} batidas
            </span>
          </div>
          <span style="font-size:0.78rem; background:var(--bg-glass); color:var(--text-secondary); padding:3px 12px; border-radius:var(--radius-full); font-weight:700; border:1px solid rgba(255,255,255,0.1);">
            ${GameHub.escapeHtml(currentGenreName)}
          </span>
        </div>

        <!-- ÁREA INTERATIVA MULTI-PADS -->
        <div class="card" style="width:100%; display:flex; flex-direction:column; align-items:center; gap:16px; padding:22px 16px; text-align:center; border:2px solid #00e5ff; box-shadow:0 8px 36px rgba(0,229,255,0.25); position:relative;">
          
          <div style="font-size:0.88rem; font-weight:900; letter-spacing:0.06em; color:#00e5ff; text-transform:uppercase;">
            ⚡ SUA VEZ! REPRODUZA NO MESMO TEMPO E INSTRUMENTOS!
          </div>

          <!-- SLOTS DE PROGRESSO DAS BATIDAS -->
          <div id="ritmo-tap-slots" style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:center; max-width:620px;">
            ${Array.from({ length: currentBeatCount }).map((_, i) => `
              <div id="tap-slot-${i}" style="width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,0.08); border:2px solid rgba(0,229,255,0.3); display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:800; color:var(--text-muted); transition:all 0.12s cubic-bezier(0.34,1.56,0.64,1);">
                ${i + 1}
              </div>
            `).join('')}
          </div>

          <!-- PADS DE BATERIA ERGONÔMICOS (GRID ADAPTÁVEL) -->
          <div id="ritmo-pads-grid" style="display:grid; grid-template-columns:repeat(${Math.min(activeInsts.length, 3)}, 1fr); gap:12px; width:100%; max-width:540px; margin:4px 0;">
            ${activeInsts.map(instKey => {
              const meta = INSTRUMENTS[instKey];
              return `
                <button class="ritmo-pad-btn" data-inst="${instKey}" style="height:120px; border-radius:var(--radius-md); background:${meta.bg}; border:2.5px solid ${meta.border}; box-shadow:0 6px 20px ${meta.color}33, inset 0 2px 12px rgba(255,255,255,0.1); cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; transition:transform 0.06s ease-out, box-shadow 0.06s ease-out; outline:none;">
                  <div style="font-size:2.4rem; filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4));">${meta.icon}</div>
                  <div style="font-family:var(--font-display); font-size:1.05rem; font-weight:900; color:${meta.color};">
                    ${meta.name}
                  </div>
                  <div style="font-size:0.68rem; color:var(--text-muted); font-weight:700;">
                    ${meta.keys[0].toUpperCase()}
                  </div>
                </button>
              `;
            }).join('')}
          </div>

          <!-- FEEDBACK EM TEMPO REAL -->
          <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
            <div id="ritmo-tap-feedback" style="font-family:var(--font-display); font-size:1.1rem; font-weight:800; color:#00e5ff; min-height:24px;">
              Dê a 1ª batida para iniciar a contagem...
            </div>
            <div id="ritmo-waiting-status" style="font-size:0.78rem; color:var(--text-muted); min-height:18px;">
              O envio é automático após as ${currentBeatCount} batidas!
            </div>
          </div>

        </div>

      </div>
    `;

    const feedback = document.getElementById('ritmo-tap-feedback');
    const waitingStatus = document.getElementById('ritmo-waiting-status');

    function sendTapsSubmission() {
      if (hasSubmitted) return;
      hasSubmitted = true;
      if (autoSubmitTimeout) clearTimeout(autoSubmitTimeout);

      const padButtons = document.querySelectorAll('.ritmo-pad-btn');
      padButtons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'default';
        btn.style.boxShadow = 'none';
      });

      if (myTaps.length === 0) {
        myTaps = [{ time: 0, inst: 'kick' }];
      }

      // Normaliza para que a 1ª batida seja o timestamp 0
      const baseTime = myTaps[0].time;
      const normalized = myTaps.map(t => ({
        time: t.time - baseTime,
        inst: t.inst
      }));

      socket.emit('game:action', {
        action: 'submit-taps',
        taps: normalized
      });

      if (feedback) {
        feedback.innerHTML = '✅ <span style="color:#00e676">RITMO ENVIADO!</span>';
      }
      if (waitingStatus) {
        waitingStatus.innerHTML = GameHub.showWaiting('Calculando fidelidade dos amigos...');
      }
    }

    function registerTap(instKey = 'kick', element = null) {
      if (hasSubmitted) return;

      const now = performance.now();
      if (!tapStartTime) {
        tapStartTime = now;
      }
      const timeOffset = Math.round(now - tapStartTime);
      myTaps.push({ time: timeOffset, inst: instKey });

      const meta = INSTRUMENTS[instKey] || INSTRUMENTS.kick;

      // Áudio imediato do instrumento correspondente
      try {
        if (AudioEngine && AudioEngine.drumPlay) {
          AudioEngine.drumPlay(instKey);
        } else if (AudioEngine && AudioEngine.drumBeat) {
          AudioEngine.drumBeat(instKey);
        }
      } catch (e) {}

      // Feedback de animação no pad tocado
      const targetPad = element || document.querySelector(`.ritmo-pad-btn[data-inst="${instKey}"]`);
      if (targetPad) {
        targetPad.style.transform = 'scale(0.92)';
        targetPad.style.boxShadow = `0 0 35px ${meta.color}, inset 0 0 20px #ffffff`;
        setTimeout(() => {
          if (targetPad && !hasSubmitted) {
            targetPad.style.transform = 'scale(1.0)';
            targetPad.style.boxShadow = `0 6px 20px ${meta.color}33`;
          }
        }, 75);
      }

      // Acender slot correspondente com o ícone e cor do instrumento
      const tapIndex = myTaps.length - 1;
      const slot = document.getElementById(`tap-slot-${tapIndex}`);
      if (slot) {
        slot.textContent = meta.icon;
        slot.style.background = meta.color;
        slot.style.borderColor = '#ffffff';
        slot.style.boxShadow = `0 0 14px ${meta.color}`;
        slot.style.transform = 'scale(1.35)';
        setTimeout(() => {
          if (slot) slot.style.transform = 'scale(1.0)';
        }, 110);
      }

      if (feedback) {
        feedback.textContent = `Batida ${myTaps.length} de ${currentBeatCount} [${meta.name}]!`;
      }

      // Auto-envio inteligente ao bater a quantidade esperada
      if (myTaps.length >= currentBeatCount) {
        if (autoSubmitTimeout) clearTimeout(autoSubmitTimeout);
        autoSubmitTimeout = setTimeout(() => {
          sendTapsSubmission();
        }, 420);
      } else {
        // Tolerância de 3.2s de silêncio para auto-envio se parar no meio
        if (autoSubmitTimeout) clearTimeout(autoSubmitTimeout);
        autoSubmitTimeout = setTimeout(() => {
          if (!hasSubmitted && myTaps.length > 0) {
            sendTapsSubmission();
          }
        }, 3200);
      }
    }

    // Eventos de clique e touch em cada pad
    const padButtons = document.querySelectorAll('.ritmo-pad-btn');
    padButtons.forEach(btn => {
      const inst = btn.getAttribute('data-inst') || 'kick';
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        registerTap(inst, btn);
      });
      btn.addEventListener('touchstart', (e) => {
        if (e.cancelable) e.preventDefault();
        registerTap(inst, btn);
      }, { passive: false });
    });

    // Mapeamento de teclas do teclado
    const keyHandler = (e) => {
      const k = e.key.toLowerCase();
      for (const instKey of activeInsts) {
        const meta = INSTRUMENTS[instKey];
        if (meta && meta.keys.includes(k)) {
          e.preventDefault();
          registerTap(instKey);
          return;
        }
      }
    };
    document.addEventListener('keydown', keyHandler);

    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      if (autoSubmitTimeout) clearTimeout(autoSubmitTimeout);
    };

    socket.once('game:ritmo:round-results', cleanup);
    socket.once('game:ended', cleanup);
  });

  socket.on('game:ritmo:submitted', (data) => {
    const status = document.getElementById('ritmo-waiting-status');
    if (status && hasSubmitted) {
      status.innerHTML = `<span style="color:#00e5ff; font-weight:800;">${data.count} de ${data.total}</span> amigos já completaram...`;
    }
  });

  // ==================== FASE 3: RESULTADOS DA RODADA ====================
  socket.on('game:ritmo:round-results', (data) => {
    stopAllReplays();
    if (nextRoundInterval) clearInterval(nextRoundInterval);

    const results = data.results || [];
    const originalBeats = data.originalBeats || [];
    const originalInsts = data.originalInstruments || originalBeats.map(() => 'kick');
    const maxTime = Math.max(...originalBeats, 1000);
    const isGameOver = !!data.isGameOver;

    try {
      AudioEngine.success();
    } catch (e) {}

    const playerColors = ['#00e5ff', '#ff6ab0', '#ffd700', '#00e676', '#ff5252', '#d500f9', '#ffa726', '#76ff03'];

    // Objeto do original formatado para replay
    const originalSequence = originalBeats.map((t, idx) => ({
      time: t,
      inst: originalInsts[idx] || 'kick'
    }));

    DOM.gameArea.innerHTML = `
      <div class="ritmo-container" style="display:flex; flex-direction:column; align-items:center; gap:16px; width:100%; max-width:760px; margin:0 auto; padding:4px 0; user-select:none;">
        
        <!-- HEADER DO PLACAR -->
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:0 8px;">
          <div>
            <span style="font-family:var(--font-display); font-size:1.25rem; font-weight:900; background:linear-gradient(135deg,#ffd700,#ff9100); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">
              🏆 Resultados da Rodada ${data.round} de ${data.totalRounds}
            </span>
          </div>
          <span style="font-size:0.78rem; background:rgba(255,215,0,0.18); color:#ffd700; padding:3px 12px; border-radius:var(--radius-full); font-weight:800; border:1px solid rgba(255,215,0,0.3);">
            ${GameHub.escapeHtml(data.genreName)}
          </span>
        </div>

        <!-- RÉGUA DA LINHA DO TEMPO COMPARATIVA -->
        <div class="card" style="width:100%; padding:18px; text-align:left; border:1px solid rgba(255,255,255,0.12);">
          
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <span style="font-size:0.8rem; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">
              Linha do Tempo: Original vs Amigos
            </span>
            <button id="btn-play-original" class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:3px 10px;">
              🔊 Ouvir Original
            </button>
          </div>

          <!-- PISTA ORIGINAL (GABARITO) -->
          <div style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; font-size:0.74rem; color:#ffd700; font-weight:800; margin-bottom:4px;">
              <span>⭐ BATIDA ORIGINAL (${originalBeats.length} batidas)</span>
              <span>100% GABARITO</span>
            </div>
            <div style="position:relative; height:24px; background:rgba(255,215,0,0.1); border-radius:var(--radius-full); border:1px solid rgba(255,215,0,0.35);">
              ${originalBeats.map((t, idx) => {
                const inst = originalInsts[idx] || 'kick';
                const meta = INSTRUMENTS[inst] || INSTRUMENTS.kick;
                return `
                  <div style="position:absolute; left:${Math.min(96, (t / maxTime) * 94)}%; top:1px; width:20px; height:20px; border-radius:50%; background:${meta.color}; border:1.5px solid #ffffff; display:flex; align-items:center; justify-content:center; font-size:0.65rem; box-shadow:0 0 8px ${meta.color};" title="${meta.name} (${t}ms)">
                    ${meta.icon}
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- PISTA DE CADA JOGADOR -->
          <div style="display:flex; flex-direction:column; gap:10px; border-top:1px dashed rgba(255,255,255,0.1); padding-top:12px;">
            ${results.map((r, i) => {
              const col = playerColors[i % playerColors.length];
              const pTaps = r.taps || [{ time: 0, inst: 'kick' }];
              return `
                <div>
                  <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; margin-bottom:3px;">
                    <span style="color:${col}; font-weight:800;">
                      #${r.rank} ${GameHub.escapeHtml(r.name)} (${r.accuracy}%)
                    </span>
                    <button class="btn btn-ghost btn-sm btn-replay-player" data-player-index="${i}" style="font-size:0.7rem; padding:1px 8px; color:${col}; border:1px solid ${col}44;">
                      🔊 Ouvir Tentativa
                    </button>
                  </div>
                  <div style="position:relative; height:20px; background:rgba(255,255,255,0.04); border-radius:var(--radius-full); border:1px solid ${col}33;">
                    ${pTaps.map(t => {
                      const time = (typeof t === 'number') ? t : (t.time || 0);
                      const inst = (typeof t === 'object' && t.inst) ? t.inst : 'kick';
                      const meta = INSTRUMENTS[inst] || INSTRUMENTS.kick;
                      return `
                        <div style="position:absolute; left:${Math.min(96, (time / maxTime) * 94)}%; top:1px; width:16px; height:16px; border-radius:50%; background:${meta.color}; border:1px solid #ffffff; display:flex; align-items:center; justify-content:center; font-size:0.55rem; box-shadow:0 0 6px ${meta.color};" title="${meta.name} (${time}ms)">
                          ${meta.icon}
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>

        </div>

        <!-- LISTA DE CLASSIFICAÇÃO DA RODADA -->
        <div style="width:100%; display:flex; flex-direction:column; gap:8px;">
          ${results.map((r, i) => {
            const col = playerColors[i % playerColors.length];
            const isWinner = (i === 0);
            return `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:var(--bg-glass); border-radius:var(--radius-md); border:1.5px solid ${isWinner ? '#ffd700' : 'rgba(255,255,255,0.08)'}; box-shadow:${isWinner ? '0 0 20px rgba(255,215,0,0.2)' : 'none'};">
                <div style="display:flex; align-items:center; gap:12px;">
                  <span style="font-size:1.25rem; font-weight:900; font-family:var(--font-display); color:${isWinner ? '#ffd700' : 'var(--text-muted)'};">
                    ${r.rank}º
                  </span>
                  <div>
                    <div style="font-weight:800; font-size:0.95rem; color:#ffffff;">
                      ${GameHub.escapeHtml(r.name)}
                    </div>
                    <div style="font-size:0.75rem; color:${col}; font-weight:700;">
                      ${r.title} • Desvio: ±${r.avgDiff}ms
                    </div>
                  </div>
                </div>

                <div style="text-align:right;">
                  <div style="font-family:var(--font-display); font-size:1.1rem; font-weight:900; color:#00e676;">
                    +${r.pointsEarned} pts
                  </div>
                  <div style="font-size:0.72rem; color:var(--text-muted);">
                    Precisão: ${r.accuracy}%
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- PRÓXIMA RODADA OU FIM DE JOGO -->
        <div style="width:100%; display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:4px;">
          ${!isGameOver ? `
            <div id="ritmo-next-counter" style="font-size:0.85rem; color:var(--text-muted); font-weight:700;">
              Próxima rodada iniciando em 8s...
            </div>
            <button id="btn-force-next-round" class="btn btn-primary host-only" style="padding:10px 24px; font-weight:800;">
              Próxima Rodada (${data.round + 1}/${data.totalRounds}) ➔
            </button>
          ` : `
            <div style="font-size:1.05rem; font-weight:900; color:#ffd700; margin-top:8px;">
              🏁 DISPUTA CONCLUÍDA! COROANDO O GRANDE MESTRE DO RITMO...
            </div>
          `}
        </div>

      </div>
    `;

    // Botão de ouvir o gabarito original
    const btnPlayOriginal = document.getElementById('btn-play-original');
    if (btnPlayOriginal) {
      btnPlayOriginal.addEventListener('click', () => {
        btnPlayOriginal.textContent = '🔊 Tocando...';
        playTapSequence(originalSequence, () => {
          btnPlayOriginal.textContent = '🔊 Ouvir Original';
        });
      });
    }

    // Botão de ouvir tentativa de cada amigo
    const replayButtons = document.querySelectorAll('.btn-replay-player');
    replayButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-player-index'), 10);
        const playerResult = results[idx];
        if (playerResult && playerResult.taps) {
          const originalText = btn.textContent;
          btn.textContent = '🔊 Tocando...';
          playTapSequence(playerResult.taps, () => {
            btn.textContent = originalText;
          });
        }
      });
    });

    const btnNext = document.getElementById('btn-force-next-round');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        socket.emit('game:action', { action: 'next-round' });
      });
    }

    if (!isGameOver) {
      let secondsLeft = 8;
      const counterEl = document.getElementById('ritmo-next-counter');
      nextRoundInterval = setInterval(() => {
        secondsLeft--;
        if (counterEl) {
          counterEl.textContent = `Próxima rodada iniciando em ${secondsLeft}s...`;
        }
        if (secondsLeft <= 0) {
          clearInterval(nextRoundInterval);
        }
      }, 1000);
    }
  });

  // ==================== FASE 4: FIM DE JOGO / PÓDIO FINAL ====================
  socket.on('game:ritmo:gameover', (data) => {
    stopAllReplays();
    if (nextRoundInterval) clearInterval(nextRoundInterval);

    try {
      AudioEngine.gameEnd();
    } catch (e) {}

    const rankings = data.rankings || [];
    const winner = rankings[0] || { name: 'Campeão', score: 0 };

    DOM.resultsOverlay.classList.remove('hidden');
    DOM.resultsTitle.textContent = '🥁 RITMO — O Mestre do Ritmo!';

    DOM.resultsContent.innerHTML = `
      <div style="text-align:center; padding:var(--gap-md) 0;">
        <div style="font-size:4.5rem; margin-bottom:var(--gap-sm); animation:emojiPop 0.5s cubic-bezier(0.34,1.56,0.64,1);">
          👑
        </div>
        <h2 style="font-family:var(--font-display); font-size:1.8rem; font-weight:900; background:linear-gradient(135deg,#ffd700,#ff9100); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:6px;">
          ${GameHub.escapeHtml(winner.name)}
        </h2>
        <p style="color:var(--text-secondary); font-size:0.95rem; margin-bottom:var(--gap-lg);">
          Sobreviveu às ${data.totalRounds || 7} rodadas e dominou todas as viradas rítmicas da sala!
        </p>

        <!-- PÓDIO FINAL DOS JOGADORES -->
        <div style="display:flex; flex-direction:column; gap:8px; margin:var(--gap-md) 0; text-align:left;">
          ${rankings.map((p, i) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:var(--bg-glass); border-radius:var(--radius-md); border:1px solid ${i === 0 ? 'rgba(255,215,0,0.5)' : 'rgba(255,255,255,0.08)'};">
              <div style="display:flex; align-items:center; gap:12px;">
                <span style="font-family:var(--font-display); font-size:1.3rem; font-weight:900; color:${i === 0 ? '#ffd700' : (i === 1 ? '#c0c0c0' : (i === 2 ? '#cd7f32' : 'var(--text-muted)'))};">
                  ${i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${i + 1}º`))}
                </span>
                <span style="font-weight:800; font-size:0.95rem; color:#ffffff;">
                  ${GameHub.escapeHtml(p.name)}
                </span>
              </div>
              <span style="font-family:var(--font-display); font-size:1.1rem; font-weight:900; color:var(--accent-primary);">
                ${p.score} pts
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });
})();
