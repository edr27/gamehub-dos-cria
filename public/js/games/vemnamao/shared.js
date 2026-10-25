/**
 * Vem na Mão — núcleo compartilhado (servidor Node + navegador)
 *
 * Briga de rua vista de cima, battle royale até 8. Triângulo:
 *   PORRADA vence AGARRÃO (é mais rápida e interrompe)
 *   AGARRÃO vence PARRY   (agarra quem está se defendendo)
 *   PARRY   vence PORRADA (devolve: atordoa quem bateu e dá contra-ataque turbinado)
 *
 * Aqui ficam constantes, armas, mapas, colisão e o passo de movimento determinístico.
 * O servidor é a autoridade; o cliente usa o MESMO passo para prever o próprio boneco.
 * Unidades: mundo em "u" (≈ px no zoom 1), tempo em segundos.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VemNaMaoShared = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = Object.freeze({
    TICK_HZ: 60,
    DT: 1 / 60,
    SNAP_EVERY: 2,              // 30 Hz
    INPUT_BATCH: 2,             // cliente manda 2 ticks de input por pacote

    P_R: 22,                    // raio do jogador
    HP: 100,
    SPEED: 235,
    ACCEL: 16,
    KB_DECAY: 6.5,              // decaimento do empurrão por segundo (exp)

    DASH_SPEED: 760,
    DASH_T: 0.15,
    DASH_IFRAME: 0.11,
    DASH_CHARGES: 2,
    DASH_RECHARGE: 1.35,

    PARRY_WIN: 0.2,             // janela de parry
    PARRY_RECOVER: 0.34,        // errou o parry: fica exposto
    PARRY_STUN: 0.85,           // quem bateu no parry fica tonto
    RIPOSTE_T: 1.2,             // tempo para usar o contra-ataque
    RIPOSTE_MULT: 1.6,

    GRAB_STARTUP: 0.15,
    GRAB_ACTIVE: 0.08,
    GRAB_RECOVER: 0.42,         // errou o agarrão
    GRAB_RANGE: 58,
    GRAB_ARC: 90,
    THROW_DMG: 16,
    THROW_KB: 640,
    THROW_STUN: 0.55,
    CLANK_STUN: 0.32,           // agarrou alguém batendo: toma

    WALL_SPLAT_SPEED: 300,      // bateu na parede com força: dano extra
    WALL_SPLAT_DMG: 7,
    WALL_SPLAT_STUN: 0.3,

    BUFFER_T: 0.16,             // comando apertado um pouco antes da hora fica guardado
    PICK_R: 44,
    HEAL: 30,
    BLEED_DPS: 3,
    BLEED_T: 4,
    SLOW_MULT: 0.6,
    KILL_CREDIT_T: 6,

    MAX_REWIND_MS: 160,         // compensação de lag nos golpes
    HIT_GRACE_MAX_MS: 150,      // golpe em humano espera um parry que já pode estar a caminho
    PARRY_LATE_TOL_MS: 40,
  });

  // Estados enviados na rede
  const ST = Object.freeze({ IDLE: 0, ATK_S: 1, ATK_A: 2, ATK_R: 3, GRAB: 4, PARRY: 5, STUN: 6, DASH: 7, SPECIAL: 8, DEAD: 9, GRAB_R: 10, PARRY_R: 11, HELD: 12 });
  // Botões (bits no input)
  const BTN = Object.freeze({ ATK: 1, PARRY: 2, GRAB: 4, DASH: 8, SPECIAL: 16, SWAP: 32 });

  /**
   * Armas. atk = golpe básico (startup/active/recovery em s, reach em u, arc em graus).
   * ranged: o golpe básico dispara projétil. special = habilidade única (Q).
   * uses = acertos até quebrar (ou munição/cargas).
   */
  const WEAPONS = Object.freeze({
    maos: {
      name: 'Mãos', uses: Infinity, color: '#efeee9',
      atk: { s: 0.12, a: 0.08, r: 0.18, dmg: 8, reach: 60, arc: 100, kb: 190, stun: 0.25 },
      special: { k: 'voadora', name: 'Voadora', cd: 5, desc: 'Chute voador para a frente' },
    },
    chinelo: {
      name: 'Chinelo', uses: 26, color: '#38bdf8',
      atk: { s: 0.1, a: 0.08, r: 0.16, dmg: 9, reach: 66, arc: 110, kb: 170, stun: 0.25 },
      special: { k: 'chinelada', name: 'Chinelada voadora', cd: 3, desc: 'Arremessa o chinelo e deixa lento' },
    },
    taco: {
      name: 'Taco', uses: 14, color: '#d6a35c',
      atk: { s: 0.26, a: 0.1, r: 0.32, dmg: 18, reach: 92, arc: 140, kb: 430, stun: 0.45 },
      special: { k: 'homerun', name: 'Home run', cd: 7, desc: 'Carrega e manda longe' },
    },
    peixeira: {
      name: 'Peixeira', uses: 22, color: '#cbd5e1',
      atk: { s: 0.09, a: 0.06, r: 0.14, dmg: 10, reach: 62, arc: 80, kb: 120, stun: 0.2 },
      special: { k: 'bote', name: 'Bote', cd: 4, desc: 'Avança e deixa sangrando' },
    },
    frigideira: {
      name: 'Frigideira', uses: 18, color: '#71717a',
      atk: { s: 0.18, a: 0.08, r: 0.24, dmg: 13, reach: 70, arc: 110, kb: 270, stun: 0.32 },
      special: { k: 'panelaco', name: 'Panelaço', cd: 6, desc: 'Parry longo que devolve com dano' },
    },
    estilingue: {
      name: 'Estilingue', uses: 15, color: '#a3e635', ranged: true,
      atk: { s: 0.14, a: 0.02, r: 0.26, dmg: 9, speed: 900, life: 0.75, kb: 140, stun: 0.18 },
      special: { k: 'rajada', name: 'Rajada', cd: 5, desc: 'Três pedras de uma vez' },
    },
    vassoura: {
      name: 'Vassoura', uses: 20, color: '#facc15',
      atk: { s: 0.16, a: 0.1, r: 0.22, dmg: 9, reach: 108, arc: 56, kb: 320, stun: 0.28 },
      special: { k: 'varrida', name: 'Varrida', cd: 6, desc: 'Gira e afasta todo mundo' },
    },
    bombinha: {
      name: 'Bombinha', uses: 3, color: '#f43f5e',
      atk: { s: 0.12, a: 0.08, r: 0.18, dmg: 8, reach: 60, arc: 100, kb: 190, stun: 0.25 },
      special: { k: 'bombinha', name: 'Bombinha de São João', cd: 0.8, desc: 'Explode depois de um tempinho' },
    },
  });
  const WEAPON_IDS = ['maos', 'chinelo', 'taco', 'peixeira', 'frigideira', 'estilingue', 'vassoura', 'bombinha'];
  const DROPPABLE = ['chinelo', 'taco', 'peixeira', 'frigideira', 'estilingue', 'vassoura', 'bombinha'];

  // Parâmetros dos especiais (usados pelo servidor e pelo desenho do cliente)
  const SPECIAL = Object.freeze({
    voadora: { t: 0.24, speed: 900, from: 0.03, to: 0.22, dmg: 14, kb: 430, stun: 0.42, r: 34 },
    chinelada: { speed: 720, life: 0.85, dmg: 12, slow: 1.5, kb: 160, stun: 0.25 },
    homerun: { charge: 0.45, a: 0.1, r: 0.3, dmg: 26, reach: 102, arc: 160, kb: 920, stun: 0.6 },
    bote: { t: 0.16, speed: 1100, dmg: 12, bleed: 4, kb: 160, stun: 0.25, r: 36 },
    panelaco: { win: 0.7, dmg: 10, stun: 1.2 },
    rajada: { n: 3, spread: 12, t: 0.3 },
    varrida: { t: 0.32, at: 0.12, radius: 118, dmg: 10, kb: 540, stun: 0.35 },
    bombinha: { speed: 540, fuse: 0.9, radius: 128, dmg: 24, kb: 540, stun: 0.45, friction: 3.2 },
  });

  // Tipos de ação (índice vai na rede)
  const ACT_KINDS = ['', 'atk', 'grab', 'parry', 'voadora', 'chinelada', 'homerun', 'bote', 'rajada', 'varrida', 'bombinha'];

  /** Linha do tempo de uma ação que começa agora (mesmos números do servidor). Usada pela previsão do cliente. */
  function actPlan(btn, wId) {
    const W = WEAPONS[wId] || WEAPONS.maos;
    if (btn === BTN.ATK) return { k: 'atk', dur: W.atk.s + W.atk.a + W.atk.r, win: 0 };
    if (btn === BTN.PARRY) return { k: 'parry', dur: C.PARRY_WIN + C.PARRY_RECOVER, win: C.PARRY_WIN };
    if (btn === BTN.GRAB) return { k: 'grab', dur: C.GRAB_STARTUP + C.GRAB_ACTIVE + C.GRAB_RECOVER, win: 0 };
    if (btn === BTN.SPECIAL) {
      const k = W.special.k, sp = SPECIAL[k];
      switch (k) {
        case 'voadora': return { k, dur: sp.t + 0.18, win: 0, forcedT: sp.t, speed: sp.speed, cd: W.special.cd };
        case 'chinelada': return { k, dur: 0.22, win: 0, cd: W.special.cd };
        case 'homerun': return { k, dur: sp.charge + sp.a + sp.r, win: 0, cd: W.special.cd };
        case 'bote': return { k, dur: sp.t + 0.22, win: 0, forcedT: sp.t, speed: sp.speed, cd: W.special.cd };
        case 'panelaco': return { k: 'parry', dur: sp.win + 0.2, win: sp.win, cd: W.special.cd, super: true };
        case 'rajada': return { k, dur: sp.t, win: 0, cd: W.special.cd };
        case 'varrida': return { k, dur: sp.t, win: 0, cd: W.special.cd };
        case 'bombinha': return { k, dur: 0.25, win: 0, cd: W.special.cd };
      }
    }
    return null;
  }

  /** Estado de rede de uma ação em andamento (para o multiplicador de movimento e animações). */
  function actState(act, wId) {
    if (!act) return ST.IDLE;
    if (act.k === 'atk') {
      const A = (WEAPONS[act.w || wId] || WEAPONS.maos).atk;
      if (act.t < A.s) return ST.ATK_S;
      if (act.t < A.s + A.a) return ST.ATK_A;
      return ST.ATK_R;
    }
    if (act.k === 'grab') return act.held ? ST.GRAB : act.t < C.GRAB_STARTUP + C.GRAB_ACTIVE ? ST.GRAB : ST.GRAB_R;
    if (act.k === 'parry') return act.t < act.win ? ST.PARRY : ST.PARRY_R;
    return ST.SPECIAL;
  }

  // ==================== MAPAS ====================
  // rects: [x, y, w, h, tipo]  circles: [x, y, r, tipo]
  function mirror4(W, H, rects) {
    const out = [];
    for (const [x, y, w, h, k] of rects) {
      out.push([x, y, w, h, k], [W - x - w, y, w, h, k], [x, H - y - h, w, h, k], [W - x - w, H - y - h, w, h, k]);
    }
    return out;
  }
  function mirror4c(W, H, circles) {
    const out = [];
    for (const [x, y, r, k] of circles) out.push([x, y, r, k], [W - x, y, r, k], [x, H - y, r, k], [W - x, H - y, r, k]);
    return out;
  }

  const MAPS = [
    (() => {
      const W = 2200, H = 2200;
      return {
        id: 'quebrada', name: 'A Quebrada', w: W, h: H,
        ground: '#3b3833',
        rects: [
          ...mirror4(W, H, [
            [250, 250, 230, 170, 'casa'], [570, 250, 240, 170, 'casa'],
            [250, 510, 230, 250, 'casa'], [570, 510, 240, 250, 'casa'],
            [930, 330, 56, 112, 'carro'], [330, 930, 112, 56, 'carro'],
            [880, 880, 46, 46, 'caixa'],
          ]),
        ],
        circles: [
          ...mirror4c(W, H, [[1040, 180, 26, 'arvore'], [180, 1040, 26, 'arvore'], [860, 610, 24, 'arvore']]),
        ],
        court: [800, 900, 600, 400],
        spawns: [[140, 140], [1100, 120], [2060, 140], [2080, 1100], [2060, 2060], [1100, 2080], [140, 2060], [120, 1100]],
        weaponSpots: [[525, 465], [1675, 465], [525, 1735], [1675, 1735], [1100, 1100], [1100, 420], [1100, 1780], [420, 1100], [1780, 1100], [880, 1100], [1320, 1100]],
        itemSpots: [[1100, 760], [1100, 1440], [760, 1100], [1440, 1100]],
      };
    })(),
    (() => {
      const W = 2200, H = 2200;
      const rects = [];
      for (const ry of [470, 760, 1370, 1660]) for (const rx of [300, 950, 1600]) rects.push([rx, ry, 300, 70, 'barraca']);
      rects.push([1030, 1030, 140, 140, 'palco']);
      return {
        id: 'feira', name: 'A Feira', w: W, h: H,
        ground: '#3a3530',
        rects,
        circles: [
          ...mirror4c(W, H, [[820, 1000, 30, 'poste'], [300, 1100, 28, 'arvore'], [1100, 250, 28, 'arvore']]),
        ],
        court: null,
        spawns: [[140, 140], [1100, 140], [2060, 140], [2060, 1100], [2060, 2060], [1100, 2060], [140, 2060], [140, 1100]],
        weaponSpots: [[450, 640], [1100, 640], [1750, 640], [450, 1560], [1100, 1560], [1750, 1560], [700, 1100], [1500, 1100], [1100, 900], [1100, 1300], [250, 900], [1950, 1300]],
        itemSpots: [[1100, 1100 - 180], [1100, 1100 + 180], [850, 1100], [1350, 1100]],
      };
    })(),
  ];
  const mapById = (id) => MAPS.find(m => m.id === id) || MAPS[0];

  // ==================== ZONA ====================
  // A zona fecha em etapas: espera, fecha, espera, fecha...
  const ZONE_PHASES = [
    { wait: 18, to: 980, dur: 16 },
    { wait: 10, to: 560, dur: 14 },
    { wait: 8, to: 260, dur: 12 },
    { wait: 6, to: 40, dur: 14 },
  ];
  function zoneAt(zone, t) {
    // zone = { x, y, r0 }; t = segundos desde o início da rodada
    let r = zone.r0, tt = t;
    for (const ph of ZONE_PHASES) {
      if (tt < ph.wait) return { x: zone.x, y: zone.y, r, shrinking: false, next: ph.wait - tt };
      tt -= ph.wait;
      if (tt < ph.dur) { const k = tt / ph.dur; return { x: zone.x, y: zone.y, r: r + (ph.to - r) * k, shrinking: true, next: 0 }; }
      tt -= ph.dur;
      r = ph.to;
    }
    return { x: zone.x, y: zone.y, r, shrinking: false, next: 0 };
  }
  function zoneDps(t) { return 5 + Math.max(0, t - 60) * 0.12; }

  // ==================== COLISÃO ====================
  /** Empurra o círculo (p.x,p.y,rad) para fora dos obstáculos. Retorna a maior velocidade de impacto contra parede. */
  function collide(p, rad, map, vel) {
    let impact = 0;
    const push = (nx, ny, pen) => {
      p.x += nx * pen; p.y += ny * pen;
      if (vel) {
        const vn = vel.x * nx + vel.y * ny;
        if (vn < 0) { impact = Math.max(impact, -vn); vel.x -= vn * nx; vel.y -= vn * ny; }
      }
    };
    for (const r of map.rects) {
      const cx = Math.max(r[0], Math.min(p.x, r[0] + r[2]));
      const cy = Math.max(r[1], Math.min(p.y, r[1] + r[3]));
      let dx = p.x - cx, dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rad * rad) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        push(dx / d, dy / d, rad - d);
      } else {
        // centro dentro do retângulo: sai pelo lado mais perto
        const l = p.x - r[0], rr = r[0] + r[2] - p.x, t = p.y - r[1], b = r[1] + r[3] - p.y;
        const m = Math.min(l, rr, t, b);
        if (m === l) push(-1, 0, l + rad); else if (m === rr) push(1, 0, rr + rad);
        else if (m === t) push(0, -1, t + rad); else push(0, 1, b + rad);
      }
    }
    for (const c of map.circles) {
      const dx = p.x - c[0], dy = p.y - c[1];
      const d = Math.hypot(dx, dy), min = rad + c[2];
      if (d < min && d > 1e-6) push(dx / d, dy / d, min - d);
    }
    // bordas do mapa
    if (p.x < rad) push(1, 0, rad - p.x);
    if (p.y < rad) push(0, 1, rad - p.y);
    if (p.x > map.w - rad) push(-1, 0, p.x - (map.w - rad));
    if (p.y > map.h - rad) push(0, -1, p.y - (map.h - rad));
    return impact;
  }

  /** Um ponto está dentro de algum obstáculo? (projéteis) */
  function solidAt(map, x, y, pad = 0) {
    if (x < 0 || y < 0 || x > map.w || y > map.h) return true;
    for (const r of map.rects) if (x > r[0] - pad && x < r[0] + r[2] + pad && y > r[1] - pad && y < r[1] + r[3] + pad) return true;
    for (const c of map.circles) if (Math.hypot(x - c[0], y - c[1]) < c[2] + pad) return true;
    return false;
  }

  // ==================== MOVIMENTO ====================
  /** Quanto o jogador consegue andar em cada estado. */
  function moveMult(st, special) {
    switch (st) {
      case ST.ATK_S: case ST.ATK_A: return 0.45;
      case ST.ATK_R: return 0.6;
      case ST.GRAB: return 0.35;
      case ST.PARRY: return 0.4;
      case ST.STUN: case ST.DEAD: case ST.HELD: return 0;
      case ST.GRAB_R: case ST.PARRY_R: return 0.5;
      case ST.SPECIAL: return special === 'homerun' ? 0.2 : special === 'varrida' ? 0.3 : 0.5;
      default: return 1;
    }
  }

  /**
   * Passo determinístico de movimento. m = {st, special, slow, dashT, dashX, dashY, forcedT, fx, fy}
   * p = {x, y, vx, vy, kx, ky}. input = {mx, my}. Retorna velocidade de impacto contra parede.
   */
  function stepMove(p, input, dt, map, m) {
    const mult = moveMult(m.st, m.special) * (m.slow > 0 ? C.SLOW_MULT : 1);
    let mx = input.mx || 0, my = input.my || 0;
    const mm = Math.hypot(mx, my);
    if (mm > 1) { mx /= mm; my /= mm; }
    const k = 1 - Math.exp(-C.ACCEL * dt);
    p.vx += (mx * C.SPEED * mult - p.vx) * k;
    p.vy += (my * C.SPEED * mult - p.vy) * k;
    let ox = p.vx, oy = p.vy;
    if (m.dashT > 1e-4) { ox = m.dashX * C.DASH_SPEED; oy = m.dashY * C.DASH_SPEED; }
    if (m.forcedT > 1e-4) { ox = m.fx; oy = m.fy; }
    const kd = Math.exp(-C.KB_DECAY * dt);
    const vel = { x: ox + p.kx, y: oy + p.ky };
    p.x += vel.x * dt; p.y += vel.y * dt;
    p.kx *= kd; p.ky *= kd;
    if (Math.abs(p.kx) < 1) p.kx = 0;
    if (Math.abs(p.ky) < 1) p.ky = 0;
    const kb = { x: p.kx, y: p.ky };
    const impact = collide(p, C.P_R, map, kb);
    // empurrão absorvido pela parede
    p.kx = kb.x; p.ky = kb.y;
    return impact;
  }

  /** Alvo dentro do arco do golpe? */
  function inArc(ax, ay, dx, dy, tx, ty, reach, arcDeg, tr = C.P_R) {
    const ex = tx - ax, ey = ty - ay;
    const d = Math.hypot(ex, ey);
    if (d - tr > reach) return false;
    if (d < tr + 6) return true;
    const dm = Math.hypot(dx, dy) || 1;
    const cos = (ex * dx + ey * dy) / (d * dm);
    return cos >= Math.cos((arcDeg / 2) * Math.PI / 180);
  }

  return { C, ST, BTN, ACT_KINDS, actPlan, actState, WEAPONS, WEAPON_IDS, DROPPABLE, SPECIAL, MAPS, mapById, ZONE_PHASES, zoneAt, zoneDps, collide, solidAt, moveMult, stepMove, inArc };
});
