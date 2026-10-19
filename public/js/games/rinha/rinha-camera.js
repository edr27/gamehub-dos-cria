/**
 * Rinha.io v2 — Câmera com Trauma e Enquadramento Dinâmico
 * =========================================================
 * Shake baseado em trauma (trauma², decai suave), rotação sutil,
 * zoom dinâmico baseado na distância entre lutadores.
 * Zero alocação por frame. Respeita opções de acessibilidade.
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory(require('./rinha-ease.js'));
    } else {
        root.RinhaCamera = factory(root.RinhaEase);
    }
}(typeof self !== 'undefined' ? self : this, function (Ease) {
    'use strict';

    function Camera(arenaWidth, arenaHeight) {
        this.aw = arenaWidth;
        this.ah = arenaHeight;
        this.x = arenaWidth / 2;
        this.y = arenaHeight / 2;
        this.zoom = 1;
        this.targetZoom = 1;
        this.trauma = 0;
        this.shakeIntensity = 1.0; // 0..1 via settings
        this.rotation = 0;
        this._time = 0;
        // Noise seed para shake determinístico
        this._seed = 12345;
    }

    Camera.prototype.setShakeIntensity = function(v) {
        this.shakeIntensity = Ease.clamp(v, 0, 1);
    };

    /**
     * Adiciona trauma (0..1). Múltiplos traumas se acumulam com clamp.
     */
    Camera.prototype.addTrauma = function(amount) {
        this.trauma = Math.min(1, this.trauma + amount);
    };

    /**
     * Atualiza câmera: enquadramento dinâmico + decay de trauma.
     * @param {object} world - Engine world com players
     * @param {number} dt - Delta time em segundos
     */
    Camera.prototype.update = function(world, dt) {
        this._time += dt;

        // Decay de trauma (exponencial suave)
        this.trauma *= Math.max(0, 1 - 5 * dt);
        if (this.trauma < 0.001) this.trauma = 0;

        // Enquadramento dinâmico: centroide dos jogadores vivos
        var cx = 0, cy = 0, count = 0;
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        var ids = Object.keys(world.players);
        for (var i = 0; i < ids.length; i++) {
            var p = world.players[ids[i]];
            if (!p.alive) continue;
            cx += p.x; cy += p.y;
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
            count++;
        }
        if (count > 0) {
            cx /= count; cy /= count;
            // Zoom baseado no spread dos jogadores
            var spreadX = maxX - minX + 200; // padding
            var spreadY = maxY - minY + 200;
            var fitZoom = Math.min(this.aw / spreadX, this.ah / spreadY);
            this.targetZoom = Ease.clamp(fitZoom, 0.7, 1.4);
        } else {
            cx = this.aw / 2; cy = this.ah / 2;
            this.targetZoom = 1;
        }

        // Smooth zoom
        this.zoom += (this.targetZoom - this.zoom) * Math.min(1, 4 * dt);

        // Smooth pan
        this.x += (cx - this.x) * Math.min(1, 6 * dt);
        this.y += (cy - this.y) * Math.min(1, 6 * dt);

        // Clamp dentro da arena
        var halfW = (this.aw / 2) / this.zoom;
        var halfH = (this.ah / 2) / this.zoom;
        this.x = Ease.clamp(this.x, halfW, this.aw - halfW);
        this.y = Ease.clamp(this.y, halfH, this.ah - halfH);

        // Shake derivado do trauma
        if (this.shakeIntensity > 0 && this.trauma > 0.001) {
            var t2 = this.trauma * this.trauma; // quadratic decay
            var maxShake = 12 * this.shakeIntensity;
            var maxRot = 0.06 * this.shakeIntensity;
            // Pseudo-noise determinístico baseado em tempo
            var nx = Math.sin(this._time * 25.3 + this._seed) * Math.cos(this._time * 17.7);
            var ny = Math.cos(this._time * 21.1 + this._seed * 1.3) * Math.sin(this._time * 13.9);
            var nr = Math.sin(this._time * 19.5 + this._seed * 0.7);
            this._shakeX = nx * maxShake * t2;
            this._shakeY = ny * maxShake * t2;
            this.rotation = nr * maxRot * t2;
        } else {
            this._shakeX = 0;
            this._shakeY = 0;
            this.rotation = 0;
        }
    };

    /**
     * Aplica transformação da câmera no contexto Canvas 2D.
     * Chamar ANTES de desenhar o mundo, RESTORE depois.
     */
    Camera.prototype.apply = function(ctx, canvasWidth, canvasHeight) {
        var sx = canvasWidth / this.aw;
        var sy = canvasHeight / this.ah;
        var scale = Math.min(sx, sy) * this.zoom;

        ctx.save();
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.rotate(this.rotation);
        ctx.scale(scale, scale);
        ctx.translate(-this.x + (this._shakeX || 0), -this.y + (this._shakeY || 0));
    };

    /**
     * Restaura o contexto após apply().
     */
    Camera.prototype.restore = function(ctx) {
        ctx.restore();
    };

    /**
     * Converte coordenadas do mundo para tela (para HUD overlay).
     */
    Camera.prototype.worldToScreen = function(wx, wy, canvasWidth, canvasHeight) {
        var sx = canvasWidth / this.aw;
        var sy = canvasHeight / this.ah;
        var scale = Math.min(sx, sy) * this.zoom;
        var dx = wx - this.x + (this._shakeX || 0);
        var dy = wy - this.y + (this._shakeY || 0);
        // Rotacionar
        var cos = Math.cos(-this.rotation);
        var sin = Math.sin(-this.rotation);
        var rx = dx * cos - dy * sin;
        var ry = dx * sin + dy * cos;
        return {
            x: canvasWidth / 2 + rx * scale,
            y: canvasHeight / 2 + ry * scale
        };
    };

    return Camera;
}));