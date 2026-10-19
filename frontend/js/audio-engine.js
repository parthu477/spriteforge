/* ============================================================
   SpriteForge — audio-engine.js
   Web Audio API Synthesized Sound Effects — Pure JS, no files
   Issue #34 — Multi-Biome Parallax Environments & Retro Audio FX
   ============================================================ */
'use strict';

class RetroAudioEngine {
  constructor() {
    this._ctx     = null;
    this._muted   = false;
    this._master  = null;

    // Engine sound state
    this._engineOsc   = null;
    this._engineGain  = null;
    this._engineNoise = null;
    this._engineNoiseGain = null;
    this._engineRunning = false;

    // Fuel alert interval
    this._fuelAlertTimer = null;

    // Issue #45: Lifecycle listener bindings
    this._boundPageHide = () => this.destroy();
    this._boundVisibilityChange = () => {
      if (document.hidden) {
        if (this._ctx && this._ctx.state === 'running') {
          try { this._ctx.suspend(); } catch (_) {}
        }
      } else {
        if (this._ctx && this._ctx.state === 'suspended') {
          try { this._ctx.resume(); } catch (_) {}
        }
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this._boundPageHide);
      document.addEventListener('visibilitychange', this._boundVisibilityChange);
    }
  }

  /* ── Init (lazy — needs user gesture) ─────────────────────── */
  _init() {
    if (this._ctx) return;
    this._ctx    = new (window.AudioContext || window.webkitAudioContext)();
    this._master = this._ctx.createGain();
    this._master.gain.value = this._muted ? 0 : 0.6;
    this._master.connect(this._ctx.destination);
  }

  _resume() {
    if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume();
  }

  /* ── Master mute toggle ────────────────────────────────────── */
  setMuted(muted) {
    this._muted = muted;
    if (this._master) {
      this._master.gain.setTargetAtTime(muted ? 0 : 0.6, this._ctx.currentTime, 0.05);
    }
  }
  toggleMute() { this.setMuted(!this._muted); return this._muted; }
  get isMuted() { return this._muted; }

  /* ── Dynamic Engine Sound ──────────────────────────────────── */
  startEngine() {
    this._init(); this._resume();
    if (this._engineRunning) return;
    this._engineRunning = true;
    const ctx = this._ctx;

    // Primary engine oscillator (sawtooth for that growl)
    this._engineOsc = ctx.createOscillator();
    this._engineOsc.type = 'sawtooth';
    this._engineOsc.frequency.value = 80;

    // Low-pass filter to shape tone
    this._engineFilter = ctx.createBiquadFilter();
    this._engineFilter.type = 'lowpass';
    this._engineFilter.frequency.value = 400;
    this._engineFilter.Q.value = 2;

    // Gain envelope
    this._engineGain = ctx.createGain();
    this._engineGain.gain.value = 0.0;
    this._engineGain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.3);

    // White noise layer for grit
    const bufLen = ctx.sampleRate * 2;
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    this._engineNoise = ctx.createBufferSource();
    this._engineNoise.buffer = buf;
    this._engineNoise.loop   = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 120;
    noiseFilter.Q.value = 0.5;

    this._engineNoiseGain = ctx.createGain();
    this._engineNoiseGain.gain.value = 0.04;

    this._engineOsc.connect(this._engineFilter);
    this._engineFilter.connect(this._engineGain);
    this._engineGain.connect(this._master);

    this._engineNoise.connect(noiseFilter);
    noiseFilter.connect(this._engineNoiseGain);
    this._engineNoiseGain.connect(this._master);

    this._engineOsc.start();
    this._engineNoise.start();
    this._engineFilter2 = noiseFilter;
  }

  /**
   * Call every frame with speed (0–max) and throttle (0–1)
   * to dynamically pitch-shift the engine sound.
   */
  updateEngineSound(speed, throttle) {
    if (!this._engineRunning || !this._engineOsc) return;
    const ctx  = this._ctx;
    const now  = ctx.currentTime;
    const spd  = Math.abs(speed);

    // Base freq rises with speed; throttle adds a boost
    const targetFreq = 65 + spd * 14 + throttle * 120;
    this._engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.08);

    // Filter opens wider with throttle (aggressive sound)
    const targetCutoff = 300 + throttle * 1200 + spd * 40;
    this._engineFilter.frequency.setTargetAtTime(targetCutoff, now, 0.1);

    // Volume tracks throttle
    const targetGain = 0.04 + throttle * 0.14 + Math.min(spd / 10, 1) * 0.08;
    this._engineGain.gain.setTargetAtTime(targetGain, now, 0.05);
    this._engineNoiseGain.gain.setTargetAtTime(throttle * 0.06, now, 0.05);
  }

  stopEngine(immediate = false) {
    if (!this._engineRunning) return;
    this._engineRunning = false;
    const ctx = this._ctx;
    if (!ctx) return;
    const now = ctx.currentTime;

    const cleanupNodes = () => {
      try { this._engineOsc?.stop(); } catch(_) {}
      try { this._engineNoise?.stop(); } catch(_) {}
      try { this._engineOsc?.disconnect(); } catch(_) {}
      try { this._engineFilter?.disconnect(); } catch(_) {}
      try { this._engineGain?.disconnect(); } catch(_) {}
      try { this._engineNoise?.disconnect(); } catch(_) {}
      try { this._engineNoiseGain?.disconnect(); } catch(_) {}
      try { this._engineFilter2?.disconnect(); } catch(_) {}
      this._engineOsc = null;
      this._engineNoise = null;
      this._engineFilter = null;
      this._engineGain = null;
      this._engineNoiseGain = null;
      this._engineFilter2 = null;
    };

    if (immediate) {
      cleanupNodes();
      return;
    }

    if (this._engineGain)      this._engineGain.gain.linearRampToValueAtTime(0, now + 0.4);
    if (this._engineNoiseGain) this._engineNoiseGain.gain.linearRampToValueAtTime(0, now + 0.4);
    setTimeout(() => {
      cleanupNodes();
    }, 500);
  }

  /* ── Brake Squeal / Friction ───────────────────────────────── */
  playBrakeSqueal(intensity = 1.0) {
    this._init(); this._resume();
    if (this._muted) return;
    const ctx = this._ctx, now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 900 + intensity * 400;
    osc.frequency.linearRampToValueAtTime(600 + intensity * 200, now + 0.15);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.08 * intensity, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + 0.18);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 8;

    osc.connect(filter); filter.connect(gain); gain.connect(this._master);
    osc.start(now); osc.stop(now + 0.2);
  }

  /* ── Retro Chiptune Coin Ping ──────────────────────────────── */
  playCoinPickup() {
    this._init(); this._resume();
    if (this._muted) return;
    const ctx = this._ctx, now = ctx.currentTime;

    // Dual-oscillator chiptune arpeggio
    const freqs = [880, 1047, 1319, 1760]; // A5, C6, E6, A6
    freqs.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;

      const t = now + i * 0.06;
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      osc.connect(gain); gain.connect(this._master);
      osc.start(t); osc.stop(t + 0.13);
    });

    // Sparkle shimmer layer
    const osc2  = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2000, now);
    osc2.frequency.linearRampToValueAtTime(3500, now + 0.25);
    gain2.gain.setValueAtTime(0.05, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc2.connect(gain2); gain2.connect(this._master);
    osc2.start(now); osc2.stop(now + 0.3);
  }

  /* ── Fuel Alert Beep ───────────────────────────────────────── */
  startFuelAlert() {
    this._init();
    if (this._fuelAlertTimer) return;
    this._fuelAlertTimer = setInterval(() => this._beepFuel(), 1200);
    this._beepFuel();
  }

  _beepFuel() {
    this._resume();
    if (this._muted) return;
    const ctx = this._ctx, now = ctx.currentTime;
    [now, now + 0.15].forEach(t => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.0, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.01);
      gain.gain.linearRampToValueAtTime(0.0, t + 0.09);
      osc.connect(gain); gain.connect(this._master);
      osc.start(t); osc.stop(t + 0.1);
    });
  }

  stopFuelAlert() {
    if (this._fuelAlertTimer) { clearInterval(this._fuelAlertTimer); this._fuelAlertTimer = null; }
  }

  /* ── Crash Impact Sound ────────────────────────────────────── */
  playCrash() {
    this._init(); this._resume();
    if (this._muted) return;
    const ctx = this._ctx, now = ctx.currentTime;

    // Low thud — sine sub-bass
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(140, now);
    thud.frequency.exponentialRampToValueAtTime(30, now + 0.3);
    thudGain.gain.setValueAtTime(0.6, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    thud.connect(thudGain); thudGain.connect(this._master);
    thud.start(now); thud.stop(now + 0.45);

    // Metal crunch — noise burst
    const bufLen = ctx.sampleRate * 0.5;
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i/bufLen, 1.5);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 200;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.35;
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(this._master);
    noise.start(now); noise.stop(now + 0.55);

    // Spark crackle — high freq burst
    const spark = ctx.createOscillator();
    const sparkGain = ctx.createGain();
    spark.type = 'sawtooth';
    spark.frequency.setValueAtTime(800, now);
    spark.frequency.exponentialRampToValueAtTime(50, now + 0.2);
    sparkGain.gain.setValueAtTime(0.15, now);
    sparkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    spark.connect(sparkGain); sparkGain.connect(this._master);
    spark.start(now); spark.stop(now + 0.28);
  }

  /* ── Retro Jump / Spring Sound (Issue #49) ─────────────────── */
  playJump() {
    this._init(); this._resume();
    if (this._muted) return;
    const ctx = this._ctx, now = ctx.currentTime;

    // Upward pitch sweep (classic retro jump/spring boing)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.16);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.exponentialRampToValueAtTime(1200, now + 0.16);
    filter.Q.value = 3.5;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this._master);

    osc.start(now);
    osc.stop(now + 0.24);
  }

  /* ── Full Teardown & Lifecycle Cleanup (Issue #45) ───────────── */
  destroy() {
    this.stopEngine(true);
    this.stopFuelAlert();
    if (this._master) {
      try { this._master.disconnect(); } catch (_) {}
      this._master = null;
    }
    if (this._ctx) {
      try {
        if (this._ctx.state !== 'closed') {
          this._ctx.close();
        }
      } catch (_) {}
      this._ctx = null;
    }
    if (typeof window !== 'undefined') {
      if (this._boundPageHide) {
        window.removeEventListener('pagehide', this._boundPageHide);
        this._boundPageHide = null;
      }
      if (this._boundVisibilityChange) {
        document.removeEventListener('visibilitychange', this._boundVisibilityChange);
        this._boundVisibilityChange = null;
      }
    }
  }
}

// ── Export ────────────────────────────────────────────────────
window.RetroAudioEngine = RetroAudioEngine;
