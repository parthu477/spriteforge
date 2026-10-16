/* ============================================================
   SpriteForge — game-sandbox.js
   Interactive Game Sandbox: Vehicle + Parallax + Particles + Audio
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
      x: 200, y: 0,          // world X, canvas Y set after resize
      vx: 0,  vy: 0,
      speed: 0,
      throttle: 0,
      braking: false,
      onGround: true,
      angle: 0,              // degrees, for flip detection
      flipped: false,
      fuel: 100,             // 0–100
      coins: 0,
      crashed: false,
      crashTimer: 0,
    };

    // ── Game objects ────────────────────────────────────────────
    this.coins = [];
    this.fuelCans = [];

    // ── Camera ──────────────────────────────────────────────────
    this.cameraX = 0;

    // ── Input state ─────────────────────────────────────────────
    this.keys = {};
    this._touchThrottle = 0;
    this._touchBrake    = 0;

    // ── Biome / HUD refs ────────────────────────────────────────
    this.biomeSelect   = document.getElementById('biome-select');
    this.muteBtn       = document.getElementById('mute-btn');
    this.hudSpeed      = document.getElementById('hud-speed');
    this.hudFuel       = document.getElementById('hud-fuel');
    this.hudFuelBar    = document.getElementById('hud-fuel-bar');
    this.hudCoins      = document.getElementById('hud-coins');
    this.hudBiome      = document.getElementById('hud-biome');
    this.crashOverlay  = document.getElementById('crash-overlay');
    this.restartBtn    = document.getElementById('restart-btn');

    this._raf = null;
    this._lastTime = 0;
    this._fuelAlertActive = false;
    this._running = false;

    this._initEvents();
    this._resize();
    this._spawnCoins();
    this._spawnFuelCans();
    this._loop(0);
  }

  /* ── Events ─────────────────────────────────────────────────── */
  _initEvents() {
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('keydown', e => { this.keys[e.code] = true;  this._onKeyDown(e); });
    window.addEventListener('keyup',   e => { this.keys[e.code] = false; this._onKeyUp(e);   });

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

    // Touch controls
    document.getElementById('touch-gas')?.addEventListener('touchstart',  e => { e.preventDefault(); this._touchThrottle = 1; this.audio.startEngine(); }, {passive:false});
    document.getElementById('touch-gas')?.addEventListener('touchend',    e => { e.preventDefault(); this._touchThrottle = 0; }, {passive:false});
    document.getElementById('touch-brake')?.addEventListener('touchstart',e => { e.preventDefault(); this._touchBrake = 1; }, {passive:false});
    document.getElementById('touch-brake')?.addEventListener('touchend',  e => { e.preventDefault(); this._touchBrake = 0; }, {passive:false});
  }

  _onKeyDown(e) {
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.audio.startEngine();
  }
  _onKeyUp(e) {
    if ((e.code === 'ArrowRight' || e.code === 'KeyD') && !this.keys['ArrowLeft'] && !this.keys['KeyA']) {
      // engine idle when releasing throttle — updateEngineSound will handle fade
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

  /* ── Spawn objects ───────────────────────────────────────────── */
  _spawnCoins() {
    this.coins = [];
    for (let i = 0; i < 20; i++) {
      this.coins.push({
        wx: 300 + i * 320 + Math.random() * 100,
        wy: 0, // set in update based on ground
        r: 14,
        collected: false,
        animT: Math.random() * Math.PI * 2,
      });
    }
  }

  _spawnFuelCans() {
    this.fuelCans = [];
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

  /* ── Physics Update ─────────────────────────────────────────── */
  _update(dt) {
    if (dt <= 0) return;
    const car    = this.car;
    const biome  = this.renderer.currentBiome;
    const gY     = this.H * biome.groundLine - 30;
    const gravity = biome.id === 'moon' ? 180 : 600;
    const friction = biome.id === 'moon' ? 0.97 : 0.90;
    const maxSpeed = biome.id === 'moon' ? 7 : 12;

    if (car.crashed) {
      car.crashTimer -= dt;
      if (car.crashTimer <= 0) this._showCrashOverlay();
      this.renderer.draw(this.cameraX);
      this._drawForeground();
      return;
    }

    // ── Input → forces ─────────────────────────────────────────
    const throttleRight = (this.keys['ArrowRight'] || this.keys['KeyD'] || this._touchThrottle) ? 1 : 0;
    const throttleLeft  = (this.keys['ArrowLeft']  || this.keys['KeyA']) ? 1 : 0;
    const brakeKey      = (this.keys['ArrowDown']  || this.keys['KeyS'] || this._touchBrake) ? 1 : 0;

    car.throttle = throttleRight > 0 ? 1 : (throttleLeft > 0 ? 0.5 : 0);
    car.braking  = brakeKey > 0;

    if (car.fuel > 0) {
      const accel = 280;
      if (throttleRight) car.vx += accel * dt;
      if (throttleLeft)  car.vx -= accel * dt * 0.7;
    }

    // Braking
    if (car.braking && Math.abs(car.vx) > 0.5) {
      const brakeFactor = 0.85;
      car.vx *= brakeFactor;
      if (car.onGround && Math.abs(car.vx) > 3) this.audio.playBrakeSqueal(Math.min(Math.abs(car.vx)/8, 1));
    }

    // Friction & max speed
    if (!throttleRight && !throttleLeft) car.vx *= friction;
    car.vx = Math.max(-maxSpeed * 60, Math.min(maxSpeed * 60, car.vx)); // px/s

    // Convert to speed units for audio/HUD
    car.speed = car.vx / 60;

    // Gravity
    if (!car.onGround) {
      car.vy += gravity * dt;
      // Air tilt
      car.angle += (car.vx > 0 ? 1.5 : -1.5) * dt * 30;
    } else {
      car.vy = 0;
      car.angle *= 0.8;
    }

    // ── Jump (space / up) ────────────────────────────────────────
    if ((this.keys['Space'] || this.keys['ArrowUp'] || this.keys['KeyW']) && car.onGround) {
      car.vy = biome.id === 'moon' ? -320 : -420;
      car.onGround = false;
    }

    // ── Position update ─────────────────────────────────────────
    car.y += car.vy * dt;
    // Camera follows car X; car stays center-ish
    const targetCamX = this.cameraX + car.vx * dt;
    this.cameraX = targetCamX;

    // Clamp car Y to ground
    if (car.y >= gY) {
      car.y = gY;
      car.vy = 0;
      car.onGround = true;

      // Flip detection: |angle| > 120° counts as crash
      if (Math.abs(car.angle) > 120 && Math.abs(car.vx) > 3 * 60) {
        this._triggerCrash();
        return;
      }
    }

    // ── Fuel consumption ────────────────────────────────────────
    if (car.throttle > 0 && car.fuel > 0) {
      car.fuel = Math.max(0, car.fuel - dt * 2.5);
    }
    if (car.fuel < 20 && !this._fuelAlertActive) {
      this._fuelAlertActive = true;
      this.audio.startFuelAlert();
    }
    if (car.fuel === 0 && this._fuelAlertActive) {
      this.audio.stopFuelAlert();
      this._fuelAlertActive = false;
    }

    // ── Particle emission ────────────────────────────────────────
    const particles = this.renderer.particles;
    const screenCarX = this.W * 0.35; // car render position on screen
    const wheelY = car.y + 32;

    // Tire dirt/smoke on acceleration
    if (car.onGround && Math.abs(car.vx) > 1) {
      particles.emitTireDirt(screenCarX - 18, wheelY, car.speed, true);
      particles.emitTireDirt(screenCarX + 18, wheelY, car.speed, true);
    }
    // Exhaust puffs
    if (car.throttle > 0 || Math.abs(car.speed) > 1) {
      particles.emitExhaust(screenCarX - 44, car.y + 8, car.speed);
    }

    // ── Coin collection ─────────────────────────────────────────
    this.coins.forEach(coin => {
      if (coin.collected) return;
      coin.animT += dt * 3;
      coin.wy = gY - 40 + Math.sin(coin.animT) * 8;
      const coinScreenX = coin.wx - this.cameraX + this.W * 0.35;
      const dx = coinScreenX - screenCarX;
      const dy = coin.wy - car.y;
      if (Math.sqrt(dx*dx + dy*dy) < coin.r + 28) {
        coin.collected = true;
        car.coins++;
        particles.emitCoinPickup(coinScreenX, coin.wy);
        this.audio.playCoinPickup();
      }
    });

    // ── Fuel can collection ──────────────────────────────────────
    this.fuelCans.forEach(fc => {
      if (fc.collected) return;
      const fcScreenX = fc.wx - this.cameraX + this.W * 0.35;
      const dx = fcScreenX - screenCarX;
      const dy = (gY - 20) - car.y;
      if (Math.sqrt(dx*dx + dy*dy) < fc.r + 28) {
        fc.collected = true;
        car.fuel = Math.min(100, car.fuel + 35);
        if (car.fuel >= 20 && this._fuelAlertActive) {
          this._fuelAlertActive = false;
          this.audio.stopFuelAlert();
        }
        particles.emitCoinPickup(fcScreenX, gY - 20);
      }
    });

    // ── Audio engine update ─────────────────────────────────────
    this.audio.updateEngineSound(car.speed, car.throttle);

    // ── HUD update ───────────────────────────────────────────────
    this._updateHUD();
  }

  /* ── Trigger crash ───────────────────────────────────────────── */
  _triggerCrash() {
    const car = this.car;
    car.crashed   = true;
    car.crashTimer = 1.8;
    const screenCarX = this.W * 0.35;
    this.renderer.particles.emitCrash(screenCarX, car.y);
    this.audio.playCrash();
    this.audio.stopEngine();
    this._fuelAlertActive = false;
    this.audio.stopFuelAlert();
  }

  _showCrashOverlay() {
    if (this.crashOverlay) this.crashOverlay.hidden = false;
  }

  _restart() {
    const car = this.car;
    car.x = 200; car.vx = 0; car.vy = 0;
    car.speed = 0; car.throttle = 0; car.braking = false;
    car.onGround = true; car.angle = 0; car.flipped = false;
    car.fuel = 100; car.coins = 0; car.crashed = false; car.crashTimer = 0;
    this.cameraX = 0;
    if (this.crashOverlay) this.crashOverlay.hidden = true;
    this._fuelAlertActive = false;
    this.audio.stopFuelAlert();
    this._spawnCoins();
    this._spawnFuelCans();
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

    // Draw uncollected coins
    this.coins.forEach(coin => {
      if (coin.collected) return;
      const cx = coin.wx - this.cameraX + carSX;
      if (cx < -30 || cx > W + 30) return;
      ctx.save();
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur  = 14;
      // Coin body
      const cg = ctx.createRadialGradient(cx - 3, coin.wy - 3, 1, cx, coin.wy, coin.r);
      cg.addColorStop(0, '#FFF9C4');
      cg.addColorStop(0.5, '#FFD700');
      cg.addColorStop(1, '#F57F17');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, coin.wy, coin.r, 0, Math.PI * 2);
      ctx.fill();
      // $ symbol
      ctx.fillStyle = '#8B6914';
      ctx.font = 'bold 11px Space Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', cx, coin.wy);
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

  /* ── HUD ─────────────────────────────────────────────────────── */
  _updateHUD() {
    const { car } = this;
    if (this.hudSpeed)   this.hudSpeed.textContent   = Math.abs(Math.round(car.speed * 10)) + ' km/h';
    if (this.hudFuel)    this.hudFuel.textContent    = Math.round(car.fuel) + '%';
    if (this.hudCoins)   this.hudCoins.textContent   = car.coins;
    if (this.hudFuelBar) {
      this.hudFuelBar.style.width = car.fuel + '%';
      this.hudFuelBar.style.backgroundColor =
        car.fuel > 50 ? '#4CAF50' : car.fuel > 20 ? '#FF9800' : '#F44336';
    }
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.audio.stopEngine();
    this.audio.stopFuelAlert();
  }
}

window.GameSandbox = GameSandbox;
