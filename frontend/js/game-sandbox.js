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

    // ── Game objects ────────────────────────────────────────────
    this.coins    = [];
    this.fuelCans = [];

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

    this._raf = null;
    this._lastTime = 0;

    this._initEvents();
    this._resize();
    this._spawnCoins();
    this._spawnFuelCans();
    this._loop(0);
  }

  /* ── Events (Dual Control Scheme: Keyboard + Touch Pedals) ── */
  _initEvents() {
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('keydown', e => { this.keys[e.code] = true;  this._onKeyDown(e); });
    window.addEventListener('keyup',   e => { this.keys[e.code] = false; });

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

    // On-Screen Touch Pedals with pointer events (zero latency, Issue #33)
    const gasPedal   = document.getElementById('touch-gas');
    const brakePedal = document.getElementById('touch-brake');

    const setupPedal = (el, type) => {
      if (!el) return;
      const press = () => {
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
  }

  _onKeyDown(e) {
    // Instant restart run via 'R' key (Specification 1, Issue #33)
    if (e.code === 'KeyR') { this._restart(); return; }

    // Gas keys — start engine audio (zero latency)
    const isGas = (e.code === 'ArrowRight' || e.code === 'KeyD' ||
                   e.code === 'ArrowUp'    || e.code === 'KeyW');
    if (isGas && !this.car.crashed && !this._gameOver && this.car.fuel > 0) {
      this.audio.startEngine();
    }
  }

  /* ── Resize ─────────────────────────────────────────────────── */
  _resize() {
    const W = this.container.clientWidth;
    const H = Math.min(this.container.clientHeight || 480, 520);
    this.W = W; this.H = H;
    this.bgCanvas.width  = W; this.bgCanvas.height = H;
    this.fgCanvas.width  = W; this.fgCanvas.height = H;
    this.renderer.resize(W, H);
    this._setCarGroundY();
  }

  _setCarGroundY() {
    const biome = this.renderer.currentBiome;
    this.groundY = this.H * biome.groundLine - 30; // 30 = half car height
    if (!this.car.onGround) return;
    this.car.y = this.groundY;
  }

  /* ── Spawn Collectibles (Issue #33) ─────────────────────────── */
  _spawnCoins() {
    this.coins = [];
    // Coins along hill crests (+100) and ramps/valleys (+50) (Issue #33)
    for (let i = 0; i < 20; i++) {
      const isCrest = (i % 4 === 0);
      this.coins.push({
        wx: 300 + i * 320 + Math.random() * 100,
        wy: 0,
        r: 14,
        collected: false,
        animT: Math.random() * Math.PI * 2,
        value: isCrest ? 100 : 50,
      });
    }
  }

  _spawnFuelCans() {
    this.fuelCans = [];
    // Red fuel canisters along hills (Issue #33)
    for (let i = 0; i < 8; i++) {
      this.fuelCans.push({
        wx: 800 + i * 900 + Math.random() * 200,
        r: 18,
        collected: false,
      });
    }
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

    // ── Fuel Consumption (Issue #33) ────────────────────────────
    // Baseline idle drain ~1.2%/s + throttle drain +3.8%/s
    if (car.fuel > 0) {
      let drain = 1.2 * dt;
      if (car.throttle > 0) drain += 3.8 * dt;
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

    // ── Coin collection (Issue #33) ─────────────────────────────
    this.coins.forEach(coin => {
      if (coin.collected) return;
      coin.animT += dt * 3;
      coin.wy = gY - 40 + Math.sin(coin.animT) * 8;
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

  _restart() {
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
    this._spawnCoins();
    this._spawnFuelCans();
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

    // Draw uncollected coins — star icon for high-value crests (Issue #33)
    this.coins.forEach(coin => {
      if (coin.collected) return;
      const cx = coin.wx - this.cameraX + carSX;
      if (cx < -30 || cx > W + 30) return;
      ctx.save();
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur  = 14;
      const cg = ctx.createRadialGradient(cx - 3, coin.wy - 3, 1, cx, coin.wy, coin.r);
      cg.addColorStop(0, '#FFF9C4');
      cg.addColorStop(0.5, '#FFD700');
      cg.addColorStop(1, '#F57F17');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, coin.wy, coin.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8B6914';
      ctx.font = 'bold 10px Space Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(coin.value === 100 ? '★' : '$', cx, coin.wy);
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

    // Draw car
    ctx.save();
    ctx.translate(carSX, car.y + 28);
    ctx.rotate(car.angle * Math.PI / 180);
    this._drawCar(ctx, biome.id);
    ctx.restore();

    // Crash flash
    if (car.crashed && car.crashTimer > 1.2) {
      ctx.save();
      ctx.fillStyle = `rgba(255,80,0,${0.3 * Math.sin(car.crashTimer * 30)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  _drawCar(ctx, biomeId) {
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
  }
}

window.GameSandbox = GameSandbox;
