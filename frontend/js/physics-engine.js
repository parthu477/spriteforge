/* ============================================================
   SpriteForge — physics-engine.js
   2D Spring-Damper Suspension & Rigid Body Vehicle Physics
   Issue #31 — 2D Procedural Terrain & Spring Suspension Physics
   ============================================================ */
'use strict';

// ── Constants ─────────────────────────────────────────────────
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ── Vec2 helper ───────────────────────────────────────────────
class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(v)    { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v)    { return new Vec2(this.x - v.x, this.y - v.y); }
  scale(s)  { return new Vec2(this.x * s, this.y * s); }
  dot(v)    { return this.x * v.x + this.y * v.y; }
  len()     { return Math.hypot(this.x, this.y); }
  norm()    { const l = this.len() || 1; return new Vec2(this.x / l, this.y / l); }
  rot(a)    { // rotate by angle a (radians)
    const c = Math.cos(a), s = Math.sin(a);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }
  clone()   { return new Vec2(this.x, this.y); }
  static lerp(a, b, t) { return new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
}

// ── Wheel (spring-damper suspension) ──────────────────────────
class Wheel {
  /**
   * @param {object} cfg
   * @param {number} cfg.restLength    — natural suspension length (px)
   * @param {number} cfg.stiffness     — spring constant k  (N/px)
   * @param {number} cfg.damping       — damping coefficient (N·s/px)
   * @param {number} cfg.radius        — wheel radius (px)
   * @param {boolean} cfg.isDriveWheel — receives engine torque
   */
  constructor(cfg = {}) {
    this.restLength    = cfg.restLength    ?? 55;
    this.stiffness     = cfg.stiffness     ?? 2800;
    this.damping       = cfg.damping       ?? 160;
    this.radius        = cfg.radius        ?? 16;
    this.isDriveWheel  = cfg.isDriveWheel  ?? false;

    // Runtime state
    this.compression   = 0;    // current spring compression (px, + = compressed)
    this.compVel       = 0;    // compression velocity (px/s)
    this.contactPoint  = null; // Vec2 world position of contact
    this.onGround      = false;
    this.groundNormal  = new Vec2(0, -1);
    this.angle         = 0;    // visual spin angle
    this.angularVel    = 0;    // visual spin speed
    this.slipRatio     = 0;    // 0–1 tyre slip
  }

  /**
   * Simulate spring-damper against terrain.
   * Returns the suspension force vector in world space.
   * @param {Vec2} attachPt    — chassis attachment point (world)
   * @param {Vec2} downDir     — unit vector pointing "suspension down"
   * @param {TerrainEngine} terrain
   * @param {number} dt
   * @returns {Vec2} force
   */
  update(attachPt, downDir, terrain, dt) {
    const rayEnd = attachPt.add(downDir.scale(this.restLength + this.radius));

    // Raycast: step along downDir and find terrain intersection
    const groundY = terrain.heightAt(rayEnd.x);
    const contactY = groundY;
    const contactX = rayEnd.x;

    // Compute current compression
    const currentLen = contactY - attachPt.y; // distance from attach to ground
    const newCompression = Math.max(0, this.restLength - (currentLen - this.radius));

    // Compression velocity (derivative)
    this.compVel = (newCompression - this.compression) / dt;
    this.compression = newCompression;

    this.onGround = newCompression > 0;

    if (this.onGround) {
      this.contactPoint = new Vec2(contactX, contactY);
      this.groundNormal = terrain.normalAt(contactX);

      // Spring force: F = k*x + d*v (Hooke's law + damping)
      const springF  = this.stiffness * this.compression;
      const dampF    = this.damping   * Math.max(0, this.compVel); // only resist compression
      const totalF   = springF + dampF;

      // Force acts along the "up" direction (opposite downDir)
      const upDir = downDir.scale(-1);
      return upDir.scale(totalF);
    } else {
      this.contactPoint = null;
      return new Vec2(0, 0);
    }
  }

  /** Spin wheel visually based on surface speed */
  spinUpdate(surfaceSpeed, dt) {
    if (this.onGround) {
      this.angularVel = surfaceSpeed / this.radius;
    } else {
      this.angularVel *= 0.98; // spin-down in air
    }
    this.angle += this.angularVel * dt;
  }

  draw(ctx, screenX, screenY, biomeId = 'countryside') {
    const r = this.radius;
    ctx.save();
    ctx.translate(screenX, screenY);

    // Suspension travel indicator (visual compression)
    const compRatio = Math.min(this.compression / this.restLength, 1);

    // Tyre
    const tyreColor = '#1a1a1a';
    ctx.fillStyle = tyreColor;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Tyre tread pattern
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = this.angle + (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r * 0.65), Math.sin(a) * (r * 0.65));
      ctx.lineTo(Math.cos(a) * r,           Math.sin(a) * r);
      ctx.stroke();
    }

    // Rim (colour by biome)
    const rimColors = {
      countryside: '#BDBDBD', desert: '#F5DEB3',
      cyberpunk: '#00FFFF', moon: '#CFD8DC',
    };
    const rimColor = rimColors[biomeId] || '#BDBDBD';

    ctx.rotate(this.angle);
    ctx.fillStyle = rimColor;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Spokes
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i) / 5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (r * 0.5), Math.sin(a) * (r * 0.5));
      ctx.stroke();
    }

    // Hub
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fill();

    // Heat shimmer on slip
    if (this.slipRatio > 0.3) {
      ctx.globalAlpha = this.slipRatio * 0.5;
      ctx.fillStyle = 'rgba(255,150,50,0.6)';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}

// ── Chassis (Rigid Body) ──────────────────────────────────────
class Chassis {
  /**
   * @param {object} cfg
   * @param {number} cfg.mass          — kg
   * @param {number} cfg.width         — chassis half-width (px)
   * @param {number} cfg.height        — chassis half-height (px)
   * @param {number} cfg.inertia       — moment of inertia (kg·px²)
   * @param {number} cfg.wheelBaseHalf — half-distance between wheel attach pts (px)
   * @param {number} cfg.wheelOffsetY  — vertical offset from chassis centre to axle (px)
   * @param {number} cfg.engineTorque  — max engine torque (N·px)
   * @param {number} cfg.brakeTorque   — max brake torque (N·px)
   * @param {number} cfg.maxSpeed      — max velocity (px/s)
   * @param {number} cfg.airRotTorque  — mid-air rotation torque (N·px)
   */
  constructor(cfg = {}) {
    this.mass          = cfg.mass          ?? 350;
    this.hw            = cfg.width         ?? 52;   // half-width
    this.hh            = cfg.height        ?? 26;   // half-height
    this.inertia       = cfg.inertia       ?? 28000;
    this.wheelBaseHalf = cfg.wheelBaseHalf ?? 44;
    this.wheelOffsetY  = cfg.wheelOffsetY  ?? 22;
    this.engineTorque  = cfg.engineTorque  ?? 18000;
    this.brakeTorque   = cfg.brakeTorque   ?? 9000;
    this.maxSpeed      = cfg.maxSpeed      ?? 680;
    this.airRotTorque  = cfg.airRotTorque  ?? 5500;

    // World state
    this.pos   = new Vec2(200, 300); // world position (chassis centre)
    this.vel   = new Vec2(0, 0);     // world velocity
    this.angle = 0;                  // chassis pitch angle (radians)
    this.angVel= 0;                  // angular velocity (rad/s)

    // Physics accumulators (reset each frame)
    this._force  = new Vec2(0, 0);
    this._torque = 0;

    // Wheel attachment (local body coords)
    this.wheels = [
      new Wheel({ restLength: 55, stiffness: 2800, damping: 160, radius: 16, isDriveWheel: false }), // rear
      new Wheel({ restLength: 55, stiffness: 2800, damping: 160, radius: 16, isDriveWheel: true  }), // front
    ];

    // State flags
    this.throttle    = 0;   // -1 (reverse) … +1 (full throttle)
    this.braking     = false;
    this.airRotInput = 0;   // -1 (tilt left) … +1 (tilt right) — mid-air only
    this.crashed     = false;
    this.onGround    = false;
    this.fuel        = 100;
    this.coins       = 0;

    // For flip detection
    this._roofContactTimer = 0;

    // Visual
    this._smokeParticles = [];
  }

  // ── Local attachment points → world ─────────────────────────
  _localToWorld(lx, ly) {
    return this.pos.add(new Vec2(lx, ly).rot(this.angle));
  }

  rearAttach()  { return this._localToWorld(-this.wheelBaseHalf,  this.wheelOffsetY); }
  frontAttach() { return this._localToWorld( this.wheelBaseHalf,  this.wheelOffsetY); }

  // Chassis corner world positions (for flip detection)
  _corners() {
    const hw = this.hw, hh = this.hh;
    return [
      this._localToWorld(-hw, -hh), // rear-top
      this._localToWorld( hw, -hh), // front-top (ROOF corners)
      this._localToWorld( hw,  hh),
      this._localToWorld(-hw,  hh),
    ];
  }

  // ── Physics Step ─────────────────────────────────────────────
  update(terrain, dt, gravity = 980) {
    if (this.crashed) return;

    // Reset accumulators
    this._force  = new Vec2(0, 0);
    this._torque = 0;

    // ── 1. Gravity ──────────────────────────────────────────────
    this._force.y += this.mass * gravity;

    // ── 2. Suspension forces ────────────────────────────────────
    const downDir = new Vec2(0, 1); // world-space "down" (no chassis-local tilt)

    const rearAttach  = this.rearAttach();
    const frontAttach = this.frontAttach();

    const suspForceRear  = this.wheels[0].update(rearAttach,  downDir, terrain, dt);
    const suspForceFront = this.wheels[1].update(frontAttach, downDir, terrain, dt);

    this._force = this._force.add(suspForceRear).add(suspForceFront);

    // Suspension torque contribution
    const torqueRear  = (rearAttach.x  - this.pos.x) * suspForceRear.y
                      - (rearAttach.y  - this.pos.y) * suspForceRear.x;
    const torqueFront = (frontAttach.x - this.pos.x) * suspForceFront.y
                      - (frontAttach.y - this.pos.y) * suspForceFront.x;
    this._torque += torqueRear + torqueFront;

    // ── 3. Drive / Brake / Air-rotation ─────────────────────────
    this.onGround = this.wheels[0].onGround || this.wheels[1].onGround;

    if (this.onGround) {
      if (this.fuel > 0 && Math.abs(this.throttle) > 0.01) {
        // Drive torque on rear wheel
        const speedRatio = Math.min(Math.abs(this.vel.x) / this.maxSpeed, 1);
        const torque = this.engineTorque * this.throttle * (1 - speedRatio * 0.7);

        // Apply as horizontal force proportional to torque / wheel radius
        const driveForce = torque / this.wheels[1].radius;
        const slopeAngle = terrain.slopeAt(this.pos.x);
        this._force.x += driveForce * Math.cos(slopeAngle);
        this._force.y += driveForce * Math.sin(slopeAngle) * 0.3;

        // Fuel drain
        this.fuel = Math.max(0, this.fuel - Math.abs(this.throttle) * dt * 2.8);
      }

      if (this.braking) {
        // Friction brake
        const brakeMag = Math.min(Math.abs(this.vel.x), this.brakeTorque / this.mass * dt);
        this._force.x -= Math.sign(this.vel.x) * brakeMag * this.mass / dt;
      }

      // Ground friction drag
      this._force.x -= this.vel.x * 120;

      // Chassis angle damping on ground
      this.angVel *= 0.80;

    } else {
      // Air drag
      this._force.x -= this.vel.x * 30;
      this._force.y -= Math.max(0, this.vel.y) * 5; // slight air resistance downward

      // Mid-air rotation control (balance for landing)
      if (Math.abs(this.airRotInput) > 0.01) {
        this._torque += this.airRotTorque * this.airRotInput;
      }
    }

    // ── 4. Slope torque — chassis pitches to match terrain ──────
    if (this.onGround) {
      const targetAngle = terrain.slopeAt(this.pos.x);
      const angleDiff   = targetAngle - this.angle;
      // Spring torque to match slope
      this._torque += angleDiff * 12000 - this.angVel * 800;
    }

    // ── 5. Integrate ─────────────────────────────────────────────
    const acc = this._force.scale(1 / this.mass);
    this.vel  = this.vel.add(acc.scale(dt));

    // Clamp horizontal speed
    const maxV = this.maxSpeed;
    this.vel.x = Math.max(-maxV, Math.min(maxV, this.vel.x));

    this.pos = this.pos.add(this.vel.scale(dt));

    const angAcc = this._torque / this.inertia;
    this.angVel  = Math.max(-8, Math.min(8, this.angVel + angAcc * dt));
    this.angle  += this.angVel * dt;

    // ── 6. Wheel spin visual update ──────────────────────────────
    this.wheels.forEach(w => w.spinUpdate(this.vel.x, dt));

    // ── 7. Ground correction — prevent sinking ───────────────────
    this._groundCorrect(terrain);

    // ── 8. Flip / Crash detection ────────────────────────────────
    this._checkCrash(terrain);
  }

  _groundCorrect(terrain) {
    // Prevent wheels from going below ground
    this.wheels.forEach((wheel, i) => {
      const attach = i === 0 ? this.rearAttach() : this.frontAttach();
      const groundY = terrain.heightAt(attach.x);
      const wheelCentreY = attach.y + wheel.restLength;
      const pen = (wheelCentreY + wheel.radius) - groundY;
      if (pen > 0 && wheel.onGround) {
        this.pos.y -= pen * 0.8; // push chassis up
        if (this.vel.y > 0) this.vel.y *= 0.2; // bounce reduction
      }
    });
  }

  _checkCrash(terrain) {
    // Roof corners touch ground → crash
    const roofCorners = [
      this._localToWorld(-this.hw, -this.hh),
      this._localToWorld( this.hw, -this.hh),
    ];
    for (const rc of roofCorners) {
      const gy = terrain.heightAt(rc.x);
      if (rc.y >= gy) {
        this._roofContactTimer += 1;
        if (this._roofContactTimer > 4) { // 4 consecutive frames
          this.crashed = true;
        }
        return;
      }
    }
    this._roofContactTimer = 0;
  }

  /** Draw chassis + wheels on screen */
  draw(ctx, camX, camY, biomeId = 'countryside') {
    if (this.crashed) {
      this._drawCrashed(ctx, camX, camY, biomeId);
      return;
    }

    const sx = this.pos.x - camX;
    const sy = this.pos.y - camY;

    // ── Draw suspension struts ─────────────────────────────────
    ctx.save();
    this.wheels.forEach((wheel, i) => {
      const attach = i === 0 ? this.rearAttach() : this.frontAttach();
      const ax = attach.x - camX;
      const ay = attach.y - camY;

      if (wheel.contactPoint) {
        const wx = wheel.contactPoint.x - camX;
        const wy = wheel.contactPoint.y - camY;

        // Strut line
        ctx.strokeStyle = 'rgba(150,150,150,0.8)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(wx, wy - wheel.radius);
        ctx.stroke();

        // Coil spring visual
        this._drawSpring(ctx, ax, ay, wx, wy - wheel.radius, wheel.compression);
      }
    });
    ctx.restore();

    // ── Draw wheels ────────────────────────────────────────────
    this.wheels.forEach((wheel, i) => {
      if (wheel.contactPoint) {
        wheel.draw(ctx, wheel.contactPoint.x - camX, wheel.contactPoint.y - camY - wheel.radius, biomeId);
      } else {
        const attach = i === 0 ? this.rearAttach() : this.frontAttach();
        const defaultY = attach.y + wheel.restLength;
        wheel.draw(ctx, attach.x - camX, defaultY - camY, biomeId);
      }
    });

    // ── Draw chassis body ─────────────────────────────────────
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);
    this._drawBody(ctx, biomeId);
    ctx.restore();
  }

  _drawSpring(ctx, x1, y1, x2, y2, compression) {
    const coils  = 5;
    const amp    = 4 + compression * 0.05;
    const dx     = x2 - x1, dy = y2 - y1;
    const len    = Math.hypot(dx, dy);
    const ux     = dx / len, uy = dy / len;
    const nx     = -uy, ny = ux; // perpendicular

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    const steps = coils * 6;
    for (let i = 0; i <= steps; i++) {
      const t    = i / steps;
      const side = Math.sin(t * Math.PI * 2 * coils) * amp;
      const px   = x1 + ux * len * t + nx * side;
      const py   = y1 + uy * len * t + ny * side;
      ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(200,200,200,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _drawBody(ctx, biomeId) {
    const hw = this.hw, hh = this.hh;

    // Biome-aware palette
    const palettes = {
      countryside: { body: '#E53935', roof: '#C62828', window: 'rgba(180,220,255,0.75)', detail: '#FFEB3B' },
      desert:      { body: '#FF9800', roof: '#E65100', window: 'rgba(255,230,180,0.7)',  detail: '#FFF9C4' },
      cyberpunk:   { body: '#7C4DFF', roof: '#311B92', window: 'rgba(0,255,255,0.35)',   detail: '#00FFFF' },
      moon:        { body: '#90A4AE', roof: '#546E7A', window: 'rgba(200,210,230,0.6)',  detail: '#ECEFF1' },
    };
    const p = palettes[biomeId] || palettes.countryside;

    // Body shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(0, hh + 8, hw * 0.9, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const bg = ctx.createLinearGradient(-hw, -hh, hw, hh);
    bg.addColorStop(0, p.body); bg.addColorStop(1, p.roof);
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(-hw, -hh * 0.5, hw * 2, hh * 1.5, 6); ctx.fill();

    // Roof / cabin
    ctx.fillStyle = p.roof;
    ctx.beginPath(); ctx.roundRect(-hw * 0.6, -hh, hw * 1.2, hh * 0.55, 4); ctx.fill();

    // Windows
    ctx.fillStyle = p.window;
    ctx.fillRect(-hw * 0.52, -hh + 4, hw * 0.44, hh * 0.38);
    ctx.fillRect( hw * 0.08, -hh + 4, hw * 0.44, hh * 0.38);

    // Headlight (front = positive x in local)
    ctx.fillStyle = '#FFFDE7';
    ctx.shadowColor = '#FFFDE7'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(hw - 4, -hh * 0.05, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Taillight
    ctx.fillStyle = '#FF1744';
    ctx.shadowColor = '#FF1744'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(-hw + 4, -hh * 0.05, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Detail stripe
    ctx.strokeStyle = p.detail; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0); ctx.stroke();

    // Exhaust pipe
    ctx.fillStyle = '#757575';
    ctx.fillRect(-hw - 8, hh * 0.2, 10, 4);
  }

  _drawCrashed(ctx, camX, camY, biomeId) {
    const sx = this.pos.x - camX;
    const sy = this.pos.y - camY;
    ctx.save();
    ctx.translate(sx, sy);
    // Flip upside down on crash
    ctx.rotate(this.angle + Math.PI);
    ctx.globalAlpha = 0.85;
    this._drawBody(ctx, biomeId);
    ctx.restore();

    // Crash X overlay
    ctx.save();
    ctx.font = 'bold 32px Space Mono, monospace';
    ctx.fillStyle = '#FF1744';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#FF1744';
    ctx.shadowBlur = 20;
    ctx.fillText('💥', sx, sy - 60);
    ctx.restore();
  }

  reset(startX, terrain) {
    const startY = terrain.heightAt(startX) - 80;
    this.pos    = new Vec2(startX, startY);
    this.vel    = new Vec2(0, 0);
    this.angle  = 0;
    this.angVel = 0;
    this.crashed = false;
    this._roofContactTimer = 0;
    this.fuel = 100;
    this.coins = 0;
    this.throttle = 0;
    this.braking  = false;
    this.airRotInput = 0;
    this.wheels.forEach(w => {
      w.compression = 0;
      w.compVel     = 0;
      w.onGround    = false;
      w.angle       = 0;
      w.angularVel  = 0;
    });
  }
}

// ── Camera ───────────────────────────────────────────────────
class SmoothCamera {
  /**
   * @param {object} [cfg]
   * @param {number} cfg.lerpFactor    — position smoothing (0–1 per frame)
   * @param {number} cfg.leadFactor    — forward lead = vel.x * leadFactor
   * @param {number} cfg.baseZoom      — default scale (1 = pixel-perfect)
   * @param {number} cfg.zoomOutSpeed  — max zoom-out at high speed
   * @param {number} cfg.screenW
   * @param {number} cfg.screenH
   * @param {number} cfg.verticalOffset— px from centre to car (positive = look down)
   */
  constructor(cfg = {}) {
    this.lerpFactor    = cfg.lerpFactor    ?? 0.10;
    this.leadFactor    = cfg.leadFactor    ?? 0.18;
    this.baseZoom      = cfg.baseZoom      ?? 1.0;
    this.zoomOutSpeed  = cfg.zoomOutSpeed  ?? 0.35;
    this.screenW       = cfg.screenW       ?? 800;
    this.screenH       = cfg.screenH       ?? 480;
    this.verticalOffset= cfg.verticalOffset?? 80;
    this.maxSpeed      = cfg.maxSpeed      ?? 680;

    this.x    = 0;   // world x of screen left edge
    this.y    = 0;   // world y of screen top edge
    this.zoom = this.baseZoom;

    this._targetX = 0;
    this._targetY = 0;
    this._targetZ = this.baseZoom;
  }

  /**
   * Update camera to follow chassis.
   * @param {Chassis} chassis
   * @param {number} dt
   */
  update(chassis, dt) {
    const speed = Math.abs(chassis.vel.x);
    const lead  = chassis.vel.x * this.leadFactor;

    // Target: car position - half screen + lead offset, centred vertically
    this._targetX = chassis.pos.x - this.screenW / 2 / this.zoom + lead;
    this._targetY = chassis.pos.y - this.screenH / 2 / this.zoom + this.verticalOffset / this.zoom;

    // Dynamic zoom: zoom out at high speeds
    const speedRatio  = Math.min(speed / this.maxSpeed, 1);
    this._targetZ = this.baseZoom - speedRatio * this.zoomOutSpeed;
    this._targetZ = Math.max(0.55, this._targetZ);

    // Smooth lerp
    const lf = 1 - Math.pow(1 - this.lerpFactor, dt * 60);
    this.x    = this.x    + (this._targetX - this.x)    * lf;
    this.y    = this.y    + (this._targetY - this.y)    * lf;
    this.zoom = this.zoom + (this._targetZ - this.zoom) * lf;
  }

  /** Apply camera transform to ctx (call before drawing world objects) */
  applyTransform(ctx) {
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  /** World coords of screen left/top for terrain draw */
  get worldLeft()  { return this.x; }
  get worldTop()   { return this.y; }
  get worldRight() { return this.x + this.screenW  / this.zoom; }
  get worldBot()   { return this.y + this.screenH  / this.zoom; }

  resize(w, h) { this.screenW = w; this.screenH = h; }
}

// ── Exports ──────────────────────────────────────────────────
window.Vec2         = Vec2;
window.Wheel        = Wheel;
window.Chassis      = Chassis;
window.SmoothCamera = SmoothCamera;
