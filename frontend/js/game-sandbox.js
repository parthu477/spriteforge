/* ============================================================
   SpriteForge — game-sandbox.js
   Interactive Game Sandbox: Vehicle + Parallax + Particles + Audio
   Issue #33 — Driving Controls, Fuel System, Collectibles & HUD
   Issue #34 — Multi-Biome Parallax Environments & Retro Audio FX
   ============================================================ */
'use strict';

class GameSandbox {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    // ── Canvases ────────────────────────────────────────────────
    this.bgCanvas  = document.getElementById('sandbox-bg');
    this.fgCanvas  = document.getElementById('sandbox-fg');
    this.ctx       = this.fgCanvas.getContext('2d');

    // ── Engine systems ──────────────────────────────────────────
    this.renderer = new BiomeParallaxRenderer(this.bgCanvas);
    this.audio    = new RetroAudioEngine();

    // ── Physics / Vehicle state ─────────────────────────────────
    this.car = {
      x: 200, y: 0,
      vx: 0,  vy: 0,
      speed: 0,
      throttle: 0,
      braking: false,
      onGround: true,
      angle: 0,
      flipped: false,
      fuel: 100,             // 0–100, starts full (Issue #33)
      coins: 0,
      crashed: false,
      crashTimer: 0,
    };

    // ── Gameplay & Scoring State (Issue #33) ────────────────────
    this.distanceMeters  = 0;
    this.stuntBonus      = 0;
    this.totalScore      = 0;
    this.currentAirTime  = 0;
    this.airAngleDelta   = 0;
    this._lastAngle      = 0;
    this.floatingPopups  = [];

    // ── Status Flags (Issue #33) ────────────────────────────────
    this._gameOver       = false;
    this._outOfFuel      = false;
    this._fuelAlert      = false;
    this._gameOverShown  = false;
    this._lowSpeedTime   = 0;

    // ── Collectibles state (Issue #49: Endless Procedural Spawning)
    this.coins    = [];
    this.fuelCans = [];
    this._lastCoinSpawnX = 0;
    this._lastFuelSpawnX = 0;

    // ── Camera ──────────────────────────────────────────────────
    this.cameraX = 0;

    // ── Input state (Dual Control Scheme: Keyboard + Touch) ──────
    this.keys = {};
    this._touchState = { gas: 0, brake: 0 };

    // ── Biome / HUD refs ────────────────────────────────────────
    this.biomeSelect   = document.getElementById('biome-select');
    this.muteBtn       = document.getElementById('mute-btn');

    // HUD elements (Issue #33)
    this.hudDist       = document.getElementById('hud-dist');
    this.hudSpeed      = document.getElementById('hud-speed');
    this.hudFuel       = document.getElementById('hud-fuel');
    this.hudFuelBar    = document.getElementById('hud-fuel-bar');
    this.hudFuelCell   = document.getElementById('hud-fuel-cell');
    this.hudFuelWarn   = document.getElementById('hud-fuel-warn');
    this.hudCoins      = document.getElementById('hud-coins');
    this.hudBiome      = document.getElementById('hud-biome');
    this.hudRpmBar     = document.getElementById('hud-rpm-bar');

    // Game Over elements (Issue #33)
    this.crashOverlay  = document.getElementById('crash-overlay');
    this.goIcon        = document.getElementById('crash-icon');
    this.goTitle       = document.getElementById('crash-title');
    this.goSub         = document.getElementById('crash-sub');
    this.goDist        = document.getElementById('go-dist');
    this.goCoins       = document.getElementById('go-coins');
    this.goStunts      = document.getElementById('go-stunts');
    this.goTotal       = document.getElementById('go-total');
    this.restartBtn    = document.getElementById('restart-btn');

    // ── Real-Time Asset Integration State ───────────────────────
    this.incomingAssets      = [];
    this.unreadIncomingCount = 0;
    this.worldSprites        = []; // Sprites placed in world coordinates & parallax layers
    this.customVehicleSprite = null; // Sprite texture skin for active vehicle

    // ── Entity State & Spawn Controls (Issue #44) ───────────────
    this.hasVehicle     = false;
    this.customSprite   = null;
    this.spawnCarBtn    = document.getElementById('spawn-car-btn');
    this.insertSpriteBtn= document.getElementById('insert-sprite-btn');
    this.spriteFileInput= document.getElementById('sprite-file-input');
    this.clearSandboxBtn= document.getElementById('clear-sandbox-btn');

    this._raf = null;
    this._lastTime = 0;

    this._initEvents();
    this._initAssetShelf();
    this._initAssetBus();
    this._resize();
    this._spawnInitialCollectibles();
    this._updateHUD();
    this._loop(0);
  }

  /* ── Events (Dual Control Scheme: Keyboard + Touch Pedals) ── */
  _initEvents() {
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('keydown', e => { this.keys[e.code] = true;  this._onKeyDown(e); });
    window.addEventListener('keyup',   e => { this.keys[e.code] = false; });

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
          this.customSprite = img;
          this.spawnCar();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    this.clearSandboxBtn?.addEventListener('click', () => this.clearSandbox());

    this.biomeSelect?.addEventListener('change', () => {
      this.renderer.setBiome(this.biomeSelect.value);
      if (this.hudBiome) this.hudBiome.textContent = this.biomeSelect.options[this.biomeSelect.selectedIndex].text;
    });

    this.muteBtn?.addEventListener('click', () => {
      const muted = this.audio.toggleMute();
      this.muteBtn.textContent = muted ? '🔇 Unmute' : '🔊 Mute';
      this.muteBtn.classList.toggle('muted', muted);
    });

    this.restartBtn?.addEventListener('click', () => this._restart());

    // On-Screen Touch Pedals with pointer events (zero latency, Issue #33 & Issue #49)
    const gasPedal   = document.getElementById('touch-gas');
    const brakePedal = document.getElementById('touch-brake');
    const jumpPedal  = document.getElementById('touch-jump');

    const setupPedal = (el, type) => {
      if (!el) return;
      const press = () => {
        if (!this.hasVehicle) return;
        this._touchState[type] = 1;
        el.classList.add('pedal-pressed');
        if (type === 'gas' && !this.car.crashed && !this._gameOver && this.car.fuel > 0) {
          this.audio.startEngine();
        }
      };
      const release = () => {
        this._touchState[type] = 0;
        el.classList.remove('pedal-pressed');
      };
      el.addEventListener('pointerdown',   e => { e.preventDefault(); press();   });
      el.addEventListener('pointerup',     e => { e.preventDefault(); release(); });
      el.addEventListener('pointercancel', e => { e.preventDefault(); release(); });
      el.addEventListener('pointerleave',  e => { e.preventDefault(); release(); });
      el.addEventListener('touchstart',  e => { e.preventDefault(); press();   }, { passive: false });
      el.addEventListener('touchend',    e => { e.preventDefault(); release(); }, { passive: false });
      el.addEventListener('touchcancel', e => { e.preventDefault(); release(); }, { passive: false });
    };

    setupPedal(gasPedal,   'gas');
    setupPedal(brakePedal, 'brake');

    // Issue #49: Dedicated [ JUMP ] on-screen touch/mouse pedal
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
  }

  _onKeyDown(e) {
    if (!this.hasVehicle) {
      if (e.code === 'KeyR') { this.spawnCar({ defaultCar: true }); return; }
      return;
    }

    // Instant restart run via 'R' key (Specification 1, Issue #33)
    if (e.code === 'KeyR') { this._restart(); return; }

    // Space key: Car Jump Mechanic (Specification 1, Issue #49)
    if (e.code === 'Space') {
      e.preventDefault();
      this._jump();
      return;
    }

    // Gas keys — start engine audio (zero latency)
    const isGas = (e.code === 'ArrowRight' || e.code === 'KeyD' ||
                   e.code === 'ArrowUp'    || e.code === 'KeyW');
    if (isGas && !this.car.crashed && !this._gameOver && this.car.fuel > 0) {
      this.audio.startEngine();
    }
  }

  /* ── Car Jump Action (Specification 1, Issue #49) ───────────── */
  _jump() {
    if (!this.hasVehicle) return;
    const car = this.car;
    if (!car.onGround || car.crashed || this._gameOver) return;

    // Apply immediate vertical impulse: car.vy = -380 px/s; car.onGround = false;
    car.vy = -380;
    car.onGround = false;

    // Retro jump / spring sound FX
    this.audio?.playJump?.();

    // Emit upward dust and exhaust burst particles from rear wheels
    const screenCarX = this.W * 0.35;
    const wheelY     = car.y + 32;
    const particles  = this.renderer?.particles;
    if (particles) {
      if (typeof particles.emitJumpDust === 'function') {
        particles.emitJumpDust(screenCarX - 26, wheelY);
        particles.emitJumpDust(screenCarX + 26, wheelY);
      } else {
        particles.emitTireDirt(screenCarX - 26, wheelY, -15, true);
      }
      particles.emitExhaust(screenCarX - 44, car.y + 8, 14);
    }
  }

  /* ── Resize ─────────────────────────────────────────────────── */
  _resize() {
    const rect = this.container.getBoundingClientRect();
    const W = Math.floor(rect.width || window.innerWidth);
    const H = Math.floor(rect.height || window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    this.W = W;
    this.H = H;

    this.fgCanvas.width = Math.floor(W * dpr);
    this.fgCanvas.height = Math.floor(H * dpr);
    this.fgCanvas.style.width = W + 'px';
    this.fgCanvas.style.height = H + 'px';
    this.ctx.scale(dpr, dpr);

    this.renderer.resize(W, H);
    this._setCarGroundY();

    const bar = document.querySelector('.sandbox-controls-bar');
    const hud = document.getElementById('sandbox-hud');
    if (bar && hud) {
      hud.style.top = (bar.offsetTop + bar.offsetHeight + 10) + 'px';
    }
  }

  _setCarGroundY() {
    const biome = this.renderer.currentBiome;
    this.groundY = this.H * biome.groundLine - 30; // 30 = half car height
    if (this.car.onGround) {
      this.car.y = this.groundY;
    }
    if (this.coins) {
      this.coins.forEach(c => {
        if (c.yOffset !== undefined) {
          c.wy = this.groundY - c.yOffset;
        }
      });
    }
  }

  /* ── Endless Procedural Collectibles (Issue #49) ─────────────── */
  _spawnInitialCollectibles() {
    this.coins = [];
    this.fuelCans = [];
    this._lastCoinSpawnX = 300;
    this._lastFuelSpawnX = 600;
    this._generateCollectiblesAhead(this.cameraX + (this.W || 800) + 1600);
  }

  _generateCollectiblesAhead(targetX) {
    const gY = this.groundY || (this.H * this.renderer.currentBiome.groundLine - 30);

    // ── Infinite Procedural Coins (Formations & Star Coins, Issue #49)
    while (this._lastCoinSpawnX < targetX) {
      const startX = this._lastCoinSpawnX;
      const formationType = Math.floor(Math.random() * 3);

      if (formationType === 0) {
        // Formation 1: Rolling hill contours following ground wave curve
        const count = 5 + Math.floor(Math.random() * 4);
        const spacing = 55 + Math.random() * 15;
        const waveFreq = 0.01 + Math.random() * 0.008;
        for (let i = 0; i < count; i++) {
          const wx = startX + i * spacing;
          const yOffset = 35 + Math.sin(wx * waveFreq) * 22;
          const isStar = (i === Math.floor(count / 2) && Math.random() > 0.4);
          this.coins.push({
            wx,
            yOffset,
            wy: gY - yOffset,
            r: 14,
            collected: false,
            animT: Math.random() * Math.PI * 2,
            value: isStar ? 100 : 50,
            isStar,
          });
        }
        this._lastCoinSpawnX = startX + count * spacing + 120 + Math.random() * 120;
      } else if (formationType === 1) {
        // Formation 2: Jump arches (curved arc formations over ramps/crests)
        const count = 7 + Math.floor(Math.random() * 3);
        const archWidth = 380 + Math.random() * 100;
        const step = archWidth / (count - 1);
        const peakHeight = 100 + Math.random() * 25; // 100-125px high above ground
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          const wx = startX + i * step;
          const archY = Math.sin(t * Math.PI) * peakHeight;
          const yOffset = 30 + archY;
          const isApex = (i >= Math.floor(count / 2) - 1 && i <= Math.floor(count / 2) + 1);
          this.coins.push({
            wx,
            yOffset,
            wy: gY - yOffset,
            r: 14,
            collected: false,
            animT: Math.random() * Math.PI * 2,
            value: isApex ? 100 : 50,
            isStar: isApex,
          });
        }
        this._lastCoinSpawnX = startX + archWidth + 140 + Math.random() * 120;
      } else {
        // Formation 3: Bonus Star Coins (+100 pts) at high altitudes rewarding mid-air jumps
        const count = 3 + Math.floor(Math.random() * 2);
        const spacing = 55;
        for (let i = 0; i < count; i++) {
          const wx = startX + i * spacing;
          const yOffset = 115 + Math.random() * 20; // High altitude reachable by jumping
          this.coins.push({
            wx,
            yOffset,
            wy: gY - yOffset,
            r: 15,
            collected: false,
            animT: Math.random() * Math.PI * 2,
            value: 100,
            isStar: true,
          });
        }
        this._lastCoinSpawnX = startX + count * spacing + 160 + Math.random() * 140;
      }
    }

    // ── Extended Fuel Endurance (Procedural Canisters every 250–350 meters, Issue #49)
    // In Biome Sandbox: 60 px = 1 meter. 250-350m = 15,000 - 21,000 px.
    while (this._lastFuelSpawnX < targetX) {
      this.fuelCans.push({
        wx: this._lastFuelSpawnX,
        r: 18,
        collected: false,
      });
      const nextIntervalPx = (250 + Math.random() * 100) * 60;
      this._lastFuelSpawnX += nextIntervalPx;
    }
  }

  _cullCollectibles() {
    // Zero memory leaks: automatically cull collected or off-screen items behind camera (Issue #49)
    const cutoff = this.cameraX - 500;
    this.coins    = this.coins.filter(c => !c.collected && c.wx >= cutoff);
    this.fuelCans = this.fuelCans.filter(fc => !fc.collected && fc.wx >= cutoff);
  }

  /* ── Main Loop ───────────────────────────────────────────────── */
  _loop(timestamp) {
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.05); // cap at 50ms
    this._lastTime = timestamp;
    this._update(dt);
    this._draw();
    this._raf = requestAnimationFrame(t => this._loop(t));
  }

  /* ── Physics Update (Issue #33 full gameplay loop) ──────────── */
  _update(dt) {
    if (dt <= 0) return;
    if (!this.hasVehicle) {
      this.renderer.draw(this.cameraX);
      this._drawForeground();
      this._updateHUD();
      return;
    }
    const car    = this.car;
    const biome  = this.renderer.currentBiome;
    const gY     = this.H * biome.groundLine - 30;
    const gravity  = biome.id === 'moon' ? 180 : 600;
    const friction = biome.id === 'moon' ? 0.97 : 0.90;
    const maxSpeed = biome.id === 'moon' ? 7 : 12;

    // ── Game over stall ─────────────────────────────────────────
    if (this._gameOver) {
      if (!this._gameOverShown) {
        this._gameOverShown = true;
        this._showGameOver();
      }
      this.renderer.draw(this.cameraX);
      this._drawForeground();
      return;
    }

    // ── Crash countdown ─────────────────────────────────────────
    if (car.crashed) {
      car.crashTimer -= dt;
      if (car.crashTimer <= 0) this._gameOver = true;
      this.renderer.draw(this.cameraX);
      this._drawForeground();
      return;
    }

    // ── Input → forces ──────────────────────────────────────────
    // W/D/↑/→ = Gas/Tilt-Right | S/A/↓/← = Brake/Tilt-Left (Spec 1)
    const gasDown   = (this.keys['ArrowRight'] || this.keys['KeyD'] ||
                       this.keys['ArrowUp']    || this.keys['KeyW'] ||
                       this._touchState.gas);
    const brakeDown = (this.keys['ArrowLeft']  || this.keys['KeyA'] ||
                       this.keys['ArrowDown']   || this.keys['KeyS'] ||
                       this._touchState.brake);

    car.throttle = gasDown ? 1 : 0;
    car.braking  = !!brakeDown;

    if (car.onGround) {
      if (car.fuel > 0 && gasDown) car.vx += 280 * dt;
      if (brakeDown) {
        if (car.vx > 0.5) {
          car.vx *= 0.85;
          if (Math.abs(car.vx) > 3 * 60) this.audio.playBrakeSqueal(Math.min(Math.abs(car.vx) / (8 * 60), 1));
        } else if (car.vx > -maxSpeed * 60 * 0.4) {
          car.vx -= 140 * dt; // allow some reverse
        }
      }
    } else {
      // Mid-air: A/D or ←/→ apply rotational torque (Spec 1, Issue #33)
      if (gasDown)   car.angle += 90 * dt;  // Clockwise tilt-right
      if (brakeDown) car.angle -= 90 * dt;  // Counter-clockwise tilt-left
    }

    // Friction & max speed
    if (!gasDown && !brakeDown) car.vx *= friction;
    car.vx = Math.max(-maxSpeed * 60 * 0.4, Math.min(maxSpeed * 60, car.vx));
    car.speed = car.vx / 60;

    // Gravity
    if (!car.onGround) {
      car.vy += gravity * dt;
      if (!gasDown && !brakeDown) car.angle += (car.vx > 0 ? 1.0 : -1.0) * dt * 15;
    } else {
      car.vy = 0;
      car.angle *= 0.78; // gradually level on ground
    }

    // ── Position update ─────────────────────────────────────────
    car.y += car.vy * dt;
    this.cameraX += car.vx * dt;

    // Distance meter in meters (Issue #33)
    if (car.vx > 0) this.distanceMeters += (car.vx * dt) / 60;

    // ── Ground detection ────────────────────────────────────────
    if (car.y >= gY) {
      // Air-time bonus (Issue #33)
      if (!car.onGround && this.currentAirTime > 0.7) {
        const airPts = Math.round(this.currentAirTime * 150);
        this.stuntBonus += airPts;
        this.totalScore += airPts;
        this._spawnPopup(`+${airPts} AIR`, this.W * 0.35, gY - 60);
      }
      // Flip stunt detection (Issue #33)
      if (!car.onGround && Math.abs(this.airAngleDelta) >= 340) {
        const stuntName = car.angle > 0 ? 'FRONTFLIP!' : 'BACKFLIP!';
        this.stuntBonus  += 500;
        this.totalScore  += 500;
        this._spawnPopup(`${stuntName} +500`, this.W * 0.35, gY - 80);
        this.audio.playCoinPickup?.();
      }

      car.y = gY; car.vy = 0; car.onGround = true;
      this.currentAirTime = 0;
      this.airAngleDelta  = 0;
      this._lastAngle     = car.angle;

      // Flip crash on hard landing
      if (Math.abs(car.angle) > 120 && Math.abs(car.vx) > 3 * 60) {
        this._triggerCrash('flip');
        return;
      }
    } else if (car.onGround) {
      car.onGround = false;
      this._lastAngle = car.angle;
    } else {
      this.currentAirTime += dt;
      this.airAngleDelta  += car.angle - this._lastAngle;
      this._lastAngle      = car.angle;
    }

    // ── Fuel Consumption (Rebalanced for Extended Endurance, Issue #49) ──
    // Baseline idle drain decreased to 0.4%/s (down from 1.2%/s)
    if (car.fuel > 0) {
      let drain = 0.4 * dt;
      if (car.throttle > 0) drain += 2.4 * dt;
      car.fuel = Math.max(0, car.fuel - drain);
    }

    // Low fuel red warning alarm < 20% (Issue #33)
    if (car.fuel < 20 && !this._fuelAlert) {
      this._fuelAlert = true;
      this.audio.startFuelAlert?.();
      this.hudFuelCell?.classList.add('fuel-warning');
      if (this.hudFuelWarn) this.hudFuelWarn.hidden = false;
    }
    if (car.fuel >= 20 && this._fuelAlert) {
      this._fuelAlert = false;
      this.audio.stopFuelAlert?.();
      this.hudFuelCell?.classList.remove('fuel-warning');
      if (this.hudFuelWarn) this.hudFuelWarn.hidden = true;
    }

    // Out of Fuel Game Over: fuel=0 AND vehicle nearly stopped (Issue #33)
    if (car.fuel === 0) {
      if (Math.abs(car.vx) < 12) {
        this._lowSpeedTime += dt;
        if (this._lowSpeedTime >= 0.9) { this._triggerCrash('fuel'); return; }
      } else {
        this._lowSpeedTime = 0;
      }
    } else {
      this._lowSpeedTime = 0;
    }

    // ── Particle emission ────────────────────────────────────────
    const particles  = this.renderer.particles;
    const screenCarX = this.W * 0.35;
    const wheelY     = car.y + 32;
    if (car.onGround && Math.abs(car.vx) > 1) {
      particles.emitTireDirt(screenCarX - 18, wheelY, car.speed, true);
      particles.emitTireDirt(screenCarX + 18, wheelY, car.speed, true);
    }
    if (car.throttle > 0 || Math.abs(car.speed) > 1) {
      particles.emitExhaust(screenCarX - 44, car.y + 8, car.speed);
    }

    // ── Procedural Endless Generation Ahead (Issue #49) ─────────
    this._generateCollectiblesAhead(this.cameraX + this.W + 1600);

    // ── Coin collection (Issue #33 & Issue #49) ─────────────────
    this.coins.forEach(coin => {
      if (coin.collected) return;
      coin.animT += dt * 3;
      coin.wy = gY - (coin.yOffset || 40) + Math.sin(coin.animT) * 8;
      const coinSX = coin.wx - this.cameraX + screenCarX;
      const dx = coinSX - screenCarX;
      const dy = coin.wy - car.y;
      if (Math.sqrt(dx * dx + dy * dy) < coin.r + 28) {
        coin.collected = true;
        car.coins++;
        this.totalScore += coin.value;
        particles.emitCoinPickup(coinSX, coin.wy);
        this.audio.playCoinPickup?.();
        this._spawnPopup(`+${coin.value}`, coinSX, coin.wy - 20);
      }
    });

    // ── Fuel canister collection (restores 100%, Issue #33) ─────
    this.fuelCans.forEach(fc => {
      if (fc.collected) return;
      const fcSX = fc.wx - this.cameraX + screenCarX;
      const dx   = fcSX - screenCarX;
      const dy   = (gY - 20) - car.y;
      if (Math.sqrt(dx * dx + dy * dy) < fc.r + 28) {
        fc.collected = true;
        car.fuel = 100; // full restore
        if (this._fuelAlert) {
          this._fuelAlert = false;
          this.audio.stopFuelAlert?.();
          this.hudFuelCell?.classList.remove('fuel-warning');
          if (this.hudFuelWarn) this.hudFuelWarn.hidden = true;
        }
        particles.emitCoinPickup(fcSX, gY - 20);
        this._spawnPopup('⛽ FULL!', fcSX, gY - 50);
      }
    });

    // ── Cull off-screen & collected items (Issue #49) ────────────
    this._cullCollectibles();

    // ── Floating popup lifetime ──────────────────────────────────
    this.floatingPopups = this.floatingPopups.filter(p => p.alpha > 0);
    this.floatingPopups.forEach(p => { p.y -= 55 * dt; p.alpha -= 0.9 * dt; });

    // ── Audio engine update ─────────────────────────────────────
    this.audio.updateEngineSound?.(car.speed, car.throttle);

    // ── HUD update (Issue #33) ───────────────────────────────────
    this._updateHUD();
  }

  /* ── Spawn floating score popup (Issue #33) ─────────────────── */
  _spawnPopup(text, x, y) {
    this.floatingPopups.push({ text, x, y, alpha: 1.0 });
  }

  /* ── Trigger crash / game over (Issue #33) ─────────────────── */
  _triggerCrash(reason) {
    const car = this.car;
    if (reason === 'fuel') {
      this._outOfFuel = true;
      this._gameOver  = true;
      this.audio.stopEngine?.();
      this.audio.stopFuelAlert?.();
      this._fuelAlert = false;
    } else {
      car.crashed    = true;
      car.crashTimer = 1.8;
      const screenCarX = this.W * 0.35;
      this.renderer.particles.emitCrash(screenCarX, car.y);
      this.audio.playCrash?.();
      this.audio.stopEngine?.();
      this._fuelAlert = false;
      this.audio.stopFuelAlert?.();
    }
  }

  /* ── Show Game Over Summary (Issue #33) ─────────────────────── */
  _showGameOver() {
    if (!this.crashOverlay) return;
    const dist  = Math.round(this.distanceMeters);
    const total = this.totalScore + dist;
    if (this.goIcon)   this.goIcon.textContent  = this._outOfFuel ? '⛽' : '💥';
    if (this.goTitle)  this.goTitle.textContent  = this._outOfFuel ? 'Out of Fuel!' : 'Crashed!';
    if (this.goSub)    this.goSub.textContent    = this._outOfFuel
      ? 'Tank empty! Collect fuel canisters next time.'
      : 'Your vehicle flipped out of control.';
    if (this.goDist)   this.goDist.textContent   = `${dist} m`;
    if (this.goCoins)  this.goCoins.textContent  = `${this.car.coins} 🪙`;
    if (this.goStunts) this.goStunts.textContent = `${this.stuntBonus} pts`;
    if (this.goTotal)  this.goTotal.textContent  = `${total} pts`;
    this.crashOverlay.hidden = false;
  }

  /* ── Explicit Spawn & Clear Controls (Issue #44) ──────────────── */
  spawnCar(options = {}) {
    this.hasVehicle = true;
    if (options.defaultCar) {
      this.customSprite = null;
    }
    this._restart();
  }

  clearSandbox() {
    this.hasVehicle     = false;
    this.customSprite   = null;
    this.floatingPopups = [];
    this.cameraX        = 0;
    this.distanceMeters = 0;
    this.stuntBonus     = 0;
    this.totalScore     = 0;
    this.currentAirTime = 0;
    this.airAngleDelta  = 0;
    this._gameOver      = false;
    this._outOfFuel     = false;
    this._fuelAlert     = false;
    this._gameOverShown = false;
    this._lowSpeedTime  = 0;
    this.hudFuelCell?.classList.remove('fuel-warning');
    if (this.hudFuelWarn) this.hudFuelWarn.hidden = true;
    if (this.crashOverlay) this.crashOverlay.hidden = true;
    this.audio.stopEngine?.();
    this.audio.stopFuelAlert?.();
    this._updateHUD();
  }

  _restart() {
    this.hasVehicle = true;
    const car = this.car;
    car.vx = 0; car.vy = 0;
    car.speed = 0; car.throttle = 0; car.braking = false;
    car.onGround = true; car.angle = 0; car.flipped = false;
    car.fuel = 100; car.coins = 0; car.crashed = false; car.crashTimer = 0;
    this.cameraX        = 0;
    this.distanceMeters = 0;
    this.stuntBonus     = 0;
    this.totalScore     = 0;
    this.currentAirTime = 0;
    this.airAngleDelta  = 0;
    this.floatingPopups = [];
    this._gameOver      = false;
    this._outOfFuel     = false;
    this._fuelAlert     = false;
    this._gameOverShown = false;
    this._lowSpeedTime  = 0;
    this.hudFuelCell?.classList.remove('fuel-warning');
    if (this.hudFuelWarn) this.hudFuelWarn.hidden = true;
    if (this.crashOverlay) this.crashOverlay.hidden = true;
    this.audio.stopFuelAlert?.();
    this._spawnInitialCollectibles();
    this._setCarGroundY();
  }

  /* ── Draw ────────────────────────────────────────────────────── */
  _draw() {
    this.renderer.draw(this.cameraX);
    this._drawForeground();
  }

  _drawForeground() {
    const ctx = this.ctx;
    const { W, H, car } = this;
    ctx.clearRect(0, 0, W, H);

    const biome  = this.renderer.currentBiome;
    const gY     = H * biome.groundLine - 30;
    const carSX  = W * 0.35; // car screen X

    // ── Background & Midground Placed World Sprites (Parallax) ───
    this._drawWorldSprites(ctx, 'background', biome, gY, carSX);
    this._drawWorldSprites(ctx, 'midground',  biome, gY, carSX);

    // Draw uncollected coins — star icon for high-value crests and jump bonus (Issue #33 & #49)
    this.coins.forEach(coin => {
      if (coin.collected) return;
      const cx = coin.wx - this.cameraX + carSX;
      if (cx < -30 || cx > W + 30) return;
      ctx.save();
      const isStar = (coin.value === 100 || coin.isStar);
      ctx.shadowColor = isStar ? '#FF4081' : '#FFD700';
      ctx.shadowBlur  = isStar ? 18 : 12;
      const cg = ctx.createRadialGradient(cx - 3, coin.wy - 3, 1, cx, coin.wy, coin.r);
      if (isStar) {
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
      ctx.arc(cx, coin.wy, coin.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = isStar ? '#FFFFFF' : '#8B6914';
      ctx.font = 'bold 11px Space Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isStar ? '★' : '$', cx, coin.wy);
      ctx.restore();
    });

    // Draw floating score popups (Issue #33)
    this.floatingPopups?.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.font = 'bold 15px Space Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFD700';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    });

    // Draw fuel cans
    this.fuelCans.forEach(fc => {
      if (fc.collected) return;
      const fx = fc.wx - this.cameraX + carSX;
      if (fx < -30 || fx > W + 30) return;
      const fy = gY - 20;
      ctx.save();
      ctx.fillStyle = '#E53935';
      ctx.fillRect(fx - 10, fy - 20, 20, 28);
      ctx.fillStyle = '#FFCDD2';
      ctx.fillRect(fx - 6,  fy - 16, 12, 8);
      ctx.fillStyle = '#B71C1C';
      ctx.fillRect(fx - 3,  fy - 24, 6, 6);
      ctx.fillStyle = '#fff';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⛽', fx, fy - 4);
      ctx.restore();
    });

    // ── Ground-Level Placed World Sprites (Sorted behind Car) ────
    this._drawWorldSprites(ctx, 'ground', biome, gY, carSX);

    // Draw car
    if (this.hasVehicle) {
      ctx.save();
      ctx.translate(carSX, car.y + 28);
      ctx.rotate(car.angle * Math.PI / 180);
      if (this.customSprite) {
        const w = 88;
        const h = (this.customSprite.height / this.customSprite.width) * w;
        ctx.drawImage(this.customSprite, -w / 2, -h / 2, w, h);
      } else {
        this._drawCar(ctx, biome.id);
      }
      ctx.restore();
    }

    // ── Foreground Overlay Placed World Sprites (In front of Car) ─
    this._drawWorldSprites(ctx, 'overlay', biome, gY, carSX);

    // Crash flash
    if (car.crashed && car.crashTimer > 1.2) {
      ctx.save();
      ctx.fillStyle = `rgba(255,80,0,${0.3 * Math.sin(car.crashTimer * 30)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  _drawCar(ctx, biomeId) {
    // If a custom sprite is ingested as vehicle, render the sprite texture!
    if (this.customVehicleSprite && this.customVehicleSprite.img && this.customVehicleSprite.img.complete) {
      const s = this.customVehicleSprite;
      const targetW = 96;
      const aspect = s.fw / Math.max(1, s.fh);
      const targetH = Math.max(30, Math.min(65, targetW / aspect));

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(0, 32, targetW * 0.45, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Multi-frame animation playback
      const totalFrames = s.metadata?.frame_count || (s.metadata?.rows * s.metadata?.columns) || 1;
      const fps = s.metadata?.fps || 8;
      const currentFrame = Math.floor((Date.now() / 1000) * fps) % Math.max(1, totalFrames);
      const cols = s.metadata?.columns || totalFrames || 1;
      const fx = (currentFrame % cols) * s.fw;
      const fy = Math.floor(currentFrame / cols) * s.fh;

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(s.img, fx, fy, s.fw, s.fh, -targetW / 2, -targetH / 2, targetW, targetH);

      // Chassis Wheels
      const wheelPositions = [[-28, 22], [28, 22]];
      wheelPositions.forEach(([wx, wy]) => {
        ctx.fillStyle = '#1e293b';
        ctx.beginPath(); ctx.arc(wx, wy, 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#06b6d4';
        ctx.beginPath(); ctx.arc(wx, wy, 5, 0, Math.PI * 2); ctx.fill();
      });
      return;
    }
    // Car body styling per biome
    const styles = {
      countryside: { body: '#E53935', roof: '#C62828', wheel: '#212121', detail: '#FFEB3B' },
      desert:      { body: '#FF9800', roof: '#E65100', wheel: '#3E2723', detail: '#FFF9C4' },
      cyberpunk:   { body: '#7C4DFF', roof: '#311B92', wheel: '#000000', detail: '#00FFFF' },
      moon:        { body: '#90A4AE', roof: '#546E7A', wheel: '#263238', detail: '#ECEFF1' },
    };
    const s = styles[biomeId] || styles.countryside;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 32, 42, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const bodyGrad = ctx.createLinearGradient(-40, -28, 40, 10);
    bodyGrad.addColorStop(0, s.body);
    bodyGrad.addColorStop(1, s.roof);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(-44, -10, 88, 28, 6);
    ctx.fill();

    // Roof/Cabin
    ctx.fillStyle = s.roof;
    ctx.beginPath();
    ctx.roundRect(-28, -28, 56, 20, 4);
    ctx.fill();

    // Windows
    ctx.fillStyle = biomeId === 'cyberpunk' ? 'rgba(0,255,255,0.3)' : 'rgba(180,220,255,0.7)';
    ctx.fillRect(-24, -25, 22, 14);
    ctx.fillRect(2,  -25, 22, 14);

    // Headlights
    ctx.fillStyle = '#FFFDE7';
    ctx.shadowColor = '#FFFDE7'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(42, -2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Taillights
    ctx.fillStyle = '#FF1744';
    ctx.shadowColor = '#FF1744'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(-42, -2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Detail stripe
    ctx.strokeStyle = s.detail;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(40, 0); ctx.stroke();

    // Exhaust pipe
    ctx.fillStyle = '#616161';
    ctx.fillRect(-48, 6, 8, 5);

    // Wheels
    const wheelPositions = [[-26, 22], [26, 22]];
    wheelPositions.forEach(([wx, wy]) => {
      // Tyre
      ctx.fillStyle = s.wheel;
      ctx.beginPath(); ctx.arc(wx, wy, 12, 0, Math.PI * 2); ctx.fill();
      // Rim
      ctx.fillStyle = '#BDBDBD';
      ctx.beginPath(); ctx.arc(wx, wy, 6, 0, Math.PI * 2); ctx.fill();
      // Hub
      ctx.fillStyle = '#757575';
      ctx.beginPath(); ctx.arc(wx, wy, 3, 0, Math.PI * 2); ctx.fill();
      // Spokes
      ctx.strokeStyle = '#9E9E9E'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i;
        ctx.beginPath();
        ctx.moveTo(wx + Math.cos(a)*3, wy + Math.sin(a)*3);
        ctx.lineTo(wx + Math.cos(a)*6, wy + Math.sin(a)*6);
        ctx.stroke();
      }
    });
  }

  /* ── HUD Update (Issue #33: Distance, Speed, RPM, Fuel, Coins) ─ */
  _updateHUD() {
    if (!this.hasVehicle) {
      if (this.hudDist)   this.hudDist.textContent   = '--- m';
      if (this.hudSpeed)  this.hudSpeed.textContent  = '--- km/h';
      if (this.hudCoins)  this.hudCoins.textContent  = '---';
      if (this.hudRpmBar) this.hudRpmBar.style.width = '0%';
      if (this.hudFuel)   this.hudFuel.textContent   = '---';
      if (this.hudFuelBar) {
        this.hudFuelBar.style.width = '0%';
        this.hudFuelBar.style.backgroundColor = '#64748b';
      }
      return;
    }

    const { car } = this;
    const speed = Math.abs(Math.round(car.speed * 10));
    const rpm   = Math.min(1, Math.abs(car.vx) / (12 * 60));

    if (this.hudDist)   this.hudDist.textContent   = `${Math.round(this.distanceMeters)} m`;
    if (this.hudSpeed)  this.hudSpeed.textContent  = `${speed} km/h`;
    if (this.hudCoins)  this.hudCoins.textContent  = car.coins;
    if (this.hudRpmBar) this.hudRpmBar.style.width = `${Math.round(rpm * 100)}%`;

    // Fuel bar with Green→Orange→Red gradient (Issue #33)
    if (this.hudFuel)    this.hudFuel.textContent    = `${Math.round(car.fuel)}%`;
    if (this.hudFuelBar) {
      this.hudFuelBar.style.width = `${car.fuel}%`;
      if      (car.fuel > 50) this.hudFuelBar.style.backgroundColor = '#4CAF50';
      else if (car.fuel > 20) this.hudFuelBar.style.backgroundColor = '#FF9800';
      else                    this.hudFuelBar.style.backgroundColor = '#F44336';
    }
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.audio.stopEngine?.();
    this.audio.stopFuelAlert?.();
    if (this.busChannel) {
      try { this.busChannel.close(); } catch (_) {}
    }
  }

  /* ── Real-Time Asset Integration Shelf & Hybrid Bus ────────── */
  _initAssetBus() {
    const CHANNEL_NAME = 'spriteforge_asset_bus';
    const QUEUE_KEY = 'spriteforge_dispatched_assets';
    const EVENT_KEY = 'spriteforge_bus_event';

    // 1. Initial queue load from persistent FIFO localStorage queue
    try {
      const stored = localStorage.getItem(QUEUE_KEY);
      if (stored) {
        const queue = JSON.parse(stored);
        if (Array.isArray(queue)) {
          const relevant = queue.filter(item => item?.target === 'biome' || item?.target === 'both');
          this.incomingAssets = relevant;
          this.unreadIncomingCount = relevant.length;
          this._updateShelfBadge();
          this._renderShelfList();
        }
      }
    } catch (err) {
      console.warn('Could not load persistent dispatched assets for Biome Sandbox:', err);
    }

    // 2. Real-time BroadcastChannel listener
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.busChannel = new BroadcastChannel(CHANNEL_NAME);
        this.busChannel.onmessage = (event) => {
          this._handleIncomingAssetPayload(event.data);
        };
      } catch (err) {
        console.warn('BroadcastChannel error in Biome Sandbox:', err);
      }
    }

    // 3. Fault-tolerant storage event fallback
    window.addEventListener('storage', (event) => {
      if (event.key === EVENT_KEY && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          if (data && data.payload) {
            this._handleIncomingAssetPayload(data.payload);
          }
        } catch (_) {}
      }
    });
  }

  _handleIncomingAssetPayload(payload) {
    if (!payload || payload.type !== 'ASSET_DISPATCH') return;
    if (payload.target !== 'biome' && payload.target !== 'both') return;

    const asset = payload.asset;
    if (!asset || !asset.imageUrl) return;

    // Deduplicate against existing items in shelf
    const exists = this.incomingAssets.some(
      item => item?.asset?.id === asset.id ||
              (item?.asset?.name === asset.name && item?.asset?.timestamp === asset.timestamp)
    );
    if (exists) return;

    this.incomingAssets.unshift(payload);
    this.unreadIncomingCount++;
    this._updateShelfBadge();
    this._renderShelfList();

    this.audio?.playCoinPickup?.();
    this.floatingPopups?.push({
      x: this.W * 0.35,
      y: 120,
      text: `📥 New Sprite: ${asset.name}!`,
      alpha: 1.2
    });
  }

  _updateShelfBadge() {
    if (!this.shelfBadge) return;
    if (this.unreadIncomingCount > 0) {
      this.shelfBadge.textContent = this.unreadIncomingCount;
      this.shelfBadge.hidden = false;
    } else {
      this.shelfBadge.hidden = true;
    }
  }

  _initAssetShelf() {
    this.shelfBtn      = document.getElementById('shelf-btn');
    this.shelfBadge    = document.getElementById('shelf-badge');
    this.assetShelf    = document.getElementById('asset-shelf');
    this.shelfBackdrop = document.getElementById('shelf-backdrop');
    this.shelfClose    = document.getElementById('shelf-close');
    this.shelfList     = document.getElementById('shelf-list');
    this.shelfCountTag = document.getElementById('shelf-count-tag');
    this.shelfClear    = document.getElementById('shelf-clear');

    const openShelf = () => {
      if (!this.assetShelf) return;
      this.assetShelf.hidden = false;
      if (this.shelfBackdrop) this.shelfBackdrop.hidden = false;
      requestAnimationFrame(() => {
        this.assetShelf.classList.add('open');
      });
      this.unreadIncomingCount = 0;
      this._updateShelfBadge();
      this._renderShelfList();
    };

    const closeShelf = () => {
      if (!this.assetShelf) return;
      this.assetShelf.classList.remove('open');
      if (this.shelfBackdrop) this.shelfBackdrop.hidden = true;
      setTimeout(() => {
        if (!this.assetShelf.classList.contains('open')) {
          this.assetShelf.hidden = true;
        }
      }, 350);
    };

    this.shelfBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.assetShelf?.classList.contains('open')) {
        closeShelf();
      } else {
        openShelf();
      }
    });

    this.shelfClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeShelf();
    });

    this.shelfBackdrop?.addEventListener('click', () => {
      closeShelf();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.assetShelf?.classList.contains('open')) {
        closeShelf();
      }
    });

    this.shelfClear?.addEventListener('click', () => {
      this.incomingAssets = [];
      this.unreadIncomingCount = 0;
      this._updateShelfBadge();
      this._renderShelfList();
      try {
        localStorage.removeItem('spriteforge_dispatched_assets');
      } catch (_) {}
    });
  }

  _renderShelfList() {
    if (!this.shelfList) return;
    if (this.shelfCountTag) {
      this.shelfCountTag.textContent = `${this.incomingAssets.length} asset${this.incomingAssets.length === 1 ? '' : 's'}`;
    }

    if (!this.incomingAssets.length) {
      this.shelfList.innerHTML = `
        <div class="shelf-empty">
          <span class="shelf-empty-icon">📦</span>
          <p class="shelf-empty-title">No incoming assets yet</p>
          <p class="shelf-empty-sub">Dispatch sprites from the <a href="/" target="_blank">Generator</a> using <strong>[ 🎮 Send to Biome Sandbox ]</strong></p>
        </div>
      `;
      return;
    }

    this.shelfList.innerHTML = this.incomingAssets.map((item, idx) => {
      const a = item.asset;
      const meta = a.metadata || {};
      const fw = meta.frame_width || 128;
      const fh = meta.frame_height || 128;
      const grid = `${meta.rows || 1}×${meta.columns || 1}`;
      const timeStr = a.timestamp ? new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Recent';
      const targetClass = item.target === 'both' ? 'target-both' : 'target-biome';
      const targetName = item.target === 'both' ? 'Both' : 'Biome';

      return `
        <div class="shelf-item-card" data-idx="${idx}">
          <div class="shelf-card-top">
            <div class="shelf-card-thumb-wrap">
              <img src="${a.imageUrl}" alt="${a.name}" class="shelf-card-thumb" crossorigin="anonymous" loading="lazy">
            </div>
            <div class="shelf-card-info">
              <span class="shelf-card-name">${a.name}</span>
              <span class="shelf-card-meta">${fw}×${fh}px · ${grid}</span>
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="shelf-target-badge ${targetClass}">${targetName}</span>
                <span class="shelf-card-time">${timeStr}</span>
              </div>
            </div>
          </div>
          <div class="shelf-card-actions">
            <button type="button" class="btn-quick-ingest" data-idx="${idx}" title="Quick Ingest: Place into parallax world and bind texture">
              ⚡ Quick Ingest
            </button>
            <button type="button" class="btn-card-subaction btn-place-world" data-idx="${idx}" title="Place sprite into parallax world layers">
              🌍 Place in World
            </button>
            <button type="button" class="btn-card-subaction btn-skin-car" data-idx="${idx}" title="Skin player vehicle with this sprite">
              🚗 Drive as Vehicle
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.shelfList.querySelectorAll('.btn-quick-ingest').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const item = this.incomingAssets[idx];
        if (!item) return;
        this.ingestSpriteToWorld(item.asset, 'ground');
        this.ingestSpriteAsVehicle(item.asset);
        if (this.assetShelf?.classList.contains('open')) {
          this.assetShelf.classList.remove('open');
          if (this.shelfBackdrop) this.shelfBackdrop.hidden = true;
          setTimeout(() => { this.assetShelf.hidden = true; }, 350);
        }
      });
    });

    this.shelfList.querySelectorAll('.btn-place-world').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const item = this.incomingAssets[idx];
        if (item) this.ingestSpriteToWorld(item.asset);
      });
    });

    this.shelfList.querySelectorAll('.btn-skin-car').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const item = this.incomingAssets[idx];
        if (item) this.ingestSpriteAsVehicle(item.asset);
      });
    });
  }

  /**
   * Convert image to texture with crossOrigin = 'anonymous' and place in world coordinates
   * respecting parallax depth, terrain ground offset, and sorting layer.
   */
  ingestSpriteToWorld(asset, preferredLayer = null) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const meta = asset.metadata || {};
      const fw = meta.frame_width || img.naturalWidth || 128;
      const fh = meta.frame_height || img.naturalHeight || 128;
      const aspect = fw / Math.max(1, fh);
      const drawW = 90;
      const drawH = drawW / aspect;

      // Determine sorting layer: cycle through ground, background, midground, overlay or use preferred
      const layers = ['ground', 'midground', 'background', 'overlay'];
      const layer = preferredLayer || layers[this.worldSprites.length % layers.length];

      // World X placed ahead of current camera view
      const worldX = this.cameraX + 280 + (this.worldSprites.length * 80);

      this.worldSprites.push({
        id: 'ws_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        img,
        name: asset.name,
        metadata: meta,
        fw,
        fh,
        drawW,
        drawH,
        worldX,
        groundOffset: 0,
        layer,
      });

      this.floatingPopups?.push({
        x: this.W * 0.35,
        y: 160,
        text: `🌍 Placed "${asset.name}" in [${layer}] layer!`,
        alpha: 1.4
      });
      this.audio?.playCoinPickup?.();
    };
    img.src = asset.imageUrl;
  }

  /**
   * Convert image to texture and skin active vehicle chassis with custom sprite.
   */
  ingestSpriteAsVehicle(asset) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const meta = asset.metadata || {};
      const fw = meta.frame_width || img.naturalWidth || 128;
      const fh = meta.frame_height || img.naturalHeight || 128;

      this.hasVehicle = true;
      this.customSprite = img;
      this.customVehicleSprite = {
        img,
        name: asset.name,
        metadata: meta,
        fw,
        fh,
      };

      this.floatingPopups?.push({
        x: this.W * 0.35,
        y: 190,
        text: `🚗 Vehicle Skinned: ${asset.name}!`,
        alpha: 1.4
      });
      this.audio?.playCoinPickup?.();
    };
    img.src = asset.imageUrl;
  }

  _drawWorldSprites(ctx, layerName, biome, gY, carSX) {
    if (!this.worldSprites || !this.worldSprites.length) return;

    const layerSpeeds = {
      background: 0.15,
      midground:  0.45,
      ground:     1.00,
      overlay:    1.15,
    };
    const speed = layerSpeeds[layerName] ?? 1.0;

    for (let i = 0; i < this.worldSprites.length; i++) {
      const ws = this.worldSprites[i];
      if (ws.layer !== layerName) continue;

      // Parallax depth calculation:
      const sx = carSX + (ws.worldX - this.cameraX) * speed;

      // Culling
      if (sx < -180 || sx > this.W + 180) continue;

      // Terrain ground offset & layer Y position
      let sy = gY + ws.groundOffset;
      let scale = 1.0;
      if (layerName === 'background') {
        sy = gY - 65 + ws.groundOffset;
        scale = 0.65;
      } else if (layerName === 'midground') {
        sy = gY - 25 + ws.groundOffset;
        scale = 0.85;
      } else if (layerName === 'overlay') {
        sy = gY + 12 + ws.groundOffset;
        scale = 1.1;
      }

      const drawW = ws.drawW * scale;
      const drawH = ws.drawH * scale;

      ctx.save();

      // Shadow under entity
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, drawW * 0.4, 5 * scale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Multi-frame animation playback
      const totalFrames = ws.metadata?.frame_count || (ws.metadata?.rows * ws.metadata?.columns) || 1;
      const fps = ws.metadata?.fps || 8;
      const currentFrame = Math.floor((Date.now() / 1000) * fps) % Math.max(1, totalFrames);
      const cols = ws.metadata?.columns || totalFrames || 1;
      const fx = (currentFrame % cols) * ws.fw;
      const fy = Math.floor(currentFrame / cols) * ws.fh;

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        ws.img,
        fx, fy, ws.fw, ws.fh,
        sx - drawW / 2,
        sy - drawH,
        drawW, drawH
      );

      ctx.restore();
    }
  }
}

window.GameSandbox = GameSandbox;

