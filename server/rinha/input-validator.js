/**
 * Rinha.io — Validador de Input (Servidor)
 * ==========================================
 * Valida e sanitiza inputs recebidos via Socket.IO antes de serem
 * processados pela engine autoritativa. Previne injeção de valores
 * inválidos, NaN, Infinity ou tipos incorretos que poderiam quebrar
 * o determinismo da simulação.
 *
 * Regras:
 * - Todos os campos numéricos devem ser números finitos
 * - mx/my normalizados entre -10 e 10 (int8 quantizado)
 * - ax/ay coordenadas absolutas dentro dos limites da arena
 * - btn bitmask de 6 bits (0-63)
 * - t (tick) deve ser inteiro não-negativo
 */
'use strict';

const Config = require('../../public/js/games/rinha/rinha-config.js');

/**
 * Valida um input raw recebido do cliente.
 * @param {object} raw - Input no formato wire { t, mx, my, ax, ay, btn }
 * @returns {boolean} true se válido, false se deve ser descartado
 */
function validateInput(raw) {
 if (!raw || typeof raw !== 'object') return false;

 // Tick: inteiro não-negativo
 if (typeof raw.t !== 'number' || !Number.isFinite(raw.t) || raw.t < 0 || !Number.isInteger(raw.t)) {
 return false;
 }

 // Movimento: int8 quantizado (-10..10)
 if (typeof raw.mx !== 'number' || !Number.isFinite(raw.mx)) return false;
 if (typeof raw.my !== 'number' || !Number.isFinite(raw.my)) return false;
 if (raw.mx < -10 || raw.mx > 10 || raw.my < -10 || raw.my > 10) return false;

 // Mira: coordenadas absolutas dentro da arena (com margem)
 if (typeof raw.ax !== 'number' || !Number.isFinite(raw.ax)) return false;
 if (typeof raw.ay !== 'number' || !Number.isFinite(raw.ay)) return false;
 // Permitir margem de 50px além da arena para mira externa
 const margin = 50;
 if (raw.ax < -margin || raw.ax > Config.ARENA.width + margin) return false;
 if (raw.ay < -margin || raw.ay > Config.ARENA.height + margin) return false;

 // Botões: bitmask de 6 bits (0-63)
 if (typeof raw.btn !== 'number' || !Number.isFinite(raw.btn)) return false;
 if (!Number.isInteger(raw.btn) || raw.btn < 0 || raw.btn > 63) return false;

 return true;
}

/**
 * Sanitiza um input válido, garantindo tipos corretos e clamping.
 * Deve ser chamado APÓS validateInput retornar true.
 * @param {object} raw - Input validado
 * @returns {object} Input sanitizado com tipos garantidos
 */
function sanitizeInput(raw) {
 return {
 t: Math.floor(raw.t),
 mx: Math.max(-10, Math.min(10, Math.round(raw.mx))),
 my: Math.max(-10, Math.min(10, Math.round(raw.my))),
 ax: Math.max(-50, Math.min(Config.ARENA.width + 50, Math.round(raw.ax))),
 ay: Math.max(-50, Math.min(Config.ARENA.height + 50, Math.round(raw.ay))),
 btn: Math.max(0, Math.min(63, Math.floor(raw.btn)))
 };
}

module.exports = { validateInput, sanitizeInput };