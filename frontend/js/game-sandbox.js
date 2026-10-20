/* ============================================================
   SpriteForge — game-sandbox.js
   Interactive Game Sandbox: Vehicle + Parallax + Particles + Audio
   Issue #33 — Driving Controls, Fuel System, Collectibles & HUD
   Issue #34 — Multi-Biome Parallax Environments & Retro Audio FX
   ============================================================ */
'use strict';

const loadSafeImage = (typeof window !== 'undefined' && window.loadSafeImage) ? window.loadSafeImage : function(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err || new Error(`Failed to load image from ${url}`));
    img.src = url;
  });
};

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
    this.wheelRotation = 0;

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

    // ── In-Game Pause & Resume Controller (Issue #50) ───────────
    this.isPaused       = false;
    this.pauseBtn       = document.getElementById('pause-btn');
    this.pauseBtnIcon   = document.getElementById('pause-btn-icon');
    this.pauseBtnText   = document.getElementById('pause-btn-text');
    this.pauseOverlay   = document.getElementById('pause-overlay');
    this.pauseDist      = document.getElementById('pause-dist');
    this.pauseCoins     = document.getElementById('pause-coins');
    this.pauseScore     = document.getElementById('pause-score');
    this.pauseResumeBtn = document.getElementById('pause-resume-btn');
    this.pauseRestartBtn= document.getElementById('pause-restart-btn');
    this.pauseSoundBtn  = document.getElementById('pause-sound-btn');
    this.pauseSoundIcon = document.getElementById('pause-sound-icon');
    this.pauseSoundText = document.getElementById('pause-sound-text');

    this._raf = null;
    this._lastTime = 0;

    // ── Issue #45: State Persistence ────────────────────────────
    try {
      const savedBiome = localStorage.getItem('spriteforge_pref_biome');
      if (savedBiome && this.biomeSelect) {
        this.biomeSelect.value = savedBiome;
        this.renderer.setBiome(savedBiome);
        if (this.hudBiome && this.biomeSelect.selectedIndex >= 0) {
          this.hudBiome.textContent = this.biomeSelect.options[this.biomeSelect.selectedIndex].text;
        }
      }
      const savedMuted = localStorage.getItem('spriteforge_pref_muted');
      if (savedMuted !== null && this.audio) {
        const isMuted = savedMuted === 'true';
        this.audio.isMuted = isMuted;
        if (this.muteBtn) {
          this.muteBtn.textContent = isMuted ? '🔇 Unmute' : '🔊 Mute';
          this.muteBtn.classList.toggle('muted', isMuted);
        }
        this._updatePauseSoundBtn();
      }
    } catch (_) {}

    this._initEvents();
    this._initPauseController();
    this._initAssetShelf();
    this._initAssetBus();
    this._resize();
    this._spawnInitialCollectibles();
    this._updateHUD();

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const targetSprite = urlParams.get('sprite');
      if (targetSprite) {
        fetch('/api/sprites').then(r => r.json()).then(gallery => {
          const item = Array.isArray(gallery) ? gallery.find(s => s.name === targetSprite) : null;
          if (item) {
            this.ingestSpriteAsVehicle({
              name: item.name,
              imageUrl: item.image_url,
              metadata: item.metadata || {},
            });
          } else {
            this.spawnCar({ defaultCar: true });
          }
        }).catch(() => this.spawnCar({ defaultCar: true }));
      } else {
        this.spawnCar({ defaultCar: true });
      }
    } catch (_) {
      this.spawnCar({ defaultCar: true });
    }

    this._loop(0);
  }

  /* ── Events (Dual Control Scheme: Keyboard + Touch Pedals) ── */
  _initEvents() {
    this._boundResize = () => this._resize();
    this._boundKeyDown = e => { this.keys[e.code] = true;  this._onKeyDown(e); };
    this._boundKeyUp = e => { this.keys[e.code] = false; };

    window.addEventListener('resize', this._boundResize);
    window.addEventListener('keydown', this._boundKeyDown);
    window.addEventListener('keyup',   this._boundKeyUp);

    // Issue #44: Dedicated Spawn Controls
    this.spawnCarBtn?.addEventListener('click', () => this.spawnCar({ defaultCar: true }));
    this.insertSpriteBtn?.addEventListener('click', () => this.spriteFileInput?.click());
    this.spriteFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        loadSafeImage(ev.target.result).then(img => {
          this.customSprite = img;
          this.customVehicleSprite = {
            img,
            name: file.name ? file.name.replace(/\.[^/.]+$/, '') : 'custom_sprite',
            metadata: {},
            fw: img.naturalWidth || 128,
            fh: img.naturalHeight || 128,
          };
          this.spawnCar();
        }).catch(err => console.error('Failed to load sprite file:', err));
      };
      reader.readAsDataURL(file);
    });
    this.clearSandboxBtn?.addEventListener('click', () => this.clearSandbox());

    this.biomeSelect?.addEventListener('change', () => {
      this.renderer.setBiome(this.biomeSelect.value);
      if (this.hudBiome) this.hudBiome.textContent = this.biomeSelect.options[this.biomeSelect.selectedIndex].text;
      try { localStorage.setItem('spriteforge_pref_biome', this.biomeSelect.value); } catch (_) {}
    });

    this.muteBtn?.addEventListener('click', () => {
      const muted = this.audio.toggleMute();
      this.muteBtn.textContent = muted ? '🔇 Unmute' : '🔊 Mute';
      this.muteBtn.classList.toggle('muted', muted);
      this._updatePauseSoundBtn();
      try { localStorage.setItem('spriteforge_pref_muted', muted); } catch (_) {}
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

  /* ── In-Game Pause & Resume Controller (Issue #50) ─────────── */
  _initPauseController() {
    this.pauseBtn?.addEventListener('click', () => this.togglePause());
    this.pauseResumeBtn?.addEventListener('click', () => this.resume());
    this.pauseRestartBtn?.addEventListener('click', () => {
      this.resume();
      this._restart();
    });
    this.pauseSoundBtn?.addEventListener('click', () => {
      const muted = this.audio.toggleMute();
      if (this.muteBtn) {
        this.muteBtn.textContent = muted ? '🔇 Unmute' : '🔊 Mute';
        this.muteBtn.classList.toggle('muted', muted);
      }
      this._updatePauseSoundBtn();
      try { localStorage.setItem('spriteforge_pref_muted', muted); } catch (_) {}
    });
    this.pauseOverlay?.addEventListener('click', (e) => {
      if (e.target === this.pauseOverlay) {
        this.resume();
      }
    });
  }

  togglePause() {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  pause() {
    if (this._gameOver || this.car.crashed) return;
    this.isPaused = true;

    // Halt engine audio sound loops
    this.audio.stopEngine?.();
    this.audio.stopFuelAlert?.();

    // Toggle button state
    if (this.pauseBtn) {
      this.pauseBtn.classList.add('is-paused');
      if (this.pauseBtnIcon) this.pauseBtnIcon.textContent = '▶';
      if (this.pauseBtnText) this.pauseBtnText.textContent = 'Resume';
      this.pauseBtn.setAttribute('title', 'Resume Game [P / Esc]');
    }

    // Refresh Current Stats Preview
    const dist  = Math.round(this.distanceMeters || 0);
    const coins = this.car ? (this.car.coins || 0) : 0;
    const score = Math.round((this.totalScore || 0) + dist);
    if (this.pauseDist)  this.pauseDist.textContent  = `${dist} m`;
    if (this.pauseCoins) this.pauseCoins.textContent = `${coins}`;
    if (this.pauseScore) this.pauseScore.textContent = `${score} pts`;

    this._updatePauseSoundBtn();

    if (this.pauseOverlay) this.pauseOverlay.hidden = false;
  }

  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this._lastTime = performance.now(); // Cache timestamp so dt does not jump

    if (this.pauseBtn) {
      this.pauseBtn.classList.remove('is-paused');
      if (this.pauseBtnIcon) this.pauseBtnIcon.textContent = '⏸';
      if (this.pauseBtnText) this.pauseBtnText.textContent = 'Pause';
      this.pauseBtn.setAttribute('title', 'Pause Game [P / Esc]');
    }

    if (this.pauseOverlay) this.pauseOverlay.hidden = true;

    // Restart engine audio if vehicle is active
    if (this.hasVehicle && !this._gameOver && !this.car.crashed && this.car.fuel > 0) {
      this.audio.startEngine?.();
      if (this._fuelAlert) {
        this.audio.startFuelAlert?.();
      }
    }
  }

  _updatePauseSoundBtn() {
    const isMuted = this.audio ? this.audio.isMuted : false;
    if (this.pauseSoundIcon) this.pauseSoundIcon.textContent = isMuted ? '🔇' : '🔊';
    if (this.pauseSoundText) this.pauseSoundText.textContent = isMuted ? 'Unmute Sound' : 'Mute Sound';
  }

  _onKeyDown(e) {
    // Escape or KeyP: Instant Toggle Pause / Resume (Issue #50 Specification 4)
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (e.code === 'Escape') {
        if (this.assetShelf?.classList.contains('open')) {
          return;
        }
        const infoModal = document.getElementById('info-modal');
        if (infoModal && !infoModal.hidden) {
          infoModal.hidden = true;
          return;
        }
      }
      e.preventDefault();
      this.togglePause();
      return;
    }

    // KeyR: Instant Restart Run (Issue #50: clean restart while paused)
    if (e.code === 'KeyR') {
      if (this.isPaused) {
        this.resume();
      }
      if (!this.hasVehicle) {
        this.spawnCar({ defaultCar: true });
      } else {
        this._restart();
      }
      return;
    }

    if (this.isPaused) {
      return;
    }

    if (!this.hasVehicle) {
      return;
    }

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

    // Emit upward dust and exhaust burst particles from wheels
    const screenCarX = this.W * 0.35;
    const wheelY     = car.y + 31;
    const particles  = this.renderer?.particles;
    if (particles) {
      if (typeof particles.emitJumpDust === 'function') {
        particles.emitJumpDust(screenCarX - 30, wheelY);
        particles.emitJumpDust(screenCarX + 32, wheelY);
      } else {
        particles.emitTireDirt(screenCarX - 30, wheelY, -15, true);
        particles.emitTireDirt(screenCarX + 32, wheelY, -15, true);
      }
      particles.emitExhaust(screenCarX - 52, car.y + 10, 14);
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
    const groundLineY = this.H * biome.groundLine;
    this.groundY = groundLineY - 31; // tyre bottom (wy=16, r=15) firmly plants on groundLineY
    if (this.car.onGround) {
      this.car.y = this.groundY;
    }
    if (this.coins) {
      this.coins.forEach(c => {
        if (c.yOffset !== undefined) {
          c.wy = groundLineY - c.yOffset;
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
    const biome = this.renderer.currentBiome;
    const groundLineY = this.H * biome.groundLine;
    const gY = groundLineY;

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
    if (this.isPaused) {
      this._lastTime = timestamp; // Cache timestamp while suspended to avoid dt jump
      this._raf = requestAnimationFrame(t => this._loop(t));
      return;
    }
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
    const groundLineY = this.H * biome.groundLine;
    const gY     = groundLineY - 31;
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

    // Continuous dynamic wheel rotation based on horizontal distance + mid-air throttle spin
    const airWheelSpin = (!car.onGround && car.throttle > 0) ? (350 * dt) : 0;
    this.wheelRotation = (this.wheelRotation || 0) + (car.vx * dt + airWheelSpin) / 15;

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
    const wheelY     = car.y + 31;
    if (car.onGround && Math.abs(car.vx) > 1) {
      particles.emitTireDirt(screenCarX - 30, wheelY, car.speed, true);
      particles.emitTireDirt(screenCarX + 32, wheelY, car.speed, true);
    }
    if (car.throttle > 0 || Math.abs(car.speed) > 1) {
      particles.emitExhaust(screenCarX - 52, car.y + 10, car.speed);
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
    if (this.isPaused) {
      this.isPaused = false;
      if (this.pauseOverlay) this.pauseOverlay.hidden = true;
      if (this.pauseBtn) {
        this.pauseBtn.classList.remove('is-paused');
        if (this.pauseBtnIcon) this.pauseBtnIcon.textContent = '⏸';
        if (this.pauseBtnText) this.pauseBtnText.textContent = 'Pause';
      }
    }
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
      this.customVehicleSprite = null;
    }
    this.worldSprites = [];
    this._restart();
  }

  clearSandbox() {
    if (this.isPaused) {
      this.isPaused = false;
      this._lastTime = performance.now();
      if (this.pauseOverlay) this.pauseOverlay.hidden = true;
      if (this.pauseBtn) {
        this.pauseBtn.classList.remove('is-paused');
        if (this.pauseBtnIcon) this.pauseBtnIcon.textContent = '⏸';
        if (this.pauseBtnText) this.pauseBtnText.textContent = 'Pause';
      }
    }
    this.hasVehicle          = false;
    this.customSprite        = null;
    this.customVehicleSprite = null; // clear vehicle skin
    this.worldSprites        = [];   // clear all placed world sprites
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
    if (this.isPaused) {
      this.isPaused = false;
      this._lastTime = performance.now();
      if (this.pauseOverlay) this.pauseOverlay.hidden = true;
      if (this.pauseBtn) {
        this.pauseBtn.classList.remove('is-paused');
        if (this.pauseBtnIcon) this.pauseBtnIcon.textContent = '⏸';
        if (this.pauseBtnText) this.pauseBtnText.textContent = 'Pause';
      }
    }
    this.hasVehicle = true;
    const car = this.car;
    car.vx = 0; car.vy = 0;
    car.speed = 0; car.throttle = 0; car.braking = false;
    car.onGround = true; car.angle = 0; car.flipped = false;
    car.fuel = 100; car.coins = 0; car.crashed = false; car.crashTimer = 0;
    this.cameraX        = 0;
    this.wheelRotation  = 0;
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

    const biome       = this.renderer.currentBiome;
    const groundLineY = H * biome.groundLine;
    const gY          = groundLineY - 31;
    const carSX       = W * 0.35; // car screen X

    // ── Background & Midground Placed World Sprites (Parallax) ───
    this._drawWorldSprites(ctx, 'background', biome, groundLineY, carSX);
    this._drawWorldSprites(ctx, 'midground',  biome, groundLineY, carSX);

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
      const fy = groundLineY - 20;
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
    this._drawWorldSprites(ctx, 'ground', biome, groundLineY, carSX);

    // Draw car / active sprite (single entity, single animated frame)
    if (this.hasVehicle) {
      // Dynamic suspension vibration and pitch
      const suspensionBob = (car.onGround && Math.abs(car.vx) > 5)
        ? Math.sin(performance.now() * 0.025) * Math.min(1.2, Math.abs(car.speed) * 0.2)
        : 0;
      const pitchAngle = car.onGround
        ? (car.throttle > 0 ? -1.8 : (car.braking ? 2.8 : 0))
        : 0;

      // Realistic Contact Shadow on Ground (stays anchored on groundLineY when jumping!)
      const distAboveGround = Math.max(0, gY - car.y);
      const shadowScale = Math.max(0.35, 1 - distAboveGround / 240);
      const shadowAlpha = Math.max(0.08, 0.42 * shadowScale);

      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
      ctx.beginPath();
      ctx.ellipse(carSX, groundLineY + 1, 52 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Additional tyre contact occlusion shadows when on the ground
      if (car.onGround) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.beginPath();
        ctx.ellipse(carSX - 30, groundLineY + 1, 16, 3, 0, 0, Math.PI * 2);
        ctx.ellipse(carSX + 32, groundLineY + 1, 16, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.translate(carSX, car.y + suspensionBob);
      ctx.rotate((car.angle + pitchAngle) * Math.PI / 180);
      this._drawCar(ctx, biome.id, groundLineY);
      ctx.restore();
    }

    // ── Foreground Overlay Placed World Sprites (In front of Car) ─
    this._drawWorldSprites(ctx, 'overlay', biome, groundLineY, carSX);

    // Crash flash
    if (car.crashed && car.crashTimer > 1.2) {
      ctx.save();
      ctx.fillStyle = `rgba(255,80,0,${0.3 * Math.sin(car.crashTimer * 30)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /* ── High-Fidelity Realistic Wheel System ───────────────────────
   * Features:
   * - Stationary ventilated disc brake rotor + Brembo-style racing caliper
   * - Rotating thick tire rubber with visible outer tread notches
   * - Rotating 5-twin-spoke alloy rim with chrome highlights
   * - Recessed center hub with 5 chrome lug nuts & anodized badge
   * ───────────────────────────────────────────────────────────── */
  _drawRealisticWheel(ctx, wx, wy, radius = 15, angle = 0, style = {}) {
    ctx.save();
    ctx.translate(wx, wy);

    // 1. STATIONARY BRAKE SYSTEM (Does NOT rotate with wheel)
    const rotorR = radius * 0.72;
    const rotorGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, rotorR);
    rotorGrad.addColorStop(0, '#94a3b8');
    rotorGrad.addColorStop(0.7, '#cbd5e1');
    rotorGrad.addColorStop(0.9, '#64748b');
    rotorGrad.addColorStop(1, '#475569');
    ctx.fillStyle = rotorGrad;
    ctx.beginPath();
    ctx.arc(0, 0, rotorR, 0, Math.PI * 2);
    ctx.fill();

    // Rotor circular surface grooves
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, rotorR * 0.82, 0, Math.PI * 2);
    ctx.arc(0, 0, rotorR * 0.62, 0, Math.PI * 2);
    ctx.stroke();

    // Rotor ventilation drill holes
    ctx.fillStyle = '#1e293b';
    for (let h = 0; h < 6; h++) {
      const ha = (Math.PI / 3) * h + 0.25;
      ctx.beginPath();
      ctx.arc(Math.cos(ha) * (rotorR * 0.72), Math.sin(ha) * (rotorR * 0.72), 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Racing Brake Caliper (Brembo style)
    const caliperColor = style.caliper || '#E11D48';
    ctx.save();
    ctx.fillStyle = caliperColor;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(0, 0, rotorR * 1.05, -Math.PI * 0.88, -Math.PI * 0.35);
    ctx.arc(0, 0, rotorR * 0.60, -Math.PI * 0.35, -Math.PI * 0.88, true);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    // Caliper metallic accent & bleed pins
    ctx.fillStyle = '#fb7185';
    ctx.fillRect(-rotorR * 0.58, -rotorR * 0.94, rotorR * 0.38, 1.4);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-rotorR * 0.62, -rotorR * 0.58, 0.9, 0, Math.PI * 2);
    ctx.arc(-rotorR * 0.32, -rotorR * 0.78, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. ROTATING WHEEL ASSEMBLY (Tire + Rim + Spokes rotate with angle)
    ctx.rotate(angle);

    // Tire outer rubber
    const tireGrad = ctx.createRadialGradient(0, 0, radius * 0.68, 0, 0, radius);
    tireGrad.addColorStop(0, '#27272a');
    tireGrad.addColorStop(0.65, '#18181b');
    tireGrad.addColorStop(1, '#09090b');
    ctx.fillStyle = tireGrad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // Visible rotating tire tread blocks
    const treadCount = 14;
    ctx.fillStyle = '#3f3f46';
    for (let t = 0; t < treadCount; t++) {
      const ta = (Math.PI * 2 / treadCount) * t;
      ctx.beginPath();
      ctx.arc(Math.cos(ta) * (radius - 1.2), Math.sin(ta) * (radius - 1.2), 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sidewall rim line
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 2.8, 0, Math.PI * 2);
    ctx.stroke();

    // Alloy Rim Lip (Chrome / Machined Silver bevel)
    const rimR = radius * 0.68;
    const rimGrad = ctx.createLinearGradient(-rimR, -rimR, rimR, rimR);
    rimGrad.addColorStop(0, '#f8fafc');
    rimGrad.addColorStop(0.35, '#94a3b8');
    rimGrad.addColorStop(0.7, '#e2e8f0');
    rimGrad.addColorStop(1, '#475569');
    ctx.fillStyle = rimGrad;
    ctx.beginPath();
    ctx.arc(0, 0, rimR, 0, Math.PI * 2);
    ctx.fill();

    // Rim inner recess (dark chamber behind spokes)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, rimR - 1.8, 0, Math.PI * 2);
    ctx.fill();

    // 5 Twin-Spoke Racing Alloy Rim
    const spokeCount = 5;
    for (let s = 0; s < spokeCount; s++) {
      const sa = (Math.PI * 2 / spokeCount) * s;
      ctx.save();
      ctx.rotate(sa);

      const spokeGrad = ctx.createLinearGradient(0, 0, 0, rimR - 1.5);
      spokeGrad.addColorStop(0, '#f1f5f9');
      spokeGrad.addColorStop(0.5, '#cbd5e1');
      spokeGrad.addColorStop(1, '#94a3b8');
      ctx.fillStyle = spokeGrad;

      // Twin aerodynamic alloy spokes
      ctx.beginPath();
      ctx.moveTo(-2.2, 2.5);
      ctx.lineTo(-1.2, rimR - 1.5);
      ctx.lineTo(0.2, rimR - 1.5);
      ctx.lineTo(-0.8, 2.5);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0.8, 2.5);
      ctx.lineTo(0.2, rimR - 1.5);
      ctx.lineTo(1.6, rimR - 1.5);
      ctx.lineTo(2.2, 2.5);
      ctx.closePath();
      ctx.fill();

      // Chrome bevel highlight on spoke
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-1.2, rimR - 1.5);
      ctx.lineTo(-2.2, 2.5);
      ctx.stroke();

      ctx.restore();
    }

    // Center Hub & 5 Chrome Lug Nuts
    const hubR = radius * 0.28;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    for (let n = 0; n < 5; n++) {
      const na = (Math.PI * 2 / 5) * n;
      ctx.beginPath();
      ctx.arc(Math.cos(na) * (hubR * 0.65), Math.sin(na) * (hubR * 0.65), 0.85, 0, Math.PI * 2);
      ctx.fill();
    }

    // Central Emblem Badge
    const badgeColor = style.badge || '#06B6D4';
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.arc(0, 0, hubR * 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawCar(ctx, biomeId, groundLineY) {
    const customAsset = this.customVehicleSprite || (this.customSprite ? {
      img: this.customSprite,
      fw: (this.customSprite.naturalWidth && this.customSprite.naturalWidth >= 128) ? 128 : (this.customSprite.naturalWidth || 64),
      fh: (this.customSprite.naturalHeight && this.customSprite.naturalHeight >= 128) ? 128 : (this.customSprite.naturalHeight || 64),
      metadata: {},
    } : null);

    // ── 1. CUSTOM INSERTED SPRITE VEHICLE ─────────────────────────
    if (customAsset && customAsset.img && customAsset.img.complete) {
      const targetW = 100;
      const fw = customAsset.fw || customAsset.img.naturalWidth || 100;
      const fh = customAsset.fh || customAsset.img.naturalHeight || 100;
      const aspect = fw / Math.max(1, fh);
      const targetH = Math.max(38, Math.min(80, targetW / aspect));

      // Multi-frame animation playback: render ONLY one frame, never the entire sheet
      const totalFrames = customAsset.metadata?.frame_count || (customAsset.metadata?.rows * customAsset.metadata?.columns) || 1;
      const fps = customAsset.metadata?.fps || 8;
      const currentFrame = Math.floor((Date.now() / 1000) * fps) % Math.max(1, totalFrames);
      const cols = customAsset.metadata?.columns || totalFrames || 1;
      const fx = (currentFrame % cols) * fw;
      const fy = Math.floor(currentFrame / cols) * fh;

      // Draw custom sprite body slightly elevated above wheel axles
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        customAsset.img,
        fx, fy, fw, fh,
        -targetW / 2, -targetH / 2 - 2,
        targetW, targetH
      );

      // Render realistic rotating alloy wheels underneath the custom sprite!
      const wheelR = Math.max(13, Math.min(16, targetH * 0.28));
      const rearWX = -targetW * 0.28;
      const frontWX = targetW * 0.28;
      const wheelWY = 16;

      this._drawRealisticWheel(ctx, rearWX, wheelWY, wheelR, this.wheelRotation, { caliper: '#E11D48', badge: '#06B6D4' });
      this._drawRealisticWheel(ctx, frontWX, wheelWY, wheelR, this.wheelRotation, { caliper: '#E11D48', badge: '#06B6D4' });

      // Subtle under-chassis shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(0, wheelWY + wheelR, targetW * 0.44, 3, 0, 0, Math.PI * 2);
      ctx.fill();

      return;
    }

    // ── 2. REALISTIC PROCEDURAL SPORTS CAR / GT RACER ─────────────
    const styles = {
      countryside: {
        body: '#E53935',
        bodyDark: '#991B1B',
        highlight: '#FF8A80',
        roof: '#7F1D1D',
        accent: '#FDE047',
        caliper: '#EF4444',
        badge: '#06B6D4',
        glow: 'rgba(255, 235, 59, 0.45)',
      },
      desert: {
        body: '#EA580C',
        bodyDark: '#9A3412',
        highlight: '#FDBA74',
        roof: '#7C2D12',
        accent: '#FEF08A',
        caliper: '#F97316',
        badge: '#EAB308',
        glow: 'rgba(251, 146, 60, 0.45)',
      },
      cyberpunk: {
        body: '#7C3AED',
        bodyDark: '#4C1D95',
        highlight: '#C4B5FD',
        roof: '#2E1065',
        accent: '#06B6D4',
        caliper: '#06B6D4',
        badge: '#22D3EE',
        glow: 'rgba(6, 182, 212, 0.75)',
      },
      moon: {
        body: '#475569',
        bodyDark: '#1E293B',
        highlight: '#94A3B8',
        roof: '#0F172A',
        accent: '#38BDF8',
        caliper: '#38BDF8',
        badge: '#38BDF8',
        glow: 'rgba(56, 189, 248, 0.55)',
      },
    };
    const s = styles[biomeId] || styles.countryside;

    const rearWX = -30;
    const frontWX = 32;
    const wheelWY = 16;
    const wheelR = 15;

    // A. Forward LED Headlight Beam Cone onto Road
    ctx.save();
    const beamGrad = ctx.createRadialGradient(48, 5, 0, 150, 18, 120);
    beamGrad.addColorStop(0, 'rgba(255, 255, 230, 0.22)');
    beamGrad.addColorStop(0.5, 'rgba(255, 255, 230, 0.08)');
    beamGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(48, 2);
    ctx.lineTo(210, -10);
    ctx.lineTo(220, 32);
    ctx.lineTo(48, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // B. Aerodynamic Carbon GT Wing / Spoiler
    ctx.fillStyle = '#1e293b';
    // Wing Struts
    ctx.fillRect(-44, -20, 3, 14);
    ctx.fillRect(-35, -20, 3, 13);
    // Aerofoil Blade
    const wingGrad = ctx.createLinearGradient(-50, -26, -30, -20);
    wingGrad.addColorStop(0, '#0f172a');
    wingGrad.addColorStop(0.5, '#334155');
    wingGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = wingGrad;
    ctx.beginPath();
    ctx.roundRect(-52, -26, 24, 6, 2);
    ctx.fill();
    // Wing Endplate
    ctx.fillStyle = s.accent;
    ctx.fillRect(-52, -28, 2.5, 9);

    // C. Main Aerodynamic Chassis Body Shell
    // Contoured multi-stage gradient for realistic automotive finish
    const bodyGrad = ctx.createLinearGradient(-52, -24, 52, 14);
    bodyGrad.addColorStop(0, s.bodyDark);
    bodyGrad.addColorStop(0.3, s.body);
    bodyGrad.addColorStop(0.7, s.body);
    bodyGrad.addColorStop(1, s.bodyDark);
    ctx.fillStyle = bodyGrad;

    ctx.beginPath();
    // Start at rear diffuser bottom
    ctx.moveTo(-52, 11);
    // Rear bumper up to rear light deck
    ctx.lineTo(-52, -1);
    ctx.lineTo(-46, -7);
    // Rear fastback slope
    ctx.lineTo(-30, -14);
    // Roofline & cabin
    ctx.lineTo(-18, -23);
    ctx.lineTo(4, -23);
    // Windshield slope down to hood
    ctx.lineTo(20, -5);
    // Sleek hood line down to nose
    ctx.lineTo(46, 2);
    // Aggressive front nose cone
    ctx.lineTo(52, 7);
    // Front chin splitter
    ctx.lineTo(54, 12);
    ctx.lineTo(48, 14);
    // Front wheel well arch (clears front wheel)
    ctx.lineTo(frontWX + 18, 14);
    ctx.arc(frontWX, wheelWY, 18, 0, Math.PI, true);
    // Side rocker panel / carbon skirt
    ctx.lineTo(rearWX + 18, 14);
    // Rear wheel well arch (clears rear wheel)
    ctx.arc(rearWX, wheelWY, 18, 0, Math.PI, true);
    // Bottom diffuser edge
    ctx.lineTo(-52, 11);
    ctx.closePath();
    ctx.fill();

    // D. Carbon Lower Splitter & Side Skirt Lip
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-10, 12, 22, 2.5, 1);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(46, 12, 8, 2.5, 1);
    ctx.fill();

    // E. Metallic Shoulder Highlight Line
    ctx.strokeStyle = s.highlight;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-44, -5);
    ctx.lineTo(20, -4);
    ctx.lineTo(46, 3);
    ctx.stroke();

    // F. Racing Livery Stripe
    ctx.fillStyle = s.accent;
    ctx.fillRect(-48, 3, 98, 2.5);

    // G. Cockpit Windows / Racing Glass
    const glassGrad = ctx.createLinearGradient(-16, -22, 18, -6);
    glassGrad.addColorStop(0, '#0f172a');
    glassGrad.addColorStop(0.5, '#1e293b');
    glassGrad.addColorStop(1, '#334155');
    ctx.fillStyle = glassGrad;
    ctx.beginPath();
    ctx.moveTo(-16, -21);
    ctx.lineTo(2, -21);
    ctx.lineTo(16, -7);
    ctx.lineTo(-24, -7);
    ctx.closePath();
    ctx.fill();

    // Glass reflection diagonal glare
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.moveTo(-8, -21);
    ctx.lineTo(-2, -21);
    ctx.lineTo(-12, -7);
    ctx.lineTo(-18, -7);
    ctx.closePath();
    ctx.fill();

    // Driver helmet silhouette inside cabin
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(-4, -13, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // Helmet visor
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-2, -15, 3.5, 3);

    // Aerodynamic Side Mirror
    ctx.fillStyle = s.bodyDark;
    ctx.beginPath();
    ctx.roundRect(14, -8, 6, 3.5, 1.5);
    ctx.fill();

    // H. Front Xenon LED Headlights
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = s.glow;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(46, 3);
    ctx.lineTo(51, 6);
    ctx.lineTo(47, 8);
    ctx.closePath();
    ctx.fill();
    // Projector LED jewel dots
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(48, 5.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // I. Rear Neon LED Taillight Bar
    ctx.save();
    const isBraking = this.car.braking;
    ctx.fillStyle = isBraking ? '#ff0033' : '#e11d48';
    ctx.shadowColor = isBraking ? '#ff0033' : '#e11d48';
    ctx.shadowBlur = isBraking ? 14 : 7;
    ctx.fillRect(-52, 0, 4, isBraking ? 5 : 3.5);
    ctx.restore();

    // J. Dual Chrome Exhaust Tips
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-54, 8, 4, 3);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-54.5, 8.5, 1.5, 2);

    // K. High-Performance Rotating Alloy Wheels
    this._drawRealisticWheel(ctx, rearWX, wheelWY, wheelR, this.wheelRotation, {
      caliper: s.caliper,
      badge: s.badge
    });
    this._drawRealisticWheel(ctx, frontWX, wheelWY, wheelR, this.wheelRotation, {
      caliper: s.caliper,
      badge: s.badge
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
    this._boundStorage = (event) => {
      if (event.key === EVENT_KEY && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          if (data && data.payload) {
            this._handleIncomingAssetPayload(data.payload);
          }
        } catch (_) {}
      }
    };
    window.addEventListener('storage', this._boundStorage);
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

    this._boundShelfKeyDown = (e) => {
      if (e.key === 'Escape' && this.assetShelf?.classList.contains('open')) {
        closeShelf();
      }
    };
    document.addEventListener('keydown', this._boundShelfKeyDown);

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
        // Only skin the vehicle — do NOT also place a world sprite to avoid duplicates
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
    loadSafeImage(asset.imageUrl).then(img => {
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
    }).catch(err => console.error('Failed to ingest sprite to world:', err));
  }

  /**
   * Convert image to texture and skin active vehicle chassis with custom sprite.
   */
  ingestSpriteAsVehicle(asset) {
    loadSafeImage(asset.imageUrl).then(img => {
      const meta = asset.metadata || {};
      const fw = meta.frame_width || img.naturalWidth || 128;
      const fh = meta.frame_height || img.naturalHeight || 128;

      // Ensure existing world sprites are cleared to avoid duplicates when driving vehicle
      this.worldSprites = [];

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

      // Start engine audio for any sprite type — audio is shared for all vehicles
      if (!this._gameOver && !this.car?.crashed) {
        this.audio?.startEngine?.();
      }

      this.audio?.playCoinPickup?.();
    }).catch(err => console.error('Failed to ingest vehicle sprite:', err));
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
  destroy() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    window.removeEventListener('resize', this._boundResize);
    window.removeEventListener('keydown', this._boundKeyDown);
    window.removeEventListener('keyup', this._boundKeyUp);
    if (this._boundStorage) window.removeEventListener('storage', this._boundStorage);
    if (this._boundShelfKeyDown) document.removeEventListener('keydown', this._boundShelfKeyDown);
    if (this.busChannel) {
      this.busChannel.close();
      this.busChannel = null;
    }
    this.audio?.destroy();
    this.renderer?.destroy();
    this.worldSprites = [];
    this.incomingAssets = [];
    this.coins = [];
    this.fuelCans = [];
    this.floatingPopups = [];
  }
}

window.GameSandbox = GameSandbox;

