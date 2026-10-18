/* ============================================================
   SpriteForge — physics-game.js
   Physics Game Controller — Driving Controls, Fuel System, Collectibles & High-Score HUD
   Issue #33 — Dual Control Scheme, Fuel Mechanics, Collectibles, HUD & Game Over
   ============================================================ */
'use strict';

class PhysicsGame {
  /**
   * @param {string} canvasId — id of the single <canvas> element
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
      engineTorque:  19000,
      brakeTorque:   9500,
      maxSpeed:      660,
      airRotTorque:  6200,
    });

    this.camera = new SmoothCamera({
      lerpFactor:     0.10,
      leadFactor:     0.22,
      baseZoom:       1.0,
      zoomOutSpeed:   0.38,
      screenW:        this.canvas.width,
      screenH:        this.canvas.height,
      verticalOffset: 90,
      maxSpeed:       660,
    });

    // ── Audio Engine ────────────────────────────────────────────
    this.audio = window.RetroAudioEngine ? new RetroAudioEngine() : null;

    // ── Biome ───────────────────────────────────────────────────
    this.biomeId = 'countryside';

    // ── Particle System ─────────────────────────────────────────
    this.particles = window.ParticleSystem ? new ParticleSystem() : null;

    // ── Gameplay & Scoring State (Issue #33) ───────────────────
    this.distanceMeters  = 0;
    this.coinsCollected  = 0;
    this.stuntBonus      = 0;
    this.totalScore      = 0;
    this.currentAirTime  = 0;
    this.airAngleDelta   = 0;
    this._lastAngle      = 0;
    this.floatingPopups  = [];

    // ── Status Flags ────────────────────────────────────────────
    this._gameOver       = false;
    this._outOfFuel      = false;
    this._fuelAlert      = false;
    this._crashShown     = false;
    this._fuelStopTime   = 0;

    // ── Collectibles (Coins & Fuel Cans, Issue #49 Endless) ────
    this.coins           = [];
    this.fuelCans        = [];
    this._lastCoinSpawnX = 0;
    this._lastFuelSpawnX = 0;
    this._spawnCollectibles();

    // ── Input state (Dual Control Scheme: Keyboard + Touch Pedals)
    this.keys = {};
    this._touchState = { gas: 0, brake: 0 };

    // ── HUD Elements (Issue #33) ───────────────────────────────
    this.hudDist       = document.getElementById('pg-hud-dist');
    this.hudSpeed      = document.getElementById('pg-hud-speed');
    this.hudRpm        = document.getElementById('pg-hud-rpm');
    this.hudFuel       = document.getElementById('pg-hud-fuel');
    this.hudFuelBar    = document.getElementById('pg-hud-fuel-bar');
    this.hudFuelCell   = document.getElementById('pg-fuel-cell');
    this.hudFuelWarning= document.getElementById('pg-fuel-warning');
    this.hudCoins      = document.getElementById('pg-hud-coins');
    this.hudScore      = document.getElementById('pg-hud-score');
    this.hudAir        = document.getElementById('pg-hud-air');

    // ── Game Over Elements (Issue #33) ─────────────────────────
    this.crashOverlay  = document.getElementById('pg-crash-overlay');
    this.goIcon        = document.getElementById('pg-go-icon');
    this.goTitle       = document.getElementById('pg-go-title');
    this.goSub         = document.getElementById('pg-go-sub');
    this.goDist        = document.getElementById('pg-go-dist');
    this.goCoins       = document.getElementById('pg-go-coins');
    this.goStunts      = document.getElementById('pg-go-stunts');
    this.goTotal       = document.getElementById('pg-go-total');
    this.restartBtn    = document.getElementById('pg-restart-btn');

    // ── Controls Bar Refs ───────────────────────────────────────
    this.spawnCarBtn   = document.getElementById('pg-spawn-car-btn');
    this.insertSpriteBtn = document.getElementById('pg-insert-sprite-btn');
    this.spriteFileInput = document.getElementById('pg-sprite-file-input');
    this.clearSandboxBtn = document.getElementById('pg-clear-sandbox-btn');
    this.biomeSelect   = document.getElementById('pg-biome-select');
    this.seedInput     = document.getElementById('pg-seed-input');
    this.newTerrainBtn = document.getElementById('pg-new-terrain-btn');
    this.muteBtn       = document.getElementById('pg-mute-btn');

    // Issue #32: Vehicle importer elements
    this.vehicleSelect = document.getElementById('pg-vehicle-select');
    this.presetSelect  = document.getElementById('pg-preset-select');
    this.spriteGallery = [];

    // ── Debug overlay ───────────────────────────────────────────
    this.debugEl       = document.getElementById('pg-debug');
    this.showDebug     = false;

    // ── Timing ──────────────────────────────────────────────────
    this._raf          = null;
    this._lastTime     = 0;

    // ── Entity State (Issue #44: Clean Initial State) ───────────
    this.hasVehicle    = false;
    this.camera.x      = 200 - (this.camera.screenW / 2) / this.camera.zoom;
    this.camera.y      = this.terrain.heightAt(200) - (this.camera.screenH / 2) / this.camera.zoom + (this.camera.verticalOffset) / this.camera.zoom;

    this._initEvents();
    this._initVehicleImporter();
    this._resize();
    this._updateHUD();
    this._loop(0);
  }

  /** Issue #32: Query /api/sprites, handle ?sprite= param, and wire dropdowns */
  async _initVehicleImporter() {
    this.presetSelect?.addEventListener('change', (e) => {
      this.chassis.setPreset(e.target.value);
    });

    this.vehicleSelect?.addEventListener('change', (e) => {
      const selected = e.target.value;
      if (!selected) {
        this.chassis.setSprite(null);
        if (this.hasVehicle) this.spawnCar({ defaultCar: true });
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
      this.spawnCar();
    };
    img.src = item.image_url;
  }

  /* ── Events (Dual Control Scheme: Keyboard + Touch Pedals) ──── */
  _initEvents() {
    window.addEventListener('resize', () => this._resize());

    // Keyboard controls
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      this._onKeyDown(e);
    });

    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      this._onKeyUp(e);
    });

    // Issue #44: Dedicated Spawn Controls
    this.spawnCarBtn?.addEventListener('click', () => this.spawnCar({ defaultCar: true }));
    this.insertSpriteBtn?.addEventListener('click', () => this.spriteFileInput?.click());
    this.spriteFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          this.chassis.setSprite(img, { rows: 1, columns: 1 });
          this.spawnCar();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    this.clearSandboxBtn?.addEventListener('click', () => this.clearSandbox());

    // Quick restart button click
    this.restartBtn?.addEventListener('click', () => this._restart());

    // Mute toggle
    this.muteBtn?.addEventListener('click', () => {
      if (!this.audio) return;
      const m = this.audio.toggleMute();
      this.muteBtn.textContent = m ? '🔇 Unmute' : '🔊 Mute';
      this.muteBtn.classList.toggle('muted', m);
    });

    // Biome change
    this.biomeSelect?.addEventListener('change', () => {
      this.biomeId = this.biomeSelect.value;
    });

    // New terrain seed button
    this.newTerrainBtn?.addEventListener('click', () => {
      const seedVal = parseInt(this.seedInput?.value || '0', 10);
      const seed    = Number.isFinite(seedVal) && seedVal > 0 ? seedVal : (Date.now() & 0xFFFF);
      this.terrain.reset({ seed });
      this._spawnCollectibles();
      if (this.hasVehicle) this._restart();
    });

    // Dual Touch Pedals (Brake/Tilt-Left, Jump, & Gas/Tilt-Right — Issue #49)
    const gasPedal   = document.getElementById('pg-touch-gas');
    const brakePedal = document.getElementById('pg-touch-brake');
    const jumpPedal  = document.getElementById('pg-touch-jump');

    const setupPedal = (el, type) => {
      if (!el) return;
      const press = () => {
        if (!this.hasVehicle) return;
        this._touchState[type] = 1;
        el.classList.add('pedal-pressed');
        if (type === 'gas' && !this.chassis.crashed && !this._gameOver && this.chassis.fuel > 0) {
          this.audio?.startEngine();
        }
      };
      const release = () => {
        this._touchState[type] = 0;
        el.classList.remove('pedal-pressed');
      };

      // Pointer events for zero input latency on touch and mouse
      el.addEventListener('pointerdown',   e => { e.preventDefault(); press();   });
      el.addEventListener('pointerup',     e => { e.preventDefault(); release(); });
      el.addEventListener('pointercancel', e => { e.preventDefault(); release(); });
      el.addEventListener('pointerleave',  e => { e.preventDefault(); release(); });

      // Fallback touch events
      el.addEventListener('touchstart',  e => { e.preventDefault(); press();   }, { passive: false });
      el.addEventListener('touchend',    e => { e.preventDefault(); release(); }, { passive: false });
      el.addEventListener('touchcancel', e => { e.preventDefault(); release(); }, { passive: false });
    };

    setupPedal(gasPedal, 'gas');
    setupPedal(brakePedal, 'brake');

    // Dedicated [ JUMP ] on-screen pedal (Specification 1, Issue #49)
    if (jumpPedal) {
      const triggerJump = () => {
        if (!this.hasVehicle) return;
        jumpPedal.classList.add('pedal-pressed');
        this._jump();
      };
      const releaseJump = () => {
        jumpPedal.classList.remove('pedal-pressed');
      };

      jumpPedal.addEventListener('pointerdown',   e => { e.preventDefault(); triggerJump(); });
      jumpPedal.addEventListener('pointerup',     e => { e.preventDefault(); releaseJump(); });
      jumpPedal.addEventListener('pointercancel', e => { e.preventDefault(); releaseJump(); });
      jumpPedal.addEventListener('pointerleave',  e => { e.preventDefault(); releaseJump(); });
      jumpPedal.addEventListener('touchstart',  e => { e.preventDefault(); triggerJump(); }, { passive: false });
      jumpPedal.addEventListener('touchend',    e => { e.preventDefault(); releaseJump(); }, { passive: false });
      jumpPedal.addEventListener('touchcancel', e => { e.preventDefault(); releaseJump(); }, { passive: false });
    }

    // Debug toggle
    document.addEventListener('keydown', e => {
      if (e.code === 'KeyF' && e.shiftKey) {
        this.showDebug = !this.showDebug;
        if (this.debugEl) this.debugEl.hidden = !this.showDebug;
      }
    });
  }

  _onKeyDown(e) {
    if (!this.hasVehicle) {
      if (e.code === 'KeyR') {
        this.spawnCar({ defaultCar: true });
      }
      return;
    }

    // Instant restart run via 'R' key (Specification 1)
    if (e.code === 'KeyR') {
      this._restart();
      return;
    }

    // Space key: Car Jump Mechanic (Specification 1, Issue #49)
    if (e.code === 'Space') {
      e.preventDefault();
      this._jump();
      return;
    }

    // Accelerate / Gas start engine audio
    const isGas = (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'ArrowUp' || e.code === 'KeyW');
    if (isGas && !this.chassis.crashed && !this._gameOver && this.chassis.fuel > 0) {
      this.audio?.startEngine();
    }
  }

  /* ── Car Jump Action (Specification 1, Issue #49) ───────────── */
  _jump() {
    if (!this.hasVehicle) return;
    const c = this.chassis;
    if (!c.onGround || c.crashed || this._gameOver) return;

    // Apply immediate vertical impulse: Physics Sandbox: c.vel.y = -520 px/s; c.onGround = false;
    c.vel.y = -520;
    c.onGround = false;

    // Retro jump / spring sound FX
    this.audio?.playJump();

    // Emit upward dust and exhaust burst particles from rear wheels
    if (this.particles) {
      const rearWheel = c.wheels[0];
      const sx = (rearWheel.pos.x - this.camera.worldLeft) * this.camera.zoom;
      const sy = (rearWheel.pos.y - this.camera.worldTop ) * this.camera.zoom;
      if (typeof this.particles.emitJumpDust === 'function') {
        this.particles.emitJumpDust(sx, sy);
      } else {
        this.particles.emitTireDirt(sx, sy, -15, true);
      }
      this.particles.emitExhaust(sx - 20, sy - 10, 15);
    }
  }

  _onKeyUp(_e) {}

  /* ── Resize ──────────────────────────────────────────────────── */
  _resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const W = Math.floor(rect?.width || window.innerWidth);
    const H = Math.floor(rect?.height || window.innerHeight);
    const dpr = window.devicePixelRatio || 1;

    this.width = W;
    this.height = H;

    this.canvas.width  = Math.floor(W * dpr);
    this.canvas.height = Math.floor(H * dpr);
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';

    this.ctx.scale(dpr, dpr);

    this.camera.resize(W, H);
    this.terrain.cfg.baseY = H * 0.68;

    const bar = document.querySelector('.pg-controls-bar');
    const hud = document.getElementById('pg-hud');
    if (bar && hud) {
      hud.style.top = (bar.offsetTop + bar.offsetHeight + 10) + 'px';
    }
  }

  /* ── Endless Procedural Collectibles (Issue #49) ─────────────── */
  _spawnCollectibles() {
    this.coins = [];
    this.fuelCans = [];
    this._lastCoinSpawnX = 350;
    this._lastFuelSpawnX = 800;
    this._generateCollectiblesAhead(this.chassis.pos.x + 2500);
  }

  _generateCollectiblesAhead(targetX) {
    // ── Infinite Procedural Coins (Formations & Star Coins, Issue #49)
    while (this._lastCoinSpawnX < targetX) {
      const startX = this._lastCoinSpawnX;
      const formationType = Math.floor(Math.random() * 3);

      if (formationType === 0) {
        // Formation 1: Rolling hill contours following terrain height curves
        const count = 5 + Math.floor(Math.random() * 4);
        const spacing = 50 + Math.random() * 15;
        for (let i = 0; i < count; i++) {
          const wx = startX + i * spacing;
          const isCrest = (i === Math.floor(count / 2) && Math.random() > 0.4);
          this.coins.push({
            wx,
            yOffset: 35,
            val: isCrest ? 100 : 50,
            collected: false,
            animT: Math.random() * Math.PI * 2,
            isCrest,
          });
        }
        this._lastCoinSpawnX = startX + count * spacing + 120 + Math.random() * 100;
      } else if (formationType === 1) {
        // Formation 2: Jump arches (curved arc formations over crests/ramps)
        const count = 7 + Math.floor(Math.random() * 3);
        const archWidth = 360 + Math.random() * 100;
        const step = archWidth / (count - 1);
        const peakHeight = 90 + Math.random() * 30; // 90-120px above terrain
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          const wx = startX + i * step;
          const archY = Math.sin(t * Math.PI) * peakHeight;
          const isApex = (i >= Math.floor(count / 2) - 1 && i <= Math.floor(count / 2) + 1);
          this.coins.push({
            wx,
            yOffset: 35 + archY,
            val: isApex ? 100 : 50,
            collected: false,
            animT: Math.random() * Math.PI * 2,
            isCrest: isApex,
          });
        }
        this._lastCoinSpawnX = startX + archWidth + 140 + Math.random() * 120;
      } else {
        // Formation 3: Bonus Star Coins (+100 pts) at high altitudes rewarding mid-air jumps
        const count = 3 + Math.floor(Math.random() * 2);
        const spacing = 50;
        for (let i = 0; i < count; i++) {
          const wx = startX + i * spacing;
          const yOffset = 110 + Math.random() * 25; // High altitude reachable by jumping
          this.coins.push({
            wx,
            yOffset,
            val: 100,
            collected: false,
            animT: Math.random() * Math.PI * 2,
            isCrest: true,
          });
        }
        this._lastCoinSpawnX = startX + count * spacing + 160 + Math.random() * 140;
      }
    }

    // ── Extended Fuel Endurance (Procedural Canisters every 250–350 meters, Issue #49)
    // In Physics Sandbox: 10 px = 1 meter. 250-350m = 2500 - 3500 px.
    while (this._lastFuelSpawnX < targetX) {
      this.fuelCans.push({
        wx: this._lastFuelSpawnX,
        collected: false,
      });
      const nextIntervalPx = (250 + Math.random() * 100) * 10;
      this._lastFuelSpawnX += nextIntervalPx;
    }
  }

  _cullCollectibles() {
    // Zero memory leaks: automatically cull collected or off-screen items behind camera (Issue #49)
    const cutoff = this.camera.worldLeft - 500;
    this.coins    = this.coins.filter(c => !c.collected && c.wx >= cutoff);
    this.fuelCans = this.fuelCans.filter(fc => !fc.collected && fc.wx >= cutoff);
  }

  /* ── Main Loop ───────────────────────────────────────────────── */
  _loop(timestamp) {
    const rawDt = (timestamp - this._lastTime) / 1000;
    const dt    = Math.min(rawDt, 0.033); // cap at ~30ms
    this._lastTime = timestamp;

    if (dt > 0) {
      this._handleInput();
      this._update(dt);
      this._draw(dt);
    }

    this._raf = requestAnimationFrame(t => this._loop(t));
  }

  /* ── Input mapping (Specification 1) ─────────────────────────── */
  _handleInput() {
    if (!this.hasVehicle) return;
    const c = this.chassis;
    if (c.crashed || this._gameOver) {
      c.throttle    = 0;
      c.braking     = false;
      c.airRotInput = 0;
      return;
    }

    // D, W, or ArrowRight, ArrowUp: Accelerate / Gas / Air-Tilt Right
    const gasInput   = (this.keys['ArrowRight'] || this.keys['KeyD'] || this.keys['ArrowUp'] || this.keys['KeyW'] || this._touchState.gas) ? 1 : 0;

    // A, S, or ArrowLeft, ArrowDown: Brake / Reverse / Air-Tilt Left
    const brakeInput = (this.keys['ArrowLeft']  || this.keys['KeyA'] || this.keys['ArrowDown'] || this.keys['KeyS'] || this._touchState.brake) ? 1 : 0;

    // Extra mid-air balancing keys Q / E supported alongside A/D & Left/Right
    const rotLeftKey  = (this.keys['KeyQ']) ? 1 : 0;
    const rotRightKey = (this.keys['KeyE']) ? 1 : 0;

    // If out of fuel, gas input produces no engine torque
    const effectiveGas = (c.fuel > 0) ? gasInput : 0;

    if (c.onGround) {
      // Ground Driving Controls: Gas accelerates, Brake brakes/reverses
      c.throttle    = effectiveGas - brakeInput * 0.65;
      c.braking     = brakeInput > 0 && c.vel.x > 5;
      c.airRotInput = 0;
      // Space jump handled on keydown via _jump() (with -520 impulse, sound, & particles)
    } else {
      // Mid-Air Controls (Specification 1):
      // A / Left / Left-Pedal apply counter-clockwise rotational torque (tilt left)
      // D / Right / Right-Pedal apply clockwise rotational torque (tilt right)
      c.throttle    = 0;
      c.braking     = false;
      c.airRotInput = (gasInput + rotRightKey) - (brakeInput + rotLeftKey);
    }
  }

  /* ── Update Game State (Specifications 2 & 3) ─────────────────── */
  _update(dt) {
    if (!this.hasVehicle) {
      const targetCamX = 200 - (this.camera.screenW / 2) / this.camera.zoom;
      const targetCamY = this.terrain.heightAt(200) - (this.camera.screenH / 2) / this.camera.zoom + (this.camera.verticalOffset) / this.camera.zoom;
      this.camera.x += (targetCamX - this.camera.x) * 0.1;
      this.camera.y += (targetCamY - this.camera.y) * 0.1;
      this.camera.zoom += (this.camera.baseZoom - this.camera.zoom) * 0.1;
      this.particles?.update();
      this._updateHUD();
      return;
    }

    const c = this.chassis;
    const biomeGravity = this.biomeId === 'moon' ? 220 : 980;

    this.chassis.update(this.terrain, dt, biomeGravity);
    this.camera.update(this.chassis, dt);

    // ── Distance Tracking (Specification 4) ──────────────────────
    const currentMeters = Math.max(0, Math.floor((c.pos.x - 200) / 10));
    this.distanceMeters = Math.max(this.distanceMeters, currentMeters);

    // ── Fuel & Energy Mechanics (Rebalanced for Extended Endurance, Issue #49) ──
    if (!c.crashed && !this._gameOver) {
      // Fuel continuously drains at baseline idle rate (decreased to 0.4%/s down from 1.2%/s)
      c.fuel -= dt * 0.4;

      // Increased consumption when pressing the gas pedal on ground (+2.2%/s)
      const isGassing = (this.keys['ArrowRight'] || this.keys['KeyD'] || this.keys['ArrowUp'] || this.keys['KeyW'] || this._touchState.gas);
      if (isGassing && c.onGround) {
        c.fuel -= dt * 2.2;
      }

      // Clamp fuel between 0 and 100%
      c.fuel = Math.max(0, Math.min(100, c.fuel));

      // Warning indicator and blinking alarm when fuel drops below 20%
      if (c.fuel < 20 && c.fuel > 0) {
        if (!this._fuelAlert) {
          this._fuelAlert = true;
          this.audio?.startFuelAlert();
        }
        this.hudFuelCell?.classList.add('fuel-warning');
        if (this.hudFuelWarning) this.hudFuelWarning.hidden = false;
      } else {
        if (this._fuelAlert) {
          this._fuelAlert = false;
          this.audio?.stopFuelAlert();
        }
        this.hudFuelCell?.classList.remove('fuel-warning');
        if (this.hudFuelWarning) this.hudFuelWarning.hidden = true;
      }

      // Game Over condition: "Out of Fuel" when fuel hits 0% and velocity stops
      if (c.fuel <= 0) {
        this.audio?.stopEngine();
        if (Math.abs(c.vel.x) < 12 && c.onGround) {
          this._fuelStopTime += dt;
          if (this._fuelStopTime >= 0.9) {
            this._triggerGameOver('fuel');
          }
        } else {
          this._fuelStopTime = 0;
        }
      }
    }

    // ── Stunts & Aerial Flip Detection (Specification 3) ─────────
    if (!c.crashed && !this._gameOver) {
      if (!c.onGround) {
        // Vehicle is airborne
        this.currentAirTime += dt;
        let dAngle = c.angle - this._lastAngle;
        // Normalize angle delta
        if (dAngle > Math.PI)  dAngle -= Math.PI * 2;
        if (dAngle < -Math.PI) dAngle += Math.PI * 2;
        this.airAngleDelta += dAngle;

        // Backflip detection (full 360° clockwise rotation)
        if (this.airAngleDelta >= Math.PI * 2 * 0.82) {
          this.stuntBonus += 500;
          this._addPopup(c.pos.x, c.pos.y - 45, 'BACKFLIP! +500', '#ec4899');
          this.airAngleDelta = 0;
          this.audio?.playCoinPickup();
        }

        // Frontflip detection (full 360° counter-clockwise rotation)
        if (this.airAngleDelta <= -Math.PI * 2 * 0.82) {
          this.stuntBonus += 500;
          this._addPopup(c.pos.x, c.pos.y - 45, 'FRONTFLIP! +500', '#06b6d4');
          this.airAngleDelta = 0;
          this.audio?.playCoinPickup();
        }
      } else {
        // Vehicle landed
        if (this.currentAirTime >= 0.7) {
          const airPts = Math.floor(this.currentAirTime * 150);
          this.stuntBonus += airPts;
          this._addPopup(c.pos.x, c.pos.y - 40, `AIR-TIME! +${airPts}`, '#38bdf8');
        }
        this.currentAirTime = 0;
        this.airAngleDelta  = 0;
      }
      this._lastAngle = c.angle;
    }

    // ── Procedural Endless Generation Ahead (Issue #49) ─────────
    this._generateCollectiblesAhead(c.pos.x + 2500);

    // ── Collectibles Pickup Checks ───────────────────────────────
    const carX = c.pos.x, carY = c.pos.y;

    // Coins: sound effect and floating score popup (+50, +100)
    this.coins.forEach(coin => {
      if (coin.collected) return;
      coin.animT += dt * 3;
      const wy = this.terrain.heightAt(coin.wx) - (coin.yOffset || 35) + Math.sin(coin.animT) * 8;
      const dx = coin.wx - carX, dy = wy - carY;
      if (Math.hypot(dx, dy) < 42) {
        coin.collected = true;
        this.coinsCollected++;
        this.audio?.playCoinPickup();
        this._addPopup(coin.wx, wy - 10, `+${coin.val}`, '#FFD700');

        const sx = (coin.wx - this.camera.worldLeft) * this.camera.zoom;
        const sy = (wy      - this.camera.worldTop ) * this.camera.zoom;
        this.particles?.emitCoinPickup(sx, sy);
      }
    });

    // Fuel canisters: restores 100% fuel when collected (Specification 2)
    this.fuelCans.forEach(fc => {
      if (fc.collected) return;
      const wy = this.terrain.heightAt(fc.wx) - 30;
      const dx = fc.wx - carX, dy = wy - carY;
      if (Math.hypot(dx, dy) < 46) {
        fc.collected = true;
        c.fuel = 100; // Restores 100% fuel
        this.audio?.playCoinPickup();
        this._addPopup(fc.wx, wy - 15, '100% FUEL!', '#22c55e');

        // Stop alert if refilled
        if (this._fuelAlert) {
          this._fuelAlert = false;
          this.audio?.stopFuelAlert();
          this.hudFuelCell?.classList.remove('fuel-warning');
          if (this.hudFuelWarning) this.hudFuelWarning.hidden = true;
        }
      }
    });

    // ── Cull off-screen & collected items (Issue #49) ────────────
    this._cullCollectibles();

    // ── Crash Check (Flip / Roof Contact) ─────────────────────────
    if (c.crashed && !this._gameOver) {
      this._triggerGameOver('crash');
    }

    // ── Audio Engine Pitch Update ────────────────────────────────
    this.audio?.updateEngineSound(c.vel.x / 60, Math.max(0, c.throttle));

    // ── Particle System Update ───────────────────────────────────
    this.particles?.update();

    // ── Update Floating Score Popups ─────────────────────────────
    this.floatingPopups.forEach(p => {
      p.life -= dt;
      p.wy   -= dt * 32; // float upwards
    });
    this.floatingPopups = this.floatingPopups.filter(p => p.life > 0);

    // ── Total Score Calculation ──────────────────────────────────
    this.totalScore = (this.coinsCollected * 50) + this.stuntBonus + Math.floor(this.distanceMeters * 2);

    // ── HUD Updates ──────────────────────────────────────────────
    this._updateHUD();
  }

  /* ── Add Floating Score Popup ─────────────────────────────────── */
  _addPopup(wx, wy, text, color) {
    this.floatingPopups.push({
      wx,
      wy,
      text,
      color: color || '#FFD700',
      life: 1.1,
    });
  }

  /* ── Trigger Game Over Summary (Specification 4) ──────────────── */
  _triggerGameOver(reason) {
    if (this._gameOver) return;
    this._gameOver = true;
    this.audio?.stopEngine();
    this.audio?.stopFuelAlert();

    if (reason === 'crash') {
      this.audio?.playCrash();
      const sx = (this.chassis.pos.x - this.camera.worldLeft) * this.camera.zoom;
      const sy = (this.chassis.pos.y - this.camera.worldTop ) * this.camera.zoom;
      this.particles?.emitCrash(sx, sy);
    }

    setTimeout(() => {
      if (!this.crashOverlay) return;
      if (reason === 'fuel') {
        if (this.goIcon)  this.goIcon.textContent  = '⛽';
        if (this.goTitle) this.goTitle.textContent = 'Out of Fuel!';
        if (this.goSub)   this.goSub.textContent   = 'Your vehicle ran out of gas in the hills!';
      } else {
        if (this.goIcon)  this.goIcon.textContent  = '💥';
        if (this.goTitle) this.goTitle.textContent = 'Crashed!';
        if (this.goSub)   this.goSub.textContent   = 'Chassis flipped — vehicle was destroyed!';
      }

      if (this.goDist)   this.goDist.textContent   = this.distanceMeters + ' m';
      if (this.goCoins)  this.goCoins.textContent  = this.coinsCollected;
      if (this.goStunts) this.goStunts.textContent = '+' + this.stuntBonus + ' pts';
      if (this.goTotal)  this.goTotal.textContent  = this.totalScore + ' pts';

      this.crashOverlay.hidden = false;
    }, reason === 'fuel' ? 200 : 800);
  }

  /* ── Draw ─────────────────────────────────────────────────────── */
  _draw(_dt) {
    const ctx = this.ctx;
    const W = this.width || this.canvas.width, H = this.height || this.canvas.height;

    ctx.clearRect(0, 0, W, H);

    // ── Sky background ───────────────────────────────────────────
    this._drawSky(ctx, W, H);

    // ── Camera transform → world space ───────────────────────────
    ctx.save();
    this.camera.applyTransform(ctx);

    const camX = this.camera.worldLeft;
    const camY = this.camera.worldTop;

    // ── Terrain ──────────────────────────────────────────────────
    this.terrain.draw(
      ctx,
      camX, camY,
      this.camera.screenW / this.camera.zoom,
      this.camera.screenH / this.camera.zoom + 200,
      this.biomeId
    );

    // ── Collectibles (Coins & Fuel Cans in world space) ───────────
    this._drawCollectibles(ctx, camX, camY);

    // ── Floating Score Popups (World space) ──────────────────────
    this._drawFloatingPopups(ctx, camX, camY);

    // ── Vehicle Chassis & Wheels ─────────────────────────────────
    if (this.hasVehicle) {
      this.chassis.draw(ctx, camX, camY, this.biomeId);
    }

    ctx.restore(); // undo camera transform

    // ── Particles (Screen space) ─────────────────────────────────
    this.particles?.draw(ctx);

    // ── Speed-blur vignette ──────────────────────────────────────
    this._drawSpeedVignette(ctx, W, H);

    // ── Debug overlay ─────────────────────────────────────────────
    if (this.showDebug) this._drawDebug(ctx);
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
    // Gold Coins
    this.coins.forEach(coin => {
      if (coin.collected) return;
      const sx = coin.wx - camX;
      const sy = this.terrain.heightAt(coin.wx) - (coin.yOffset || 35) + Math.sin(coin.animT) * 8 - camY;
      if (sx < -40 || sx > (this.camera.screenW / this.camera.zoom) + 40) return;

      ctx.save();
      ctx.shadowColor = coin.isCrest ? '#FF4081' : '#FFD700';
      ctx.shadowBlur = coin.isCrest ? 18 : 12;

      const cg = ctx.createRadialGradient(sx - 3, sy - 3, 1, sx, sy, 14);
      if (coin.isCrest) {
        cg.addColorStop(0, '#FFE4E1');
        cg.addColorStop(0.5, '#FF4081');
        cg.addColorStop(1, '#C2185B');
      } else {
        cg.addColorStop(0, '#FFF9C4');
        cg.addColorStop(0.5, '#FFD700');
        cg.addColorStop(1, '#F57F17');
      }

      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px Space Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(coin.isCrest ? '★' : '$', sx, sy);
      ctx.restore();
    });

    // Fuel Cans (Red Canisters)
    this.fuelCans.forEach(fc => {
      if (fc.collected) return;
      const sx = fc.wx - camX;
      const sy = this.terrain.heightAt(fc.wx) - 30 - camY;
      if (sx < -40 || sx > (this.camera.screenW / this.camera.zoom) + 40) return;

      ctx.save();
      ctx.shadowColor = '#E53935';
      ctx.shadowBlur  = 12;

      // Canister body
      ctx.fillStyle = '#E53935';
      ctx.fillRect(sx - 11, sy - 22, 22, 28);
      // Highlight strip
      ctx.fillStyle = '#FFCDD2';
      ctx.fillRect(sx - 7, sy - 18, 14, 8);
      // Cap
      ctx.fillStyle = '#B71C1C';
      ctx.fillRect(sx - 4, sy - 26, 8, 5);

      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText('⛽', sx, sy - 3);
      ctx.restore();
    });
  }

  _drawFloatingPopups(ctx, camX, camY) {
    this.floatingPopups.forEach(p => {
      const sx = p.wx - camX;
      const sy = p.wy - camY;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 10;
      ctx.font        = 'bold 13px Space Mono, monospace';
      ctx.textAlign   = 'center';
      ctx.fillText(p.text, sx, sy);
      ctx.restore();
    });
  }

  _drawSpeedVignette(ctx, W, H) {
    if (!this.hasVehicle) return;
    const speed = Math.abs(this.chassis.vel.x);
    const maxV  = this.chassis.maxSpeed;
    const ratio = Math.min(speed / maxV, 1);
    if (ratio < 0.3) return;

    const alpha = (ratio - 0.3) * 0.6;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, 'transparent');
    g.addColorStop(1, `rgba(0,0,0,${alpha.toFixed(2)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  _drawDebug(ctx) {
    const c = this.chassis;
    const lines = [
      `Distance: ${this.distanceMeters}m | Score: ${this.totalScore}`,
      `Fuel: ${c.fuel.toFixed(1)}% | Idle drain: on`,
      `Coins: ${this.coinsCollected} | Stunts: +${this.stuntBonus}`,
      `AirTime: ${this.currentAirTime.toFixed(2)}s | AirAngle: ${(this.airAngleDelta * 180 / Math.PI).toFixed(0)}°`,
      `vel: (${c.vel.x.toFixed(1)}, ${c.vel.y.toFixed(1)})`,
      `zoom: ${this.camera.zoom.toFixed(2)}`,
    ];

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(8, 8, 260, lines.length * 16 + 10);
    ctx.fillStyle = '#00FF88';
    ctx.font = '11px Space Mono, monospace';
    lines.forEach((l, i) => ctx.fillText(l, 14, 22 + i * 16));
    ctx.restore();
  }

  /* ── HUD Live Updates (Specification 4) ───────────────────────── */
  _updateHUD() {
    if (!this.hasVehicle) {
      if (this.hudDist)  this.hudDist.textContent  = '--- m';
      if (this.hudSpeed) this.hudSpeed.textContent = '--- km/h';
      if (this.hudRpm)   this.hudRpm.style.width   = '0%';
      if (this.hudFuel)  this.hudFuel.textContent  = '---';
      if (this.hudFuelBar) {
        this.hudFuelBar.style.width = '0%';
        this.hudFuelBar.style.backgroundColor = '#64748b';
      }
      if (this.hudCoins) this.hudCoins.textContent = '---';
      if (this.hudScore) this.hudScore.textContent = 'Ready';
      if (this.hudAir)   this.hudAir.textContent   = '';
      return;
    }

    const c = this.chassis;
    const spd = Math.abs(c.vel.x / 60 * 10);

    // Distance traveled
    if (this.hudDist) {
      this.hudDist.textContent = this.distanceMeters + ' m';
    }

    // Speedometer
    if (this.hudSpeed) {
      this.hudSpeed.textContent = spd.toFixed(0) + ' km/h';
    }

    // RPM Gauge (Speed ratio)
    if (this.hudRpm) {
      const rpmRatio = Math.min(100, Math.max(8, (Math.abs(c.vel.x) / c.maxSpeed) * 100));
      this.hudRpm.style.width = rpmRatio + '%';
    }

    // Fuel Gauge (Green -> Orange -> Red color gradient)
    if (this.hudFuel) {
      this.hudFuel.textContent = Math.round(c.fuel) + '%';
    }
    if (this.hudFuelBar) {
      this.hudFuelBar.style.width = c.fuel + '%';
      this.hudFuelBar.style.backgroundColor =
        c.fuel > 50 ? '#10b981' : (c.fuel > 20 ? '#f59e0b' : '#ef4444');
    }

    // Coins counter & points
    if (this.hudCoins) {
      this.hudCoins.textContent = this.coinsCollected;
    }
    if (this.hudScore) {
      this.hudScore.textContent = this.totalScore + ' pts';
    }

    // Airborne status & stunt alert
    if (this.hudAir) {
      if (!c.onGround && !c.crashed && !this._gameOver) {
        this.hudAir.textContent = `✈ Air: ${this.currentAirTime.toFixed(1)}s`;
        this.hudAir.style.color = '#00FFFF';
      } else {
        this.hudAir.textContent = '';
      }
    }
  }

  /* ── Explicit Spawn & Clear Controls (Issue #44) ──────────────── */
  spawnCar(options = {}) {
    this.hasVehicle = true;
    if (options.defaultCar) {
      this.chassis.setSprite(null);
      if (this.vehicleSelect) this.vehicleSelect.value = '';
    }
    this._restart();
  }

  clearSandbox() {
    this.hasVehicle = false;
    this.chassis.setSprite(null);
    this.floatingPopups = [];
    this.distanceMeters = 0;
    this.coinsCollected = 0;
    this.stuntBonus = 0;
    this.totalScore = 0;
    this.currentAirTime = 0;
    this.airAngleDelta = 0;
    this._gameOver = false;
    this._outOfFuel = false;
    this._fuelAlert = false;
    this._crashShown = false;
    this._fuelStopTime = 0;
    this.hudFuelCell?.classList.remove('fuel-warning');
    if (this.hudFuelWarning) this.hudFuelWarning.hidden = true;
    if (this.crashOverlay) this.crashOverlay.hidden = true;
    this.audio?.stopEngine();
    this.audio?.stopFuelAlert();
    if (this.vehicleSelect) this.vehicleSelect.value = '';

    // Reset camera to origin
    this.camera.x = 200 - (this.camera.screenW / 2) / this.camera.zoom;
    this.camera.y = this.terrain.heightAt(200) - (this.camera.screenH / 2) / this.camera.zoom + (this.camera.verticalOffset) / this.camera.zoom;
    this.camera.zoom = this.camera.baseZoom;
    this._updateHUD();
  }

  /* ── Restart Run (Shortcut R or Try Again Button) ─────────────── */
  _restart() {
    this.hasVehicle      = true;
    this.chassis.reset(200, this.terrain);
    this.chassis.fuel    = 100;
    this.distanceMeters  = 0;
    this.coinsCollected  = 0;
    this.stuntBonus      = 0;
    this.totalScore      = 0;
    this.currentAirTime  = 0;
    this.airAngleDelta   = 0;
    this._lastAngle      = this.chassis.angle;
    this.floatingPopups  = [];

    this._gameOver       = false;
    this._outOfFuel      = false;
    this._fuelAlert      = false;
    this._crashShown     = false;
    this._fuelStopTime   = 0;

    this.hudFuelCell?.classList.remove('fuel-warning');
    if (this.hudFuelWarning) this.hudFuelWarning.hidden = true;
    if (this.crashOverlay)   this.crashOverlay.hidden   = true;

    this.audio?.stopFuelAlert();
    this.audio?.stopEngine();
    this._spawnCollectibles();
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.audio?.stopEngine();
    this.audio?.stopFuelAlert();
  }
}

window.PhysicsGame = PhysicsGame;
