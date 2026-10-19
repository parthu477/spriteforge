/* ============================================================
   SpriteForge — app.js
   Frontend logic: form submission, job polling, gallery
   ============================================================ */
'use strict';

/**
 * Issue #45 — Cross-Origin Image Ingestion Helper
 * Prevents canvas tainting (SecurityError) when reading image data
 */
function loadSafeImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err || new Error(`Failed to load image from ${url}`));
    img.src = url;
  });
}
if (typeof window !== 'undefined') {
  window.loadSafeImage = loadSafeImage;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports.loadSafeImage = loadSafeImage;
}

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
const exportDropdown = document.getElementById('export-dropdown');
const exportDropdownBtn = document.getElementById('export-dropdown-btn');
const exportMenu = document.getElementById('export-menu');
const exportOptions = document.querySelectorAll('.export-option');
const rerollBtn = document.getElementById('reroll-btn');
const galleryGrid = document.getElementById('gallery-grid');
const refreshGallery = document.getElementById('refresh-gallery');
const randomSeedBtn = document.getElementById('random-seed-btn');
const seedInput = document.getElementById('seed-input');
const progressPercent = document.getElementById('progress-percent');
const progressEta = document.getElementById('progress-eta');
const progressBarFill = document.getElementById('progress-bar-fill');
const paletteSelect = document.getElementById('palette-select');
const outlineToggle = document.getElementById('outline-toggle');
const multiActionToggle = document.getElementById('multi-action-toggle');
const modeToggleCard = document.getElementById('mode-toggle-card');
const modeBadge = document.getElementById('mode-badge');
const stateMachinePreview = document.getElementById('state-machine-preview');
const stagePlaceholder = document.getElementById('stage-placeholder');
const toggleGalleryBtn = document.getElementById('toggle-gallery-btn');
const closeGalleryBtn = document.getElementById('close-gallery-btn');
const galleryDock = document.getElementById('gallery-dock');

// ── Char counter ──────────────────────────────────────────────
promptInput.addEventListener('input', () => {
  promptCount.textContent = promptInput.value.length;
});

// ── Grid pill & Multi-action toggle (AC 23.3) ──────────────────
document.querySelectorAll('.grid-pill input').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.grid-pill').forEach(p => p.classList.remove('active'));
    radio.closest('.grid-pill').classList.add('active');
    if (radio.value !== '4x4' && multiActionToggle?.checked) {
      multiActionToggle.checked = false;
      modeToggleCard?.classList.remove('active');
      if (modeBadge) modeBadge.hidden = true;
      if (stateMachinePreview) stateMachinePreview.hidden = true;
    }
  });
});

multiActionToggle?.addEventListener('change', () => {
  const isMulti = multiActionToggle.checked;
  modeToggleCard?.classList.toggle('active', isMulti);
  if (modeBadge) modeBadge.hidden = !isMulti;
  if (stateMachinePreview) stateMachinePreview.hidden = !isMulti;

  if (isMulti) {
    const radio4x4 = form.querySelector('input[name="grid"][value="4x4"]');
    if (radio4x4) {
      radio4x4.checked = true;
      document.querySelectorAll('.grid-pill').forEach(p => p.classList.remove('active'));
      radio4x4.closest('.grid-pill')?.classList.add('active');
    }
  }
});

// ── Random seed ───────────────────────────────────────────────
randomSeedBtn.addEventListener('click', () => {
  seedInput.value = Math.floor(Math.random() * 4294967295);
});

// ── Form submission & job streaming ───────────────────────────
let currentJobId = null;
let pollTimer = null;
let activeEventSource = null;
let lastPromptData = null;
let currentActiveSprite = {
  name: '',
  imageUrl: '',
  metadata: null,
};

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
  const multiAction = multiActionToggle?.checked || false;
  const grid = multiAction ? '4x4' : form.querySelector('input[name="grid"]:checked')?.value;
  const style = document.getElementById('style-select').value;
  const palette = paletteSelect?.value || 'original';
  const outline = outlineToggle?.checked || false;
  const name = document.getElementById('name-input').value.trim() || undefined;
  const seedVal = seedInput.value.trim();
  const seed = seedVal !== '' ? parseInt(seedVal, 10) : undefined;
  return {
    prompt,
    grid,
    style,
    ...(multiAction && { multi_action: true }),
    ...(palette && palette !== 'original' && { palette }),
    ...(outline && { outline: true }),
    ...(name && { name }),
    ...(seed !== undefined && { seed }),
  };
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
    trackJob(currentJobId);
  } catch (err) {
    setGenerating(false);
    showError('Network error: ' + err.message);
    hideResult();
  }
}

function cleanupTracking() {
  if (activeEventSource) {
    try {
      activeEventSource.close();
    } catch (_) {}
    activeEventSource = null;
  }
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function trackJob(jobId) {
  cleanupTracking();
  // AC 25.4: Use EventSource with fallback to HTTP polling
  if (typeof window.EventSource !== 'undefined') {
    startSSE(jobId);
  } else {
    pollJob(jobId);
  }
}

function startSSE(jobId) {
  let isDoneOrFailed = false;
  let es;
  try {
    es = new EventSource(`/api/jobs/${jobId}/stream`);
  } catch (err) {
    console.warn('Failed to construct EventSource, falling back to polling:', err);
    pollJob(jobId);
    return;
  }

  activeEventSource = es;

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateProgress(data);

      if (data.status === 'done') {
        isDoneOrFailed = true;
        cleanupTracking(); // AC 25.5: Close connection cleanly upon completion
        onJobDone(data);
      } else if (data.status === 'failed') {
        isDoneOrFailed = true;
        cleanupTracking(); // AC 25.5: Close connection cleanly upon failure
        onJobFailed(data);
      }
    } catch (parseErr) {
      console.error('Error parsing SSE event:', parseErr);
    }
  };

  es.onerror = (err) => {
    if (isDoneOrFailed) return;
    console.warn('SSE connection interrupted or dropped, falling back to HTTP polling.', err);
    cleanupTracking();
    // Graceful fallback to HTTP polling (AC 25.4)
    pollJob(jobId);
  };
}

function pollJob(jobId) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/jobs/${jobId}`);
      if (!resp.ok) {
        if (resp.status === 404) {
          onJobFailed({ error: { message: 'Job not found.' } });
          return;
        }
        pollJob(jobId);
        return;
      }
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
  const stageLabel = STAGE_LABELS[data.stage] || data.stage;
  const pct = Math.min(100, Math.max(0, Math.round(data.progress ?? 0)));

  if (data.status === 'done') {
    statusText.textContent = 'Complete!';
  } else if (data.status === 'failed') {
    statusText.textContent = 'Generation Failed';
  } else {
    statusText.textContent = `Stage: ${stageLabel}`;
  }

  if (progressPercent) {
    progressPercent.textContent = `${pct}%`;
  }
  if (progressBarFill) {
    progressBarFill.style.width = `${pct}%`;
    progressBarFill.setAttribute('aria-valuenow', pct);
  }

  if (progressEta) {
    const eta = data.eta_seconds ?? data.estimated_remaining_seconds;
    if (eta !== undefined && eta !== null && data.status !== 'done' && data.status !== 'failed') {
      const etaNum = parseFloat(eta);
      progressEta.textContent = etaNum > 0 ? `~${etaNum.toFixed(1)}s left` : '< 1s left';
      progressEta.hidden = false;
    } else {
      progressEta.hidden = true;
    }
  }

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
    this.actionTracksBar = document.getElementById('action-tracks-bar');
    this.actionTrackButtons = document.getElementById('action-track-buttons');

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
    this.animations = null;
    this.activeTrackName = null;
    this.activeTrack = null;

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

    loadSafeImage(imageUrl).then(img => {
      const fw = Number(metadata?.frame_width) || Math.floor(img.naturalWidth / columns) || 128;
      const fh = Number(metadata?.frame_height) || Math.floor(img.naturalHeight / rows) || 128;
      const totalFrames = Number(metadata?.frame_count) || (rows * columns) || 4;

      this.image = img;
      this.frameWidth = fw;
      this.frameHeight = fh;
      this.rows = rows;
      this.columns = columns;
      this.frameCount = Math.max(1, totalFrames);
      this.animations = metadata?.animations || null;
      this.activeTrackName = null;
      this.activeTrack = null;

      // Set canvas internal resolution to 1 frame size
      this.canvas.width = fw;
      this.canvas.height = fh;
      this.applyZoom(this.zoom);

      // Handle named animation tracks (US-23 AC 23.2, 23.4)
      if (this.animations && Object.keys(this.animations).length > 0) {
        this.renderActionTrackButtons();
        if (this.actionTracksBar) this.actionTracksBar.hidden = false;
        const initialTrack = this.animations.idle ? 'idle' : Object.keys(this.animations)[0];
        this.selectTrack(initialTrack);
      } else {
        if (this.actionTracksBar) this.actionTracksBar.hidden = true;
        this.activeTrack = null;
        if (this.scrubber) {
          this.scrubber.min = 0;
          this.scrubber.max = this.frameCount - 1;
          this.scrubber.value = 0;
        }
        this.currentFrame = 0;
        this.setFps(initialFps);
        this.renderFrame(0);
        this.play();
      }
    }).catch(err => {
      console.error('Failed to load sprite preview:', err);
    });
  }

  renderActionTrackButtons() {
    if (!this.actionTrackButtons || !this.animations) return;
    this.actionTrackButtons.innerHTML = Object.keys(this.animations).map(key => {
      const track = this.animations[key];
      return `<button type="button" class="btn-action-track" data-track="${key}" title="Row ${track.row} (${track.frames} frames, ${track.fps} FPS)">▶ ${key}</button>`;
    }).join('');

    this.actionTrackButtons.querySelectorAll('.btn-action-track').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectTrack(btn.dataset.track);
      });
    });
  }

  selectTrack(trackName) {
    if (!this.animations || !this.animations[trackName]) return;
    this.activeTrackName = trackName;
    this.activeTrack = this.animations[trackName];

    this.actionTrackButtons?.querySelectorAll('.btn-action-track').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.track === trackName);
    });

    this.frameCount = this.activeTrack.frames;
    if (this.scrubber) {
      this.scrubber.min = 0;
      this.scrubber.max = this.frameCount - 1;
      this.scrubber.value = 0;
    }
    this.currentFrame = 0;
    this.setFps(this.activeTrack.fps || 8);
    this.renderFrame(0);
    this.play();
  }

  renderFrame(frameIdx) {
    if (!this.canvas || !this.ctx) return;
    const idx = Math.max(0, Math.min(frameIdx, this.frameCount - 1));
    this.currentFrame = idx;

    let sx, sy;
    if (this.activeTrack) {
      const col = idx % this.columns;
      const row = this.activeTrack.row;
      sx = col * this.frameWidth;
      sy = row * this.frameHeight;
    } else {
      const col = idx % this.columns;
      const row = Math.floor(idx / this.columns);
      sx = col * this.frameWidth;
      sy = row * this.frameHeight;
    }

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
      const trackSuffix = this.activeTrackName ? ` (${this.activeTrackName})` : '';
      this.frameCounter.textContent = `Frame: ${idx + 1} / ${this.frameCount}${trackSuffix}`;
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
        let next;
        if (this.activeTrack && this.activeTrack.loop === false) {
          if (this.currentFrame >= this.frameCount - 1) {
            this.pause();
            return;
          }
          next = this.currentFrame + 1;
        } else {
          next = (this.currentFrame + 1) % this.frameCount;
        }
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
  cleanupTracking();
  setGenerating(false);
  closeExportMenu();
  statusSpinner.style.display = 'none';
  if (progressPercent) progressPercent.textContent = '100%';
  if (progressBarFill) progressBarFill.style.width = '100%';
  if (progressEta) progressEta.hidden = true;

  resultCard.hidden = false;
  const testDriveBtn = document.getElementById('test-drive-btn');
  if (testDriveBtn && data.metadata?.name) {
    testDriveBtn.href = `/physics?sprite=${encodeURIComponent(data.metadata.name)}`;
  }
  const fullUrl = data.preview_url + '?t=' + Date.now();
  resultImg.src = fullUrl;
  currentActiveSprite = {
    name: data.metadata?.name || 'sprite',
    imageUrl: data.preview_url,
    metadata: data.metadata,
  };
  resultMeta.textContent = JSON.stringify({
    name: data.metadata?.name,
    frames: data.metadata?.frame_count,
    grid: `${data.metadata?.rows}×${data.metadata?.columns}`,
    size: `${data.metadata?.frame_width}×${data.metadata?.frame_height}px`,
    fps: data.metadata?.fps || 8,
    palette: data.metadata?.source?.palette || 'original',
    outline: Boolean(data.metadata?.source?.outline),
    ...(data.metadata?.animations && {
      tracks: Object.keys(data.metadata.animations).join(', '),
      animations: data.metadata.animations,
    }),
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
  cleanupTracking();
  setGenerating(false);
  statusSpinner.style.display = 'none';
  if (progressEta) progressEta.hidden = true;
  const msg = data.error?.message || 'Generation failed.';
  statusText.textContent = '❌ ' + msg;
  showError(msg);
}

// ── UI helpers ────────────────────────────────────────────────
function setGenerating(on) {
  generateBtn.disabled = on;
  btnText.hidden = on;
  btnLoader.hidden = !on;
  if (on) closeExportMenu();
}

function showResult() {
  resultSection.hidden = false;
  if (stagePlaceholder) stagePlaceholder.hidden = true;
  resultCard.hidden = true;
  statusSpinner.style.display = '';
  statusText.textContent = 'Submitting…';
  if (progressPercent) progressPercent.textContent = '0%';
  if (progressBarFill) {
    progressBarFill.style.width = '0%';
    progressBarFill.setAttribute('aria-valuenow', 0);
  }
  if (progressEta) {
    progressEta.hidden = true;
    progressEta.textContent = '';
  }
  progressStages.innerHTML = '';
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() {
  resultSection.hidden = true;
  if (stagePlaceholder) stagePlaceholder.hidden = false;
}

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
            <button type="button" class="gallery-btn dispatch-physics" data-name="${s.name}" title="🚀 Send to Physics Sandbox">🚀</button>
            <button type="button" class="gallery-btn dispatch-biome" data-name="${s.name}" title="🎮 Send to Biome Sandbox">🎮</button>
            <button type="button" class="gallery-btn dispatch-both" data-name="${s.name}" title="⚡ Send to Both Sandboxes">⚡</button>
            <a href="/physics?sprite=${encodeURIComponent(s.name)}" target="_blank" class="gallery-btn drive" title="Drive in Physics Sandbox">🚗</a>
            <button class="gallery-btn reroll-gallery" title="Re-roll">🎲</button>
            <button class="gallery-btn delete" title="Delete">🗑</button>
          </div>
        </div>
      </div>
    `).join('');

    // Wire real-time dispatch buttons on each gallery item
    galleryGrid.querySelectorAll('.gallery-btn.dispatch-physics').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sprite = sprites.find(s => s.name === btn.dataset.name);
        if (!sprite) return;
        dispatchSpriteAsset('physics', {
          id: sprite.name + '_' + Date.now(),
          name: sprite.name,
          imageUrl: sprite.image_url,
          metadata: sprite.metadata || {},
          timestamp: Date.now(),
        });
      });
    });

    galleryGrid.querySelectorAll('.gallery-btn.dispatch-biome').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sprite = sprites.find(s => s.name === btn.dataset.name);
        if (!sprite) return;
        dispatchSpriteAsset('biome', {
          id: sprite.name + '_' + Date.now(),
          name: sprite.name,
          imageUrl: sprite.image_url,
          metadata: sprite.metadata || {},
          timestamp: Date.now(),
        });
      });
    });

    galleryGrid.querySelectorAll('.gallery-btn.dispatch-both').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sprite = sprites.find(s => s.name === btn.dataset.name);
        if (!sprite) return;
        dispatchSpriteAsset('both', {
          id: sprite.name + '_' + Date.now(),
          name: sprite.name,
          imageUrl: sprite.image_url,
          metadata: sprite.metadata || {},
          timestamp: Date.now(),
        });
      });
    });

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
        if (stagePlaceholder) stagePlaceholder.hidden = true;
        resultCard.hidden = false;
        closeExportMenu();
        const testDriveBtn = document.getElementById('test-drive-btn');
        if (testDriveBtn) {
          testDriveBtn.href = `/physics?sprite=${encodeURIComponent(sprite.name)}`;
        }
        statusSpinner.style.display = 'none';
        statusText.textContent = `Previewing: ${sprite.name}`;
        progressStages.innerHTML = `<span class="stage-chip done">Ready</span>`;

        // Mount and animate in player
        animationPlayer.mount(sprite.image_url, sprite.metadata, sprite.name);

        // Update full sheet preview and active sprite
        currentActiveSprite = {
          name: sprite.name,
          imageUrl: sprite.image_url,
          metadata: sprite.metadata,
        };
        resultImg.src = sprite.image_url;
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
            if (paletteSelect && sprite.metadata.source?.palette) {
              paletteSelect.value = sprite.metadata.source.palette;
            }
            if (outlineToggle) {
              outlineToggle.checked = Boolean(sprite.metadata.source?.outline);
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
        if (paletteSelect && meta.source?.palette) {
          paletteSelect.value = meta.source.palette;
        }
        if (outlineToggle) {
          outlineToggle.checked = Boolean(meta.source?.outline);
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

// ── Export Dropdown Logic (US-24, AC 24.5) ─────────────────────
function openExportMenu() {
  if (!exportMenu || !exportDropdownBtn) return;
  exportMenu.hidden = false;
  exportDropdownBtn.setAttribute('aria-expanded', 'true');
}

function closeExportMenu() {
  if (!exportMenu || !exportDropdownBtn) return;
  exportMenu.hidden = true;
  exportDropdownBtn.setAttribute('aria-expanded', 'false');
}

function toggleExportMenu() {
  if (!exportMenu) return;
  if (exportMenu.hidden) {
    openExportMenu();
  } else {
    closeExportMenu();
  }
}

function downloadExport(format) {
  if (!currentActiveSprite || !currentActiveSprite.name) return;
  const spriteName = currentActiveSprite.name;
  const exportUrl = `/api/sprites/${encodeURIComponent(spriteName)}/export/${format}`;

  const a = document.createElement('a');
  a.href = exportUrl;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

exportDropdownBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleExportMenu();
});

exportOptions?.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const format = btn.dataset.format;
    downloadExport(format);
    closeExportMenu();
  });
});

document.addEventListener('click', (e) => {
  if (!exportDropdown?.contains(e.target)) {
    closeExportMenu();
  }
});

// ── Cross-Window Asset Communication Bus ────────────────────────
const ASSET_BUS_CHANNEL = 'spriteforge_asset_bus';
const ASSET_QUEUE_KEY = 'spriteforge_dispatched_assets';
const ASSET_FALLBACK_EVENT_KEY = 'spriteforge_bus_event';
const MAX_QUEUE_ITEMS = 50;

/**
 * Dispatch an asset to open or future sandboxes via BroadcastChannel + storage fallback.
 * @param {'physics'|'biome'|'both'} target
 * @param {Object} asset
 */
function dispatchSpriteAsset(target, asset) {
  if (!asset || !asset.name || !asset.imageUrl) {
    showToast('No valid sprite selected to dispatch!', 'warning', '⚠️');
    return;
  }

  const payload = {
    type: 'ASSET_DISPATCH',
    target: target,
    asset: {
      id: asset.id || ('sf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
      name: asset.name,
      imageUrl: asset.imageUrl,
      metadata: asset.metadata || {},
      timestamp: asset.timestamp || Date.now(),
      userId: asset.userId,
    },
  };

  // 1. Persistent FIFO queue in localStorage (max 50 items)
  try {
    let queue = [];
    const stored = localStorage.getItem(ASSET_QUEUE_KEY);
    if (stored) {
      queue = JSON.parse(stored);
      if (!Array.isArray(queue)) queue = [];
    }
    // Filter any duplicate entry with identical ID or name to prevent duplicates
    queue = queue.filter(item => item?.asset?.id !== payload.asset.id && item?.asset?.name !== payload.asset.name);
    // Unshift so latest item is at index 0 (FIFO queue retaining newest 50)
    queue.unshift(payload);
    if (queue.length > MAX_QUEUE_ITEMS) {
      queue.length = MAX_QUEUE_ITEMS;
    }
    localStorage.setItem(ASSET_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('Failed to persist dispatched asset in localStorage:', err);
  }

  // 2. Real-time BroadcastChannel broadcast
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(ASSET_BUS_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    } catch (err) {
      console.warn('BroadcastChannel error, falling back to storage listener:', err);
    }
  }

  // 3. Fault-tolerant fallback: localStorage storage event
  try {
    localStorage.setItem(ASSET_FALLBACK_EVENT_KEY, JSON.stringify({
      payload,
      nonce: Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    }));
  } catch (err) {
    console.warn('Storage fallback event error:', err);
  }

  // 4. Animated Toast Notification
  const targetName = target === 'both' ? 'Both Sandboxes' : target === 'physics' ? 'Physics Sandbox' : 'Biome Sandbox';
  const icon = target === 'both' ? '⚡' : target === 'physics' ? '🚀' : '🎮';
  showToast(`Dispatched "${payload.asset.name}" to ${targetName}!`, 'success', icon);
}

/**
 * Animated Toast Notification component
 * @param {string} message
 * @param {'success'|'warning'|'info'|'error'} type
 * @param {string} icon
 */
function showToast(message, type = 'success', icon = '🚀') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `sf-toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">
      <div class="toast-title">Asset Dispatched</div>
      <div class="toast-msg">${message}</div>
    </div>
    <button type="button" class="toast-close" aria-label="Close notification">&times;</button>
  `;

  container.appendChild(toast);

  // Trigger CSS enter transition
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  const dismiss = () => {
    if (!toast.parentNode) return;
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  };

  toast.querySelector('.toast-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
  });

  setTimeout(dismiss, 3500);
}

// ── Wire Result Card Dispatch Buttons ──────────────────────────
const dispatchPhysicsBtn = document.getElementById('dispatch-physics-btn');
const dispatchBiomeBtn   = document.getElementById('dispatch-biome-btn');
const dispatchBothBtn    = document.getElementById('dispatch-both-btn');

dispatchPhysicsBtn?.addEventListener('click', () => {
  if (!currentActiveSprite || !currentActiveSprite.imageUrl) {
    showToast('Generate or select a sprite first!', 'warning', '⚠️');
    return;
  }
  dispatchSpriteAsset('physics', currentActiveSprite);
});

dispatchBiomeBtn?.addEventListener('click', () => {
  if (!currentActiveSprite || !currentActiveSprite.imageUrl) {
    showToast('Generate or select a sprite first!', 'warning', '⚠️');
    return;
  }
  dispatchSpriteAsset('biome', currentActiveSprite);
});

dispatchBothBtn?.addEventListener('click', () => {
  if (!currentActiveSprite || !currentActiveSprite.imageUrl) {
    showToast('Generate or select a sprite first!', 'warning', '⚠️');
    return;
  }
  dispatchSpriteAsset('both', currentActiveSprite);
});

toggleGalleryBtn?.addEventListener('click', () => {
  galleryDock?.classList.toggle('drawer-open');
});

closeGalleryBtn?.addEventListener('click', () => {
  galleryDock?.classList.remove('drawer-open');
});

// ── Init ──────────────────────────────────────────────────────
if (stagePlaceholder && resultSection) {
  stagePlaceholder.hidden = !resultSection.hidden;
}
loadGallery();


