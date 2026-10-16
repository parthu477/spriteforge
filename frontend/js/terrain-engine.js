/* ============================================================
   SpriteForge — terrain-engine.js
   Procedural 2D Hill Terrain Generator
   Issue #31 — 2D Procedural Terrain & Spring Suspension Physics
   ============================================================ */
'use strict';

// ── Pseudo-Random Number Generator (seeded, deterministic) ────
class SeededRNG {
  constructor(seed = 42) {
    this.seed = seed >>> 0;
  }
  next() {
    // xorshift32
    let s = this.seed;
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    this.seed = s >>> 0;
    return (this.seed >>> 0) / 0xFFFFFFFF;
  }
  range(min, max) { return min + this.next() * (max - min); }
}

// ── Smooth noise via cubic interpolation ──────────────────────
function fade(t)        { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t)  { return a + (b - a) * t; }

// Layered value noise (poor-man Perlin, no WASM dep)
class ValueNoise {
  constructor(seed = 1337) {
    this.rng = new SeededRNG(seed);
    this._perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this._perm[i] = p[i & 255];
  }

  // 1D value noise
  noise1d(x) {
    const ix = Math.floor(x) & 255;
    const fx = x - Math.floor(x);
    const u  = fade(fx);
    const a  = (this._perm[ix]     / 255) * 2 - 1;
    const b  = (this._perm[ix + 1] / 255) * 2 - 1;
    return lerp(a, b, u);
  }

  // Octave-layered fractal noise
  fbm(x, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let val = 0, amp = 1, freq = 1, maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      val    += this.noise1d(x * freq) * amp;
      maxAmp += amp;
      amp    *= gain;
      freq   *= lacunarity;
    }
    return val / maxAmp;
  }
}

// ── Terrain Chunk ─────────────────────────────────────────────
const CHUNK_WIDTH   = 600;   // px per chunk
const POINT_SPACING = 6;     // world-x distance between height samples
const POINTS_PER_CHUNK = Math.ceil(CHUNK_WIDTH / POINT_SPACING) + 2;

class TerrainChunk {
  /**
   * @param {number} chunkIndex  — integer index (0, 1, 2, …)
   * @param {ValueNoise} noise
   * @param {object} cfg         — terrain generation config
   */
  constructor(chunkIndex, noise, cfg) {
    this.index     = chunkIndex;
    this.startX    = chunkIndex * CHUNK_WIDTH;
    this.points    = [];   // [{x, y}] in world coords
    this._generate(noise, cfg);
  }

  _generate(noise, cfg) {
    const { baseAmplitude, baseFreq, bumpAmplitude, bumpFreq,
            baseY, maxSlope } = cfg;

    for (let i = 0; i < POINTS_PER_CHUNK; i++) {
      const wx = this.startX + i * POINT_SPACING;
      const nx = wx / (CHUNK_WIDTH * baseFreq);

      // Macro rolling hills
      const macro = noise.fbm(nx, 4, 1.8, 0.55) * baseAmplitude;
      // Micro bumps
      const micro = noise.fbm(nx * bumpFreq, 2, 2.0, 0.5) * bumpAmplitude;

      const wy = baseY - macro - micro;
      this.points.push({ x: wx, y: wy });
    }

    // Slope clamping — prevent vertical walls
    for (let i = 1; i < this.points.length; i++) {
      const prev = this.points[i - 1];
      const curr = this.points[i];
      const dy   = curr.y - prev.y;
      const maxDy = maxSlope * POINT_SPACING;
      if (Math.abs(dy) > maxDy) {
        curr.y = prev.y + Math.sign(dy) * maxDy;
      }
    }
  }

  /** Height at world x (linear interpolation between samples) */
  heightAt(wx) {
    const localX = wx - this.startX;
    const idx    = localX / POINT_SPACING;
    const i0     = Math.floor(idx);
    const i1     = i0 + 1;
    if (i0 < 0 || i1 >= this.points.length) return null;
    const t = idx - i0;
    return lerp(this.points[i0].y, this.points[i1].y, t);
  }

  /** Surface normal at world x (unit vector pointing up from slope) */
  normalAt(wx) {
    const dy = (this.heightAt(wx + 2) ?? 0) - (this.heightAt(wx - 2) ?? 0);
    const dx = 4;
    const len = Math.hypot(dx, dy);
    return { x: -dy / len, y: dx / len }; // perpendicular, pointing "up"
  }

  /** Slope angle in radians at world x */
  slopeAt(wx) {
    const h1 = this.heightAt(wx + 1) ?? 0;
    const h0 = this.heightAt(wx - 1) ?? 0;
    return Math.atan2(h1 - h0, 2);
  }
}

// ── Terrain Manager ───────────────────────────────────────────
class TerrainEngine {
  /**
   * @param {object} [options]
   * @param {number} [options.seed]
   * @param {number} [options.baseY]            — canvas Y for flat reference
   * @param {number} [options.baseAmplitude]    — max macro hill height px
   * @param {number} [options.baseFreq]         — macro frequency scalar
   * @param {number} [options.bumpAmplitude]    — micro bump height px
   * @param {number} [options.bumpFreq]         — micro bump freq scalar
   * @param {number} [options.maxSlope]         — max slope ratio (dy/dx)
   * @param {number} [options.chunksAhead]      — chunks to keep generated ahead
   */
  constructor(options = {}) {
    this.cfg = {
      seed:          options.seed          ?? 42,
      baseY:         options.baseY         ?? 400,
      baseAmplitude: options.baseAmplitude ?? 160,
      baseFreq:      options.baseFreq      ?? 0.7,
      bumpAmplitude: options.bumpAmplitude ?? 28,
      bumpFreq:      options.bumpFreq      ?? 8,
      maxSlope:      options.maxSlope      ?? 0.65,
      chunksAhead:   options.chunksAhead   ?? 5,
    };

    this.noise  = new ValueNoise(this.cfg.seed);
    this.chunks = new Map(); // chunkIndex → TerrainChunk
    this._ensureChunks(0);
  }

  /** Ensure chunks exist around a world-x position */
  _ensureChunks(worldX) {
    const currentChunk = Math.floor(worldX / CHUNK_WIDTH);
    const ahead = this.cfg.chunksAhead;
    for (let i = Math.max(0, currentChunk - 1); i <= currentChunk + ahead; i++) {
      if (!this.chunks.has(i)) {
        this.chunks.set(i, new TerrainChunk(i, this.noise, this.cfg));
      }
    }
    // Prune old chunks far behind
    for (const [idx] of this.chunks) {
      if (idx < currentChunk - 2) this.chunks.delete(idx);
    }
  }

  /** Get chunk containing worldX */
  _chunkAt(worldX) {
    const idx = Math.floor(worldX / CHUNK_WIDTH);
    return this.chunks.get(idx) ?? null;
  }

  /** World height at given world x */
  heightAt(worldX) {
    this._ensureChunks(worldX);
    const chunk = this._chunkAt(worldX);
    if (!chunk) return this.cfg.baseY;
    return chunk.heightAt(worldX) ?? this.cfg.baseY;
  }

  /** Surface normal at world x */
  normalAt(worldX) {
    const chunk = this._chunkAt(worldX);
    if (!chunk) return { x: 0, y: 1 };
    return chunk.normalAt(worldX);
  }

  /** Slope angle at world x */
  slopeAt(worldX) {
    const chunk = this._chunkAt(worldX);
    if (!chunk) return 0;
    return chunk.slopeAt(worldX);
  }

  /**
   * Draw terrain on canvas ctx, given camera transform.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} camX  — world x of left edge of screen
   * @param {number} camY  — world y of top edge (camera scroll)
   * @param {number} W     — canvas width
   * @param {number} H     — canvas height
   * @param {string} biomeId
   */
  draw(ctx, camX, camY, W, H, biomeId = 'countryside') {
    this._ensureChunks(camX + W / 2);

    const startChunk = Math.floor(camX / CHUNK_WIDTH);
    const endChunk   = Math.floor((camX + W) / CHUNK_WIDTH) + 1;

    // Collect all visible points
    const pts = [];
    for (let ci = startChunk; ci <= endChunk; ci++) {
      const chunk = this.chunks.get(ci);
      if (!chunk) continue;
      for (const p of chunk.points) {
        const sx = p.x - camX;
        const sy = p.y - camY;
        if (sx >= -POINT_SPACING && sx <= W + POINT_SPACING) {
          pts.push({ sx, sy });
        }
      }
    }
    if (pts.length < 2) return;

    // ── Dirt/rock fill below terrain ─────────────────────────
    const { dirtTop, dirtBot, grassColor, surfaceLineColor } =
      this._biomeColors(biomeId);

    const dirtGrad = ctx.createLinearGradient(0, pts[0].sy, 0, H + 200);
    dirtGrad.addColorStop(0.0, dirtTop);
    dirtGrad.addColorStop(0.6, dirtBot);
    dirtGrad.addColorStop(1.0, '#111');

    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length - 1; i++) {
      // Catmull-Rom → smooth bezier
      const mx = (pts[i].sx + pts[i + 1].sx) / 2;
      const my = (pts[i].sy + pts[i + 1].sy) / 2;
      ctx.quadraticCurveTo(pts[i].sx, pts[i].sy, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].sx, pts[pts.length - 1].sy);
    ctx.lineTo(pts[pts.length - 1].sx, H + 50);
    ctx.lineTo(pts[0].sx, H + 50);
    ctx.closePath();
    ctx.fillStyle = dirtGrad;
    ctx.fill();

    // ── Grass surface line ────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].sx + pts[i + 1].sx) / 2;
      const my = (pts[i].sy + pts[i + 1].sy) / 2;
      ctx.quadraticCurveTo(pts[i].sx, pts[i].sy, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].sx, pts[pts.length - 1].sy);
    ctx.strokeStyle = grassColor;
    ctx.lineWidth = 4;
    ctx.stroke();

    // ── Subtle surface line glow ──────────────────────────────
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].sx + pts[i + 1].sx) / 2;
      const my = (pts[i].sy + pts[i + 1].sy) / 2;
      ctx.quadraticCurveTo(pts[i].sx, pts[i].sy, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].sx, pts[pts.length - 1].sy);
    ctx.strokeStyle = surfaceLineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _biomeColors(biomeId) {
    switch (biomeId) {
      case 'desert':
        return {
          dirtTop: '#C9A84C', dirtBot: '#8B6914',
          grassColor: '#D4A055', surfaceLineColor: 'rgba(255,220,100,0.5)',
        };
      case 'cyberpunk':
        return {
          dirtTop: '#1a1a2e', dirtBot: '#0d0d1a',
          grassColor: '#00FFFF', surfaceLineColor: 'rgba(0,255,255,0.3)',
        };
      case 'moon':
        return {
          dirtTop: '#5a5a6a', dirtBot: '#2a2a3a',
          grassColor: '#8a8aaa', surfaceLineColor: 'rgba(200,200,220,0.4)',
        };
      default: // countryside
        return {
          dirtTop: '#7B5E3A', dirtBot: '#4a2e0a',
          grassColor: '#4CAF50', surfaceLineColor: 'rgba(100,220,100,0.4)',
        };
    }
  }

  /** Reset terrain with new seed / config */
  reset(options = {}) {
    Object.assign(this.cfg, options);
    this.noise  = new ValueNoise(this.cfg.seed);
    this.chunks = new Map();
    this._ensureChunks(0);
  }
}

// ── Exports ───────────────────────────────────────────────────
window.TerrainEngine  = TerrainEngine;
window.TerrainChunk   = TerrainChunk;
window.ValueNoise     = ValueNoise;
window.CHUNK_WIDTH    = CHUNK_WIDTH;
window.POINT_SPACING  = POINT_SPACING;
