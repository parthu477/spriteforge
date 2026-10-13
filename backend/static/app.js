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

function onJobDone(data) {
  setGenerating(false);
  statusSpinner.style.display = 'none';
  resultCard.hidden = false;
  resultImg.src = data.preview_url + '?t=' + Date.now();
  downloadBtn.href = data.preview_url;
  downloadBtn.download = data.metadata?.image_file || 'sprite.png';
  resultMeta.textContent = JSON.stringify({
    frames: data.metadata?.frame_count,
    grid: `${data.metadata?.rows}×${data.metadata?.columns}`,
    size: `${data.metadata?.frame_width}×${data.metadata?.frame_height}px`,
    provider: data.metadata?.source?.provider,
    duration: `${(data.duration_ms / 1000).toFixed(1)}s`,
  }, null, 2);

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
      <div class="gallery-item" data-name="${s.name}">
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

    galleryGrid.querySelectorAll('.gallery-btn.delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
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
