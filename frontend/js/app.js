/* ============================================================
   SpriteForge — app.js
   Frontend logic: form submission, job polling, gallery
   ============================================================ */
'use strict';

const POLL_INTERVAL_MS = 1500;
const STAGES = ['queued', 'generating', 'removing_background', 'processing', 'exporting', 'done'];
const STAGE_LABELS = {
  queued: 'Queued',
  generating: 'Generating',
  removing_background: 'Removing BG',
  processing: 'Processing',
  exporting: 'Exporting',
  done: 'Done',
};

const csrfToken = () => document.getElementById('csrf-token').value;

// ── DOM refs ──────────────────────────────────────────────────
const form = document.getElementById('generate-form');
const promptInput = document.getElementById('prompt-input');
const promptCount = document.getElementById('prompt-count');
const generateBtn = document.getElementById('generate-btn');
const btnText = generateBtn.querySelector('.btn-text');
const btnLoader = generateBtn.querySelector('.btn-loader');
const formError = document.getElementById('form-error');
const resultSection = document.getElementById('result-section');
const statusText = document.getElementById('status-text');
const statusSpinner = document.getElementById('status-spinner');
const progressStages = document.getElementById('progress-stages');
const resultCard = document.getElementById('result-card');
const resultImg = document.getElementById('result-img');
const resultMeta = document.getElementById('result-meta');
const downloadBtn = document.getElementById('download-btn');
const rerollBtn = document.getElementById('reroll-btn');
const galleryGrid = document.getElementById('gallery-grid');
const refreshGallery = document.getElementById('refresh-gallery');
const randomSeedBtn = document.getElementById('random-seed-btn');
const seedInput = document.getElementById('seed-input');

// ── Char counter ──────────────────────────────────────────────
promptInput.addEventListener('input', () => {
  promptCount.textContent = promptInput.value.length;
});

// ── Grid pill active state ────────────────────────────────────
document.querySelectorAll('.grid-pill input').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.grid-pill').forEach(p => p.classList.remove('active'));
    radio.closest('.grid-pill').classList.add('active');
  });
});

// ── Random seed ───────────────────────────────────────────────
randomSeedBtn.addEventListener('click', () => {
  seedInput.value = Math.floor(Math.random() * 4294967295);
});

// ── Form submission ───────────────────────────────────────────
let currentJobId = null;
let pollTimer = null;
let lastPromptData = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  const body = buildPayload();
  if (!body) return;
  lastPromptData = { ...body };
  await submitJob(body);
});

function buildPayload() {
  const prompt = promptInput.value.trim();
  if (prompt.length < 3 || prompt.length > 300) {
    showError('Prompt must be 3–300 characters.');
    return null;
  }
  const grid = form.querySelector('input[name="grid"]:checked')?.value;
  const style = document.getElementById('style-select').value;
  const name = document.getElementById('name-input').value.trim() || undefined;
  const seedVal = seedInput.value.trim();
  const seed = seedVal !== '' ? parseInt(seedVal, 10) : undefined;
  return { prompt, grid, style, ...(name && { name }), ...(seed !== undefined && { seed }) };
}

async function submitJob(body) {
  setGenerating(true);
  showResult();

  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken(),
        'Origin': location.origin,
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();

    if (!resp.ok) {
      const msg = data.fields ? Object.values(data.fields).join(' ') : (data.message || 'Request failed.');
      setGenerating(false);
      showError(msg);
      hideResult();
      return;
    }

    currentJobId = data.job_id;
    pollJob(currentJobId);
  } catch (err) {
    setGenerating(false);
    showError('Network error: ' + err.message);
    hideResult();
  }
}

function pollJob(jobId) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/jobs/${jobId}`);
      const data = await resp.json();
      updateProgress(data);

      if (data.status === 'done') {
        onJobDone(data);
      } else if (data.status === 'failed') {
        onJobFailed(data);
      } else {
        pollJob(jobId);
      }
    } catch (_) {
      pollJob(jobId); // retry on network blip
    }
  }, POLL_INTERVAL_MS);
}

function updateProgress(data) {
  statusText.textContent = data.stage === 'done' ? 'Complete!' : `Stage: ${STAGE_LABELS[data.stage] || data.stage}`;
  progressStages.innerHTML = STAGES.map(s => {
    const idx = STAGES.indexOf(s);
    const curIdx = STAGES.indexOf(data.stage);
    let cls = 'stage-chip';
    if (data.status === 'failed' && s === data.stage) cls += ' error';
    else if (idx < curIdx || data.status === 'done') cls += ' done';
    else if (s === data.stage) cls += ' active';
    return `<span class="${cls}">${STAGE_LABELS[s]}</span>`;
  }).join('');
}

// ── Animation Previewer (US-21) ──────────────────────────────
class SpriteAnimationPlayer {
  constructor() {
    this.canvas = document.getElementById('animation-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.viewport = document.getElementById('canvas-viewport');
    this.spriteNameEl = document.getElementById('preview-sprite-name');
    this.scrubber = document.getElementById('frame-scrubber');
    this.frameCounter = document.getElementById('frame-counter');
    this.frameTimestamp = document.getElementById('frame-timestamp');
    this.btnPlayPause = document.getElementById('btn-play-pause');
    this.playPauseIcon = document.getElementById('play-pause-icon');
    this.playPauseText = document.getElementById('play-pause-text');
    this.btnStepPrev = document.getElementById('btn-step-prev');
    this.btnStepNext = document.getElementById('btn-step-next');
    this.fpsSlider = document.getElementById('fps-slider');
    this.fpsBadge = document.getElementById('fps-badge');
    this.zoomButtons = document.querySelectorAll('.btn-zoom');
    this.themeButtons = document.querySelectorAll('.btn-theme');

    this.image = null;
    this.frameWidth = 128;
    this.frameHeight = 128;
    this.rows = 1;
    this.columns = 4;
    this.frameCount = 4;
    this.currentFrame = 0;
    this.fps = 8;
    this.zoom = 2;
    this.isPlaying = false;
    this.animReqId = null;
    this.lastTimestamp = 0;
    this.currentTheme = 'checkered';

    this.initListeners();
  }

  initListeners() {
    if (!this.canvas) return;

    // Play / Pause toggle
    this.btnPlayPause?.addEventListener('click', () => {
      this.togglePlayPause();
    });

    // Step backward
    this.btnStepPrev?.addEventListener('click', () => {
      this.step(-1);
    });

    // Step forward
    this.btnStepNext?.addEventListener('click', () => {
      this.step(1);
    });

    // Scrubber interaction
    const onScrub = () => {
      const targetFrame = parseInt(this.scrubber.value, 10);
      this.seek(targetFrame);
    };
    this.scrubber?.addEventListener('input', onScrub);
    this.scrubber?.addEventListener('change', onScrub);

    // FPS slider real-time update (AC 21.3)
    this.fpsSlider?.addEventListener('input', () => {
      const val = parseInt(this.fpsSlider.value, 10);
      this.setFps(val);
    });

    // Zoom buttons (AC 21.4)
    this.zoomButtons?.forEach(btn => {
      btn.addEventListener('click', () => {
        const z = parseInt(btn.dataset.zoom, 10);
        this.setZoom(z);
      });
    });

    // Theme switcher (AC 21.5)
    this.themeButtons?.forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        this.setTheme(theme);
      });
    });
  }

  mount(imageUrl, metadata, name = '') {
    if (!this.canvas || !this.ctx) return;

    this.pause();

    const displayName = name || metadata?.name || 'sprite';
    if (this.spriteNameEl) {
      this.spriteNameEl.textContent = displayName;
    }

    const rows = Number(metadata?.rows) || 1;
    const columns = Number(metadata?.columns) || 4;
    const initialFps = Number(metadata?.fps) || 8;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const fw = Number(metadata?.frame_width) || Math.floor(img.naturalWidth / columns) || 128;
      const fh = Number(metadata?.frame_height) || Math.floor(img.naturalHeight / rows) || 128;
      const totalFrames = Number(metadata?.frame_count) || (rows * columns) || 4;

      this.image = img;
      this.frameWidth = fw;
      this.frameHeight = fh;
      this.rows = rows;
      this.columns = columns;
      this.frameCount = Math.max(1, totalFrames);

      // Set canvas internal resolution to 1 frame size
      this.canvas.width = fw;
      this.canvas.height = fh;

      // Update scrubber bounds
      if (this.scrubber) {
        this.scrubber.min = 0;
        this.scrubber.max = this.frameCount - 1;
        this.scrubber.value = 0;
      }
      this.currentFrame = 0;

      // Initialize zoom display
      this.applyZoom(this.zoom);

      // Initialize FPS
      this.setFps(initialFps);

      // Render first frame
      this.renderFrame(0);

      // Start looping animation (AC 21.1)
      this.play();
    };
    img.src = imageUrl;
  }

  renderFrame(frameIdx) {
    if (!this.canvas || !this.ctx) return;
    const idx = Math.max(0, Math.min(frameIdx, this.frameCount - 1));
    this.currentFrame = idx;

    const col = idx % this.columns;
    const row = Math.floor(idx / this.columns);
    const sx = col * this.frameWidth;
    const sy = row * this.frameHeight;

    // Ensure nearest-neighbor pixelated rendering on canvas
    this.ctx.imageSmoothingEnabled = false;
    if (this.ctx.webkitImageSmoothingEnabled !== undefined) this.ctx.webkitImageSmoothingEnabled = false;
    if (this.ctx.mozImageSmoothingEnabled !== undefined) this.ctx.mozImageSmoothingEnabled = false;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.image && this.image.complete && this.image.naturalWidth > 0) {
      this.ctx.drawImage(
        this.image,
        sx, sy, this.frameWidth, this.frameHeight,
        0, 0, this.canvas.width, this.canvas.height
      );
    }

    // Update scrubber & UI labels
    if (this.scrubber && document.activeElement !== this.scrubber) {
      this.scrubber.value = idx;
    }
    if (this.frameCounter) {
      this.frameCounter.textContent = `Frame: ${idx + 1} / ${this.frameCount}`;
    }
    if (this.frameTimestamp) {
      const sec = this.fps > 0 ? (idx / this.fps).toFixed(2) : '0.00';
      this.frameTimestamp.textContent = `${sec}s`;
    }
  }

  play() {
    this.isPlaying = true;
    if (this.playPauseIcon) this.playPauseIcon.textContent = '⏸';
    if (this.playPauseText) this.playPauseText.textContent = 'Pause';
    this.btnPlayPause?.setAttribute('title', 'Pause animation');

    this.lastTimestamp = performance.now();
    cancelAnimationFrame(this.animReqId);

    const loop = (timestamp) => {
      if (!this.isPlaying) return;
      const frameDuration = 1000 / Math.max(1, this.fps);
      const elapsed = timestamp - this.lastTimestamp;

      if (elapsed >= frameDuration) {
        const next = (this.currentFrame + 1) % this.frameCount;
        this.renderFrame(next);
        this.lastTimestamp = timestamp - (elapsed % frameDuration);
      }
      this.animReqId = requestAnimationFrame(loop);
    };

    this.animReqId = requestAnimationFrame(loop);
  }

  pause() {
    this.isPlaying = false;
    cancelAnimationFrame(this.animReqId);
    if (this.playPauseIcon) this.playPauseIcon.textContent = '▶';
    if (this.playPauseText) this.playPauseText.textContent = 'Play';
    this.btnPlayPause?.setAttribute('title', 'Play animation');
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  step(direction) {
    this.pause();
    const next = (this.currentFrame + direction + this.frameCount) % this.frameCount;
    this.renderFrame(next);
  }

  seek(frameIdx) {
    this.pause();
    this.renderFrame(frameIdx);
  }

  setFps(fps) {
    this.fps = Math.max(1, Math.min(60, Number(fps) || 8));
    if (this.fpsSlider) this.fpsSlider.value = this.fps;
    if (this.fpsBadge) this.fpsBadge.textContent = `${this.fps} FPS`;
    if (this.frameTimestamp) {
      const sec = (this.currentFrame / this.fps).toFixed(2);
      this.frameTimestamp.textContent = `${sec}s`;
    }
  }

  setZoom(zoom) {
    this.zoom = zoom;
    this.zoomButtons.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.zoom, 10) === zoom);
    });
    this.applyZoom(zoom);
  }

  applyZoom(zoom) {
    if (!this.canvas) return;
    const w = this.frameWidth * zoom;
    const h = this.frameHeight * zoom;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  setTheme(themeName) {
    this.currentTheme = themeName;
    this.themeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === themeName);
    });
    if (this.viewport) {
      this.viewport.className = `canvas-viewport theme-${themeName}`;
    }
  }
}

const animationPlayer = new SpriteAnimationPlayer();

function onJobDone(data) {
  setGenerating(false);
  statusSpinner.style.display = 'none';
  resultCard.hidden = false;
  const fullUrl = data.preview_url + '?t=' + Date.now();
  resultImg.src = fullUrl;
  downloadBtn.href = data.preview_url;
  downloadBtn.download = data.metadata?.image_file || 'sprite.png';
  resultMeta.textContent = JSON.stringify({
    name: data.metadata?.name,
    frames: data.metadata?.frame_count,
    grid: `${data.metadata?.rows}×${data.metadata?.columns}`,
    size: `${data.metadata?.frame_width}×${data.metadata?.frame_height}px`,
    fps: data.metadata?.fps || 8,
    provider: data.metadata?.source?.provider,
    duration: `${(data.duration_ms / 1000).toFixed(1)}s`,
  }, null, 2);

  // Mount animation previewer (AC 21.1)
  animationPlayer.mount(data.preview_url, data.metadata, data.metadata?.name);

  rerollBtn.onclick = () => {
    const seed = Math.floor(Math.random() * 4294967295);
    submitJob({ ...lastPromptData, seed });
  };

  loadGallery();
}

function onJobFailed(data) {
  setGenerating(false);
  statusSpinner.style.display = 'none';
  const msg = data.error?.message || 'Generation failed.';
  statusText.textContent = '❌ ' + msg;
  showError(msg);
}

// ── UI helpers ────────────────────────────────────────────────
function setGenerating(on) {
  generateBtn.disabled = on;
  btnText.hidden = on;
  btnLoader.hidden = !on;
}

function showResult() {
  resultSection.hidden = false;
  resultCard.hidden = true;
  statusSpinner.style.display = '';
  statusText.textContent = 'Submitting…';
  progressStages.innerHTML = '';
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() { resultSection.hidden = true; }

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
}

function hideError() { formError.hidden = true; }

// ── Gallery ───────────────────────────────────────────────────
async function loadGallery() {
  try {
    const resp = await fetch('/api/sprites');
    const sprites = await resp.json();
    if (!sprites.length) {
      galleryGrid.innerHTML = '<p class="gallery-empty">No sprites yet — generate one above!</p>';
      return;
    }
    galleryGrid.innerHTML = sprites.map(s => `
      <div class="gallery-item" data-name="${s.name}" title="Click to preview & animate">
        <img src="${s.image_url}?t=${Date.now()}" alt="${s.name}" loading="lazy">
        <div class="gallery-item-footer">
          <span class="gallery-item-name">${s.name}</span>
          <div class="gallery-item-actions">
            <button class="gallery-btn reroll-gallery" title="Re-roll">🎲</button>
            <button class="gallery-btn delete" title="Delete">🗑</button>
          </div>
        </div>
      </div>
    `).join('');

    // Mount and animate on clicking any gallery sprite (AC 21.6)
    galleryGrid.querySelectorAll('.gallery-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.gallery-btn')) return; // Ignore action button clicks

        const spriteName = item.dataset.name;
        const sprite = sprites.find(s => s.name === spriteName);
        if (!sprite) return;

        // Highlight selected gallery item
        galleryGrid.querySelectorAll('.gallery-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        // Reveal result section & card
        resultSection.hidden = false;
        resultCard.hidden = false;
        statusSpinner.style.display = 'none';
        statusText.textContent = `Previewing: ${sprite.name}`;
        progressStages.innerHTML = `<span class="stage-chip done">Ready</span>`;

        // Mount and animate in player
        animationPlayer.mount(sprite.image_url, sprite.metadata, sprite.name);

        // Update full sheet preview and download/meta
        resultImg.src = sprite.image_url;
        downloadBtn.href = sprite.image_url;
        downloadBtn.download = sprite.metadata?.image_file || `${sprite.name}.png`;
        resultMeta.textContent = JSON.stringify({
          name: sprite.name,
          frames: sprite.metadata?.frame_count,
          grid: `${sprite.metadata?.rows}×${sprite.metadata?.columns}`,
          size: `${sprite.metadata?.frame_width}×${sprite.metadata?.frame_height}px`,
          fps: sprite.metadata?.fps || 8,
          provider: sprite.metadata?.source?.provider,
          style: sprite.metadata?.source?.style,
          seed: sprite.metadata?.source?.seed,
        }, null, 2);

        rerollBtn.onclick = () => {
          if (sprite.metadata) {
            promptInput.value = sprite.metadata.source?.prompt || '';
            promptCount.textContent = promptInput.value.length;
            document.getElementById('style-select').value = sprite.metadata.source?.style || 'pixel_art';
            const grid = `${sprite.metadata.rows}x${sprite.metadata.columns}`;
            const radio = form.querySelector(`input[value="${grid}"]`);
            if (radio) {
              radio.checked = true;
              document.querySelectorAll('.grid-pill').forEach(p => p.classList.remove('active'));
              radio.closest('.grid-pill').classList.add('active');
            }
          }
          const seed = Math.floor(Math.random() * 4294967295);
          submitJob({ ...lastPromptData, seed });
        };

        // Smooth scroll to previewer
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    galleryGrid.querySelectorAll('.gallery-btn.delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = e.target.closest('.gallery-item');
        const name = item.dataset.name;
        if (!confirm(`Delete sprite "${name}"?`)) return;
        await fetch(`/api/sprites/${name}`, {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': csrfToken(), 'Origin': location.origin },
        });
        loadGallery();
      });
    });

    galleryGrid.querySelectorAll('.gallery-btn.reroll-gallery').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.gallery-item');
        const meta = sprites.find(s => s.name === item.dataset.name)?.metadata;
        if (!meta) return;
        promptInput.value = meta.source?.prompt || '';
        promptCount.textContent = promptInput.value.length;
        document.getElementById('style-select').value = meta.source?.style || 'pixel_art';
        const grid = `${meta.rows}x${meta.columns}`;
        const radio = form.querySelector(`input[value="${grid}"]`);
        if (radio) {
          radio.checked = true;
          document.querySelectorAll('.grid-pill').forEach(p => p.classList.remove('active'));
          radio.closest('.grid-pill').classList.add('active');
        }
        seedInput.value = Math.floor(Math.random() * 4294967295);
        form.dispatchEvent(new Event('submit'));
      });
    });
  } catch (_) {
    // Silent fail — gallery is optional
  }
}

refreshGallery.addEventListener('click', loadGallery);

// ── Init ──────────────────────────────────────────────────────
loadGallery();

