/* ============================================================
   SpriteForge — biome-parallax.js
   Multi-Biome Parallax Background System + Dynamic Particle FX
   Issue #34 — Multi-Biome Parallax Environments & Retro Audio FX
   ============================================================ */
'use strict';

// ── Biome Definitions ─────────────────────────────────────────
const BIOMES = {
  countryside: {
    id: 'countryside',
    label: '🌄 Countryside / Rolling Hills',
    layers: [
      { name: 'sky',        speed: 0.00, drawFn: 'drawCountrysideSky'        },
      { name: 'mountains',  speed: 0.08, drawFn: 'drawCountrysideMountains'  },
      { name: 'hills',      speed: 0.20, drawFn: 'drawCountrysideHills'      },
      { name: 'foreground', speed: 0.50, drawFn: 'drawCountrysideForeground' },
    ],
    groundColor: '#4CAF50',
    groundLine: 0.75,
  },
  desert: {
    id: 'desert',
    label: '🏜️ Desert / Dunes',
    layers: [
      { name: 'sky',        speed: 0.00, drawFn: 'drawDesertSky'        },
      { name: 'pyramids',   speed: 0.06, drawFn: 'drawDesertPyramids'   },
      { name: 'dunes',      speed: 0.18, drawFn: 'drawDesertDunes'      },
      { name: 'foreground', speed: 0.45, drawFn: 'drawDesertForeground' },
    ],
    groundColor: '#C9A84C',
    groundLine: 0.72,
  },
  cyberpunk: {
    id: 'cyberpunk',
    label: '🌆 Cyberpunk / Neon City',
    layers: [
      { name: 'sky',             speed: 0.00, drawFn: 'drawCyberpunkSky'          },
      { name: 'skyscrapers_far', speed: 0.04, drawFn: 'drawCyberpunkFarBuildings' },
      { name: 'skyscrapers_near',speed: 0.15, drawFn: 'drawCyberpunkNearBuildings'},
      { name: 'foreground',      speed: 0.45, drawFn: 'drawCyberpunkForeground'   },
    ],
    groundColor: '#1a1a2e',
    groundLine: 0.78,
  },
  moon: {
    id: 'moon',
    label: '🌑 Moon / Lunar Surface',
    layers: [
      { name: 'stars',       speed: 0.00, drawFn: 'drawMoonStars'      },
      { name: 'earth',       speed: 0.02, drawFn: 'drawMoonEarth'      },
      { name: 'craters_far', speed: 0.08, drawFn: 'drawMoonFarSurface' },
      { name: 'foreground',  speed: 0.35, drawFn: 'drawMoonForeground' },
    ],
    groundColor: '#5a5a6a',
    groundLine: 0.80,
  },
};

// ── Particle ──────────────────────────────────────────────────
class Particle {
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.vx = opts.vx ?? (Math.random() - 0.5) * 4;
    this.vy = opts.vy ?? -(Math.random() * 3 + 1);
    this.life = 1.0;
    this.decay   = opts.decay   ?? (Math.random() * 0.03 + 0.02);
    this.size    = opts.size    ?? (Math.random() * 6 + 2);
    this.color   = opts.color   ?? '#888';
    this.gravity = opts.gravity ?? 0.15;
    this.type    = opts.type    ?? 'smoke';
    this.rotation  = Math.random() * Math.PI * 2;
    this.rotSpeed  = (Math.random() - 0.5) * 0.2;
  }
  update() {
    this.x  += this.vx;
    this.y  += this.vy;
    this.vy += this.gravity;
    this.life -= this.decay;
    this.size *= 0.985;
    this.rotation += this.rotSpeed;
  }
  isDead() { return this.life <= 0 || this.size < 0.5; }
}

// ── Particle System ───────────────────────────────────────────
class ParticleSystem {
  constructor() { this.particles = []; }

  clear() { this.particles = []; }

  emit(x, y, opts = {}) {
    const count = opts.count ?? 1;
    for (let i = 0; i < count; i++) this.particles.push(new Particle(x, y, opts));
  }

  emitTireDirt(x, y, speed, isGrounded) {
    if (!isGrounded) return;
    const intensity = Math.min(Math.abs(speed) / 8, 1);
    if (intensity < 0.1 || Math.random() > intensity * 0.8) return;
    const count = Math.floor(intensity * 4) + 1;
    for (let i = 0; i < count; i++) {
      this.emit(x, y, {
        vx: speed * -0.3 + (Math.random() - 0.5) * 2,
        vy: -(Math.random() * 2 + 0.5),
        decay: 0.04 + Math.random() * 0.03,
        size: Math.random() * 8 + 3,
        color: speed > 0
          ? `hsl(30,${40 + Math.random()*30}%,${40 + Math.random()*20}%)`
          : 'rgba(150,150,150,0.8)',
        gravity: 0.08, type: 'dirt',
      });
    }
  }

  emitJumpDust(x, y) {
    for (let i = 0; i < 18; i++) {
      this.emit(x, y, {
        vx: (Math.random() - 0.5) * 6,
        vy: -(Math.random() * 3.5 + 1.5),
        decay: 0.025 + Math.random() * 0.025,
        size: Math.random() * 8 + 3,
        color: `rgba(${210 + Math.floor(Math.random()*40)},${180 + Math.floor(Math.random()*30)},${130 + Math.floor(Math.random()*30)},0.75)`,
        gravity: 0.08,
        type: 'dirt',
      });
    }
  }

  emitExhaust(x, y, speed) {
    if (Math.random() > 0.4) return;
    const intensity = Math.min(Math.abs(speed) / 10, 1);
    this.emit(x, y, {
      vx: -Math.abs(speed) * 0.5 - 1,
      vy: -(Math.random() * 1.5),
      decay: 0.025 + Math.random() * 0.02,
      size: intensity * 12 + 4,
      color: `rgba(${180 + Math.floor(intensity*50)},${170 + Math.floor(intensity*40)},${160 + Math.floor(intensity*30)},0.6)`,
      gravity: -0.02, type: 'exhaust',
    });
  }

  emitCoinPickup(x, y) {
    const colors = ['#FFD700','#FFA500','#FFEC00','#FFB800','#FFF176'];
    for (let i = 0; i < 20; i++) {
      const angle = (Math.PI * 2 * i) / 20 + Math.random() * 0.3;
      const spd   = Math.random() * 6 + 2;
      this.emit(x, y, {
        vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd - 3,
        decay: 0.025 + Math.random() * 0.02, size: Math.random() * 6 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        gravity: 0.2, type: 'sparkle',
      });
    }
  }

  emitCrash(x, y) {
    const sc = ['#FF4500','#FF6B00','#FFD700','#FFFFFF','#FF0000'];
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, spd = Math.random() * 10 + 3;
      this.emit(x, y, {
        vx: Math.cos(a)*spd, vy: Math.sin(a)*spd - 5,
        decay: 0.02 + Math.random()*0.04, size: Math.random()*8+1,
        color: sc[Math.floor(Math.random()*sc.length)], gravity: 0.35, type: 'spark',
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, spd = Math.random() * 6 + 2;
      this.emit(x, y, {
        vx: Math.cos(a)*spd, vy: Math.sin(a)*spd - 4,
        decay: 0.015, size: Math.random()*12+5,
        color: '#555', gravity: 0.4, type: 'debris',
      });
    }
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update();
      if (this.particles[i].isDead()) this.particles.splice(i, 1);
    }
  }

  draw(ctx) {
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);

      if (p.type === 'sparkle') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const oa = (Math.PI*2*i)/5 - Math.PI/2;
          const ia = oa + Math.PI/5;
          if (i === 0) ctx.moveTo(Math.cos(oa)*p.size, Math.sin(oa)*p.size);
          else         ctx.lineTo(Math.cos(oa)*p.size, Math.sin(oa)*p.size);
          ctx.lineTo(Math.cos(ia)*(p.size*0.4), Math.sin(ia)*(p.size*0.4));
        }
        ctx.closePath(); ctx.fill();
      } else if (p.type === 'spark') {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size * 0.3;
        ctx.shadowColor = p.color; ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(p.vx*-0.5, p.vy*-0.5); ctx.stroke();
      } else {
        const g = ctx.createRadialGradient(0,0,0, 0,0,p.size);
        g.addColorStop(0, p.color); g.addColorStop(1,'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0,0,p.size,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    });
  }
}

// ── Parallax Renderer ─────────────────────────────────────────
class BiomeParallaxRenderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.width   = canvas.width;
    this.height  = canvas.height;
    this.currentBiome  = BIOMES.countryside;
    this.particles     = new ParticleSystem();
    this._frameCount   = 0;
    this._stars        = this._genStars(200);
    this._rainDrops    = this._genRain(80);
    this._neonFlicker  = {};
  }

  _genStars(n) {
    return Array.from({length: n}, () => ({
      x: Math.random(), y: Math.random() * 0.65,
      r: Math.random() * 1.8 + 0.3,
      bright: Math.random(), phase: Math.random() * Math.PI * 2,
    }));
  }
  _genRain(n) {
    return Array.from({length: n}, () => ({
      x: Math.random(), y: Math.random(),
      len: Math.random() * 15 + 8,
      spd: Math.random() * 0.005 + 0.008,
      op:  Math.random() * 0.5 + 0.2,
    }));
  }

  resize(w, h) {
    const dpr = window.devicePixelRatio || 1;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(dpr, dpr);
  }

  destroy() {
    this.particles?.clear();
    this.ctx = null;
    this.canvas = null;
    this._stars = [];
    this._rainDrops = [];
    this._neonFlicker = {};
  }

  draw(cameraX) {
    this._frameCount++;
    const { ctx, width: W, height: H, currentBiome: biome } = this;
    ctx.clearRect(0, 0, W, H);

    biome.layers.forEach(layer => {
      ctx.save();
      const offset = -(cameraX * layer.speed) % W;
      if (typeof this[layer.drawFn] === 'function') this[layer.drawFn](ctx, W, H, offset, biome);
      ctx.restore();
    });

    // Ground
    const gy = H * biome.groundLine;
    const gg = ctx.createLinearGradient(0, gy, 0, H);
    gg.addColorStop(0, biome.groundColor);
    gg.addColorStop(1, this._darken(biome.groundColor, 0.4));
    ctx.fillStyle = gg;
    ctx.fillRect(0, gy, W, H - gy);

    this.particles.update();
    this.particles.draw(ctx);
  }

  _darken(hex, amt) {
    try {
      const n = parseInt(hex.replace('#',''),16);
      const r = Math.max(0,(n>>16)-Math.floor(255*amt));
      const g = Math.max(0,((n>>8)&0xff)-Math.floor(255*amt));
      const b = Math.max(0,(n&0xff)-Math.floor(255*amt));
      return `rgb(${r},${g},${b})`;
    } catch(_) { return hex; }
  }
  _hex2rgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? `${parseInt(r[1],16)},${parseInt(r[2],16)},${parseInt(r[3],16)}` : '255,255,255';
  }

  /* ---- Countryside ---- */
  drawCountrysideSky(ctx, W, H) {
    const g = ctx.createLinearGradient(0,0,0,H*0.75);
    g.addColorStop(0,'#5BB8FF'); g.addColorStop(0.5,'#90D5FF'); g.addColorStop(1,'#FFF5C8');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.shadowColor='#FFE066'; ctx.shadowBlur=40;
    ctx.fillStyle='#FFD700'; ctx.beginPath(); ctx.arc(W*0.15,H*0.12,40,0,Math.PI*2); ctx.fill();
    ctx.restore();
    this._clouds(ctx, W, H, 0, [{rx:0.10,y:0.08,s:1.2},{rx:0.38,y:0.15,s:0.9},{rx:0.62,y:0.07,s:1.4},{rx:0.84,y:0.13,s:1.0}]);
  }
  drawCountrysideMountains(ctx, W, H, off) {
    const pts = [[0,0.55],[0.08,0.30],[0.15,0.55],[0.22,0.28],[0.32,0.55],[0.40,0.35],[0.50,0.55],[0.58,0.26],[0.68,0.55],[0.76,0.32],[0.88,0.55],[0.95,0.30],[1.05,0.55]];
    const peaks = [[0.08,0.30],[0.22,0.28],[0.40,0.35],[0.58,0.26],[0.76,0.32],[0.95,0.30]];
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W;
      ctx.beginPath(); ctx.moveTo(ox,H);
      pts.forEach(([rx,ry])=>ctx.lineTo(ox+rx*W,ry*H));
      ctx.lineTo(ox+W,H); ctx.closePath(); ctx.fillStyle='#5A8055'; ctx.fill();
      peaks.forEach(([rx,ry])=>{
        ctx.beginPath(); ctx.moveTo(ox+rx*W,ry*H);
        ctx.lineTo(ox+(rx-0.025)*W,(ry+0.05)*H); ctx.lineTo(ox+(rx+0.025)*W,(ry+0.05)*H);
        ctx.closePath(); ctx.fillStyle='#E8F5E9'; ctx.fill();
      });
    }
  }
  drawCountrysideHills(ctx, W, H, off) {
    const pts = [[0,0.72],[0.12,0.58],[0.28,0.72],[0.44,0.60],[0.60,0.72],[0.72,0.56],[0.88,0.72],[1.05,0.62]];
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W; ctx.beginPath(); ctx.moveTo(ox,H);
      pts.forEach(([rx,ry])=>ctx.lineTo(ox+rx*W,ry*H));
      ctx.lineTo(ox+W,H); ctx.closePath(); ctx.fillStyle='#6BBF59'; ctx.fill();
    }
  }
  drawCountrysideForeground(ctx, W, H, off) {
    const gy=H*0.75;
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W;
      ctx.fillStyle='#A0784A'; ctx.fillRect(ox,gy-18,W,5); ctx.fillRect(ox,gy-8,W,5);
      for (let px=0;px<W;px+=80) { ctx.fillStyle='#8B6914'; ctx.fillRect(ox+px,gy-26,8,30); }
      for (let gx=20;gx<W;gx+=45) this._grassTuft(ctx, ox+gx, gy);
    }
  }

  /* ---- Desert ---- */
  drawDesertSky(ctx, W, H) {
    const g = ctx.createLinearGradient(0,0,0,H*0.75);
    g.addColorStop(0,'#B33000'); g.addColorStop(0.4,'#FF6600'); g.addColorStop(0.7,'#FFAA00'); g.addColorStop(1,'#FFD166');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    const sg = ctx.createRadialGradient(W*0.8,H*0.35,0,W*0.8,H*0.35,50);
    sg.addColorStop(0,'#FFFDE7'); sg.addColorStop(0.4,'#FFCA28'); sg.addColorStop(1,'transparent');
    ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(W*0.8,H*0.35,50,0,Math.PI*2); ctx.fill();
  }
  drawDesertPyramids(ctx, W, H, off) {
    const pyr=[{rx:0.10,ry:0.72,sz:0.18},{rx:0.28,ry:0.72,sz:0.12},{rx:0.55,ry:0.72,sz:0.22},{rx:0.75,ry:0.72,sz:0.15}];
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W;
      pyr.forEach(({rx,ry,sz})=>{
        const bx=ox+rx*W, by=ry*H, hw=sz*W*0.5, ph=sz*H*0.6;
        ctx.beginPath(); ctx.moveTo(bx,by-ph); ctx.lineTo(bx,by); ctx.lineTo(bx+hw,by); ctx.closePath(); ctx.fillStyle='#9B7D34'; ctx.fill();
        ctx.beginPath(); ctx.moveTo(bx,by-ph); ctx.lineTo(bx-hw,by); ctx.lineTo(bx,by); ctx.closePath(); ctx.fillStyle='#C9A84C'; ctx.fill();
      });
      for (let cx=30;cx<W;cx+=200) this._cactus(ctx, ox+cx, H*0.72);
    }
  }
  drawDesertDunes(ctx, W, H, off) {
    const pts=[[0,0.75],[0.15,0.63],[0.30,0.75],[0.45,0.67],[0.60,0.75],[0.75,0.61],[0.92,0.75],[1.05,0.68]];
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W; ctx.beginPath(); ctx.moveTo(ox,H);
      pts.forEach(([rx,ry])=>ctx.lineTo(ox+rx*W,ry*H));
      ctx.lineTo(ox+W,H); ctx.closePath(); ctx.fillStyle='#D4A055'; ctx.fill();
    }
  }
  drawDesertForeground(ctx, W, H, off) {
    const gy=H*0.72;
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W;
      ctx.strokeStyle='rgba(180,130,50,0.4)'; ctx.lineWidth=1.5;
      for (let rx=0;rx<W;rx+=25) {
        ctx.beginPath(); ctx.moveTo(ox+rx,gy+5); ctx.bezierCurveTo(ox+rx+8,gy+2,ox+rx+17,gy+8,ox+rx+25,gy+5); ctx.stroke();
      }
      for (let rx=40;rx<W;rx+=110) this._rock(ctx, ox+rx, gy+4);
    }
  }

  /* ---- Cyberpunk ---- */
  drawCyberpunkSky(ctx, W, H) {
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#050014'); g.addColorStop(0.4,'#0D0033'); g.addColorStop(1,'#1A0855');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    this._stars.forEach(s=>{
      const tw=0.5+0.5*Math.sin(s.phase+this._frameCount*0.03);
      ctx.globalAlpha=s.bright*tw; ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(s.x*W,s.y*H,s.r,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha=1;
    ctx.save(); ctx.shadowColor='#FF00FF'; ctx.shadowBlur=30;
    const mg=ctx.createRadialGradient(W*0.85,H*0.1,0,W*0.85,H*0.1,28);
    mg.addColorStop(0,'#FFB3FF'); mg.addColorStop(0.5,'#CC00CC'); mg.addColorStop(1,'transparent');
    ctx.fillStyle=mg; ctx.beginPath(); ctx.arc(W*0.85,H*0.1,28,0,Math.PI*2); ctx.fill(); ctx.restore();
    this._rain(ctx, W, H);
  }
  drawCyberpunkFarBuildings(ctx, W, H, off) {
    const nc=['#FF00FF','#00FFFF','#FF0066','#9400FF','#00FF88'];
    const bl=[{rx:0.00,w:0.06,h:0.50},{rx:0.07,w:0.04,h:0.35},{rx:0.12,w:0.08,h:0.45},{rx:0.21,w:0.05,h:0.55},{rx:0.27,w:0.07,h:0.38},{rx:0.35,w:0.05,h:0.60},{rx:0.41,w:0.09,h:0.42},{rx:0.51,w:0.04,h:0.50},{rx:0.56,w:0.06,h:0.35},{rx:0.63,w:0.07,h:0.48},{rx:0.71,w:0.05,h:0.58},{rx:0.77,w:0.08,h:0.40},{rx:0.86,w:0.06,h:0.52},{rx:0.93,w:0.07,h:0.36}];
    const gy=H*0.78;
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W;
      bl.forEach((b,idx)=>{
        const col=nc[idx%nc.length], bx=ox+b.rx*W, bh=b.h*gy, bw=b.w*W, by=gy-bh;
        const bg=ctx.createLinearGradient(bx,by,bx+bw,by);
        bg.addColorStop(0,'#1a0535'); bg.addColorStop(1,'#0d0221');
        ctx.fillStyle=bg; ctx.fillRect(bx,by,bw,bh);
        ctx.save(); ctx.shadowColor=col; ctx.shadowBlur=8; ctx.strokeStyle=col; ctx.lineWidth=1.5;
        ctx.strokeRect(bx+0.5,by+0.5,bw-1,bh-1); ctx.restore();
        this._bldgWindows(ctx,bx,by,bw,bh,col,idx);
      });
    }
  }
  drawCyberpunkNearBuildings(ctx, W, H, off) {
    const nc=['#00FFFF','#FF00FF','#FF0080'];
    const bl=[{rx:0.00,w:0.10,h:0.45,c:0},{rx:0.11,w:0.14,h:0.35,c:1},{rx:0.26,w:0.10,h:0.50,c:2},{rx:0.37,w:0.12,h:0.40,c:0},{rx:0.50,w:0.09,h:0.48,c:1},{rx:0.60,w:0.13,h:0.38,c:2},{rx:0.74,w:0.10,h:0.52,c:0},{rx:0.85,w:0.15,h:0.36,c:1}];
    const gy=H*0.78;
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W;
      bl.forEach(b=>{
        const col=nc[b.c], bx=ox+b.rx*W, bh=b.h*gy*1.1, bw=b.w*W, by=gy-bh;
        ctx.fillStyle='#0a0120'; ctx.fillRect(bx,by,bw,bh);
        ctx.save(); ctx.shadowColor=col; ctx.shadowBlur=15; ctx.strokeStyle=col; ctx.lineWidth=2;
        ctx.strokeRect(bx+1,by+1,bw-2,bh-2); ctx.fillStyle=col; ctx.fillRect(bx,by,bw,3); ctx.restore();
        this._bldgWindows(ctx,bx,by,bw,bh,col,b.c+5);
      });
    }
  }
  drawCyberpunkForeground(ctx, W, H, off) {
    const gy=H*0.78;
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W;
      const rg=ctx.createLinearGradient(0,gy,0,H);
      rg.addColorStop(0,'rgba(0,200,255,0.08)'); rg.addColorStop(0.5,'rgba(255,0,255,0.05)'); rg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=rg; ctx.fillRect(ox,gy,W,H-gy);
      ctx.fillStyle='rgba(255,255,100,0.5)';
      for (let rx=0;rx<W;rx+=60) ctx.fillRect(ox+rx,gy+(H-gy)*0.3,35,3);
      for (let lx=60;lx<W;lx+=180) this._lampPost(ctx, ox+lx, gy);
    }
  }

  /* ---- Moon ---- */
  drawMoonStars(ctx, W, H) {
    const g=ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#010209'); g.addColorStop(1,'#02040A');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    this._stars.forEach(s=>{
      const tw=0.4+0.6*Math.sin(s.phase+this._frameCount*0.02);
      ctx.globalAlpha=s.bright*tw; ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(s.x*W,s.y*H*0.8,s.r,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha=1;
    const mw=ctx.createLinearGradient(0,0,W,H*0.5);
    mw.addColorStop(0,'rgba(150,150,255,0)'); mw.addColorStop(0.5,'rgba(200,200,255,0.04)'); mw.addColorStop(1,'rgba(150,150,255,0)');
    ctx.fillStyle=mw; ctx.fillRect(0,0,W,H*0.6);
  }
  drawMoonEarth(ctx, W, H) {
    const ex=W*0.2, ey=H*0.2, er=65;
    ctx.save(); ctx.shadowColor='#00AAFF'; ctx.shadowBlur=20;
    const eg=ctx.createRadialGradient(ex-15,ey-15,5,ex,ey,er);
    eg.addColorStop(0,'#4BB8E8'); eg.addColorStop(0.3,'#2E8B4A'); eg.addColorStop(0.6,'#1A6B5A'); eg.addColorStop(0.8,'#4BB8E8'); eg.addColorStop(1,'#1A3A7A');
    ctx.fillStyle=eg; ctx.beginPath(); ctx.arc(ex,ey,er,0,Math.PI*2); ctx.fill();
    const ag=ctx.createRadialGradient(ex,ey,er*0.9,ex,ey,er*1.2);
    ag.addColorStop(0,'rgba(100,180,255,0.3)'); ag.addColorStop(1,'transparent');
    ctx.fillStyle=ag; ctx.beginPath(); ctx.arc(ex,ey,er*1.2,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  drawMoonFarSurface(ctx, W, H, off) {
    const pts=[[0,0.72],[0.1,0.60],[0.2,0.72],[0.3,0.64],[0.45,0.72],[0.55,0.58],[0.68,0.72],[0.78,0.62],[0.90,0.72],[1.05,0.65]];
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W; ctx.beginPath(); ctx.moveTo(ox,H);
      pts.forEach(([rx,ry])=>ctx.lineTo(ox+rx*W,ry*H));
      ctx.lineTo(ox+W,H); ctx.closePath(); ctx.fillStyle='#3D3D4A'; ctx.fill();
      [[0.08,0.70],[0.28,0.68],[0.52,0.69],[0.75,0.67],[0.92,0.70]].forEach(([rx,ry])=>this._crater(ctx,ox+rx*W,ry*H,20));
    }
  }
  drawMoonForeground(ctx, W, H, off) {
    const gy=H*0.8;
    for (let t=-1;t<=1;t++) {
      const ox=off+t*W;
      [[0.07,gy+8],[0.25,gy+12],[0.5,gy+6],[0.72,gy+10],[0.9,gy+8]].forEach(([rx,y])=>this._crater(ctx,ox+rx*W,y,35));
      for (let rx=30;rx<W;rx+=95) this._moonRock(ctx, ox+rx, gy+3);
    }
  }

  /* ---- Shared Primitives ---- */
  _clouds(ctx, W, H, off, list) {
    list.forEach(({rx, y, s=1, a=0.9}) => {
      ctx.save(); ctx.globalAlpha=a; ctx.fillStyle='rgba(255,255,255,0.85)';
      ctx.shadowColor='rgba(200,220,255,0.5)'; ctx.shadowBlur=10;
      const cx=(rx*W+off)%W;
      ctx.beginPath();
      ctx.ellipse(cx, y*H, s*30, s*15, 0, 0, Math.PI*2);
      ctx.ellipse(cx-s*18, y*H+s*3, s*21, s*12, 0, 0, Math.PI*2);
      ctx.ellipse(cx+s*18, y*H+s*3, s*23, s*11, 0, 0, Math.PI*2);
      ctx.fill(); ctx.restore();
    });
  }
  _grassTuft(ctx, x, y) {
    ctx.strokeStyle=`hsl(${120+Math.random()*20},${60+Math.random()*20}%,${35+Math.random()*15}%)`;
    ctx.lineWidth=1.5;
    for (let i=0;i<4;i++) {
      ctx.beginPath(); ctx.moveTo(x+i*3,y);
      ctx.quadraticCurveTo(x+i*3+(Math.random()-0.5)*6, y-(8+Math.random()*8), x+i*3+(Math.random()-0.5)*4, y-(12+Math.random()*6));
      ctx.stroke();
    }
  }
  _cactus(ctx, x, y) {
    ctx.fillStyle='#3D8B37';
    ctx.fillRect(x-5,y-40,10,40); ctx.fillRect(x-20,y-28,15,8); ctx.fillRect(x-20,y-48,8,20);
    ctx.fillRect(x+5,y-22,15,8); ctx.fillRect(x+12,y-38,8,16);
    ctx.fillStyle='#fff';
    for (let i=0;i<5;i++) { ctx.fillRect(x-6,y-10-i*8,2,3); ctx.fillRect(x+4,y-10-i*8,2,3); }
  }
  _rock(ctx, x, y) {
    ctx.fillStyle='#9E8A6A'; ctx.beginPath(); ctx.ellipse(x,y,15,9,-0.2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#B5A07A'; ctx.beginPath(); ctx.ellipse(x-3,y-1.5,6,3.75,-0.3,0,Math.PI*2); ctx.fill();
  }
  _rain(ctx, W, H) {
    ctx.strokeStyle='rgba(150,200,255,0.25)'; ctx.lineWidth=1;
    this._rainDrops.forEach(d=>{
      d.y=(d.y+d.spd)%1;
      ctx.globalAlpha=d.op; ctx.beginPath();
      ctx.moveTo(d.x*W,d.y*H); ctx.lineTo(d.x*W+3,d.y*H+d.len); ctx.stroke();
    });
    ctx.globalAlpha=1;
  }
  _bldgWindows(ctx, bx, by, bw, bh, neonColor, seed) {
    const rows=Math.floor(bh/18), cols=Math.floor(bw/12);
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
      const wx=bx+c*(bw/cols)+2, wy=by+r*(bh/rows)+4, ww=(bw/cols)-4, wh=(bh/rows)-6;
      const lit=((seed*7+r*13+c*17)%3)!==0;
      if (lit) {
        const key=`${seed}_${r}_${c}`;
        if (!this._neonFlicker[key]||Math.random()>0.995) this._neonFlicker[key]=Math.random()>0.1;
        if (this._neonFlicker[key]) { ctx.fillStyle=`rgba(${this._hex2rgb(neonColor)},0.7)`; ctx.fillRect(wx,wy,ww,wh); }
      } else { ctx.fillStyle='rgba(5,5,20,0.8)'; ctx.fillRect(wx,wy,ww,wh); }
    }
  }
  _lampPost(ctx, x, y) {
    const cols=['#FF00FF','#00FFFF','#FF0066'], col=cols[Math.floor(x/60)%cols.length];
    ctx.save(); ctx.shadowColor=col; ctx.shadowBlur=20;
    ctx.fillStyle='#333'; ctx.fillRect(x-3,y-80,6,80); ctx.fillRect(x-3,y-80,30,5);
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(x+27,y-78,6,0,Math.PI*2); ctx.fill();
    const cg=ctx.createRadialGradient(x+27,y-72,0,x+27,y-72,40);
    cg.addColorStop(0,`rgba(${this._hex2rgb(col)},0.3)`); cg.addColorStop(1,'transparent');
    ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(x+27,y-72,40,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  _crater(ctx, x, y, r) {
    ctx.save();
    ctx.fillStyle='rgba(100,100,110,0.5)'; ctx.beginPath(); ctx.ellipse(x,y,r*1.15,r*0.55,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(15,15,22,0.7)';   ctx.beginPath(); ctx.ellipse(x,y,r*0.75,r*0.35,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(180,180,200,0.3)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(x-r*0.1,y-r*0.05,r*1.1,r*0.5,0,0,Math.PI); ctx.stroke();
    ctx.restore();
  }
  _moonRock(ctx, x, y) {
    ctx.fillStyle='#6A6A7A'; ctx.beginPath(); ctx.ellipse(x,y,10,6.5,-0.3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#8080A0'; ctx.beginPath(); ctx.ellipse(x-2,y-1.5,3.5,2.2,-0.5,0,Math.PI*2); ctx.fill();
  }
}

// ── Exports ───────────────────────────────────────────────────
window.BIOMES               = BIOMES;
window.BiomeParallaxRenderer = BiomeParallaxRenderer;
window.ParticleSystem        = ParticleSystem;
window.Particle              = Particle;
