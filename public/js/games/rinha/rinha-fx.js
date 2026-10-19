/**
 * Rinha.io v2 — Sistema de Efeitos (Pools)
 * ==========================================
 * Partículas, faíscas, anéis, textos flutuantes e rastros.
 * Zero alocação no hot path: todos os objetos são pré-alocados em pools.
 * Qualidade adaptativa: reduz partículas automaticamente se FPS cair.
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory(require('./rinha-ease.js'));
    } else {
        root.RinhaFx = factory(root.RinhaEase);
    }
}(typeof self !== 'undefined' ? self : this, function (Ease) {
    'use strict';

    // ==================== POOL SIZES ====================
    var MAX_PARTICLES = 200;
    var MAX_SPARKS = 80;
    var MAX_RINGS = 16;
    var MAX_TEXTS = 24;
    var MAX_TRAILS = 32;

    // ==================== PARTICLE POOL ====================
    function ParticlePool(size) {
        this.pool = new Array(size);
        this.activeCount = 0;
        for (var i = 0; i < size; i++) {
            this.pool[i] = {
                active: false, x: 0, y: 0, vx: 0, vy: 0,
                life: 0, maxLife: 0, size: 0, color: '',
                gravity: 0, friction: 1, shrink: true
            };
        }
    }

    ParticlePool.prototype.spawn = function (x, y, vx, vy, life, size, color, gravity, friction, shrink) {
        for (var i = 0; i < this.pool.length; i++) {
            var p = this.pool[i];
            if (!p.active) {
                p.active = true;
                p.x = x; p.y = y; p.vx = vx; p.vy = vy;
                p.life = life; p.maxLife = life;
                p.size = size; p.color = color;
                p.gravity = gravity || 0;
                p.friction = friction || 1;
                p.shrink = shrink !== false;
                this.activeCount++;
                return p;
            }
        }
        return null; // pool cheio
    };

    ParticlePool.prototype.update = function (dt) {
        this.activeCount = 0;
        for (var i = 0; i < this.pool.length; i++) {
            var p = this.pool[i];
            if (!p.active) continue;
            p.life -= dt;
            if (p.life <= 0) { p.active = false; continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += p.gravity * dt;
            p.vx *= p.friction;
            p.vy *= p.friction;
            this.activeCount++;
        }
    };

    ParticlePool.prototype.draw = function (ctx) {
        for (var i = 0; i < this.pool.length; i++) {
            var p = this.pool[i];
            if (!p.active) continue;
            var alpha = Ease.clamp(p.life / p.maxLife, 0, 1);
            var sz = p.shrink ? p.size * alpha : p.size;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.5, sz), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    };

    // ==================== SPARK POOL (linhas direcionais) ====================
    function SparkPool(size) {
        this.pool = new Array(size);
        this.activeCount = 0;
        for (var i = 0; i < size; i++) {
            this.pool[i] = {
                active: false, x: 0, y: 0, vx: 0, vy: 0,
                life: 0, maxLife: 0, len: 0, color: ''
            };
        }
    }

    SparkPool.prototype.spawn = function (x, y, angle, speed, life, len, color) {
        for (var i = 0; i < this.pool.length; i++) {
            var s = this.pool[i];
            if (!s.active) {
                s.active = true;
                s.x = x; s.y = y;
                s.vx = Math.cos(angle) * speed;
                s.vy = Math.sin(angle) * speed;
                s.life = life; s.maxLife = life;
                s.len = len; s.color = color;
                this.activeCount++;
                return s;
            }
        }
        return null;
    };

    SparkPool.prototype.update = function (dt) {
        this.activeCount = 0;
        for (var i = 0; i < this.pool.length; i++) {
            var s = this.pool[i];
            if (!s.active) continue;
            s.life -= dt;
            if (s.life <= 0) { s.active = false; continue; }
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            s.vx *= 0.95;
            s.vy *= 0.95;
            this.activeCount++;
        }
    };

    SparkPool.prototype.draw = function (ctx) {
        ctx.lineCap = 'round';
        for (var i = 0; i < this.pool.length; i++) {
            var s = this.pool[i];
            if (!s.active) continue;
            var alpha = Ease.clamp(s.life / s.maxLife, 0, 1);
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x - s.vx * s.len * 0.016, s.y - s.vy * s.len * 0.016);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    };

    // ==================== RING POOL (anéis expansivos) ====================
    function RingPool(size) {
        this.pool = new Array(size);
        this.activeCount = 0;
        for (var i = 0; i < size; i++) {
            this.pool[i] = {
                active: false, x: 0, y: 0, radius: 0, maxRadius: 0,
                life: 0, maxLife: 0, color: '', lineWidth: 0
            };
        }
    }

    RingPool.prototype.spawn = function (x, y, maxRadius, life, color, lineWidth) {
        for (var i = 0; i < this.pool.length; i++) {
            var r = this.pool[i];
            if (!r.active) {
                r.active = true;
                r.x = x; r.y = y;
                r.radius = 0; r.maxRadius = maxRadius;
                r.life = life; r.maxLife = life;
                r.color = color; r.lineWidth = lineWidth || 3;
                this.activeCount++;
                return r;
            }
        }
        return null;
    };

    RingPool.prototype.update = function (dt) {
        this.activeCount = 0;
        for (var i = 0; i < this.pool.length; i++) {
            var r = this.pool[i];
            if (!r.active) continue;
            r.life -= dt;
            if (r.life <= 0) { r.active = false; continue; }
            var t = 1 - (r.life / r.maxLife);
            r.radius = r.maxRadius * Ease.outCubic(t);
            this.activeCount++;
        }
    };

    RingPool.prototype.draw = function (ctx) {
        for (var i = 0; i < this.pool.length; i++) {
            var r = this.pool[i];
            if (!r.active) continue;
            var alpha = Ease.clamp(r.life / r.maxLife, 0, 1);
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = r.color;
            ctx.lineWidth = r.lineWidth * alpha;
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    };

    // ==================== TEXT POOL (textos flutuantes) ====================
    function TextPool(size) {
        this.pool = new Array(size);
        this.activeCount = 0;
        for (var i = 0; i < size; i++) {
            this.pool[i] = {
                active: false, x: 0, y: 0, text: '', color: '',
                life: 0, maxLife: 0, fontSize: 0, scale: 1
            };
        }
    }

    TextPool.prototype.spawn = function (x, y, text, color, life, fontSize) {
        for (var i = 0; i < this.pool.length; i++) {
            var t = this.pool[i];
            if (!t.active) {
                t.active = true;
                t.x = x; t.y = y;
                t.text = text; t.color = color;
                t.life = life; t.maxLife = life;
                t.fontSize = fontSize || 14;
                t.scale = 1.5; // pop inicial
                this.activeCount++;
                return t;
            }
        }
        return null;
    };

    TextPool.prototype.update = function (dt) {
        this.activeCount = 0;
        for (var i = 0; i < this.pool.length; i++) {
            var t = this.pool[i];
            if (!t.active) continue;
            t.life -= dt;
            if (t.life <= 0) { t.active = false; continue; }
            t.y -= 30 * dt; // flutua para cima
            // Pop easing: escala de 1.5 → 1.0 nos primeiros 20% da vida
            var progress = 1 - (t.life / t.maxLife);
            if (progress < 0.2) {
                t.scale = 1.5 - 0.5 * Ease.outBack(progress / 0.2);
            } else {
                t.scale = 1.0;
            }
            this.activeCount++;
        }
    };

    TextPool.prototype.draw = function (ctx) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var i = 0; i < this.pool.length; i++) {
            var t = this.pool[i];
            if (!t.active) continue;
            var alpha = Ease.clamp(t.life / (t.maxLife * 0.3), 0, 1); // fade nos últimos 30%
            ctx.globalAlpha = alpha;
            ctx.fillStyle = t.color;
            ctx.font = 'bold ' + Math.round(t.fontSize * t.scale) + 'px Outfit, sans-serif';
            ctx.fillText(t.text, t.x, t.y);
        }
        ctx.globalAlpha = 1;
    };

    // ==================== FX MANAGER ====================
    function FxManager() {
        this.particles = new ParticlePool(MAX_PARTICLES);
        this.sparks = new SparkPool(MAX_SPARKS);
        this.rings = new RingPool(MAX_RINGS);
        this.texts = new TextPool(MAX_TEXTS);
        this.qualityLevel = 2; // 0=baixo, 1=médio, 2=alto, 3=ultra
        this._frameTimes = [];
        this._lastAdaptTime = 0;
    }

    /**
     * Dispara efeitos baseados em eventos do engine.
     * Escalonado por intensidade (dano, tipo de golpe).
     */
    FxManager.prototype.processEvent = function (ev) {
        var type = ev.type || ev;
        var d = ev.data || {};
        var x = d.x || 0, y = d.y || 0;
        var dmg = d.dmg || 0;
        var heavy = d.heavy || false;
        var combo = d.combo || 0;

        switch (type) {
            case 'hit':
                var hitCount = heavy ? 14 : 7;
                var sparkCount = heavy ? 8 : 4;
                // Reduzir por qualidade
                if (this.qualityLevel <= 1) { hitCount = Math.ceil(hitCount * 0.5); sparkCount = Math.ceil(sparkCount * 0.5); }
                // Partículas radiais
                for (var i = 0; i < hitCount; i++) {
                    var ang = Math.random() * Math.PI * 2;
                    var spd = (Math.random() * 0.7 + 0.3) * (heavy ? 5 : 3);
                    this.particles.spawn(x, y, Math.cos(ang)*spd, Math.sin(ang)*spd,
                        0.3 + Math.random()*0.2, heavy ? 3 : 2, '#ef4444', 0, 0.95, true);
                }
                // Faíscas direcionais (na direção do golpe se kb disponível)
                var kbAngle = d.kb ? Math.atan2(d.y - (d.y - d.kb * 0.1), d.x - (d.x - d.kb * 0.1)) : Math.random() * Math.PI * 2;
                for (var s = 0; s < sparkCount; s++) {
                    var sa = kbAngle + (Math.random() - 0.5) * 0.8;
                    this.sparks.spawn(x, y, sa, 4 + Math.random()*4, 0.2 + Math.random()*0.15, 12, '#ffcc00');
                }
                // Texto de dano
                this.texts.spawn(x, y - 20, String(dmg), '#ef4444', 0.8, heavy ? 18 : 14);
                break;

            case 'block':
                if (this.qualityLevel >= 1) {
                    for (var b = 0; b < 5; b++) {
                        var ba = Math.random() * Math.PI * 2;
                        this.particles.spawn(x, y, Math.cos(ba)*2, Math.sin(ba)*2,
                            0.25, 2, '#f59e0b', 0, 0.9, true);
                    }
                }
                this.texts.spawn(x, y - 20, 'BLOCK', '#f59e0b', 0.6, 12);
                break;

            case 'parry':
                this.rings.spawn(x, y, 60, 0.3, '#3b82f6', 4);
                if (this.qualityLevel >= 2) {
                    for (var pp = 0; pp < 18; pp++) {
                        var pa = Math.random() * Math.PI * 2;
                        this.sparks.spawn(x, y, pa, 5 + Math.random()*3, 0.25, 15, '#3b82f6');
                    }
                }
                this.texts.spawn(x, y - 30, 'PARRY!', '#3b82f6', 0.9, 20);
                break;

            case 'throw':
                if (this.qualityLevel >= 1) {
                    for (var th = 0; th < 12; th++) {
                        var ta = Math.random() * Math.PI * 2;
                        this.particles.spawn(x, y, Math.cos(ta)*4, Math.sin(ta)*4,
                            0.35, 2.5, '#a855f7', 0, 0.92, true);
                    }
                }
                this.texts.spawn(x, y - 25, d.dmg || 'THROW', '#a855f7', 0.7, 16);
                break;

            case 'wall_splat':
                this.rings.spawn(x, y, 40, 0.25, '#ffffff', 3);
                if (this.qualityLevel >= 1) {
                    for (var ws = 0; ws < 16; ws++) {
                        var wa = Math.random() * Math.PI * 2;
                        this.particles.spawn(x, y, Math.cos(wa)*5, Math.sin(wa)*5,
                            0.4, 2, '#ffffff', 2, 0.93, true);
                    }
                }
                this.texts.spawn(x, y - 25, 'SPLAT!', '#ffffff', 0.8, 18);
                break;

            case 'posture_break':
                this.rings.spawn(x, y, 80, 0.4, '#f59e0b', 5);
                if (this.qualityLevel >= 2) {
                    for (var pb = 0; pb < 22; pb++) {
                        var pba = Math.random() * Math.PI * 2;
                        this.sparks.spawn(x, y, pba, 6 + Math.random()*4, 0.35, 18, '#f59e0b');
                    }
                }
                this.texts.spawn(x, y - 35, 'BREAK!', '#f59e0b', 1.0, 22);
                break;

            case 'burst':
                this.rings.spawn(x, y, 140, 0.5, '#3b82f6', 6);
                if (this.qualityLevel >= 2) {
                    for (var bu = 0; bu < 28; bu++) {
                        var bua = (bu / 28) * Math.PI * 2;
                        this.particles.spawn(x, y, Math.cos(bua)*7, Math.sin(bua)*7,
                            0.4, 3, '#3b82f6', 0, 0.96, true);
                    }
                }
                break;

            case 'ko':
                this.rings.spawn(x, y, 100, 0.6, '#ef4444', 5);
                if (this.qualityLevel >= 1) {
                    for (var ko = 0; ko < 32; ko++) {
                        var ka = Math.random() * Math.PI * 2;
                        this.particles.spawn(x, y, Math.cos(ka)*8, Math.sin(ka)*8,
                            0.5, 3, '#ef4444', 1, 0.94, true);
                    }
                }
                this.texts.spawn(x, y - 40, 'K.O.', '#ef4444', 1.2, 28);
                break;
        }
    };

    /**
     * Atualiza todos os pools. Chamar uma vez por frame com dt em segundos.
     */
    FxManager.prototype.update = function (dt) {
        this.particles.update(dt);
        this.sparks.update(dt);
        this.rings.update(dt);
        this.texts.update(dt);
    };

    /**
     * Desenha todos os efeitos. Chamar após desenhar o mundo.
     */
    FxManager.prototype.draw = function (ctx) {
        this.rings.draw(ctx);
        this.particles.draw(ctx);
        this.sparks.draw(ctx);
        this.texts.draw(ctx);
    };

    /**
     * Qualidade adaptativa: mede FPS e reduz nível se necessário.
     * @param {number} frameMs - Tempo do frame atual em ms
     * @param {number} now - Timestamp atual (performance.now())
     * @returns {number} Nível de qualidade atual (0-3)
     */
    FxManager.prototype.adaptQuality = function (frameMs, now) {
        this._frameTimes.push(frameMs);
        if (this._frameTimes.length > 120) this._frameTimes.shift();

        // Verificar a cada 2 segundos
        if (now - this._lastAdaptTime < 2000) return this.qualityLevel;
        this._lastAdaptTime = now;

        if (this._frameTimes.length < 60) return this.qualityLevel;

        // Calcular FPS médio dos últimos 60 frames
        var sum = 0;
        for (var i = this._frameTimes.length - 60; i < this._frameTimes.length; i++) {
            sum += this._frameTimes[i];
        }
        var avgMs = sum / 60;
        var fps = 1000 / avgMs;

        if (fps < 50 && this.qualityLevel > 0) {
            this.qualityLevel--;
            console.log('[RinhaFx] Qualidade reduzida para nível', this.qualityLevel, '(FPS:', fps.toFixed(1), ')');
        } else if (fps > 58 && this.qualityLevel < 3) {
            this.qualityLevel++;
        }

        return this.qualityLevel;
    };

    /**
     * Define nível de qualidade manualmente.
     */
    FxManager.prototype.setQuality = function (level) {
        this.qualityLevel = Ease.clamp(level, 0, 3);
    };

    /**
     * Retorna contagem de objetos ativos (para debug/Lab).
     */
    FxManager.prototype.getActiveCounts = function () {
        return {
            particles: this.particles.activeCount,
            sparks: this.sparks.activeCount,
            rings: this.rings.activeCount,
            texts: this.texts.activeCount,
            total: this.particles.activeCount + this.sparks.activeCount + this.rings.activeCount + this.texts.activeCount
        };
    };

    return FxManager;
}));