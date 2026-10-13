/**
 * Rinha.io — Engine de Combate Compartilhada
 * ===========================================
 * Simulação determinística que roda IDENTICAMENTE no servidor (autoritativo)
 * e no cliente (predição/reconciliação).
 *
 * Regras de determinismo:
 * - Sem Math.random() — usar Config.createRng(seed) quando necessário
 * - Fixed timestep apenas (1/60s)
 * - Iteração de jogadores em ordem sorted para resolução determinística
 * - Engine é função pura: (worldState, inputs) => newWorldState + events
 *
 * UMD module: funciona com require() no Node e <script> no browser.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./rinha-config.js'));
  } else {
    root.RinhaEngine = factory(root.RinhaConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (Config) {
  'use strict';

  // ==================== ESTADOS DO JOGADOR ====================
  const States = {
    NEUTRAL: 'neutral',
    STARTUP_LIGHT: 'startup_light',
    ACTIVE_LIGHT: 'active_light',
    RECOVERY_LIGHT: 'recovery_light',
    STARTUP_HEAVY: 'startup_heavy',
    ACTIVE_HEAVY: 'active_heavy',
    RECOVERY_HEAVY: 'recovery_heavy',
    GUARDING: 'guarding',
    PARRYING: 'parrying',
    GRAB_STARTUP: 'grab_startup',
    GRAB_ACTIVE: 'grab_active',
    GRAB_RECOVERY: 'grab_recovery',
    DASHING: 'dashing',
    BURST: 'burst',
    HITSTUN: 'hitstun',
    BLOCKSTUN: 'blockstun',
    STUNNED: 'stunned',       // postura quebrada
    THROWN: 'thrown',         // agarrado
    PARRY_STAGGER: 'parry_stagger', // atacante parried
    KNOCKED_DOWN: 'knocked_down',
    DEAD: 'dead'
  };

  // Estados onde o jogador pode agir (transições permitidas)
  const CAN_ACT_STATES = new Set([
    States.NEUTRAL, States.GUARDING
  ]);

  // ==================== TIPOS DE EVENTO ====================
  const EventTypes = {
    HIT: 'hit',
    BLOCK: 'block',
    PARRY: 'parry',
    GRAB: 'grab',
    THROW: 'throw',
    WALL_SPLAT: 'wall_splat',
    POSTURE_BREAK: 'posture_break',
    KO: 'ko',
    ROUND_END: 'round_end',
    BURST: 'burst'
  };

  // ==================== CRIAÇÃO DE ESTADO ====================

  /**
   * Cria um novo mundo de simulação.
   * @param {string} arenaId - Identificador da arena (para futuras variantes)
   * @param {number} seed - Seed para PRNG determinístico
   */
  function createWorld(arenaId, seed) {
    return {
      tick: 0,
      phase: 'waiting', // waiting, countdown, fighting, round_end, match_over
      arenaId: arenaId || 'default',
      players: {},        // playerId -> PlayerState
      events: [],         // eventos gerados neste tick
      scores: {},         // playerId -> roundsWon
      roundNumber: 0,
      rng: Config.createRng(seed || 42),
      // Contagem de jogadores vivos por time (para modos de equipe)
      teams: {}           // teamId -> [playerId]
    };
  }

  /**
   * Cria um jogador no mundo.
   * @param {string} id - ID único do jogador (socketId ou similar)
   * @param {string} name - Nome exibido
   * @param {string} fighterId - 'faisca' ou 'golias'
   * @param {number} x - Posição X inicial
   * @param {number} y - Posição Y inicial
   * @param {string} team - Time ('a', 'b', ou null para FFA)
   */
  function createPlayer(id, name, fighterId, x, y, team) {
    const fDef = Config.FIGHTERS[fighterId];
    if (!fDef) throw new Error('Fighter desconhecido: ' + fighterId);

    return {
      id: id,
      name: name,
      fighterId: fighterId,
      team: team || null,

      // Posição e física
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      facing: 0,          // ângulo em radianos (direção da mira)

      // Stats vitais
      hp: fDef.hp,
      hpMax: fDef.hp,
      posture: 0,
      stamina: fDef.staminaMax,
      staminaMax: fDef.staminaMax,
      momentum: 0,

      // State machine
      state: States.NEUTRAL,
      stateTicks: 0,       // ticks no estado atual
      currentAction: null, // 'light', 'heavy', 'grab', 'dash', 'burst'

      // Combo tracking
      comboCount: 0,
      comboTimer: 0,       // ticks desde último hit
      dashCancelsUsed: 0,

      // Flags
      alive: true,
      invulnFrames: 0,     // ticks restantes de invulnerabilidade
      hasHitThisAction: false, // previne multi-hit no mesmo ataque

      // Visual (não afeta simulação, usado pelo renderer)
      lastDamageTaken: 0,
      flashTimer: 0
    };
  }

  // ==================== INPUT PROCESSING ====================

  /**
   * Decodifica input compacto do formato wire.
   * @param {object} raw - Input no formato { t, mx, my, ax, ay, btn }
   * @returns {object} Input decodificado
   */
  function decodeInput(raw) {
    if (!raw) return null;
    const btn = raw.btn || 0;
    return {
      tick: raw.t || 0,
      moveX: (raw.mx || 0) / 10,  // desnormaliza de int8
      moveY: (raw.my || 0) / 10,
      aimX: raw.ax || 0,
      aimY: raw.ay || 0,
      attackLight: !!(btn & 0x01),
      attackHeavy: !!(btn & 0x02),
      dash: !!(btn & 0x04),
      guard: !!(btn & 0x08),
      grab: !!(btn & 0x10),
      burst: !!(btn & 0x20)
    };
  }

  // ==================== STEP PRINCIPAL ====================

  /**
   * Avança a simulação em exatamente UM tick fixo.
   * Esta é a função core chamada 60x/segundo tanto no server quanto no client.
   *
   * @param {object} world - Estado do mundo (mutado in-place)
   * @param {object} inputsByPlayerId - Map de playerId -> rawInput
   * @returns {Array} Eventos gerados neste tick
   */
  function step(world, inputsByPlayerId) {
    world.events = [];
    world.tick++;

    // Ordem determinística de processamento
    const playerIds = Object.keys(world.players).sort();

    // Fase 1: Processar inputs e transições de estado
    for (const pid of playerIds) {
      const p = world.players[pid];
      if (!p.alive) continue;

      const rawInput = inputsByPlayerId[pid];
      const input = rawInput ? decodeInput(rawInput) : null;

      processPlayerInput(world, p, input);
    }

    // Fase 2: Física e movimento
    for (const pid of playerIds) {
      const p = world.players[pid];
      if (!p.alive) continue;
      applyPhysics(world, p);
    }

    // Fase 3: Resolução de hitboxes e combate
    for (const pid of playerIds) {
      const p = world.players[pid];
      if (!p.alive) continue;
      resolveCombat(world, p, playerIds);
    }

    // Fase 4: Separação de corpos (evita overlap)
    separatePlayers(world, playerIds);

    // Fase 5: Decay e regeneração
    for (const pid of playerIds) {
      const p = world.players[pid];
      if (!p.alive) continue;
      applyDecayAndRegen(world, p);
    }

    return world.events;
  }

  // ==================== PROCESSAMENTO DE INPUT ====================

  function processPlayerInput(world, p, input) {
    // Avançar contador de estado
    p.stateTicks++;

    // Decrementar timers
    if (p.invulnFrames > 0) p.invulnFrames--;
    if (p.flashTimer > 0) p.flashTimer--;
    if (p.comboTimer > 0) {
      p.comboTimer++;
      if (p.comboTimer >= Config.COMBO.resetTimeoutTicks) {
        p.comboCount = 0;
        p.comboTimer = 0;
        p.dashCancelsUsed = 0;
      }
    }

    // Atualizar mira se tiver input
    if (input) {
      const dx = input.aimX - p.x;
      const dy = input.aimY - p.y;
      if (dx !== 0 || dy !== 0) {
        p.facing = Math.atan2(dy, dx);
      }
    }

    // Máquina de estados
    switch (p.state) {
      case States.NEUTRAL:
        handleNeutralInput(world, p, input);
        break;

      case States.STARTUP_LIGHT:
      case States.STARTUP_HEAVY:
        handleAttackStartup(world, p, input);
        break;

      case States.ACTIVE_LIGHT:
      case States.ACTIVE_HEAVY:
        handleAttackActive(world, p);
        break;

      case States.RECOVERY_LIGHT:
      case States.RECOVERY_HEAVY:
        handleAttackRecovery(world, p);
        break;

      case States.GUARDING:
        handleGuarding(world, p, input);
        break;

      case States.PARRYING:
        handleParrying(world, p);
        break;

      case States.GRAB_STARTUP:
        handleGrabStartup(world, p);
        break;

      case States.GRAB_ACTIVE:
        handleGrabActive(world, p, playerIds);
        break;

      case States.GRAB_RECOVERY:
        handleGrabRecovery(world, p);
        break;

      case States.DASHING:
        handleDashing(world, p);
        break;

      case States.BURST:
        handleBurst(world, p, playerIds);
        break;

      case States.HITSTUN:
      case States.BLOCKSTUN:
      case States.STUNNED:
      case States.THROWN:
      case States.PARRY_STAGGER:
      case States.KNOCKED_DOWN:
        handleStunState(world, p);
        break;

      case States.DEAD:
        // Não faz nada
        break;
    }
  }

  // --- Handlers de estado ---

  function handleNeutralInput(world, p, input) {
    if (!input) return;

    // Movimento base
    if (input.moveX !== 0 || input.moveY !== 0) {
      const len = Math.sqrt(input.moveX * input.moveX + input.moveY * input.moveY);
      const norm = Math.min(len, 1.0);
      const fDef = Config.FIGHTERS[p.fighterId];
      const speed = fDef.speed * (norm / Math.max(len, 0.01));
      p.vx = (input.moveX / Math.max(len, 0.01)) * speed * norm;
      p.vy = (input.moveY / Math.max(len, 0.01)) * speed * norm;
    } else {
      p.vx *= 0.7; // friction
      p.vy *= 0.7;
    }

    // Prioridade de ações: burst > dash > grab > heavy > light > guard
    if (input.burst && p.momentum >= Config.MOMENTUM.burstCost && p.stamina >= 10) {
      enterState(p, States.BURST);
      p.currentAction = 'burst';
      p.momentum -= Config.MOMENTUM.burstCost;
      addEvent(world, EventTypes.BURST, { playerId: p.id, x: p.x, y: p.y });
      return;
    }

    if (input.dash && p.stamina >= Config.FIGHTERS[p.fighterId].dash.staminaCost) {
      const dashDef = Config.FIGHTERS[p.fighterId].dash;
      p.stamina -= dashDef.staminaCost;
      enterDash(p, dashDef);
      return;
    }

    if (input.grab) {
      enterState(p, States.GRAB_STARTUP);
      p.currentAction = 'grab';
      return;
    }

    if (input.attackHeavy) {
      enterState(p, States.STARTUP_HEAVY);
      p.currentAction = 'heavy';
      p.hasHitThisAction = false;
      return;
    }

    if (input.attackLight) {
      enterState(p, States.STARTUP_LIGHT);
      p.currentAction = 'light';
      p.hasHitThisAction = false;
      return;
    }

    if (input.guard) {
      enterState(p, States.PARRYING); // Começa na janela de parry
      p.currentAction = 'guard';
      return;
    }
  }

  function handleAttackStartup(world, p, input) {
    const fDef = Config.FIGHTERS[p.fighterId];
    const atkDef = p.currentAction === 'heavy' ? fDef.attacks.heavy : fDef.attacks.light;

    // Dash cancel durante startup (finta) — custa stamina extra
    if (input && input.dash && p.dashCancelsUsed < Config.COMBO.maxDashCancels) {
      if (p.stamina >= Config.COMBO.dashCancelStaminaCost) {
        p.stamina -= Config.COMBO.dashCancelStaminaCost;
        p.dashCancelsUsed++;
        enterDash(p, fDef.dash);
        return;
      }
    }

    // Transição para active frames
    if (p.stateTicks >= atkDef.startup) {
      const activeState = p.currentAction === 'heavy' ? States.ACTIVE_HEAVY : States.ACTIVE_LIGHT;
      enterState(p, activeState);
    }
  }

  function handleAttackActive(world, p) {
    const fDef = Config.FIGHTERS[p.fighterId];
    const atkDef = p.currentAction === 'heavy' ? fDef.attacks.heavy : fDef.attacks.light;

    // Verificar fim dos active frames
    const totalBeforeRecovery = atkDef.startup + atkDef.active;
    if (p.stateTicks >= totalBeforeRecovery) {
      const recState = p.currentAction === 'heavy' ? States.RECOVERY_HEAVY : States.RECOVERY_LIGHT;
      enterState(p, recState);
    }
  }

  function handleAttackRecovery(world, p) {
    const fDef = Config.FIGHTERS[p.fighterId];
    const atkDef = p.currentAction === 'heavy' ? fDef.attacks.heavy : fDef.attacks.light;

    const totalDuration = atkDef.startup + atkDef.active + atkDef.recovery;
    if (p.stateTicks >= totalDuration) {
      enterState(p, States.NEUTRAL);
      p.currentAction = null;
    }

    // Reduzir velocidade durante recovery (comprometimento)
    p.vx *= 0.85;
    p.vy *= 0.85;
  }

  function handleGuarding(world, p, input) {
    // Sair da guarda se soltar o botão
    if (!input || !input.guard) {
      enterState(p, States.NEUTRAL);
      p.currentAction = null;
      return;
    }

    // Movimento reduzido durante guarda
    if (input.moveX !== 0 || input.moveY !== 0) {
      const fDef = Config.FIGHTERS[p.fighterId];
      const guardSpeed = fDef.speed * 0.3;
      const len = Math.sqrt(input.moveX * input.moveX + input.moveY * input.moveY);
      const norm = Math.min(len, 1.0);
      p.vx = (input.moveX / Math.max(len, 0.01)) * guardSpeed * norm;
      p.vy = (input.moveY / Math.max(len, 0.01)) * guardSpeed * norm;
    } else {
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }

  function handleParrying(world, p) {
    // Janela de parry expira → transiciona para guarding normal
    if (p.stateTicks >= Config.POSTURE.parryWindowTicks) {
      enterState(p, States.GUARDING);
    }
  }

  function handleGrabStartup(world, p) {
    const fDef = Config.FIGHTERS[p.fighterId];
    if (p.stateTicks >= fDef.grab.startup) {
      enterState(p, States.GRAB_ACTIVE);
    }
  }

  function handleGrabActive(world, p, playerIds) {
    const fDef = Config.FIGHTERS[p.fighterId];
    const totalBeforeRecovery = fDef.grab.startup + fDef.grab.active;

    if (p.stateTicks >= totalBeforeRecovery) {
      enterState(p, States.GRAB_RECOVERY);
      return;
    }

    // Grab já foi resolvido na fase de combate (resolveCombat)
    // Aqui só controlamos a duração
  }

  function handleGrabRecovery(world, p) {
    const fDef = Config.FIGHTERS[p.fighterId];
    const totalDuration = fDef.grab.startup + fDef.grab.active + fDef.grab.recovery;
    if (p.stateTicks >= totalDuration) {
      enterState(p, States.NEUTRAL);
      p.currentAction = null;
    }
    p.vx *= 0.85;
    p.vy *= 0.85;
  }

  function handleDashing(world, p) {
    const fDef = Config.FIGHTERS[p.fighterId];
    const dashDef = fDef.dash;

    if (p.stateTicks >= dashDef.duration) {
      enterState(p, States.NEUTRAL);
      p.currentAction = null;
      return;
    }

    // Movimento rápido na direção do facing durante dash
    p.vx = Math.cos(p.facing) * dashDef.speed;
    p.vy = Math.sin(p.facing) * dashDef.speed;

    // Invulnerabilidade nos primeiros frames
    if (p.stateTicks <= dashDef.invulnFrames) {
      p.invulnFrames = 1;
    }
  }

  function handleBurst(world, p, playerIds) {
    // Burst dura ~10 ticks e empurra todos os inimigos próximos
    if (p.stateTicks >= 10) {
      enterState(p, States.NEUTRAL);
      p.currentAction = null;
      return;
    }

    // Efeito visual no tick 1
    if (p.stateTicks === 1) {
      for (const otherId of playerIds) {
        if (otherId === p.id) continue;
        const other = world.players[otherId];
        if (!other.alive) continue;
        if (isTeammate(p, other)) continue;

        const dx = other.x - p.x;
        const dy = other.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < Config.MOMENTUM.burstRadius) {
          // Empurrão forte + quebra combo do oponente
          const pushForce = Config.MOMENTUM.burstForce * (1 - dist / Config.MOMENTUM.burstRadius);
          const angle = Math.atan2(dy, dx);
          other.vx += Math.cos(angle) * pushForce;
          other.vy += Math.sin(angle) * pushForce;

          // Quebra combo do oponente
          other.comboCount = 0;
          other.comboTimer = 0;
          other.dashCancelsUsed = 0;

          // Se estava em combo/stun, volta para neutral
          if ([States.HITSTUN, States.BLOCKSTUN].includes(other.state)) {
            enterState(other, States.NEUTRAL);
          }
        }
      }
    }

    p.vx *= 0.5;
    p.vy *= 0.5;
  }

  function handleStunState(world, p) {
    // Duração baseada no tipo de stun
    let duration;
    switch (p.state) {
      case States.HITSTUN: duration = 12; break;
      case States.BLOCKSTUN: duration = 8; break;
      case States.STUNNED: duration = Config.POSTURE.brokenStunTicks; break;
      case States.THROWN: duration = 20; break;
      case States.PARRY_STAGGER: duration = 18; break;
      case States.KNOCKED_DOWN: duration = 30; break;
      default: duration = 10;
    }

    if (p.stateTicks >= duration) {
      enterState(p, States.NEUTRAL);
      p.currentAction = null;
    }

    // Fricção alta durante stun
    p.vx *= 0.9;
    p.vy *= 0.9;
  }

  // ==================== FÍSICA ====================

  function applyPhysics(world, p) {
    // Aplicar velocidade
    p.x += p.vx;
    p.y += p.vy;

    const arena = Config.ARENA;
    const radius = Config.FIGHTERS[p.fighterId].radius;

    // Colisão com paredes da arena
    let hitWall = false;
    let wallNormalX = 0, wallNormalY = 0;

    if (p.x - radius < 0) {
      p.x = radius;
      wallNormalX = 1;
      hitWall = true;
    } else if (p.x + radius > arena.width) {
      p.x = arena.width - radius;
      wallNormalX = -1;
      hitWall = true;
    }

    if (p.y - radius < 0) {
      p.y = radius;
      wallNormalY = 1;
      hitWall = true;
    } else if (p.y + radius > arena.height) {
      p.y = arena.height - radius;
      wallNormalY = -1;
      hitWall = true;
    }

    // Wall bounce/splat
    if (hitWall) {
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);

      // Wall splat: impacto forte contra parede causa stun bonus
      if (speed >= arena.wallSplatSpeedThreshold && p.state === States.HITSTUN) {
        addEvent(world, EventTypes.WALL_SPLAT, {
          playerId: p.id,
          x: p.x,
          y: p.y,
          damage: Math.floor(speed * 2)
        });
        // Dano extra de wall splat
        applyDamage(world, p, Math.floor(speed * 2), null);
        // Estende stun
        p.stateTicks = Math.max(0, p.stateTicks - 8);
      }

      // Quique na parede
      if (wallNormalX !== 0) p.vx *= -arena.wallRestitution;
      if (wallNormalY !== 0) p.vy *= -arena.wallRestitution;

      // Fricção na parede
      p.vx *= (1 - arena.wallFriction);
      p.vy *= (1 - arena.wallFriction);
    }

    // Colisão com obstáculos
    for (const obs of arena.obstacles) {
      resolveObstacleCollision(p, obs, radius, arena);
    }
  }

  function resolveObstacleCollision(p, obs, radius, arena) {
    // AABB vs Circle simplificado
    const closestX = Config.clamp(p.x, obs.x, obs.x + obs.w);
    const closestY = Config.clamp(p.y, obs.y, obs.y + obs.h);
    const dx = p.x - closestX;
    const dy = p.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq < radius * radius && distSq > 0) {
      const dist = Math.sqrt(distSq);
      const overlap = radius - dist;
      const nx = dx / dist;
      const ny = dy / dist;

      p.x += nx * overlap;
      p.y += ny * overlap;

      // Reflexão
      const dot = p.vx * nx + p.vy * ny;
      p.vx -= 2 * dot * nx * (1 - arena.wallRestitution * 0.5);
      p.vy -= 2 * dot * ny * (1 - arena.wallRestitution * 0.5);
    }
  }

  // ==================== COMBATE ====================

  function resolveCombat(world, attacker, playerIds) {
    // Apenas estados ativos podem causar dano
    const isActiveAttack = attacker.state === States.ACTIVE_LIGHT ||
                           attacker.state === States.ACTIVE_HEAVY;
    const isActiveGrab = attacker.state === States.GRAB_ACTIVE;

    if (!isActiveAttack && !isActiveGrab) return;
    if (attacker.hasHitThisAction) return; // Já acertou neste golpe

    const fDef = Config.FIGHTERS[attacker.fighterId];

    for (const targetId of playerIds) {
      if (targetId === attacker.id) continue;
      const target = world.players[targetId];
      if (!target.alive) continue;
      if (isTeammate(attacker, target)) continue;
      if (target.invulnFrames > 0) continue;

      if (isActiveAttack) {
        checkAttackHit(world, attacker, target, fDef);
      } else if (isActiveGrab) {
        checkGrabHit(world, attacker, target, fDef);
      }

      if (attacker.hasHitThisAction) break; // Um hit por ação
    }
  }

  function checkAttackHit(world, attacker, target, fDef) {
    const atkDef = attacker.currentAction === 'heavy' ? fDef.attacks.heavy : fDef.attacks.light;
    const hb = atkDef.hitbox;

    // Calcular posição da hitbox baseada no facing do atacante
    const cos = Math.cos(attacker.facing);
    const sin = Math.sin(attacker.facing);

    // Centro da hitbox rotacionado
    const hbCenterX = attacker.x + (hb.offsetX * cos - hb.offsetY * sin);
    const hbCenterY = attacker.y + (hb.offsetX * sin + hb.offsetY * cos);

    // Hitbox como retângulo rotacionado (simplificado como círculo para colisão)
    const hbRadius = Math.max(hb.width, hb.height) / 2;
    const targetRadius = Config.FIGHTERS[target.fighterId].radius;

    const dx = hbCenterX - target.x;
    const dy = hbCenterY - target.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > hbRadius + targetRadius) return; // Não colidiu

    // Verificar arco de alcance (ângulo entre facing e direção ao alvo)
    const angleToTarget = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    const angleDiff = Math.abs(Config.normalizeAngle(angleToTarget - attacker.facing));
    if (angleDiff > hb.angle) return; // Fora do arco

    // HIT CONFIRMADO — resolver triângulo de combate
    attacker.hasHitThisAction = true;
    resolveHitTriangle(world, attacker, target, atkDef);
  }

  function checkGrabHit(world, attacker, target, fDef) {
    const grabDef = fDef.grab;
    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > grabDef.range + Config.FIGHTERS[target.fighterId].radius) return;

    // Verificar ângulo (grab tem arco mais estreito)
    const angleToTarget = Math.atan2(dy, dx);
    const angleDiff = Math.abs(Config.normalizeAngle(angleToTarget - attacker.facing));
    if (angleDiff > 0.5) return;

    attacker.hasHitThisAction = true;

    // Triângulo: grab vence guard e parry
    if (target.state === States.GUARDING || target.state === States.PARRYING) {
      // Grab conecta contra defesa!
      applyGrab(world, attacker, target, grabDef);
      return;
    }

    // Grab vs neutral/attack startup = counter-hit
    if (target.state === States.NEUTRAL ||
        target.state === States.STARTUP_LIGHT ||
        target.state === States.STARTUP_HEAVY) {
      applyGrab(world, attacker, target, grabDef);
      return;
    }

    // Grab erra contra outros estados (hitstun, dashing, etc.)
  }

  /**
   * Resolve o triângulo de combate quando um ataque conecta.
   */
  function resolveHitTriangle(world, attacker, target, atkDef) {
    // Parry perfeito vence ataque
    if (target.state === States.PARRYING) {
      // PARRY!
      enterState(attacker, States.PARRY_STAGGER);
      attacker.currentAction = null;

      // Defender recupera postura e ganha momentum
      target.posture = Math.max(0, target.posture - Config.POSTURE.postureRecoveryOnParry);
      target.momentum = Math.min(Config.MOMENTUM.max, target.momentum + Config.MOMENTUM.gainOnParry);

      addEvent(world, EventTypes.PARRY, {
        defenderId: target.id,
        attackerId: attacker.id,
        x: (attacker.x + target.x) / 2,
        y: (attacker.y + target.y) / 2
      });
      return;
    }

    // Guarda bloqueia parte do dano, converte em postura
    if (target.state === States.GUARDING) {
      const blockedDmg = Math.floor(atkDef.damage * (1 - Config.POSTURE.guardDamageReduction));
      const postureDmg = Config.POSTURE.postureDamageOnBlock;

      applyDamage(world, target, blockedDmg, attacker);
      target.posture += postureDmg;

      enterState(target, States.BLOCKSTUN);

      // Knockback reduzido
      const kbAngle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
      target.vx += Math.cos(kbAngle) * atkDef.knockback * 0.4;
      target.vy += Math.sin(kbAngle) * atkDef.knockback * 0.4;

      addEvent(world, EventTypes.BLOCK, {
        defenderId: target.id,
        attackerId: attacker.id,
        damage: blockedDmg,
        postureDamage: postureDmg,
        x: target.x,
        y: target.y
      });

      // Verificar quebra de postura
      checkPostureBreak(world, target);
      return;
    }

    // Hit limpo (neutral, startup, recovery, etc.)
    // Calcular dano com scaling de combo
    const comboIdx = Math.min(attacker.comboCount, Config.COMBO.damageScaling.length - 1);
    const scale = Config.COMBO.damageScaling[comboIdx] || Config.COMBO.minDamageScale;
    const finalDamage = Math.floor(atkDef.damage * scale);

    applyDamage(world, target, finalDamage, attacker);

    // Combo tracking
    attacker.comboCount++;
    attacker.comboTimer = 0;

    // Momentum
    attacker.momentum = Math.min(Config.MOMENTUM.max, attacker.momentum + Config.MOMENTUM.gainOnHitDeal);
    target.momentum = Math.min(Config.MOMENTUM.max, target.momentum + Config.MOMENTUM.gainOnHitTake);

    // Knockback
    const kbAngle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    target.vx += Math.cos(kbAngle) * atkDef.knockback;
    target.vy += Math.sin(kbAngle) * atkDef.knockback;

    // Postura damage direto em hit limpo (menor que block)
    target.posture += Math.floor(atkDef.postureDamage * 0.5);

    enterState(target, States.HITSTUN);

    addEvent(world, EventTypes.HIT, {
      attackerId: attacker.id,
      defenderId: target.id,
      damage: finalDamage,
      comboCount: attacker.comboCount,
      knockback: atkDef.knockback,
      x: target.x,
      y: target.y,
      isHeavy: attacker.currentAction === 'heavy'
    });

    checkPostureBreak(world, target);
  }

  function applyGrab(world, attacker, target, grabDef) {
    const finalDamage = grabDef.damage;
    applyDamage(world, target, finalDamage, attacker);

    enterState(target, States.THROWN);

    // Throw direction
    const throwAngle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    target.vx = Math.cos(throwAngle) * 6.0;
    target.vy = Math.sin(throwAngle) * 6.0;

    // Reset postura do target (grab ignora postura)
    target.posture = Math.min(target.posture, Config.POSTURE.max * 0.5);

    attacker.comboCount++;
    attacker.comboTimer = 0;
    attacker.momentum = Math.min(Config.MOMENTUM.max, attacker.momentum + Config.MOMENTUM.gainOnHitDeal);

    addEvent(world, EventTypes.THROW, {
      attackerId: attacker.id,
      defenderId: target.id,
      damage: finalDamage,
      x: target.x,
      y: target.y
    });
  }

  // ==================== DANO E STATUS ====================

  function applyDamage(world, p, amount, attacker) {
    if (amount <= 0) return;
    p.hp -= amount;
    p.lastDamageTaken = amount;
    p.flashTimer = 4;

    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      enterState(p, States.DEAD);

      addEvent(world, EventTypes.KO, {
        playerId: p.id,
        killerId: attacker ? attacker.id : null,
        x: p.x,
        y: p.y
      });

      checkRoundEnd(world);
    }
  }

  function checkPostureBreak(world, p) {
    if (p.posture >= Config.POSTURE.max) {
      p.posture = Config.POSTURE.max;
      enterState(p, States.STUNNED);
      p.currentAction = null;

      addEvent(world, EventTypes.POSTURE_BREAK, {
        playerId: p.id,
        x: p.x,
        y: p.y
      });
    }
  }

  function checkRoundEnd(world) {
    const playerIds = Object.keys(world.players);
    const alive = playerIds.filter(id => world.players[id].alive);

    // FFA: último vivo vence
    if (alive.length <= 1) {
      const winnerId = alive[0] || null;
      addEvent(world, EventTypes.ROUND_END, {
        winnerId: winnerId,
        reason: 'ko'
      });
      world.phase = 'round_end';
    }

    // 1v1 / 2v2: verificar times
    // (lógica adicional será implementada no room-manager)
  }

  // ==================== SEPARAÇÃO DE CORPOS ====================

  function separatePlayers(world, playerIds) {
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const a = world.players[playerIds[i]];
        const b = world.players[playerIds[j]];
        if (!a.alive || !b.alive) continue;

        const rA = Config.FIGHTERS[a.fighterId].radius;
        const rB = Config.FIGHTERS[b.fighterId].radius;
        const minDist = rA + rB;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDist * minDist && distSq > 0.001) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          // Empurrar igualmente
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
        }
      }
    }
  }

  // ==================== DECAY E REGENERAÇÃO ====================

  function applyDecayAndRegen(world, p) {
    const fDef = Config.FIGHTERS[p.fighterId];

    // Stamina regen (mais rápida em neutral)
    if (p.state === States.NEUTRAL) {
      p.stamina = Math.min(fDef.staminaMax, p.stamina + fDef.staminaRegen);
    } else {
      p.stamina = Math.min(fDef.staminaMax, p.stamina + fDef.staminaRegen * 0.3);
    }

    // Posture decay natural
    if (p.state !== States.GUARDING && p.state !== States.BLOCKSTUN) {
      p.posture = Math.max(0, p.posture - Config.POSTURE.decayPerTick);
    }

    // Momentum decay lento
    p.momentum = Math.max(0, p.momentum - Config.MOMENTUM.decayPerTick);
  }

  // ==================== UTILITÁRIOS ====================

  function enterState(p, newState) {
    p.state = newState;
    p.stateTicks = 0;
  }

  function enterDash(p, dashDef) {
    enterState(p, States.DASHING);
    p.currentAction = 'dash';
    p.invulnFrames = dashDef.invulnFrames;
  }

  function isTeammate(a, b) {
    if (!a.team || !b.team) return false;
    return a.team === b.team;
  }

  function addEvent(world, type, data) {
    world.events.push({ type, tick: world.tick, ...data });
  }

  /**
   * Clona profundamente o estado do mundo para reconciliação.
   * Necessário para re-simular inputs não-confirmados sobre estado do servidor.
   */
  function cloneWorld(world) {
    const cloned = {
      tick: world.tick,
      phase: world.phase,
      arenaId: world.arenaId,
      players: {},
      events: [],
      scores: { ...world.scores },
      roundNumber: world.roundNumber,
      rng: Config.createRng(0), // RNG não precisa ser clonado fielmente para reconciliação
      teams: {}
    };

    for (const pid of Object.keys(world.players)) {
      cloned.players[pid] = clonePlayer(world.players[pid]);
    }

    for (const tid of Object.keys(world.teams)) {
      cloned.teams[tid] = [...world.teams[tid]];
    }

    return cloned;
  }

  function clonePlayer(p) {
    return {
      id: p.id,
      name: p.name,
      fighterId: p.fighterId,
      team: p.team,
      x: p.x, y: p.y,
      vx: p.vx, vy: p.vy,
      facing: p.facing,
      hp: p.hp, hpMax: p.hpMax,
      posture: p.posture,
      stamina: p.stamina, staminaMax: p.staminaMax,
      momentum: p.momentum,
      state: p.state,
      stateTicks: p.stateTicks,
      currentAction: p.currentAction,
      comboCount: p.comboCount,
      comboTimer: p.comboTimer,
      dashCancelsUsed: p.dashCancelsUsed,
      alive: p.alive,
      invulnFrames: p.invulnFrames,
      hasHitThisAction: p.hasHitThisAction,
      lastDamageTaken: p.lastDamageTaken,
      flashTimer: p.flashTimer
    };
  }

  // ==================== EXPORTS ====================

  return {
    States,
    EventTypes,
    createWorld,
    createPlayer,
    step,
    cloneWorld,
    clonePlayer,
    decodeInput,
    isTeammate
  };
}));