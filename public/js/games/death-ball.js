/**
 * Death Ball — Cyber Colosseum Gladiator Survival (Ultra High-Performance Constant 60FPS Edition)
 * Constant-rate physics, velocity blending, batched neon trail, zero-DOM-reflow,
 * batched particle rendering, zero-font-parsing floating texts, and built-in diagnostic HUD.
 */
(() => {
  const { socket, DOM } = GameHub;

  // ==================== CONFIG & PALETTES ====================
  const ARENA_RADIUS_PCT = 45;
  const DEFLECT_ZONE = 22;
  const PERFECT_ZONE = 12;

  // Zero-Allocation Pool Sizes (aumentados para Death Ball 2.0)
  const PARTICLE_POOL_SIZE = 120;
  const PULSE_POOL_SIZE = 16;
  const GHOST_POOL_SIZE = 14;
  const TEXT_POOL_SIZE = 8;
  const TRAIL_BUFFER_SIZE = 24;

  // Static line dash arrays
  const STATIC_DASH_EMPTY = [];
  const STATIC_DASH_7 = [7, 7];
  const STATIC_DASH_5 = [5, 5];
  const STATIC_DASH_8 = [8, 8];

  // Cached font constants (Fixed once, NEVER dynamically parsed at runtime)
  const FONT_GLADIATOR_NAME = '700 11px "Space Grotesk", sans-serif';
  const FONT_GLADIATOR_INITIAL = '900 11px "Space Grotesk", sans-serif';
  const FONT_TARGET_ALERT = '800 10px "Space Grotesk", sans-serif';
  const FONT_PARRY_PROMPT = '900 11px "Space Grotesk", sans-serif';
  const FONT_HUD_TEXT = '800 12px "Space Grotesk", sans-serif';
  const FONT_HUD_SPEED = '900 13px "Space Grotesk", sans-serif';
  const FONT_SKULL = '18px sans-serif';
  const FONT_SKULL_NAME = '600 11px sans-serif';
  const FONT_FLOATING_TEXT = '900 16px "Space Grotesk", sans-serif';

  const PALETTE = {
    bg: '#040412',
    bgGradCenter: '#0b0b26',
    grid: 'rgba(124, 106, 255, 0.06)',
    arenaRing: 'rgba(124, 106, 255, 0.22)',
    arenaGlow: '#7c6aff',
    duelGlow: '#ff1744',
    ballSpeeds: [
      { max: 2.5, core: '#00e5ff', glow: 'rgba(0, 229, 255, 0.35)', name: 'NORMAL' },
      { max: 4.5, core: '#d500f9', glow: 'rgba(213, 0, 249, 0.35)', name: 'SUPER' },
      { max: 7.0, core: '#ff9100', glow: 'rgba(255, 145, 0, 0.35)', name: 'HIPER' },
      { max: 99,  core: '#ff1744', glow: 'rgba(255, 23, 68, 0.35)', name: 'LETAL' }
    ],
    players: ['#7c6aff', '#ff6ab0', '#00e5ff', '#ffa726', '#00e676', '#ff5252', '#ffd600', '#76ff03'],
    targetRing: '#ff1744',
    parryRing: '#00e676',
    perfectRing: '#ffd700'
  };

  // ==================== STATE ====================
  let canvas = null;
  let ctx = null;
  let animFrame = null;
  let offscreenBgCanvas = null;
  let offscreenBgCtx = null;
  let offscreenBgNeedsRedraw = true;

  // Ball positions & network reconciliation
  // Pure velocity-blended continuous motion: NEVER snaps or desyncs at high speed
  const ball = { x: 50, y: 50, vx: 0, vy: 0, curve: 0 };
  let serverTargetX = 50;
  let serverTargetY = 50;
  let serverTargetVx = 0;
  let serverTargetVy = 0;

  let localPlayers = {};
  let cachedPlayerList = [];
  let currentTargetId = null;
  let isSoloMode = false;
  let isDuelMode = false;
  let myId = null;
  let W = 0, H = 0;
  let dpr = 1;

  // Local user movement, aim & mechanics
  let myAimDir = { x: 0, y: -1 };
  const keysDown = new Set();
  let touchMoveDir = null;
  let parryCooldownUntil = 0;
  let hasDash = true;
  let lastMoveEmitTime = 0;
  let keyHandlerBound = null;

  // Contagem regressiva 3, 2, 1 e pontuação exclusiva da partida
  let activeCountdown = 3;
  let countdownActive = false;
  let countdownEndingText = null;
  let myMatchScore = 0;

  const slashAnim = { active: false, progress: 0, x: 50, y: 50, color: '#00e5ff' };

  // ==================== ZERO-ALLOCATION POOLS ====================
  // 1. Trail ring buffer
  const trailBuffer = [];
  for (let i = 0; i < TRAIL_BUFFER_SIZE; i++) {
    trailBuffer.push({ x: 50, y: 50 });
  }
  let trailHead = 0;
  let trailCount = 0;

  // 2. Particle pool
  const particlePool = [];
  for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
    particlePool.push({
      active: false,
      x: 0, y: 0,
      vx: 0, vy: 0,
      size: 2,
      life: 0,
      maxLife: 20,
      color: '#ffffff',
      gravity: 0,
      type: 'circle',
      rotation: 0,
      rotSpeed: 0
    });
  }

  // 3. Pulse ring pool
  const pulsePool = [];
  for (let i = 0; i < PULSE_POOL_SIZE; i++) {
    pulsePool.push({
      active: false,
      x: 0, y: 0,
      r: 8,
      maxRadius: 55,
      alpha: 1,
      color: '#00e5ff'
    });
  }

  // 4. Ghost afterimages pool
  const ghostPool = [];
  for (let i = 0; i < GHOST_POOL_SIZE; i++) {
    ghostPool.push({
      active: false,
      x: 0, y: 0,
      color: '#00e5ff',
      alpha: 0.6
    });
  }

  // 5. Floating texts pool
  const textPool = [];
  for (let i = 0; i < TEXT_POOL_SIZE; i++) {
    textPool.push({
      active: false,
      x: 0, y: 0,
      text: '',
      color: '#ffffff',
      life: 25,
      maxLife: 25,
      vy: -1.7
    });
  }

  function resetAllPools() {
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) particlePool[i].active = false;
    for (let i = 0; i < PULSE_POOL_SIZE; i++) pulsePool[i].active = false;
    for (let i = 0; i < GHOST_POOL_SIZE; i++) ghostPool[i].active = false;
    for (let i = 0; i < TEXT_POOL_SIZE; i++) textPool[i].active = false;
    trailCount = 0;
    trailHead = 0;
  }

  // Screen VFX State
  const shake = { x: 0, y: 0, intensity: 0, decay: 0.85 };
  const flash = { alpha: 0, color: '#fff' };
  let gameSpeed = 1.7;
  let hitCount = 0;
  let comboCount = 0;

  // Cached DOM elements
  let domCache = {
    hitsBadge: null,
    comboBadge: null,
    modeBadge: null,
    statusText: null,
    dashBtn: null,
    hitBtn: null
  };

  // Audio rate-limiting
  const lastAudioTimes = {};

  // Timing
  let lastFrameTime = 0;
  let deltaTime = 0;

  // ==================== DIAGNOSTIC / PERF MONITOR ====================
  const perfMonitor = {
    enabled: false,
    frameCount: 0,
    fps: 60,
    avgFps: 60,
    frameTime: 16.6,
    p95: 16.6,
    p99: 16.6,
    stutterCount: 0,
    history: new Float32Array(120),
    historyIdx: 0,
    historyCount: 0,
    sortedHistory: new Float32Array(120),
    lastStatUpdate: 0,

    record(now, dtMs) {
      // Discard background tab / debugger pauses (> 80ms) from active rolling calculation
      const effectiveMs = (dtMs > 0 && dtMs < 80) ? dtMs : 16.67;

      this.frameCount++;
      this.frameTime = effectiveMs;
      this.history[this.historyIdx] = effectiveMs;
      this.historyIdx = (this.historyIdx + 1) % 120;
      if (this.historyCount < 120) this.historyCount++;

      if (dtMs > 24 && dtMs < 80) {
        this.stutterCount++;
      }

      if (now - this.lastStatUpdate >= 200) {
        this.lastStatUpdate = now;
        this.fps = effectiveMs > 0 ? Math.min(144, 1000 / effectiveMs) : 60;

        let sum = 0;
        for (let i = 0; i < this.historyCount; i++) {
          this.sortedHistory[i] = this.history[i];
          sum += this.history[i];
        }
        this.avgFps = this.historyCount > 0 ? (1000 / (sum / this.historyCount)) : 60;

        const slice = this.sortedHistory.subarray(0, this.historyCount);
        slice.sort();
        const p95Idx = Math.floor(this.historyCount * 0.95);
        const p99Idx = Math.floor(this.historyCount * 0.99);
        this.p95 = slice[p95Idx] || effectiveMs;
        this.p99 = slice[p99Idx] || effectiveMs;
      }
    },

    draw(targetCtx) {
      if (!this.enabled || !targetCtx) return;
      const boxW = 215;
      const boxH = 146;
      const x = 12;
      const y = 46;

      targetCtx.save();
      targetCtx.fillStyle = 'rgba(4, 4, 18, 0.92)';
      targetCtx.strokeStyle = this.fps >= 55 ? 'rgba(0, 230, 118, 0.7)' : 'rgba(255, 23, 68, 0.7)';
      targetCtx.lineWidth = 1.5;
      targetCtx.beginPath();
      targetCtx.roundRect(x, y, boxW, boxH, 8);
      targetCtx.fill();
      targetCtx.stroke();

      targetCtx.font = '700 11px monospace';
      targetCtx.textAlign = 'left';
      targetCtx.textBaseline = 'top';

      targetCtx.fillStyle = '#00e5ff';
      targetCtx.fillText('⚡ DEATH BALL PERF MONITOR', x + 8, y + 8);

      targetCtx.fillStyle = this.fps >= 55 ? '#00e676' : (this.fps >= 40 ? '#ffd600' : '#ff1744');
      targetCtx.fillText(`FPS: ${this.fps.toFixed(1)} (Méd: ${this.avgFps.toFixed(1)})`, x + 8, y + 25);

      targetCtx.fillStyle = '#ffffff';
      targetCtx.fillText(`Frame Time: ${this.frameTime.toFixed(1)}ms`, x + 8, y + 41);
      targetCtx.fillText(`P95: ${this.p95.toFixed(1)}ms | P99: ${this.p99.toFixed(1)}ms`, x + 8, y + 57);

      targetCtx.fillStyle = this.stutterCount === 0 ? '#00e676' : '#ffa726';
      targetCtx.fillText(`Travamentos (>24ms): ${this.stutterCount}`, x + 8, y + 73);

      let activeParticles = 0;
      for (let i = 0; i < PARTICLE_POOL_SIZE; i++) if (particlePool[i].active) activeParticles++;
      let activePulses = 0;
      for (let i = 0; i < PULSE_POOL_SIZE; i++) if (pulsePool[i].active) activePulses++;
      let activeGhosts = 0;
      for (let i = 0; i < GHOST_POOL_SIZE; i++) if (ghostPool[i].active) activeGhosts++;

      targetCtx.fillStyle = '#b0b0d0';
      targetCtx.fillText(`Velocidade: ${gameSpeed.toFixed(1)}x`, x + 8, y + 89);
      targetCtx.fillText(`Pools: ${activeParticles} pt / ${activePulses} pl / ${activeGhosts} gh`, x + 8, y + 105);

      const mem = (window.performance && performance.memory)
        ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)}MB`
        : 'N/A';
      targetCtx.fillText(`Mem: ${mem} | Loop: 1 rAF (OK)`, x + 8, y + 121);

      targetCtx.restore();
    }
  };

  // ==================== AUDIO HELPERS ====================
  function safeAudio(fnName, ...args) {
    const now = performance.now();
    // High-speed safe rate-limiting to prevent WebAudio audio node piling
    const minInterval = (fnName === 'wallBounce' || fnName === 'clash' || fnName === 'whiff') ? 110 : 55;
    if (lastAudioTimes[fnName] && now - lastAudioTimes[fnName] < minInterval) return;
    lastAudioTimes[fnName] = now;

    try {
      if (typeof AudioEngine !== 'undefined' && typeof AudioEngine[fnName] === 'function') {
        AudioEngine[fnName](...args);
      }
    } catch (e) {}
  }

  // ==================== PLAYER CACHING ====================
  function cachePlayerMeta(p) {
    if (!p) return;
    p._initial = (p.name || '?').charAt(0).toUpperCase();
    p._isMe = (p.id === myId);
    p._label = p._isMe ? `⭐ ${p.name} (VOCÊ)` : (p.name || 'Gladiador');
    p._auraColor = (p.color || '#7c6aff') + (p._isMe ? '35' : '18');
  }

  function rebuildCachedPlayerList() {
    cachedPlayerList = Object.values(localPlayers);
    for (let i = 0; i < cachedPlayerList.length; i++) {
      cachePlayerMeta(cachedPlayerList[i]);
    }
  }

  // ==================== OFFSCREEN ARENA PRE-RENDERING ====================
  function prepareOffscreenArena() {
    if (!offscreenBgCanvas) {
      offscreenBgCanvas = document.createElement('canvas');
      offscreenBgCtx = offscreenBgCanvas.getContext('2d', { alpha: false });
    }
    offscreenBgCanvas.width = Math.round(W * dpr);
    offscreenBgCanvas.height = Math.round(H * dpr);
    offscreenBgCtx.setTransform(1, 0, 0, 1, 0, 0);
    offscreenBgCtx.scale(dpr, dpr);

    const cx = W / 2;
    const cy = H / 2;
    const arenaR = (W * ARENA_RADIUS_PCT) / 100;

    // 1. Fundo radial espacial
    const bgGrad = offscreenBgCtx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.72);
    bgGrad.addColorStop(0, isDuelMode ? '#1e0514' : PALETTE.bgGradCenter);
    bgGrad.addColorStop(0.7, isDuelMode ? '#11030a' : '#07071a');
    bgGrad.addColorStop(1, PALETTE.bg);
    offscreenBgCtx.fillStyle = bgGrad;
    offscreenBgCtx.fillRect(0, 0, W, H);

    // 2. Estrelas estáticas pré-renderizadas
    offscreenBgCtx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    for (let i = 0; i < 50; i++) {
      const sx = ((i * 137.5) % W);
      const sy = ((i * 263.3) % H);
      const sr = (i % 3 === 0) ? 1.5 : 0.9;
      offscreenBgCtx.beginPath();
      offscreenBgCtx.arc(sx, sy, sr, 0, Math.PI * 2);
      offscreenBgCtx.fill();
    }

    // 3. Círculos concêntricos de chão
    const ringColor = isDuelMode ? PALETTE.duelGlow : PALETTE.arenaGlow;
    const concentricRatios = [0.3, 0.6, 0.85, 1.0];
    for (let idx = 0; idx < concentricRatios.length; idx++) {
      const ratio = concentricRatios[idx];
      offscreenBgCtx.beginPath();
      offscreenBgCtx.arc(cx, cy, arenaR * ratio, 0, Math.PI * 2);
      offscreenBgCtx.strokeStyle = idx === 3 ? ringColor : PALETTE.grid;
      offscreenBgCtx.lineWidth = idx === 3 ? (isDuelMode ? 3.5 : 2.5) : 1;
      if (idx !== 3) offscreenBgCtx.setLineDash([4, 6]);
      offscreenBgCtx.stroke();
      offscreenBgCtx.setLineDash(STATIC_DASH_EMPTY);
    }

    // 4. Linhas radiais fixas
    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const a = (i * Math.PI * 2) / spokes;
      offscreenBgCtx.beginPath();
      offscreenBgCtx.moveTo(cx + Math.cos(a) * (arenaR * 0.25), cy + Math.sin(a) * (arenaR * 0.25));
      offscreenBgCtx.lineTo(cx + Math.cos(a) * arenaR, cy + Math.sin(a) * arenaR);
      offscreenBgCtx.strokeStyle = isDuelMode ? 'rgba(255,23,68,0.1)' : PALETTE.grid;
      offscreenBgCtx.lineWidth = 1;
      offscreenBgCtx.stroke();
    }

    // 5. Emblema central de arena
    offscreenBgCtx.beginPath();
    offscreenBgCtx.arc(cx, cy, 26, 0, Math.PI * 2);
    offscreenBgCtx.fillStyle = isDuelMode ? 'rgba(255, 23, 68, 0.18)' : 'rgba(124, 106, 255, 0.08)';
    offscreenBgCtx.fill();
    offscreenBgCtx.strokeStyle = isDuelMode ? 'rgba(255, 23, 68, 0.6)' : 'rgba(124, 106, 255, 0.3)';
    offscreenBgCtx.lineWidth = 2;
    offscreenBgCtx.stroke();

    offscreenBgCtx.font = '20px sans-serif';
    offscreenBgCtx.textAlign = 'center';
    offscreenBgCtx.textBaseline = 'middle';
    offscreenBgCtx.fillText(isDuelMode ? '⚔️' : '💀', cx, cy);

    // 6. 4 Cantos de ricochete
    const corners = [
      { x: (5 / 100) * W,  y: (5 / 100) * H },
      { x: (95 / 100) * W, y: (5 / 100) * H },
      { x: (5 / 100) * W,  y: (95 / 100) * H },
      { x: (95 / 100) * W, y: (95 / 100) * H }
    ];

    const cornerColor = isDuelMode ? '#ff1744' : '#00e5ff';
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      offscreenBgCtx.beginPath();
      offscreenBgCtx.arc(c.x, c.y, 16, 0, Math.PI * 2);
      offscreenBgCtx.fillStyle = 'rgba(124, 106, 255, 0.12)';
      offscreenBgCtx.fill();

      offscreenBgCtx.beginPath();
      offscreenBgCtx.arc(c.x, c.y, 12, 0, Math.PI * 2);
      offscreenBgCtx.fillStyle = '#0f0f2d';
      offscreenBgCtx.fill();
      offscreenBgCtx.strokeStyle = cornerColor;
      offscreenBgCtx.lineWidth = 2.5;
      offscreenBgCtx.stroke();

      offscreenBgCtx.beginPath();
      offscreenBgCtx.arc(c.x, c.y, 3.5, 0, Math.PI * 2);
      offscreenBgCtx.fillStyle = '#ffffff';
      offscreenBgCtx.fill();
    }

    // 7. Moldura exterior
    offscreenBgCtx.strokeStyle = isDuelMode ? 'rgba(255,23,68, 0.35)' : 'rgba(124,106,255, 0.2)';
    offscreenBgCtx.lineWidth = 3;
    offscreenBgCtx.strokeRect(4, 4, W - 8, H - 8);

    offscreenBgNeedsRedraw = false;
  }

  // ==================== POOLED PARTICLE ENGINE ====================
  function spawnParticles(x, y, count, colors, opts = {}) {
    const {
      speedMin = 1.5, speedMax = 5.0,
      sizeMin = 1.5, sizeMax = 3.2,
      life = 18, gravity = 0,
      spread = Math.PI * 2, angle = 0,
      type = 'circle'
    } = opts;

    const colorArray = Array.isArray(colors) ? colors : [colors];
    let spawned = 0;

    for (let i = 0; i < PARTICLE_POOL_SIZE && spawned < count; i++) {
      const p = particlePool[i];
      if (p.active) continue;

      const a = angle - spread / 2 + Math.random() * spread;
      const spd = speedMin + Math.random() * (speedMax - speedMin);

      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
      p.size = sizeMin + Math.random() * (sizeMax - sizeMin);
      p.life = life * (0.8 + Math.random() * 0.2);
      p.maxLife = p.life;
      p.color = colorArray[Math.floor(Math.random() * colorArray.length)];
      p.gravity = gravity;
      p.type = type;
      p.rotation = Math.random() * Math.PI * 2;
      p.rotSpeed = (Math.random() - 0.5) * 0.25;

      spawned++;
    }
  }

  function updateParticles(dt) {
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = particlePool[i];
      if (!p.active) continue;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
      p.rotation += p.rotSpeed;

      if (p.life <= 0) {
        p.active = false;
      }
    }
  }

  // BATCHED ZERO-SWITCH PARTICLE DRAWING (Reduces GPU draw calls from 50 to 2)
  function drawParticles() {
    let hasSparks = false;
    let hasCircles = false;

    // Pass 1: Faíscas de parry em um único path contínuo
    ctx.beginPath();
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = particlePool[i];
      if (!p.active || p.type !== 'spark') continue;
      const alpha = p.life / p.maxLife;
      const size = p.size * (0.4 + alpha * 0.6);
      const cosR = Math.cos(p.rotation);
      const sinR = Math.sin(p.rotation);
      const halfW = size * 2;
      const halfH = size * 0.4;

      ctx.moveTo(p.x - halfW * cosR, p.y - halfW * sinR);
      ctx.lineTo(p.x + halfH * sinR, p.y - halfH * cosR);
      ctx.lineTo(p.x + halfW * cosR, p.y + halfW * sinR);
      ctx.lineTo(p.x - halfH * sinR, p.y + halfH * cosR);
      ctx.closePath();
      hasSparks = true;
    }
    if (hasSparks) {
      ctx.fillStyle = '#ffd700';
      ctx.fill();
    }

    // Pass 2: Círculos de impacto em um único path contínuo
    ctx.beginPath();
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = particlePool[i];
      if (!p.active || p.type === 'spark') continue;
      const alpha = p.life / p.maxLife;
      const size = p.size * (0.4 + alpha * 0.6);
      ctx.moveTo(p.x + size, p.y);
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      hasCircles = true;
    }
    if (hasCircles) {
      ctx.fillStyle = isDuelMode ? '#ff1744' : '#00e5ff';
      ctx.fill();
    }
  }

  // ==================== POOLED GHOST AFTERIMAGES ====================
  function addGhostAfterimage(x, y, color) {
    for (let i = 0; i < GHOST_POOL_SIZE; i++) {
      const g = ghostPool[i];
      if (!g.active) {
        g.active = true;
        g.x = x;
        g.y = y;
        g.color = color;
        g.alpha = 0.6;
        return;
      }
    }
    const g = ghostPool[0];
    g.active = true;
    g.x = x;
    g.y = y;
    g.color = color;
    g.alpha = 0.6;
  }

  function updateAndDrawGhosts(dt) {
    for (let i = 0; i < GHOST_POOL_SIZE; i++) {
      const g = ghostPool[i];
      if (!g.active) continue;

      g.alpha -= 0.08 * dt;
      if (g.alpha <= 0) {
        g.active = false;
        continue;
      }
      const px = (g.x / 100) * W;
      const py = (g.y / 100) * H;

      ctx.globalAlpha = g.alpha * 0.4;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(px, py, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ==================== SCREEN SHAKE & SHOCKWAVE ====================
  function triggerShake(intensity) {
    shake.intensity = Math.min(shake.intensity + intensity, 14);
  }

  function updateShake() {
    if (shake.intensity > 0.3) {
      shake.x = (Math.random() - 0.5) * shake.intensity * 2;
      shake.y = (Math.random() - 0.5) * shake.intensity * 2;
      shake.intensity *= shake.decay;
    } else {
      shake.x = 0;
      shake.y = 0;
      shake.intensity = 0;
    }
  }

  // ==================== POOLED PULSE RINGS ====================
  function addPulseRing(x, y, color, maxRadius = 55) {
    for (let i = 0; i < PULSE_POOL_SIZE; i++) {
      const pr = pulsePool[i];
      if (!pr.active) {
        pr.active = true;
        pr.x = x;
        pr.y = y;
        pr.r = 8;
        pr.maxRadius = maxRadius;
        pr.alpha = 0.95;
        pr.color = color;
        return;
      }
    }
    const pr = pulsePool[0];
    pr.active = true;
    pr.x = x;
    pr.y = y;
    pr.r = 8;
    pr.maxRadius = maxRadius;
    pr.alpha = 0.95;
    pr.color = color;
  }

  function updateAndDrawPulseRings(dt) {
    ctx.lineWidth = 2.5;
    for (let i = 0; i < PULSE_POOL_SIZE; i++) {
      const pr = pulsePool[i];
      if (!pr.active) continue;

      pr.r += (pr.maxRadius - pr.r) * 0.25 * dt + 3.5 * dt;
      pr.alpha *= Math.pow(0.88, dt);

      if (pr.alpha < 0.03 || pr.r >= pr.maxRadius) {
        pr.active = false;
        continue;
      }

      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.r, 0, Math.PI * 2);
      ctx.strokeStyle = pr.color;
      ctx.globalAlpha = pr.alpha;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ==================== POOLED FLOATING TEXTS ====================
  function addFloatingText(x, y, text, color = '#fff') {
    for (let i = 0; i < TEXT_POOL_SIZE; i++) {
      const ft = textPool[i];
      if (!ft.active) {
        ft.active = true;
        ft.x = x;
        ft.y = y;
        ft.text = text;
        ft.color = color;
        ft.life = 25;
        ft.maxLife = 25;
        ft.vy = -1.8;
        return;
      }
    }
    const ft = textPool[0];
    ft.active = true;
    ft.x = x;
    ft.y = y;
    ft.text = text;
    ft.color = color;
    ft.life = 25;
    ft.maxLife = 25;
    ft.vy = -1.8;
  }

  // ZERO DYNAMIC FONT PARSING: Pre-set font ONCE, no strokeText polygon parsing
  function updateAndDrawFloatingTexts(dt) {
    ctx.font = FONT_FLOATING_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < TEXT_POOL_SIZE; i++) {
      const ft = textPool[i];
      if (!ft.active) continue;

      ft.y += ft.vy * dt;
      ft.life -= dt;

      if (ft.life <= 0) {
        ft.active = false;
        continue;
      }

      const alpha = Math.max(0, ft.life / ft.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }

    ctx.globalAlpha = 1;
  }

  // ==================== SPEED CONFIG ====================
  function getSpeedConfig() {
    for (let i = 0; i < PALETTE.ballSpeeds.length; i++) {
      const cfg = PALETTE.ballSpeeds[i];
      if (gameSpeed <= cfg.max) return cfg;
    }
    return PALETTE.ballSpeeds[PALETTE.ballSpeeds.length - 1];
  }

  // ==================== ZERO-ALLOCATION CONTINUOUS NEON TRAIL ====================
  function pushTrail(bx, by) {
    trailBuffer[trailHead].x = bx;
    trailBuffer[trailHead].y = by;
    trailHead = (trailHead + 1) % TRAIL_BUFFER_SIZE;
    if (trailCount < TRAIL_BUFFER_SIZE) trailCount++;
  }

  // BATCHED CONTINUOUS NEON STROKE: Replaces 36 fill calls with 2 fast GPU stroke paths
  function drawTrail(speedCfg) {
    if (trailCount < 2) return;
    const ballSpeed = Math.hypot(ball.vx, ball.vy);
    // Largura e opacidade dinâmicas baseadas na velocidade da bola
    const speedFactor = Math.min(ballSpeed / 10, 1.0);
    const outerWidth = 10 + speedFactor * 12; // 10-22px baseado na velocidade
    const innerWidth = 3 + speedFactor * 4;   // 3-7px
    const glowAlpha = 0.25 + speedFactor * 0.35; // 0.25-0.60 opacidade

    // Glow externo com opacidade dinâmica
    const glowColor = isDuelMode
      ? `rgba(255, 23, 68, ${glowAlpha.toFixed(2)})`
      : speedCfg.glow.replace(/[\d.]+\)$/, `${glowAlpha.toFixed(2)})`);

    ctx.beginPath();
    for (let i = 0; i < trailCount; i++) {
      const idx = (trailHead - 1 - i + TRAIL_BUFFER_SIZE) % TRAIL_BUFFER_SIZE;
      const t = trailBuffer[idx];
      if (i === 0) ctx.moveTo(t.x, t.y);
      else ctx.lineTo(t.x, t.y);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer neon glow stroke (largura dinâmica)
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = outerWidth;
    ctx.stroke();

    // Inner bright plasma core (largura dinâmica)
    ctx.strokeStyle = speedCfg.core;
    ctx.lineWidth = innerWidth;
    ctx.stroke();
  }

  // ==================== BALL RENDERING (OPTIMIZED) ====================
  function drawBall(bx, by, time, speedCfg) {
    const r = 12 + Math.sin(time * 0.015) * 1.8;

    // MOTION BLUR: esticar a bola na direção do movimento baseado na velocidade
    const ballSpeed = Math.hypot(ball.vx, ball.vy);
    const stretchFactor = Math.min(ballSpeed * 0.06, 0.6); // max 60% stretch
    if (stretchFactor > 0.05) {
      const moveAngle = Math.atan2(ball.vy, ball.vx);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(moveAngle);
      ctx.scale(1 + stretchFactor, 1 - stretchFactor * 0.4);
      ctx.translate(-bx, -by);
    }

    // Laser de mira no alvo (se houver alvo ativo)
    if (currentTargetId && localPlayers[currentTargetId] && localPlayers[currentTargetId].alive) {
      const targetP = localPlayers[currentTargetId];
      const tx = (targetP.x / 100) * W;
      const ty = (targetP.y / 100) * H;

      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = 'rgba(255, 23, 68, 0.45)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash(STATIC_DASH_7);
      ctx.stroke();
      ctx.setLineDash(STATIC_DASH_EMPTY);
    }

    // Curva indicadora de giro (spin)
    if (ball.curve && Math.abs(ball.curve) > 0.1) {
      const spinAngle = time * 0.02 * (ball.curve > 0 ? 1 : -1);
      ctx.beginPath();
      ctx.arc(bx, by, r * 1.7, spinAngle, spinAngle + Math.PI * 0.8);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Halo externo
    const haloColor = isDuelMode ? 'rgba(255, 23, 68, 0.28)' : speedCfg.glow;
    ctx.beginPath();
    ctx.arc(bx, by, r * 2.3, 0, Math.PI * 2);
    ctx.fillStyle = haloColor;
    ctx.fill();

    // Núcleo brilhante
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = isDuelMode ? '#ff1744' : speedCfg.core;
    ctx.fill();

    // Ponto de luz quente no centro
    ctx.beginPath();
    ctx.arc(bx - r * 0.25, by - r * 0.25, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Anel orbital de plasma
    ctx.beginPath();
    ctx.ellipse(bx, by, r * 1.45, r * 0.6, time * 0.012, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Restaurar contexto se motion blur foi aplicado
    if (stretchFactor > 0.05) {
      ctx.restore();
    }
  }

  // ==================== SPEED LINES BACKGROUND EFFECT ====================
  // Linhas radiais que aparecem quando a bola está em alta velocidade
  function drawSpeedLines(time) {
    const ballSpeed = Math.hypot(ball.vx, ball.vy);
    if (ballSpeed < 3) return; // Só ativa acima de velocidade 3

    const intensity = Math.min((ballSpeed - 3) / 10, 1.0); // 0..1 baseado na velocidade
    const bx = (ball.x / 100) * W;
    const by = (ball.y / 100) * H;
    const lineCount = Math.floor(8 + intensity * 12); // 8-20 linhas
    const baseAngle = Math.atan2(ball.vy, ball.vx);

    ctx.save();
    ctx.globalAlpha = intensity * 0.15;
    ctx.strokeStyle = isDuelMode ? '#ff1744' : '#00e5ff';
    ctx.lineWidth = 1 + intensity * 2;
    ctx.lineCap = 'round';

    ctx.beginPath();
    for (let i = 0; i < lineCount; i++) {
      const angle = baseAngle + (i - lineCount / 2) * 0.15 + Math.sin(time * 0.003 + i) * 0.05;
      const startDist = 60 + Math.random() * 40;
      const endDist = startDist + 80 + intensity * 120;
      const sx = bx + Math.cos(angle) * startDist;
      const sy = by + Math.sin(angle) * startDist;
      const ex = bx + Math.cos(angle) * endDist;
      const ey = by + Math.sin(angle) * endDist;
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ==================== GLADIATORS RENDERING (OPTIMIZED V2) ====================
  function drawGladiators(time) {
    const r = 20;

    // PASS 1: Batched aura rendering (todos os vivos de uma vez)
    ctx.beginPath();
    for (let i = 0; i < cachedPlayerList.length; i++) {
      const p = cachedPlayerList[i];
      if (!p.alive) continue;
      const px = (p.x / 100) * W;
      const py = (p.y / 100) * H;
      const auraR = r + (p._isMe ? 5 : 3);
      ctx.moveTo(px + auraR, py);
      ctx.arc(px, py, auraR, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(124, 106, 255, 0.15)';
    ctx.fill();

    // PASS 2: Individual player rendering
    for (let i = 0; i < cachedPlayerList.length; i++) {
      const p = cachedPlayerList[i];
      const px = (p.x / 100) * W;
      const py = (p.y / 100) * H;
      const isMe = p._isMe;
      const isTarget = (p.id === currentTargetId);

      if (!p.alive) {
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ff5252';
        ctx.fill();

        ctx.font = FONT_SKULL;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💀', px, py);
        ctx.globalAlpha = 1;

        ctx.font = FONT_SKULL_NAME;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255, 82, 82, 0.45)';
        ctx.fillText(p.name, px, py + r + 13);
        continue;
      }

      // Proximidade da bola para efeitos visuais dinâmicos
      const ballDx = ball.x - p.x;
      const ballDy = ball.y - p.y;
      const ballDist = Math.hypot(ballDx, ballDy);
      const proximityFactor = Math.max(0, 1 - ballDist / 30); // 1 quando perto, 0 quando longe

      // 1. Reticle de alvo
      if (isTarget) {
        const pulse = Math.sin(time * 0.016) * 3.5;
        const reticleR = r + 13 + pulse;

        ctx.beginPath();
        ctx.arc(px, py, reticleR, 0, Math.PI * 2);
        ctx.strokeStyle = PALETTE.targetRing;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        const cr = reticleR + 4;
        ctx.beginPath();
        ctx.moveTo(px + cr - 6, py); ctx.lineTo(px + cr + 4, py);
        ctx.moveTo(px - cr + 6, py); ctx.lineTo(px - cr - 4, py);
        ctx.moveTo(px, py + cr - 6); ctx.lineTo(px, py + cr + 4);
        ctx.moveTo(px, py - cr + 6); ctx.lineTo(px, py - cr - 4);
        ctx.stroke();

        ctx.font = FONT_TARGET_ALERT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ff1744';
        ctx.fillText('⚠️ ALVO', px, py - reticleR - 6);
      }

      // 2. Sweet spot timing indicator
      if (isMe && isTarget) {
        if (ballDist < DEFLECT_ZONE + 8) {
          const isPerfect = ballDist <= PERFECT_ZONE;
          const inWindow = ballDist <= DEFLECT_ZONE;
          const ringCol = isPerfect ? PALETTE.perfectRing : (inWindow ? PALETTE.parryRing : '#ffd600');

          ctx.beginPath();
          ctx.arc(px, py, (DEFLECT_ZONE / 100) * W, 0, Math.PI * 2);
          ctx.strokeStyle = ringCol;
          ctx.lineWidth = isPerfect ? 3.5 : 2.5;
          ctx.setLineDash(inWindow ? STATIC_DASH_5 : STATIC_DASH_8);
          ctx.stroke();
          ctx.setLineDash(STATIC_DASH_EMPTY);

          ctx.font = FONT_PARRY_PROMPT;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = ringCol;
          ctx.fillText(isPerfect ? '🔥 PARRY PERFEITO!' : (inWindow ? '⚡ REBATER AGORA!' : 'PREPARE-SE...'), px, py + r + 26);
        }
      }

      // 3. Indicador de mira (batched stroke para todos os jogadores depois)
      const aim = p.aimDir || myAimDir;
      const amag = Math.hypot(aim.x, aim.y) || 1;
      const ux = aim.x / amag;
      const uy = aim.y / amag;
      const nx = -uy;
      const ny = ux;

      const xStart = px + ux * (r + 5);
      const yStart = py + uy * (r + 5);
      const xTip = px + ux * (r + 16);
      const yTip = py + uy * (r + 16);
      const xB1 = px + ux * (r + 11) + nx * 4.5;
      const yB1 = py + uy * (r + 11) + ny * 4.5;
      const xB2 = px + ux * (r + 11) - nx * 4.5;
      const yB2 = py + uy * (r + 11) - ny * 4.5;

      ctx.beginPath();
      ctx.moveTo(xStart, yStart);
      ctx.lineTo(xTip, yTip);
      ctx.strokeStyle = isMe ? '#00e5ff' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(xTip, yTip);
      ctx.lineTo(xB1, yB1);
      ctx.lineTo(xB2, yB2);
      ctx.closePath();
      ctx.fillStyle = isMe ? '#00e5ff' : 'rgba(255,255,255,0.7)';
      ctx.fill();

      // 5. Corpo metálico escuro com borda colorida
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = '#141432';
      ctx.fill();

      // Borda com brilho dinâmico baseado na proximidade da bola
      ctx.lineWidth = isMe ? 3 : 2;
      if (proximityFactor > 0.3) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = proximityFactor * 12;
      }
      ctx.strokeStyle = p.color;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 6. Centro com cor do gladiador (pulsa quando bola está perto)
      const centerScale = 0.45 + proximityFactor * 0.1;
      ctx.beginPath();
      ctx.arc(px, py, r * centerScale, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();

      // 7. Letra inicial
      ctx.fillStyle = '#ffffff';
      ctx.font = FONT_GLADIATOR_INITIAL;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p._initial, px, py);

      // 8. Nome do jogador
      ctx.font = FONT_GLADIATOR_NAME;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p._label, px, py - r - 5);
    }
  }

  // ==================== SLASH ANIMATION ====================
  function triggerSlash(x, y, color) {
    slashAnim.active = true;
    slashAnim.progress = 0;
    slashAnim.x = x;
    slashAnim.y = y;
    slashAnim.color = color || '#00e5ff';
  }

  function updateAndDrawSlash(dt) {
    if (!slashAnim.active) return;
    slashAnim.progress += dt * 0.18;
    if (slashAnim.progress >= 1) {
      slashAnim.active = false;
      return;
    }

    const px = (slashAnim.x / 100) * W;
    const py = (slashAnim.y / 100) * H;
    const angle = slashAnim.progress * Math.PI * 2;
    const r = 28 + slashAnim.progress * 18;

    ctx.beginPath();
    ctx.arc(px, py, r, angle - 1.2, angle + 1.2);
    ctx.strokeStyle = slashAnim.color;
    ctx.lineWidth = 4 * (1 - slashAnim.progress);
    ctx.stroke();
  }

  // ==================== HUD RENDERING ====================
  function drawHUD(time) {
    const speedCfg = getSpeedConfig();
    let aliveCount = 0;
    for (let i = 0; i < cachedPlayerList.length; i++) {
      if (cachedPlayerList[i].alive) aliveCount++;
    }

    ctx.font = FONT_HUD_TEXT;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`👥 VIVOS: ${aliveCount}/${cachedPlayerList.length}`, 16, 24);

    if (isDuelMode) {
      ctx.fillStyle = '#ff1744';
      ctx.fillText('⚔️ DUELO MORTAL', 16, 42);
    }

    ctx.textAlign = 'right';
    ctx.font = FONT_HUD_SPEED;
    ctx.fillStyle = isDuelMode ? '#ff1744' : speedCfg.core;
    ctx.fillText(`⚡ VEL ${gameSpeed.toFixed(1)}x [${speedCfg.name}]`, W - 16, 24);

    // Alerta no topo se for o alvo
    if (currentTargetId === myId && localPlayers[myId] && localPlayers[myId].alive) {
      const pulseAlpha = 0.4 + Math.sin(time * 0.01) * 0.3;
      const bannerW = 180;
      const bx = W / 2 - bannerW / 2;
      const by = 12;

      ctx.fillStyle = `rgba(255, 23, 68, ${pulseAlpha * 0.28})`;
      ctx.beginPath();
      ctx.roundRect(bx, by, bannerW, 26, 13);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 23, 68, ${pulseAlpha})`;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = FONT_HUD_TEXT;
      ctx.fillStyle = '#ff1744';
      ctx.fillText('⚠️ VOCÊ É O ALVO! PREPARE-SE!', W / 2, by + 13);
    }
  }

  // ==================== SCREEN FLASH ====================
  function drawFlash() {
    if (flash.alpha > 0.01) {
      ctx.fillStyle = flash.color;
      ctx.globalAlpha = flash.alpha;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      flash.alpha *= 0.80;
    }
  }

  // ==================== LOCAL PLAYER SIMULATION (rAF-SYNCED) ====================
  function updateLocalPlayerSimulation(dtStep) {
    const me = localPlayers[myId];
    if (!me || !me.alive) return;

    let dx = 0, dy = 0;
    if (keysDown.has('arrowleft') || keysDown.has('a')) dx -= 1;
    if (keysDown.has('arrowright') || keysDown.has('d')) dx += 1;
    if (keysDown.has('arrowup') || keysDown.has('w')) dy -= 1;
    if (keysDown.has('arrowdown') || keysDown.has('s')) dy += 1;

    if (touchMoveDir) {
      if (touchMoveDir === 'left') dx = -1;
      if (touchMoveDir === 'right') dx = 1;
      if (touchMoveDir === 'up') dy = -1;
      if (touchMoveDir === 'down') dy = 1;
    }

    if (dx !== 0 || dy !== 0) {
      const mag = Math.hypot(dx, dy) || 1;
      const udx = dx / mag;
      const udy = dy / mag;
      const step = 3.8 * dtStep;
      const nx = Math.max(8, Math.min(92, me.x + udx * step));
      const ny = Math.max(8, Math.min(92, me.y + udy * step));
      me.x = nx;
      me.y = ny;
      myAimDir.x = udx;
      myAimDir.y = udy;
      me.aimDir = myAimDir;

      const now = performance.now();
      if (now - lastMoveEmitTime >= 35) {
        lastMoveEmitTime = now;
        socket.emit('game:action', {
          action: 'move',
          x: nx,
          y: ny,
          aimDir: myAimDir
        });
      }
    }
  }

  // ==================== MAIN CONSTANT 60FPS RENDER LOOP ====================
  function drawGame(timestamp) {
    if (!canvas || !ctx) return;

    if (!lastFrameTime) lastFrameTime = timestamp;
    const rawDeltaMs = timestamp - lastFrameTime;
    deltaTime = Math.min(rawDeltaMs / 1000, 0.035);
    lastFrameTime = timestamp;

    perfMonitor.record(timestamp, rawDeltaMs);

    // Constant unbroken physics step: NEVER slowed by hitstop to maintain 100% server synchrony
    const dtStep = Math.min(deltaTime * 33.333, 1.6);

    // 1. SUB-STEPPING DE FÍSICA PARA ESTABILIDADE EM ALTAS VELOCIDADES
    // Divide o frame em múltiplos passos menores quando a bola está rápida
    const ballSpeed = Math.hypot(ball.vx, ball.vy);
    const subSteps = ballSpeed > 8 ? 4 : (ballSpeed > 4 ? 2 : 1);
    const subDt = dtStep / subSteps;

    for (let s = 0; s < subSteps; s++) {
      // Reconciliação contínua via velocity blending (aplicada proporcionalmente por sub-step)
      const vBlend = Math.min(1.0, 16 * deltaTime / subSteps);
      ball.vx += (serverTargetVx - ball.vx) * vBlend;
      ball.vy += (serverTargetVy - ball.vy) * vBlend;

      const posCorrection = Math.min(1.0, 10 * deltaTime / subSteps);
      ball.x += ball.vx * 0.72 * subDt + (serverTargetX - ball.x) * posCorrection;
      ball.y += ball.vy * 0.72 * subDt + (serverTargetY - ball.y) * posCorrection;

      // Ricochete local nos limites da arena (5% a 95%) — verificado a cada sub-step
      if (ball.x <= 5) {
        ball.x = 5;
        if (ball.vx < 0) ball.vx = -ball.vx;
        serverTargetVx = Math.abs(serverTargetVx);
      } else if (ball.x >= 95) {
        ball.x = 95;
        if (ball.vx > 0) ball.vx = -ball.vx;
        serverTargetVx = -Math.abs(serverTargetVx);
      }

      if (ball.y <= 5) {
        ball.y = 5;
        if (ball.vy < 0) ball.vy = -ball.vy;
        serverTargetVy = Math.abs(serverTargetVy);
      } else if (ball.y >= 95) {
        ball.y = 95;
        if (ball.vy > 0) ball.vy = -ball.vy;
        serverTargetVy = -Math.abs(serverTargetVy);
      }
    }

    // 2. Movimentação local perfeitamente sincronizada com o frame do display
    updateLocalPlayerSimulation(dtStep);

    // 3. Atualizar efeitos visuais e pools
    updateShake();
    updateParticles(dtStep);

    // 4. Desenho de tela
    ctx.save();
    if (shake.intensity > 0.3) {
      ctx.translate(Math.round(shake.x), Math.round(shake.y));
    }

    // A. Arena pré-renderizada
    if (offscreenBgNeedsRedraw || !offscreenBgCanvas) {
      prepareOffscreenArena();
    }
    ctx.drawImage(offscreenBgCanvas, 0, 0, W, H);

    // B. Speed Lines (efeito de velocidade no fundo)
    drawSpeedLines(timestamp);

    // C. Fantasmas do Dash
    updateAndDrawGhosts(dtStep);

    // C. Rastro Contínuo da Bola (Buffer circular com stroke de GPU direto)
    const bx = (ball.x / 100) * W;
    const by = (ball.y / 100) * H;
    pushTrail(bx, by);
    const speedCfg = getSpeedConfig();
    drawTrail(speedCfg);

    // D. Gladiadores
    drawGladiators(timestamp);

    // E. Animação de Corte/Parry
    updateAndDrawSlash(dtStep);

    // F. Bola Mortal
    drawBall(bx, by, timestamp, speedCfg);

    // G. Pools de partículas, shockwaves e textos flutuantes
    updateAndDrawPulseRings(dtStep);
    drawParticles();
    updateAndDrawFloatingTexts(dtStep);
    drawHUD(timestamp);
    drawFlash();

    // H. Contagem Regressiva Neon 3, 2, 1
    drawCountdown();

    // I. Modo de Diagnóstico / Perf HUD
    perfMonitor.draw(ctx);

    ctx.restore();

    animFrame = requestAnimationFrame(drawGame);
  }

  function drawCountdown() {
    if (!countdownActive && !countdownEndingText) return;

    ctx.save();
    const cx = W / 2;
    const cy = H / 2;

    const text = countdownEndingText || String(activeCountdown);
    const color = countdownEndingText ? '#00e5ff' : (activeCountdown === 3 ? '#00e5ff' : (activeCountdown === 2 ? '#ffd700' : '#ff9100'));

    // Radial aura
    const auraGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 90);
    auraGrad.addColorStop(0, 'rgba(4, 4, 18, 0.85)');
    auraGrad.addColorStop(1, 'rgba(4, 4, 18, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = countdownEndingText ? '900 46px "Space Grotesk", sans-serif' : '900 78px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);

    ctx.font = '800 12px "Space Grotesk", sans-serif';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(countdownEndingText ? '⚔️ SOBREVIVA NA ARENA!' : 'PREPARE-SE...', cx, cy + 46);

    ctx.restore();
  }

  // ==================== DASH & HIT ACTIONS ====================
  function updateDashButtonUI() {
    const dashBtn = domCache.dashBtn;
    if (dashBtn) {
      if (hasDash) {
        dashBtn.disabled = false;
        dashBtn.style.opacity = '1';
        dashBtn.style.filter = 'none';
        dashBtn.innerHTML = '💨 DASH <span style="font-size:0.7rem; opacity:0.8;">[1x]</span>';
      } else {
        dashBtn.disabled = true;
        dashBtn.style.opacity = '0.4';
        dashBtn.style.filter = 'grayscale(1)';
        dashBtn.innerHTML = '💨 USADO <span style="font-size:0.7rem; opacity:0.8;">[0x]</span>';
      }
    }
  }

  function doDash() {
    if (!hasDash) return;
    const me = localPlayers[myId];
    if (!me || !me.alive) return;

    hasDash = false;
    updateDashButtonUI();

    safeAudio('dash');
    triggerShake(4);

    addGhostAfterimage(me.x, me.y, me.color);
    addPulseRing((me.x / 100) * W, (me.y / 100) * H, '#00e5ff', 45);

    socket.emit('game:action', {
      action: 'dash',
      aimDir: myAimDir
    });

    addFloatingText((me.x / 100) * W, (me.y / 100) * H - 24, '💨 DASH!', '#00e5ff');
  }

  function doHit() {
    if (Date.now() < parryCooldownUntil) {
      return;
    }

    const me = localPlayers[myId];
    if (!me || !me.alive) return;

    // Cooldown imediato no cliente para impedir envio múltiplo de pacotes e duplo hit
    parryCooldownUntil = Date.now() + 350;

    triggerSlash(me.x, me.y, me.color);

    let curve = 0;
    if (keysDown.has('a') || keysDown.has('arrowleft') || touchMoveDir === 'left') curve -= 0.85;
    if (keysDown.has('d') || keysDown.has('arrowright') || touchMoveDir === 'right') curve += 0.85;

    socket.emit('game:action', {
      action: 'hit',
      aimDir: myAimDir,
      curve
    });

    const hitBtn = domCache.hitBtn;
    if (hitBtn) {
      hitBtn.style.transform = 'scale(0.94)';
      setTimeout(() => { if (hitBtn) hitBtn.style.transform = ''; }, 100);
    }
  }

  function updateMyAimFromKeys() {
    let dx = 0;
    let dy = 0;
    if (keysDown.has('arrowleft') || keysDown.has('a')) dx -= 1;
    if (keysDown.has('arrowright') || keysDown.has('d')) dx += 1;
    if (keysDown.has('arrowup') || keysDown.has('w')) dy -= 1;
    if (keysDown.has('arrowdown') || keysDown.has('s')) dy += 1;

    if (touchMoveDir) {
      if (touchMoveDir === 'left') dx = -1;
      if (touchMoveDir === 'right') dx = 1;
      if (touchMoveDir === 'up') dy = -1;
      if (touchMoveDir === 'down') dy = 1;
    }

    if (dx !== 0 || dy !== 0) {
      const mag = Math.hypot(dx, dy) || 1;
      myAimDir.x = dx / mag;
      myAimDir.y = dy / mag;
    }
  }

  function setupInput() {
    if (keyHandlerBound) {
      document.removeEventListener('keydown', keyHandlerBound);
      document.removeEventListener('keyup', keyHandlerBound);
    }

    keyHandlerBound = (e) => {
      // Impede disparo repetido contínuo gerado pelo sistema operacional ao segurar tecla
      if (e.repeat) return;

      const k = e.key.toLowerCase();
      if (e.type === 'keydown') {
        // Toggle Modo Diagnóstico de Performance com Shift + D
        if (e.shiftKey && (k === 'd' || e.key === 'D')) {
          perfMonitor.enabled = !perfMonitor.enabled;
          return;
        }

        keysDown.add(k);
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          doHit();
        } else if (e.key === 'Shift' || k === 'e') {
          e.preventDefault();
          doDash();
        }
      } else if (e.type === 'keyup') {
        keysDown.delete(k);
      }
      updateMyAimFromKeys();
    };

    document.addEventListener('keydown', keyHandlerBound);
    document.addEventListener('keyup', keyHandlerBound);
  }

  // ==================== LIFECYCLE CLEANUP ====================
  function cleanupDeathBall() {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    if (keyHandlerBound) {
      document.removeEventListener('keydown', keyHandlerBound);
      document.removeEventListener('keyup', keyHandlerBound);
      keyHandlerBound = null;
    }
    keysDown.clear();
    touchMoveDir = null;
    resetAllPools();
    domCache = {
      hitsBadge: null,
      comboBadge: null,
      modeBadge: null,
      statusText: null,
      dashBtn: null,
      hitBtn: null
    };
  }

  // ==================== GAME START ====================
  socket.on('game:deathball:start', (data) => {
    cleanupDeathBall();

    if (DOM.resultsOverlay) DOM.resultsOverlay.classList.add('hidden');
    myId = socket.id;
    localPlayers = data.players || {};
    rebuildCachedPlayerList();

    const startBall = data.ball || { x: 50, y: 50, vx: 0, vy: 0, curve: 0 };
    ball.x = startBall.x;
    ball.y = startBall.y;
    ball.vx = startBall.vx || 0;
    ball.vy = startBall.vy || 0;
    ball.curve = startBall.curve || 0;
    serverTargetX = startBall.x;
    serverTargetY = startBall.y;
    serverTargetVx = startBall.vx || 0;
    serverTargetVy = startBall.vy || 0;

    currentTargetId = data.targetId || null;
    isSoloMode = !!data.isSolo;
    isDuelMode = !!data.isDuel;
    gameSpeed = data.speed || 1.7;
    hitCount = 0;
    comboCount = 0;
    hasDash = true;
    lastMoveEmitTime = 0;
    offscreenBgNeedsRedraw = true;

    // Inicializa pontuação e contagem regressiva 3, 2, 1
    myMatchScore = 0;
    activeCountdown = (typeof data.countdown === 'number') ? data.countdown : 3;
    countdownActive = true;
    countdownEndingText = null;
    try { AudioEngine.countdown(activeCountdown); } catch (e) {}

    resetAllPools();
    lastFrameTime = performance.now();

    dpr = Math.min(window.devicePixelRatio || 1, 1.5); // Aumentado para telas HiDPI

    // Arena maior: usa mais espaço da tela disponível
    const maxArenaW = Math.min(1100, window.innerWidth - 24);
    const maxArenaH = Math.min(820, window.innerHeight - 140);
    const size = Math.max(420, Math.floor(Math.min(maxArenaW, maxArenaH)));

    DOM.gameArea.innerHTML = `
      <div class="deathball-container" style="display:flex; flex-direction:column; align-items:center; gap:8px; width:100%; max-width:920px; margin:0 auto;">
        
        <!-- HEADER / PLACAR -->
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:0 8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-family:var(--font-display); font-size:1.25rem; font-weight:900; background:linear-gradient(135deg,#ff1744,#ff9100); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">💀 DEATH BALL ARENA</span>
            <span id="db-mode-badge" style="font-size:0.75rem; background:rgba(124,106,255,0.18); color:var(--text-secondary); padding:3px 10px; border-radius:var(--radius-full); font-weight:800; border:1px solid rgba(124,106,255,0.3);">
              ${isDuelMode ? '⚔️ DUELO MORTAL (1v1)' : (isSoloMode ? '🤖 Modo Treino (Solo)' : '⚔️ PvP Real')}
            </span>
            <button id="db-perf-toggle" title="Alternar Diagnóstico de Performance (Shift + D)" style="background:rgba(0,229,255,0.12); border:1px solid rgba(0,229,255,0.3); color:var(--accent-tertiary); font-size:0.72rem; padding:2px 8px; border-radius:var(--radius-full); cursor:pointer; font-weight:700;">
              ⚡ Perf
            </button>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <span id="db-myscore-badge" style="font-size:0.8rem; background:var(--bg-glass); padding:3px 12px; border-radius:var(--radius-full); color:#ffd700; font-weight:800; border:1px solid rgba(255,215,0,0.25);" title="Pontos conquistados nesta partida">⭐ 0 pts</span>
            <span id="db-combo-badge" style="font-size:0.75rem; background:rgba(255,145,0,0.18); color:#ff9100; padding:3px 10px; border-radius:var(--radius-full); font-weight:800; border:1px solid rgba(255,145,0,0.3); opacity:0; transition:opacity 0.2s;">0x COMBO</span>
            <span id="db-hits-badge" style="font-size:0.8rem; background:var(--bg-glass); padding:3px 12px; border-radius:var(--radius-full); color:var(--accent-tertiary); font-weight:700; border:1px solid rgba(0,229,255,0.2);">⚡ 0</span>
          </div>
        </div>

        <!-- ARENA CANVAS -->
        <div style="position:relative; border-radius:var(--radius-lg); overflow:hidden; box-shadow:0 0 50px rgba(124,106,255,0.2), 0 10px 40px rgba(0,0,0,0.7); border:2.5px solid rgba(124,106,255,0.35);">
          <canvas id="deathball-canvas" width="${Math.round(size * dpr)}" height="${Math.round(size * dpr)}" style="width:${size}px; height:${size}px; display:block; border-radius:var(--radius-lg);"></canvas>
        </div>

        <!-- CONTROLES -->
        <div style="display:flex; gap:14px; justify-content:space-between; align-items:center; width:100%; max-width:620px; margin-top:4px;">
          
          <!-- D-PAD VIRTUAL -->
          <div style="display:grid; grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(3, 40px); gap:3px;">
            <div></div>
            <button class="btn btn-secondary db-dpad" id="db-up" style="padding:0; font-size:1.1rem; border-radius:8px;">▲</button>
            <div></div>
            <button class="btn btn-secondary db-dpad" id="db-left" style="padding:0; font-size:1.1rem; border-radius:8px;">◀</button>
            <div style="display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:0.72rem; font-weight:700;">MOVER</div>
            <button class="btn btn-secondary db-dpad" id="db-right" style="padding:0; font-size:1.1rem; border-radius:8px;">▶</button>
            <div></div>
            <button class="btn btn-secondary db-dpad" id="db-down" style="padding:0; font-size:1.1rem; border-radius:8px;">▼</button>
            <div></div>
          </div>

          <!-- BOTÃO DE DASH -->
          <div style="display:flex; flex-direction:column; align-items:center;">
            <button class="btn btn-secondary" id="db-dash" style="width:84px; height:74px; font-size:0.95rem; font-weight:900; background:linear-gradient(135deg,rgba(0,229,255,0.25),rgba(124,106,255,0.25)); border:2px solid #00e5ff; color:#00e5ff; border-radius:var(--radius-md); box-shadow:0 4px 15px rgba(0,229,255,0.25); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;">
              💨 DASH <span style="font-size:0.7rem; opacity:0.8;">[1x]</span>
            </button>
            <div style="font-size:0.68rem; color:var(--text-muted); margin-top:4px; font-weight:600;">SHIFT / E</div>
          </div>

          <!-- BOTÃO REBATER -->
          <div style="flex:1; display:flex; flex-direction:column; align-items:center;">
            <button class="btn btn-lg" id="db-hit" style="width:100%; height:74px; font-size:1.35rem; font-weight:900; background:linear-gradient(135deg,#ff1744 0%,#d50000 100%); color:#ffffff; box-shadow:0 6px 25px rgba(255,23,68,0.5); border:2px solid rgba(255,255,255,0.25); border-radius:var(--radius-md); letter-spacing:0.05em; transition:transform 0.1s, box-shadow 0.1s;">
              ⚡ REBATER
            </button>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px; font-weight:600;">
              ESPAÇO / ENTER • REBATA COM CURVA
            </div>
          </div>

        </div>

        <p id="db-status" style="font-size:0.82rem; color:var(--text-muted); text-align:center; min-height:20px;">
          ${isSoloMode ? '🤖 Modo Treino (Solo contra Bots) • Em 2+ jogadores reais, a partida é 100% PvP!' : '⚔️ Partida PvP — Segure uma direção para mirar no rival! Mova-se de lado para dar efeito curvo na bola!'}
        </p>

      </div>
    `;

    canvas = document.getElementById('deathball-canvas');
    ctx = canvas.getContext('2d', { alpha: false });
    W = size;
    H = size;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx = canvas.getContext('2d', { alpha: false });
    ctx.scale(dpr, dpr);

    // Cache DOM references
    domCache = {
      hitsBadge: document.getElementById('db-hits-badge'),
      comboBadge: document.getElementById('db-combo-badge'),
      modeBadge: document.getElementById('db-mode-badge'),
      myScoreBadge: document.getElementById('db-myscore-badge'),
      statusText: document.getElementById('db-status'),
      dashBtn: document.getElementById('db-dash'),
      hitBtn: document.getElementById('db-hit')
    };

    const perfBtn = document.getElementById('db-perf-toggle');
    if (perfBtn) {
      perfBtn.addEventListener('click', () => {
        perfMonitor.enabled = !perfMonitor.enabled;
      });
    }

    prepareOffscreenArena();

    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(drawGame);

    const bindDpad = (btnId, dir) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      const start = (e) => {
        if (e.cancelable) e.preventDefault();
        touchMoveDir = dir;
        updateMyAimFromKeys();
      };
      const stop = () => {
        if (touchMoveDir === dir) touchMoveDir = null;
        updateMyAimFromKeys();
      };
      btn.addEventListener('mousedown', start);
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('mouseup', stop);
      btn.addEventListener('mouseleave', stop);
      btn.addEventListener('touchend', stop);
      btn.addEventListener('touchcancel', stop);
    };

    bindDpad('db-up', 'up');
    bindDpad('db-down', 'down');
    bindDpad('db-left', 'left');
    bindDpad('db-right', 'right');

    const hitBtn = domCache.hitBtn;
    if (hitBtn) {
      hitBtn.addEventListener('click', doHit);
      hitBtn.addEventListener('touchstart', (e) => {
        if (e.cancelable) e.preventDefault();
        doHit();
      }, { passive: false });
    }

    const dashBtn = domCache.dashBtn;
    if (dashBtn) {
      dashBtn.addEventListener('click', doDash);
      dashBtn.addEventListener('touchstart', (e) => {
        if (e.cancelable) e.preventDefault();
        doDash();
      }, { passive: false });
    }

    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = ((e.clientX - rect.left) / rect.width) * 100;
      const clickY = ((e.clientY - rect.top) / rect.height) * 100;

      const me = localPlayers[myId];
      if (me && me.alive) {
        const dx = clickX - me.x;
        const dy = clickY - me.y;
        const mag = Math.hypot(dx, dy) || 1;
        myAimDir.x = dx / mag;
        myAimDir.y = dy / mag;
        me.aimDir = myAimDir;
      }
    });

    setupInput();
    safeAudio('gameStart');

    socket.once('game:ended', cleanupDeathBall);
  });

  // ==================== NETWORK EVENTS ====================
  socket.on('game:deathball:update', (data) => {
    currentTargetId = data.targetId;
    if (typeof data.speed === 'number') gameSpeed = data.speed;

    serverTargetX = data.ball.x;
    serverTargetY = data.ball.y;
    serverTargetVx = data.ball.vx;
    serverTargetVy = data.ball.vy;
    ball.curve = data.ball.curve || 0;

    // Boundary snap if discrepancy is extremely large (e.g. initial start)
    const dist = Math.hypot(serverTargetX - ball.x, serverTargetY - ball.y);
    if (dist > 25) {
      ball.x = serverTargetX;
      ball.y = serverTargetY;
      ball.vx = serverTargetVx;
      ball.vy = serverTargetVy;
    }
  });

  socket.on('game:deathball:player-move', (data) => {
    if (localPlayers[data.id] && data.id !== myId) {
      localPlayers[data.id].x = data.x;
      localPlayers[data.id].y = data.y;
      if (data.aimDir) localPlayers[data.id].aimDir = data.aimDir;
    }
  });

  socket.on('game:deathball:player-dash', (data) => {
    if (localPlayers[data.id]) {
      localPlayers[data.id].x = data.x;
      localPlayers[data.id].y = data.y;
      addGhostAfterimage(data.x, data.y, localPlayers[data.id].color);
      addPulseRing((data.x / 100) * W, (data.y / 100) * H, '#00e5ff', 45);
      if (data.id !== myId) safeAudio('dash');
    }
  });

  socket.on('game:deathball:bounce', (data) => {
    const bx = (data.x / 100) * W;
    const by = (data.y / 100) * H;
    safeAudio('wallBounce');
    triggerShake(2.0);
    spawnParticles(bx, by, 5, ['#00e5ff', '#ffffff', '#7c6aff'], {
      speedMin: 2, speedMax: 4.0,
      sizeMin: 1.5, sizeMax: 2.5,
      life: 14
    });
  });

  socket.on('game:deathball:duel-start', (data) => {
    isDuelMode = true;
    offscreenBgNeedsRedraw = true;
    safeAudio('heartbeat');
    triggerShake(8);
    flash.alpha = 0.35;
    flash.color = '#ff1744';
    addFloatingText(W / 2, H / 2 - 20, '⚔️ DUELO MORTAL! 1v1 FINAL! ⚔️', '#ff1744');

    const modeBadge = domCache.modeBadge;
    if (modeBadge) {
      modeBadge.textContent = '⚔️ DUELO MORTAL (1v1)';
      modeBadge.style.background = 'rgba(255,23,68,0.25)';
      modeBadge.style.color = '#ff1744';
      modeBadge.style.borderColor = '#ff1744';
    }

    const status = domCache.statusText;
    if (status) {
      status.textContent = '⚔️ DUELO MORTAL! Restam apenas 2 gladiadores! Velocidade máxima ativada!';
    }
  });

  socket.on('game:deathball:hit', (data) => {
    serverTargetX = data.ball.x;
    serverTargetY = data.ball.y;
    serverTargetVx = data.ball.vx;
    serverTargetVy = data.ball.vy;
    ball.x = data.ball.x;
    ball.y = data.ball.y;
    ball.vx = data.ball.vx;
    ball.vy = data.ball.vy;
    ball.curve = data.ball.curve || 0;

    currentTargetId = data.targetId;
    gameSpeed = data.speed || gameSpeed;
    hitCount = data.hits || (hitCount + 1);
    comboCount = data.combo || 1;

    const bx = (ball.x / 100) * W;
    const by = (ball.y / 100) * H;

    // Visual impact without slowing down physics simulation
    if (data.isPerfect) {
      safeAudio('perfectParry');
      triggerShake(10);
      flash.alpha = 0.35;
      flash.color = '#ffffff';
      addPulseRing(bx, by, '#ffd700', 70);
      addFloatingText(bx, by - 28, '🔥 PARRY PERFEITO! ⚡', '#ffd700');
      spawnParticles(bx, by, 14, ['#ffd700', '#ffffff', '#ff9100'], {
        speedMin: 3.0, speedMax: 6.5,
        sizeMin: 2, sizeMax: 4.0,
        life: 20,
        type: 'spark'
      });
    } else {
      safeAudio('clash');
      triggerShake(3 + Math.min(comboCount * 0.4, 5));
      flash.alpha = 0.15;
      flash.color = '#00e5ff';
      addPulseRing(bx, by, '#00e5ff', 45);
      spawnParticles(bx, by, 8, ['#00e5ff', '#ffffff', '#ffd600'], {
        speedMin: 2.0, speedMax: 5.0,
        sizeMin: 1.8, sizeMax: 3.0,
        life: 16,
        type: 'spark'
      });
      if (data.combo > 1) {
        addFloatingText(bx, by - 22, `${data.combo}x COMBO! 🔥`, '#ffa726');
      } else {
        addFloatingText(bx, by - 18, 'REBATEU! ⚡', '#00e5ff');
      }
    }

    if (data.ball.curve && Math.abs(data.ball.curve) > 0.1) {
      addFloatingText(bx, by + 22, '🌀 CURVA!', '#00e5ff');
    }

    if (data.targetId === myId) {
      safeAudio('lockOn');
    }

    if (data.byId === myId && typeof data.gameScore === 'number') {
      myMatchScore = data.gameScore;
      const myScoreBadge = domCache.myScoreBadge;
      if (myScoreBadge) myScoreBadge.textContent = `⭐ ${myMatchScore} pts`;
    }

    const hitsBadge = domCache.hitsBadge;
    if (hitsBadge) hitsBadge.textContent = `⚡ ${data.hits}`;

    const comboBadge = domCache.comboBadge;
    if (comboBadge) {
      if (data.combo > 1) {
        comboBadge.textContent = `${data.combo}x COMBO`;
        comboBadge.style.opacity = '1';
      } else {
        comboBadge.style.opacity = '0';
      }
    }

    const status = domCache.statusText;
    if (status) {
      const targetName = localPlayers[data.targetId]?.name || 'Gladiador';
      status.textContent = `💥 ${data.by} rebateu para ${targetName}! (Vel: ${data.speed}x)`;
    }
  });

  socket.on('game:deathball:countdown', (data) => {
    activeCountdown = data.count;
    if (activeCountdown > 0) {
      countdownActive = true;
      countdownEndingText = null;
      try { AudioEngine.countdown(activeCountdown); } catch (e) { safeAudio('tick'); }
      triggerShake(1.5);
    } else {
      // 0 = VAI!
      countdownEndingText = '⚔️ VAI!';
      countdownActive = true;
      try { AudioEngine.gameStart(); } catch (e) { safeAudio('gameStart'); }
      triggerShake(5);
      flash.alpha = 0.25;
      flash.color = '#00e5ff';
      setTimeout(() => {
        countdownActive = false;
        countdownEndingText = null;
      }, 700);
    }
  });

  socket.on('game:deathball:ball-launch', (data) => {
    countdownActive = false;
    countdownEndingText = null;
    serverTargetX = data.ball.x;
    serverTargetY = data.ball.y;
    serverTargetVx = data.ball.vx;
    serverTargetVy = data.ball.vy;
    ball.x = data.ball.x;
    ball.y = data.ball.y;
    ball.vx = data.ball.vx;
    ball.vy = data.ball.vy;
    currentTargetId = data.targetId;
    if (typeof data.speed === 'number') gameSpeed = data.speed;
    const status = domCache.statusText;
    if (status) {
      const targetName = localPlayers[data.targetId]?.name || 'Gladiador';
      status.textContent = `⚡ A bola foi lançada em direção a ${targetName}! Defenda-se!`;
    }
  });

  socket.on('game:deathball:whiff', (data) => {
    parryCooldownUntil = Date.now() + (data.cooldownMs || 450);
    const me = localPlayers[myId];
    if (me) {
      const px = (me.x / 100) * W;
      const py = (me.y / 100) * H;
      addFloatingText(px, py - 18, 'CEDO DEMAIS! ⏳', '#ff5252');
      safeAudio('whiff');
    }
  });

  socket.on('game:deathball:new-target', (data) => {
    serverTargetX = data.ball.x;
    serverTargetY = data.ball.y;
    serverTargetVx = data.ball.vx;
    serverTargetVy = data.ball.vy;
    ball.x = data.ball.x;
    ball.y = data.ball.y;
    ball.vx = data.ball.vx;
    ball.vy = data.ball.vy;
    ball.curve = 0;

    currentTargetId = data.targetId;
    gameSpeed = data.speed;
    if (isDuelMode !== !!data.isDuel) {
      isDuelMode = !!data.isDuel;
      offscreenBgNeedsRedraw = true;
    }

    hasDash = true;
    updateDashButtonUI();

    if (data.resetSpeed) {
      comboCount = 0;
      const comboBadge = domCache.comboBadge;
      if (comboBadge) comboBadge.style.opacity = '0';
      addFloatingText(W / 2, H / 2 - 30, '⚡ VELOCIDADE RESETADA!', '#00e5ff');
      flash.alpha = 0.20;
      flash.color = '#00e5ff';
      triggerShake(3);
    }

    if (data.targetId === myId) {
      safeAudio('lockOn');
    }
    const status = domCache.statusText;
    if (status) {
      const targetName = localPlayers[data.targetId]?.name || 'Gladiador';
      status.textContent = `🎯 Nova rodada! Alvo: ${targetName} (Vel: ${data.speed}x)`;
    }
  });

  socket.on('game:deathball:eliminated', (data) => {
    safeAudio('explosion');
    triggerShake(9);
    flash.alpha = 0.30;
    flash.color = '#ff1744';

    if (localPlayers[data.id]) {
      localPlayers[data.id].alive = false;
    }
    rebuildCachedPlayerList();

    const px = (data.x / 100) * W;
    const py = (data.y / 100) * H;
    addPulseRing(px, py, '#ff1744', 65);
    spawnParticles(px, py, 18, ['#ff1744', '#ff5252', '#ffd600', '#212121'], {
      speedMin: 2, speedMax: 6.5,
      sizeMin: 1.8, sizeMax: 3.5,
      life: 22
    });

    addFloatingText(px, py, '💀 ELIMINADO!', '#ff1744');

    const status = domCache.statusText;
    if (status) {
      status.textContent = `💀 ${data.name} FOI ELIMINADO!`;
    }
  });

  socket.on('game:deathball:gameover', (data) => {
    safeAudio('gameEnd');
    triggerShake(12);
    flash.alpha = 0.40;
    flash.color = '#ffd700';

    const bx = (ball.x / 100) * W;
    const by = (ball.y / 100) * H;
    spawnParticles(bx, by, 25, ['#ffd700', '#ffffff', '#ff6ab0', '#00e5ff'], {
      speedMin: 3, speedMax: 7.5,
      sizeMin: 2, sizeMax: 4.0,
      life: 30
    });

    setTimeout(() => {
      cleanupDeathBall();

      DOM.resultsOverlay.classList.remove('hidden');
      DOM.resultsTitle.textContent = '💀 DEATH BALL — Fim de Partida!';

      const hits = data.hits || 0;
      const maxSpd = data.maxSpeed || gameSpeed;
      const isWinnerMe = data.winnerId === myId;

      const rankings = Array.isArray(data.rankings) ? data.rankings : [];
      const rankingRows = rankings.map((r, idx) => {
        const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `${idx + 1}º`));
        const isMe = r.id === myId;
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:${isMe ? 'rgba(124,106,255,0.22)' : 'rgba(255,255,255,0.05)'}; border-radius:var(--radius-sm); border:1px solid ${isMe ? 'rgba(124,106,255,0.45)' : 'rgba(255,255,255,0.06)'}; margin-bottom:6px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-weight:900; min-width:26px;">${medal}</span>
              <span style="font-weight:${isMe ? '800' : '600'}; color:${isMe ? 'var(--accent-primary)' : 'var(--text-primary)'};">
                ${GameHub.escapeHtml(r.name)}${isMe ? ' (Você)' : ''}
              </span>
            </div>
            <div style="font-weight:900; color:#ffd700; font-family:var(--font-display);">
              +${r.gameScore} pts
            </div>
          </div>
        `;
      }).join('');

      DOM.resultsContent.innerHTML = `
        <div style="text-align:center; padding:var(--gap-md) 0;">
          <div style="font-size:3.8rem; margin-bottom:var(--gap-sm); animation:emojiPop 0.5s cubic-bezier(0.34,1.56,0.64,1);">🏆</div>

          <p style="font-family:var(--font-display); font-size:1.7rem; font-weight:900; background:linear-gradient(135deg,#ffd700,#ff1744); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:var(--gap-xs);">
            ${GameHub.escapeHtml(data.winner)}
          </p>
          <p style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:var(--gap-md);">
            ${isWinnerMe ? '🎉 Você foi o grande campeão sobrevivente da arena!' : 'Sobreviveu à arena mortal e eliminou todos os adversários!'}
          </p>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--gap-md); margin-bottom:var(--gap-md);">
            <div style="background:var(--bg-glass); border-radius:var(--radius-md); padding:10px; border:1px solid rgba(0,229,255,0.25);">
              <div style="font-size:1.6rem; font-weight:900; color:var(--accent-tertiary); font-family:var(--font-display);">⚡ ${hits}</div>
              <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Total de Rebatidas</div>
            </div>
            <div style="background:var(--bg-glass); border-radius:var(--radius-md); padding:10px; border:1px solid rgba(255,23,68,0.25);">
              <div style="font-size:1.6rem; font-weight:900; color:#ff1744; font-family:var(--font-display);">${maxSpd.toFixed(1)}x</div>
              <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Velocidade Máxima</div>
            </div>
          </div>

          <!-- PLACAR DESTA PARTIDA -->
          <div style="margin-top:var(--gap-sm); text-align:left; background:rgba(0,0,0,0.25); border-radius:var(--radius-md); padding:12px; border:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-weight:800; font-size:0.8rem; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.05em;">
                ⚔️ Placar Desta Partida (Death Ball)
              </span>
              <span style="font-size:0.72rem; color:var(--accent-primary); font-weight:700;">
                ⭐ Pontos desta Partida
              </span>
            </div>
            <div style="max-height:160px; overflow-y:auto; padding-right:2px;">
              ${rankingRows}
            </div>
            <p style="font-size:0.72rem; color:var(--text-muted); text-align:center; margin-top:8px; margin-bottom:0;">
              💡 Os pontos conquistados nesta partida foram somados ao seu Ranking Geral visível no Lobby.
            </p>
          </div>
        </div>
      `;
    }, 1100);
  });
})();
