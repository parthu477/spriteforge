/* ============================================================
   SpriteForge — physics-game.js
   Physics Game Controller — Terrain + Suspension + Camera + Audio
   Issue #31 — 2D Procedural Terrain & Spring Suspension Physics
   ============================================================ */
'use strict';

class PhysicsGame {
  /**
   * @param {string} canvasId  — id of the single <canvas> element
   */
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // ── Sub-systems ─────────────────────────────────────────────
    this.terrain = new TerrainEngine({
      seed:          Date.now() & 0xFFFF,
      baseY:         340,
      baseAmplitude: 170,
      baseFreq:      0.65,
      bumpAmplitude: 30,
      bumpFreq:      9,
      maxSlope:      0.6,
      chunksAhead:   6,
    });

    this.chassis = new Chassis({
      mass:          350,
      width:         52,
      height:        26,
      inertia:       28000,
      wheelBaseHalf: 44,
      wheelOffsetY:  24,
      engineTorque:  18000,
      brakeTorque:   9000,
      maxSpeed:      640,
      airRotTorque:  5500,
    });

    this.camera = new SmoothCamera({
      lerpFactor:     0.10,
      leadFactor:     0.22,
      baseZoom:       1.0,
      zoomOutSpeed:   0.38,
      screenW:        this.canvas.width,
      screenH:        this.canvas.height,
      verticalOffset: 90,
      maxSpeed:       640,
    });

    // ── Audio (from Issue #34, optional) ──────────────────────
    this.audio = window.RetroAudioEngine ? new RetroAudioEngine() : null;

    // ── Biome ─────────────────────────────────────────────────
    this.biomeId = 'countryside';

    // ── Particle system (from Issue #34, optional) ─────────────
    this.particles = window.ParticleSystem ? new ParticleSystem() : null;

    // ── Collectibles ──────────────────────────────────────────
    this.coins    = [];
    this.fuelCans = [];
    this._spawnCollectibles();

    // ── Input state ────────────────────────────────────────────
    this.keys = {};
    this._touchState = { gas: 0, brake: 0, rotL: 0, rotR: 0 };

    // ── HUD refs ───────────────────────────────────────────────
    this.hudSpeed      = document.getElementById('pg-hud-speed');
    this.hudFuel       = document.getElementById('pg-hud-fuel');
    this.hudFuelBar    = document.getElementById('pg-hud-fuel-bar');
    this.hudCoins      = document.getElementById('pg-hud-coins');
    this.hudAir        = document.getElementById('pg-hud-air');
    this.crashOverlay  = document.getElementById('pg-crash-overlay');
    this.restartBtn    = document.getElementById('pg-restart-btn');
    this.biomeSelect   = document.getElementById('pg-biome-select');
    this.seedInput     = document.getElementById('pg-seed-input');
    this.newTerrainBtn = document.getElementById('pg-new-terrain-btn');
    this.muteBtn       = document.getElementById('pg-mute-btn');

    // Issue #32: Vehicle importer elements
    this.vehicleSelect = document.getElementById('pg-vehicle-select');
    this.presetSelect  = document.getElementById('pg-preset-select');
    this.spriteGallery = [];

    // ── Debug overlay ──────────────────────────────────────────
    this.debugEl = document.getElementById('pg-debug');
    this.showDebug = false;

    // ── Timing ─────────────────────────────────────────────────
    this._raf      = null;
    this._lastTime = 0;

    // ── Init car position ──────────────────────────────────────
    this.chassis.reset(200, this.terrain);

    this._initEvents();
    this._initVehicleImporter();
    this._resize();
    this._loop(0);
  }

  /* ── Events ──────────────────────────────────────────────────── */
  /** Issue #32: Query /api/sprites, handle ?sprite= param, and wire dropdowns */
  async _initVehicleImporter() {
    this.presetSelect?.addEventListener('change', (e) => {
      this.chassis.setPreset(e.target.value);
    });

    this.vehicleSelect?.addEventListener('change', (e) => {
      const selected = e.target.value;
      if (!selected) {
        this.chassis.setSprite(null);
      } else {
        this.loadSpriteByName(selected);
      }
    });

    try {
      const resp = await fetch('/api/sprites');
      if (resp.ok) {
        this.spriteGallery = await resp.json();
        this._populateVehicleSelect();

        // Auto-load from URL query param: ?sprite=<name>
        const urlParams = new URLSearchParams(window.location.search);
        const targetSprite = urlParams.get('sprite');
        if (targetSprite) {
          if (this.vehicleSelect) this.vehicleSelect.value = targetSprite;
          this.loadSpriteByName(targetSprite);
        }
      }
    } catch (err) {
      console.warn('Could not fetch SpriteForge sprites for sandbox:', err);
    }
  }

  _populateVehicleSelect() {
    if (!this.vehicleSelect) return;
    this.vehicleSelect.innerHTML = '<option value="">Default Procedural Buggy</option>';
    this.spriteGallery.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = `🚗 ${item.name} (${item.metadata?.rows || 1}×${item.metadata?.columns || 1})`;
      this.vehicleSelect.appendChild(opt);
    });
  }

  loadSpriteByName(name) {
    const item = this.spriteGallery.find(s => s.name === name);
    if (!item) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.chassis.setSprite(img, item.metadata || {});
      this.chassis.reset(this.chassis.pos.x, this.terrain);
    };
    img.src = item.image_url;
  }

  _initEvents() {
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('keydown', e => { this.keys[e.code] = true;  this._onKeyDown(e); });
    window.addEventListener('keyup',   e => { this.keys[e.code] = false; this._onKeyUp(e);   });

    this.restartBtn?.addEventListener('click', () => this._restart());
    this.muteBtn?.addEventListener('click', () => {
      if (!this.audio) return;
      const m = this.audio.toggleMute();
      this.muteBtn.textContent = m ? '🔇 Unmute' : '🔊 Mute';
      this.muteBtn.classList.toggle('muted', m);
    });

    this.biomeSelect?.addEventListener('change', () => {
      this.biomeId = this.biomeSelect.value;
    });

    this.newTerrainBtn?.addEventListener('click', () => {
      const seedVal = parseInt(this.seedInput?.value || '0', 10);
      const seed    = Number.isFinite(seedVal) && seedVal > 0 ? seedVal : (Date.now() & 0xFFFF);
      this.terrain.reset({ seed });
      this._spawnCollectibles();
      this._restart();
    });

    // Touch controls
    const touchMap = {
      'pg-touch-gas':   () => { this._touchState.gas   = 1; this.audio?.startEngine(); },
      'pg-touch-brake': () => { this._touchState.brake = 1; },
      'pg-touch-rotl':  () => { this._touchState.rotL  = 1; },
      'pg-touch-rotr':  () => { this._touchState.rotR  = 1; },
    };
    Object.entries(touchMap).forEach(([id, start]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const stop = () => {
        this._touchState.gas   = 0; this._touchState.brake = 0;
        this._touchState.rotL  = 0; this._touchState.rotR  = 0;
      };
      el.addEventListener('touchstart',  e => { e.preventDefault(); start();  }, {passive:false});
      el.addEventListener('touchend',    e => { e.preventDefault(); stop();   }, {passive:false});
      el.addEventListener('touchcancel', e => { e.preventDefault(); stop();   }, {passive:false});
    });

    // Debug toggle
    document.addEventListener('keydown', e => {
      if (e.code === 'KeyF' && e.shiftKey) {
        this.showDebug = !this.showDebug;
        if (this.debugEl) this.debugEl.hidden = !this.showDebug;
      }
    });
  }

  _onKeyDown(e) {
    if ((e.code === 'ArrowRight' || e.code === 'KeyD') && !this.chassis.crashed) {
      this.audio?.startEngine();
    }
  }
  _onKeyUp(_e) {}

  /* ── Resize ──────────────────────────────────────────────────── */
  _resize() {
    const W = this.canvas.parentElement?.clientWidth || 800;
    const H = Math.min(window.innerHeight * 0.55, 520);
    this.canvas.width  = W;
    this.canvas.height = H;
    this.camera.resize(W, H);
    this.terrain.cfg.baseY = H * 0.68;
  }

  /* ── Spawn collectibles ──────────────────────────────────────── */
  _spawnCollectibles() {
    this.coins = [];
    for (let i = 0; i < 25; i++) {
      const wx = 350 + i * 280 + Math.random() * 80;
      this.coins.push({ wx, collected: false, animT: Math.random() * Math.PI * 2 });
    }
    this.fuelCans = [];
    for (let i = 0; i < 10; i++) {
      const wx = 600 + i * 700 + Math.random() * 150;
      this.fuelCans.push({ wx, collected: false });
    }
  }

  /* ── Main Loop ───────────────────────────────────────────────── */
  _loop(timestamp) {
    const rawDt = (timestamp - this._lastTime) / 1000;
    const dt    = Math.min(rawDt, 0.033); // cap at ~30ms
    this._lastTime = timestamp;
    if (dt > 0) {
      this._handleInput();
      this._update(dt);
      this._draw();
    }
    this._raf = requestAnimationFrame(t => this._loop(t));
  }

  /* ── Input mapping ───────────────────────────────────────────── */
  _handleInput() {
    const c = this.chassis;
    if (c.crashed) { c.throttle = 0; c.braking = false; c.airRotInput = 0; return; }

    const right = (this.keys['ArrowRight'] || this.keys['KeyD'] || this._touchState.gas)   ? 1 : 0;
    const left  = (this.keys['ArrowLeft']  || this.keys['KeyA'])                            ? 1 : 0;
    const brake = (this.keys['ArrowDown']  || this.keys['KeyS'] || this._touchState.brake) ? 1 : 0;
    const rotR  = (this.keys['KeyE'] || this._touchState.rotR) ? 1 : 0;
    const rotL  = (this.keys['KeyQ'] || this._touchState.rotL) ? 1 : 0;

    c.throttle    = right - left * 0.5;
    c.braking     = brake > 0;
    c.airRotInput = rotR - rotL;

    // Jump
    if ((this.keys['Space'] || this.keys['ArrowUp'] || this.keys['KeyW']) && c.onGround) {
      c.vel.y = -480;
      c.onGround = false;
    }
  }

  /* ── Update ──────────────────────────────────────────────────── */
  _update(dt) {
    const c = this.chassis;
    const biomeGravity = this.biomeId === 'moon' ? 200 : 980;

    this.chassis.update(this.terrain, dt, biomeGravity);
    this.camera.update(this.chassis, dt);

    // ── Collectible checks ──────────────────────────────────────
    const carX = c.pos.x, carY = c.pos.y;
    this.coins.forEach(coin => {
      if (coin.collected) return;
      coin.animT += dt * 3;
      const wy = this.terrain.heightAt(coin.wx) - 35 + Math.sin(coin.animT) * 8;
      const dx = coin.wx - carX, dy = wy - carY;
      if (Math.hypot(dx, dy) < 38) {
        coin.collected = true;
        c.coins++;
        this.audio?.playCoinPickup();
        const sx = (coin.wx - this.camera.worldLeft) * this.camera.zoom;
        const sy = (wy      - this.camera.worldTop ) * this.camera.zoom;
        this.particles?.emitCoinPickup(sx, sy);
      }
    });

    this.fuelCans.forEach(fc => {
      if (fc.collected) return;
      const wy = this.terrain.heightAt(fc.wx) - 30;
      const dx = fc.wx - carX, dy = wy - carY;
      if (Math.hypot(dx, dy) < 42) {
        fc.collected = true;
        c.fuel = Math.min(100, c.fuel + 40);
      }
    });

    // ── Fuel alert ─────────────────────────────────────────────
    if (c.fuel < 20 && !this._fuelAlert) {
      this._fuelAlert = true;
      this.audio?.startFuelAlert();
    }
    if (c.fuel >= 20 && this._fuelAlert) {
      this._fuelAlert = false;
      this.audio?.stopFuelAlert();
    }

    // ── Crash overlay ───────────────────────────────────────────
    if (c.crashed && !this._crashShown) {
      this._crashShown = true;
      this.audio?.playCrash();
      this.audio?.stopEngine();
      const sx = (c.pos.x - this.camera.worldLeft) * this.camera.zoom;
      const sy = (c.pos.y - this.camera.worldTop ) * this.camera.zoom;
      this.particles?.emitCrash(sx, sy);
      setTimeout(() => {
        if (this.crashOverlay) this.crashOverlay.hidden = false;
      }, 1200);
    }

    // ── Audio engine ────────────────────────────────────────────
    this.audio?.updateEngineSound(c.vel.x / 60, Math.max(0, c.throttle));

    // ── Particle update ─────────────────────────────────────────
    this.particles?.update();

    // ── HUD ─────────────────────────────────────────────────────
    this._updateHUD();
  }

  /* ── Draw ────────────────────────────────────────────────────── */
  _draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);

    // ── Sky background ──────────────────────────────────────────
    this._drawSky(ctx, W, H);

    // ── Camera transform → world space ──────────────────────────
    ctx.save();
    this.camera.applyTransform(ctx);

    const camX = this.camera.worldLeft;
    const camY = this.camera.worldTop;

    // ── Terrain ─────────────────────────────────────────────────
    this.terrain.draw(
      ctx,
      camX, camY,
      this.camera.screenW / this.camera.zoom,
      this.camera.screenH / this.camera.zoom + 200,
      this.biomeId
    );

    // ── Collectibles (world space) ──────────────────────────────
    this._drawCollectibles(ctx, camX, camY);

    // ── Vehicle ─────────────────────────────────────────────────
    this.chassis.draw(ctx, camX, camY, this.biomeId);

    ctx.restore(); // undo camera transform

    // ── Particles (screen space) ─────────────────────────────────
    this.particles?.draw(ctx);

    // ── Debug overlay ────────────────────────────────────────────
    if (this.showDebug) this._drawDebug(ctx);

    // ── Speed-blur vignette at high speed ───────────────────────
    this._drawSpeedVignette(ctx, W, H);
  }

  _drawSky(ctx, W, H) {
    const skies = {
      countryside: ['#87CEEB', '#B8E4FF', '#FFF9C4'],
      desert:      ['#B33000', '#FF6600', '#FFD166'],
      cyberpunk:   ['#050014', '#0D0033', '#1A0855'],
      moon:        ['#010209', '#02040A', '#02040A'],
    };
    const stops = skies[this.biomeId] || skies.countryside;
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.7);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  _drawCollectibles(ctx, camX, camY) {
    // Coins
    this.coins.forEach(coin => {
      if (coin.collected) return;
      const sx = coin.wx - camX;
      const sy = this.terrain.heightAt(coin.wx) - 35 + Math.sin(coin.animT) * 8 - camY;
      if (sx < -40 || sx > this.canvas.width / this.camera.zoom + 40) return;

      ctx.save();
      ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 12;
      const cg = ctx.createRadialGradient(sx - 3, sy - 3, 1, sx, sy, 14);
      cg.addColorStop(0, '#FFF9C4'); cg.addColorStop(0.5, '#FFD700'); cg.addColorStop(1, '#F57F17');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8B6914';
      ctx.font = 'bold 10px Space Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$', sx, sy);
      ctx.restore();
    });

    // Fuel cans
    this.fuelCans.forEach(fc => {
      if (fc.collected) return;
      const sx = fc.wx - camX;
      const sy = this.terrain.heightAt(fc.wx) - 30 - camY;
      if (sx < -40 || sx > this.canvas.width / this.camera.zoom + 40) return;

      ctx.save();
      ctx.fillStyle = '#E53935'; ctx.fillRect(sx - 10, sy - 20, 20, 26);
      ctx.fillStyle = '#FFCDD2'; ctx.fillRect(sx - 6, sy - 16, 12, 8);
      ctx.fillStyle = '#B71C1C'; ctx.fillRect(sx - 3, sy - 24, 6, 6);
      ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#fff'; ctx.fillText('⛽', sx, sy - 4);
      ctx.restore();
    });
  }

  _drawSpeedVignette(ctx, W, H) {
    const speed = Math.abs(this.chassis.vel.x);
    const maxV  = this.chassis.maxSpeed;
    const ratio = Math.min(speed / maxV, 1);
    if (ratio < 0.3) return;

    const alpha = (ratio - 0.3) * 0.6;
    const g = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, H*0.8);
    g.addColorStop(0, 'transparent');
    g.addColorStop(1, `rgba(0,0,0,${alpha.toFixed(2)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Speed lines (radial streaks)
    if (ratio > 0.6) {
      ctx.save();
      ctx.globalAlpha = (ratio - 0.6) * 0.4;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 * i) / 12;
        const r1 = H * 0.25, r2 = H * 0.7;
        ctx.beginPath();
        ctx.moveTo(W/2 + Math.cos(a) * r1, H/2 + Math.sin(a) * r1);
        ctx.lineTo(W/2 + Math.cos(a) * r2, H/2 + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _drawDebug(ctx) {
    const c = this.chassis;
    const lines = [
      `pos: (${c.pos.x.toFixed(0)}, ${c.pos.y.toFixed(0)})`,
      `vel: (${c.vel.x.toFixed(1)}, ${c.vel.y.toFixed(1)})`,
      `angle: ${(c.angle * 180 / Math.PI).toFixed(1)}°`,
      `angVel: ${c.angVel.toFixed(2)} rad/s`,
      `onGround: ${c.onGround}`,
      `rearSusp: ${c.wheels[0].compression.toFixed(1)}px`,
      `frtSusp:  ${c.wheels[1].compression.toFixed(1)}px`,
      `zoom: ${this.camera.zoom.toFixed(2)}`,
      `camX: ${this.camera.x.toFixed(0)}`,
      `chunks: ${this.terrain.chunks.size}`,
    ];
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(8, 8, 220, lines.length * 16 + 10);
    ctx.fillStyle = '#00FF88';
    ctx.font = '11px Space Mono, monospace';
    lines.forEach((l, i) => ctx.fillText(l, 14, 22 + i * 16));
    ctx.restore();

    if (this.debugEl) {
      this.debugEl.textContent = lines.join('\n');
    }
  }

  /* ── HUD ──────────────────────────────────────────────────────── */
  _updateHUD() {
    const c = this.chassis;
    const spd = Math.abs(c.vel.x / 60 * 10);
    if (this.hudSpeed)   this.hudSpeed.textContent   = spd.toFixed(0) + ' km/h';
    if (this.hudFuel)    this.hudFuel.textContent    = Math.round(c.fuel) + '%';
    if (this.hudFuelBar) {
      this.hudFuelBar.style.width = c.fuel + '%';
      this.hudFuelBar.style.backgroundColor =
        c.fuel > 50 ? '#4CAF50' : c.fuel > 20 ? '#FF9800' : '#F44336';
    }
    if (this.hudCoins)   this.hudCoins.textContent   = c.coins;
    if (this.hudAir) {
      this.hudAir.textContent = c.onGround ? '' : '✈ Airborne';
      this.hudAir.style.color = '#00FFFF';
    }
  }

  /* ── Restart ──────────────────────────────────────────────────── */
  _restart() {
    this.chassis.reset(200, this.terrain);
    this._crashShown  = false;
    this._fuelAlert   = false;
    if (this.crashOverlay) this.crashOverlay.hidden = true;
    this.audio?.stopFuelAlert();
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.audio?.stopEngine();
    this.audio?.stopFuelAlert();
  }
}

window.PhysicsGame = PhysicsGame;
