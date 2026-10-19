/**
 * Rinha.io v2 — Máquina de Pose Procedural
 * ==========================================
 * Função pura: (estado, ticksNoEstado, lutadorDef, alpha) => Pose
 * Nunca altera simulação, hitboxes ou timings.
 * Zero alocação por frame: reutiliza objeto de pose pré-alocado.
 */
(function (root, factory) {
 if (typeof module !== 'undefined' && module.exports) {
 module.exports = factory(require('./rinha-config.js'), require('./rinha-ease.js'));
 } else {
 root.RinhaAnim = factory(root.RinhaConfig, root.RinhaEase);
 }
}(typeof self !== 'undefined' ? self : this, function (Config, Ease) {
 'use strict';

 // Objeto de pose reutilizável (zero alocação no hot path)
 var _pose = {
 scaleX: 1, scaleY: 1,
 rotation: 0,
 offsetX: 0, offsetY: 0,
 leftArmAngle: 0, rightArmAngle: 0,
 leftHandExt: 0, rightHandExt: 0,
 trailIntensity: 0,
 glowIntensity: 0,
 shieldAlpha: 0,
 eyeBlink: 0
 };

 /**
 * Calcula a pose visual de um lutador para o frame atual.
 * @param {string} state - Estado atual do engine (ex: 'startup_l', 'active_h')
 * @param {number} ticks - Ticks decorridos no estado atual
 * @param {object} fDef - Definição do lutador (Config.FIGHTERS[id])
 * @param {number} alpha - Interpolação [0..1] entre ticks (para suavização)
 * @param {number} velocity - Velocidade atual do jogador (magnitude)
 * @param {number} facing - Ângulo de mira em radianos
 * @returns {object} Pose (objeto reutilizado, não guardar referência)
 */
 function getPose(state, ticks, fDef, alpha, velocity, facing) {
 // Resetar pose
 _pose.scaleX = 1; _pose.scaleY = 1;
 _pose.rotation = 0;
 _pose.offsetX = 0; _pose.offsetY = 0;
 _pose.leftArmAngle = 0; _pose.rightArmAngle = 0;
 _pose.leftHandExt = 0; _pose.rightHandExt = 0;
 _pose.trailIntensity = 0;
 _pose.glowIntensity = 0;
 _pose.shieldAlpha = 0;
 _pose.eyeBlink = 0;

 var t, dur, p;

 switch (state) {
 case 'neutral':
 // Idle breathing
 t = (ticks % 120) / 120; // ciclo de 2s
 var breath = Math.sin(t * Math.PI * 2) * 0.02;
 _pose.scaleX = 1 + breath;
 _pose.scaleY = 1 - breath;
 // Movimento: inclinação na direção da velocidade
 if (velocity > 0.5) {
 var moveLean = Math.min(velocity / fDef.speed, 1) * 0.12;
 _pose.rotation = moveLean;
 _pose.scaleX = 1 + moveLean * 0.3; // stretch horizontal
 _pose.scaleY = 1 - moveLean * 0.15; // squash vertical
 }
 break;

 case 'startup_l':
 case 'startup_h':
 dur = state === 'startup_h' ? fDef.attacks.heavy.startup : fDef.attacks.light.startup;
 t = Ease.clamp((ticks + alpha) / dur, 0, 1);
 p = Ease.anticipation(t);
 // Recuo do corpo (anticipation)
 _pose.offsetX = -Math.cos(facing) * p * 6;
 _pose.offsetY = -Math.sin(facing) * p * 6;
 // Squash durante wind-up
 _pose.scaleX = 1 - p * 0.12;
 _pose.scaleY = 1 + p * 0.08;
 // Braço de ataque recua e prepara
 var atkHand = state === 'startup_h' ? fDef.attacks.heavy.hand : fDef.attacks.light.hand;
 var armAngle = -p * 0.8;
 if (atkHand === 'right') {
 _pose.rightArmAngle = armAngle;
 _pose.rightHandExt = -p * 8;
 } else {
 _pose.leftArmAngle = armAngle;
 _pose.leftHandExt = -p * 8;
 }
 // Glow crescente durante startup
 _pose.glowIntensity = p * 0.7;
 break;

 case 'active_l':
 case 'active_h':
 var isHeavy = state === 'active_h';
 var atkDef = isHeavy ? fDef.attacks.heavy : fDef.attacks.light;
 dur = atkDef.active;
 t = Ease.clamp((ticks + alpha) / dur, 0, 1);
 // Extensão total do braço de ataque
 var hand = isHeavy ? atkDef.hand : fDef.attacks.light.hand;
 var ext = atkDef.hitbox.offsetX;
 if (hand === 'right') {
 _pose.rightHandExt = ext;
 _pose.rightArmAngle = 0.1;
 } else {
 _pose.leftHandExt = ext;
 _pose.leftArmAngle = 0.1;
 }
 // Stretch na direção do golpe
 _pose.scaleX = 1 + t * 0.15;
 _pose.scaleY = 1 - t * 0.08;
 // Trail intenso durante active frames
 _pose.trailIntensity = isHeavy ? 0.9 : 0.6;
 _pose.glowIntensity = isHeavy ? 1.0 : 0.7;
 break;

 case 'recovery_l':
 case 'recovery_h':
 var isHeavyR = state === 'recovery_h';
 var recAtkDef = isHeavyR ? fDef.attacks.heavy : fDef.attacks.light;
 dur = recAtkDef.recovery;
 t = Ease.clamp((ticks + alpha) / dur, 0, 1);
 p = Ease.followThrough(t);
 // Follow-through: overshoot e retorno suave
 var recHand = isHeavyR ? recAtkDef.hand : fDef.attacks.light.hand;
 var returnExt = recAtkDef.hitbox.offsetX * (1 - p);
 if (recHand === 'right') {
 _pose.rightHandExt = returnExt;
 _pose.rightArmAngle = 0.1 * (1 - p);
 } else {
 _pose.leftHandExt = returnExt;
 _pose.leftArmAngle = 0.1 * (1 - p);
 }
 // Corpo volta ao normal com overshoot
 _pose.scaleX = 1 + (1 - p) * 0.08;
 _pose.scaleY = 1 - (1 - p) * 0.04;
 _pose.trailIntensity = (1 - p) * 0.3;
 _pose.glowIntensity = (1 - p) * 0.3;
 break;

 case 'guarding':
 _pose.shieldAlpha = 0.8;
 // Micro-vibração ao absorver (simulada por ticks)
 var vib = Math.sin(ticks * 0.8) * 0.01;
 _pose.scaleX = 1 + vib;
 _pose.scaleY = 1 - vib;
 // Postura defensiva: ligeiro agachamento
 _pose.scaleY *= 0.95;
 _pose.scaleX *= 1.03;
 break;

 case 'parrying':
 // Flash no instante exato do parry
 t = Ease.clamp((ticks + alpha) / Config.POSTURE.parryWindowTicks, 0, 1);
 _pose.shieldAlpha = 1.0;
 _pose.glowIntensity = 1.0 - t * 0.5;
 // Corpo tenso
 _pose.scaleX = 1.05;
 _pose.scaleY = 0.95;
 break;

 case 'dashing':
 dur = fDef.dash.duration;
 t = Ease.clamp((ticks + alpha) / dur, 0, 1);
 // Stretch extremo na direção do dash
 _pose.scaleX = 1 + t * 0.4;
 _pose.scaleY = 1 - t * 0.2;
 _pose.trailIntensity = 0.8;
 // Inclinação forte
 _pose.rotation = 0.2;
 break;

 case 'hitstun':
 // Tremor de alta frequência
 var tremor = Math.sin(ticks * 3.0) * 0.04;
 _pose.offsetX = tremor * 3;
 _pose.offsetY = Math.cos(ticks * 2.5) * 2;
 _pose.scaleX = 1 + tremor;
 _pose.scaleY = 1 - tremor;
 // Recuo
 _pose.rotation = -0.1;
 break;

 case 'blockstun':
 // Recuo curto com vibração
 t = Ease.clamp((ticks + alpha) / 8, 0, 1);
 var recoil = Ease.outCubic(t);
 _pose.offsetX = -Math.cos(facing) * recoil * 4;
 _pose.offsetY = -Math.sin(facing) * recoil * 4;
 _pose.shieldAlpha = 0.6 * (1 - recoil);
 _pose.scaleX = 1 + (1 - recoil) * 0.05;
 break;

 case 'stunned':
 // Oscilação lenta enquanto atordoado
 t = ((ticks % 60) / 60);
 _pose.rotation = Math.sin(t * Math.PI * 2) * 0.08;
 _pose.offsetY = Math.sin(t * Math.PI * 4) * 2;
 _pose.eyeBlink = 0.5;
 break;

 case 'thrown':
 // Rotação rápida durante arremesso
 t = Ease.clamp((ticks + alpha) / 20, 0, 1);
 _pose.rotation = t * Math.PI * 2;
 _pose.scaleX = 1 - t * 0.2;
 _pose.scaleY = 1 + t * 0.1;
 break;

 case 'parry_stagger':
 // Atacante recua após parry falho
 t = Ease.clamp((ticks + alpha) / 18, 0, 1);
 p = Ease.outBack(t);
 _pose.offsetX = -Math.cos(facing) * p * 10;
 _pose.offsetY = -Math.sin(facing) * p * 10;
 _pose.scaleX = 1 - p * 0.1;
 _pose.rotation = -p * 0.15;
 break;

 case 'grab_start':
 // Braços abertos telegrafando agarrão
 t = Ease.clamp((ticks + alpha) / fDef.grab.startup, 0, 1);
 p = Ease.outQuad(t);
 _pose.leftArmAngle = -p * 0.6;
 _pose.rightArmAngle = p * 0.6;
 _pose.leftHandExt = p * 12;
 _pose.rightHandExt = p * 12;
 _pose.glowIntensity = p * 0.5;
 break;

 case 'grab_active':
 // Mãos fechadas, corpo avança
 _pose.leftHandExt = fDef.grab.range * 0.6;
 _pose.rightHandExt = fDef.grab.range * 0.6;
 _pose.leftArmAngle = 0.3;
 _pose.rightArmAngle = -0.3;
 _pose.scaleX = 1.08;
 _pose.glowIntensity = 0.6;
 break;

 case 'burst':
 // Expansão radial
 t = Ease.clamp((ticks + alpha) / 10, 0, 1);
 p = Ease.outElastic(t);
 _pose.scaleX = 1 + p * 0.3;
 _pose.scaleY = 1 + p * 0.3;
 _pose.glowIntensity = 1.0 - t;
 _pose.trailIntensity = 0.5 * (1 - t);
 break;

 default:
 // Fallback: idle sutil
 break;
 }

 return _pose;
 }

 return {
 getPose: getPose
 };
}));