/* ============================================================
   SpriteForge — auth.js
   Issue #47: Interactive "Log in to Continue" Modal & Onboarding
   ChatGPT / Gemini-style auth UX with draft preservation
   ============================================================ */
'use strict';

const SpriteForgeAuth = (() => {
  // ── State ──────────────────────────────────────────────────
  let _user = null;           // { username, ... } or null
  let _pendingAction = null;  // { type, data } — preserved draft
  let _modalEl = null;
  let _backdropEl = null;
  let _isInitialized = false;

  // Actions that require authentication
  const GATED_ACTIONS = ['generate', 'export', 'reroll', 'test-drive', 'save'];

  // ── API helpers ────────────────────────────────────────────
  async function _apiJson(url, method = 'GET', body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const data = await resp.json();
    return { ok: resp.ok, status: resp.status, data };
  }

  async function checkSession() {
    try {
      const { ok, data } = await _apiJson('/api/auth/me');
      if (ok && data.authenticated) {
        _user = data.user;
        _updateNavbarUser();
        return true;
      }
    } catch (_) {}
    _user = null;
    _updateNavbarUser();
    return false;
  }

  async function login(username, password) {
    const { ok, data } = await _apiJson('/api/auth/login', 'POST', { username, password });
    if (ok) {
      _user = data.user;
      _updateNavbarUser();
    }
    return { ok, data };
  }

  async function register(username, password) {
    const { ok, data } = await _apiJson('/api/auth/register', 'POST', { username, password });
    if (ok) {
      _user = data.user;
      _updateNavbarUser();
    }
    return { ok, data };
  }

  async function logout() {
    await _apiJson('/api/auth/logout', 'POST');
    _user = null;
    _updateNavbarUser();
  }

  // ── Navbar User Menu ──────────────────────────────────────
  function _updateNavbarUser() {
    const container = document.getElementById('auth-nav-container');
    if (!container) return;

    if (_user) {
      const initial = _user.username.charAt(0).toUpperCase();
      container.innerHTML = `
        <div class="auth-user-pill" id="auth-user-pill">
          <span class="auth-avatar">${initial}</span>
          <span class="auth-username">${_escHtml(_user.username)}</span>
          <span class="auth-chevron">▾</span>
        </div>
        <div class="auth-user-menu" id="auth-user-menu" hidden>
          <div class="auth-menu-header">
            <span class="auth-menu-avatar">${initial}</span>
            <div class="auth-menu-info">
              <span class="auth-menu-name">${_escHtml(_user.username)}</span>
              <span class="auth-menu-badge">✨ Creator</span>
            </div>
          </div>
          <div class="auth-menu-divider"></div>
          <button class="auth-menu-item" id="auth-logout-btn">
            <span>🚪</span> Sign Out
          </button>
        </div>
      `;

      const pill = container.querySelector('#auth-user-pill');
      const menu = container.querySelector('#auth-user-menu');
      const logoutBtn = container.querySelector('#auth-logout-btn');

      pill?.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      });

      logoutBtn?.addEventListener('click', async () => {
        await logout();
        menu.hidden = true;
      });

      document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
          menu.hidden = true;
        }
      });
    } else {
      container.innerHTML = `
        <button class="auth-sign-in-btn" id="auth-nav-sign-in">
          <span class="auth-sign-in-icon">👤</span>
          <span>Sign In</span>
        </button>
      `;
      container.querySelector('#auth-nav-sign-in')?.addEventListener('click', () => {
        showModal();
      });
    }
  }

  // ── Modal Creation ────────────────────────────────────────
  function _createModal() {
    if (_modalEl) return;

    // Backdrop
    _backdropEl = document.createElement('div');
    _backdropEl.className = 'auth-backdrop';
    _backdropEl.addEventListener('click', (e) => {
      if (e.target === _backdropEl) hideModal();
    });

    // Modal
    _modalEl = document.createElement('div');
    _modalEl.className = 'auth-modal';
    _modalEl.setAttribute('role', 'dialog');
    _modalEl.setAttribute('aria-modal', 'true');
    _modalEl.setAttribute('aria-label', 'Sign in to SpriteForge');

    _modalEl.innerHTML = `
      <button class="auth-modal-close" id="auth-modal-close" aria-label="Close" title="Close">✕</button>

      <!-- Draft preserved banner -->
      <div class="auth-draft-banner" id="auth-draft-banner" hidden>
        <span class="auth-draft-icon">💾</span>
        <span class="auth-draft-text">Your work is saved! Sign in to continue.</span>
      </div>

      <!-- Header -->
      <div class="auth-modal-header">
        <div class="auth-modal-brand">
          <span class="auth-brand-glow">⚡</span>
          <span class="auth-brand-text">SpriteForge</span>
        </div>
        <h2 class="auth-modal-title" id="auth-modal-title">Welcome back</h2>
        <p class="auth-modal-subtitle" id="auth-modal-subtitle">Sign in to start generating AI sprites</p>
      </div>

      <!-- Tab Switcher -->
      <div class="auth-tabs" role="tablist">
        <button class="auth-tab active" role="tab" data-tab="login" id="auth-tab-login" aria-selected="true">Sign In</button>
        <button class="auth-tab" role="tab" data-tab="register" id="auth-tab-register" aria-selected="false">Create Account</button>
        <div class="auth-tab-indicator" id="auth-tab-indicator"></div>
      </div>

      <!-- Login Form -->
      <form class="auth-form" id="auth-form-login" autocomplete="on">
        <div class="auth-field">
          <label class="auth-label" for="auth-login-user">Username</label>
          <div class="auth-input-wrap">
            <span class="auth-input-icon">👤</span>
            <input type="text" id="auth-login-user" class="auth-input" placeholder="Enter your username" required minlength="3" autocomplete="username">
          </div>
        </div>
        <div class="auth-field">
          <label class="auth-label" for="auth-login-pass">Password</label>
          <div class="auth-input-wrap">
            <span class="auth-input-icon">🔒</span>
            <input type="password" id="auth-login-pass" class="auth-input" placeholder="Enter your password" required minlength="6" autocomplete="current-password">
            <button type="button" class="auth-toggle-pass" data-target="auth-login-pass" aria-label="Toggle password visibility">👁</button>
          </div>
        </div>
        <div class="auth-error" id="auth-login-error" role="alert" hidden></div>
        <button type="submit" class="auth-submit-btn" id="auth-login-submit">
          <span class="auth-submit-text">Sign In</span>
          <span class="auth-submit-loader" hidden></span>
        </button>
      </form>

      <!-- Register Form -->
      <form class="auth-form" id="auth-form-register" hidden autocomplete="on">
        <div class="auth-field">
          <label class="auth-label" for="auth-reg-user">Username</label>
          <div class="auth-input-wrap">
            <span class="auth-input-icon">👤</span>
            <input type="text" id="auth-reg-user" class="auth-input" placeholder="Choose a username" required minlength="3" autocomplete="username">
          </div>
        </div>
        <div class="auth-field">
          <label class="auth-label" for="auth-reg-pass">Password</label>
          <div class="auth-input-wrap">
            <span class="auth-input-icon">🔒</span>
            <input type="password" id="auth-reg-pass" class="auth-input" placeholder="At least 6 characters" required minlength="6" autocomplete="new-password">
            <button type="button" class="auth-toggle-pass" data-target="auth-reg-pass" aria-label="Toggle password visibility">👁</button>
          </div>
        </div>
        <div class="auth-field">
          <label class="auth-label" for="auth-reg-pass2">Confirm Password</label>
          <div class="auth-input-wrap">
            <span class="auth-input-icon">🔒</span>
            <input type="password" id="auth-reg-pass2" class="auth-input" placeholder="Re-enter password" required minlength="6" autocomplete="new-password">
            <button type="button" class="auth-toggle-pass" data-target="auth-reg-pass2" aria-label="Toggle password visibility">👁</button>
          </div>
        </div>
        <div class="auth-error" id="auth-register-error" role="alert" hidden></div>
        <button type="submit" class="auth-submit-btn" id="auth-register-submit">
          <span class="auth-submit-text">Create Account</span>
          <span class="auth-submit-loader" hidden></span>
        </button>
      </form>

      <!-- Footer -->
      <div class="auth-modal-footer">
        <p class="auth-footer-text" id="auth-footer-toggle-text">
          Don't have an account? <button class="auth-link-btn" id="auth-footer-toggle">Create one</button>
        </p>
      </div>
    `;

    _backdropEl.appendChild(_modalEl);
    document.body.appendChild(_backdropEl);

    // ── Wire up modal interactions ──────────────────────────
    _modalEl.querySelector('#auth-modal-close').addEventListener('click', hideModal);

    // Tab switching
    _modalEl.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => _switchTab(tab.dataset.tab));
    });

    // Footer toggle
    _modalEl.querySelector('#auth-footer-toggle').addEventListener('click', () => {
      const loginTab = _modalEl.querySelector('#auth-tab-login');
      const isLogin = loginTab.classList.contains('active');
      _switchTab(isLogin ? 'register' : 'login');
    });

    // Password toggle
    _modalEl.querySelectorAll('.auth-toggle-pass').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (input) {
          input.type = input.type === 'password' ? 'text' : 'password';
          btn.textContent = input.type === 'password' ? '👁' : '🙈';
        }
      });
    });

    // Login form
    _modalEl.querySelector('#auth-form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = _modalEl.querySelector('#auth-login-error');
      const submitBtn = _modalEl.querySelector('#auth-login-submit');
      errorEl.hidden = true;

      const username = _modalEl.querySelector('#auth-login-user').value.trim();
      const password = _modalEl.querySelector('#auth-login-pass').value;

      if (!username || !password) {
        _showFormError(errorEl, 'Please fill in all fields.');
        return;
      }

      _setSubmitting(submitBtn, true);
      const { ok, data } = await login(username, password);
      _setSubmitting(submitBtn, false);

      if (ok) {
        _onAuthSuccess();
      } else {
        _showFormError(errorEl, data.message || 'Login failed. Please try again.');
      }
    });

    // Register form
    _modalEl.querySelector('#auth-form-register').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = _modalEl.querySelector('#auth-register-error');
      const submitBtn = _modalEl.querySelector('#auth-register-submit');
      errorEl.hidden = true;

      const username = _modalEl.querySelector('#auth-reg-user').value.trim();
      const password = _modalEl.querySelector('#auth-reg-pass').value;
      const password2 = _modalEl.querySelector('#auth-reg-pass2').value;

      if (!username || !password || !password2) {
        _showFormError(errorEl, 'Please fill in all fields.');
        return;
      }
      if (password !== password2) {
        _showFormError(errorEl, 'Passwords do not match.');
        return;
      }
      if (username.length < 3) {
        _showFormError(errorEl, 'Username must be at least 3 characters.');
        return;
      }
      if (password.length < 6) {
        _showFormError(errorEl, 'Password must be at least 6 characters.');
        return;
      }

      _setSubmitting(submitBtn, true);
      const { ok, data } = await register(username, password);
      _setSubmitting(submitBtn, false);

      if (ok) {
        _onAuthSuccess();
      } else {
        _showFormError(errorEl, data.message || 'Registration failed. Please try again.');
      }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _backdropEl && !_backdropEl.hidden) {
        hideModal();
      }
    });
  }

  function _switchTab(tab) {
    const loginTab = _modalEl.querySelector('#auth-tab-login');
    const registerTab = _modalEl.querySelector('#auth-tab-register');
    const loginForm = _modalEl.querySelector('#auth-form-login');
    const registerForm = _modalEl.querySelector('#auth-form-register');
    const title = _modalEl.querySelector('#auth-modal-title');
    const subtitle = _modalEl.querySelector('#auth-modal-subtitle');
    const footerText = _modalEl.querySelector('#auth-footer-toggle-text');
    const footerBtn = _modalEl.querySelector('#auth-footer-toggle');
    const indicator = _modalEl.querySelector('#auth-tab-indicator');

    // Hide errors
    _modalEl.querySelectorAll('.auth-error').forEach(el => el.hidden = true);

    if (tab === 'login') {
      loginTab.classList.add('active');
      loginTab.setAttribute('aria-selected', 'true');
      registerTab.classList.remove('active');
      registerTab.setAttribute('aria-selected', 'false');
      loginForm.hidden = false;
      registerForm.hidden = true;
      title.textContent = 'Welcome back';
      subtitle.textContent = 'Sign in to start generating AI sprites';
      footerText.innerHTML = `Don't have an account? <button class="auth-link-btn" id="auth-footer-toggle">Create one</button>`;
      indicator.style.transform = 'translateX(0)';
    } else {
      registerTab.classList.add('active');
      registerTab.setAttribute('aria-selected', 'true');
      loginTab.classList.remove('active');
      loginTab.setAttribute('aria-selected', 'false');
      loginForm.hidden = true;
      registerForm.hidden = false;
      title.textContent = 'Create your account';
      subtitle.textContent = 'Join SpriteForge and start creating';
      footerText.innerHTML = `Already have an account? <button class="auth-link-btn" id="auth-footer-toggle">Sign in</button>`;
      indicator.style.transform = 'translateX(100%)';
    }

    // Re-wire footer toggle
    _modalEl.querySelector('#auth-footer-toggle')?.addEventListener('click', () => {
      _switchTab(tab === 'login' ? 'register' : 'login');
    });
  }

  function _showFormError(el, msg) {
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('auth-error-shake');
    setTimeout(() => el.classList.remove('auth-error-shake'), 500);
  }

  function _setSubmitting(btn, loading) {
    const text = btn.querySelector('.auth-submit-text');
    const loader = btn.querySelector('.auth-submit-loader');
    if (loading) {
      btn.disabled = true;
      text.hidden = true;
      loader.hidden = false;
    } else {
      btn.disabled = false;
      text.hidden = false;
      loader.hidden = true;
    }
  }

  function _onAuthSuccess() {
    // Show success micro-animation
    if (_modalEl) {
      _modalEl.classList.add('auth-modal-success');
    }

    setTimeout(() => {
      hideModal();
      // Replay pending action
      if (_pendingAction) {
        _replayAction(_pendingAction);
        _pendingAction = null;
      }
    }, 600);
  }

  // ── Draft Preservation & Action Replay ────────────────────
  function _captureFormDraft() {
    const prompt = document.getElementById('prompt-input')?.value || '';
    const name = document.getElementById('name-input')?.value || '';
    const style = document.getElementById('style-select')?.value || '';
    const seed = document.getElementById('seed-input')?.value || '';
    const grid = document.querySelector('input[name="grid"]:checked')?.value || '';
    return { prompt, name, style, seed, grid };
  }

  function _replayAction(action) {
    switch (action.type) {
      case 'generate': {
        const form = document.getElementById('generate-form');
        if (form) {
          // Restore draft if we have it
          if (action.data?.draft) {
            const d = action.data.draft;
            const promptInput = document.getElementById('prompt-input');
            if (promptInput && d.prompt) promptInput.value = d.prompt;
          }
          // Re-submit
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
        break;
      }
      case 'export': {
        const exportBtn = document.getElementById('export-dropdown-btn');
        if (exportBtn) exportBtn.click();
        break;
      }
      case 'reroll': {
        const rerollBtn = document.getElementById('reroll-btn');
        if (rerollBtn) rerollBtn.click();
        break;
      }
      case 'test-drive': {
        const driveBtn = document.getElementById('test-drive-btn');
        if (driveBtn) window.open(driveBtn.href, '_blank');
        break;
      }
      default:
        break;
    }
  }

  // ── Action Gating ─────────────────────────────────────────
  function requireAuth(actionType, actionData = {}) {
    if (_user) return true; // Already authenticated

    // Capture draft
    const draft = _captureFormDraft();
    _pendingAction = { type: actionType, data: { ...actionData, draft } };

    // Show modal with draft banner
    showModal({ showDraft: draft.prompt?.length > 0 });
    return false;
  }

  // ── Modal Show / Hide ─────────────────────────────────────
  function showModal(opts = {}) {
    _createModal();

    // Reset forms
    _modalEl.querySelectorAll('.auth-form').forEach(f => f.reset());
    _modalEl.querySelectorAll('.auth-error').forEach(el => el.hidden = true);
    _modalEl.classList.remove('auth-modal-success');

    // Draft banner
    const banner = _modalEl.querySelector('#auth-draft-banner');
    if (banner) banner.hidden = !opts.showDraft;

    // Switch to login tab
    _switchTab('login');

    // Show
    _backdropEl.hidden = false;
    requestAnimationFrame(() => {
      _backdropEl.classList.add('auth-backdrop-visible');
      _modalEl.classList.add('auth-modal-visible');
    });

    // Focus first input
    setTimeout(() => {
      _modalEl.querySelector('#auth-login-user')?.focus();
    }, 200);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  function hideModal() {
    if (!_backdropEl) return;
    _backdropEl.classList.remove('auth-backdrop-visible');
    _modalEl.classList.remove('auth-modal-visible');
    setTimeout(() => {
      _backdropEl.hidden = true;
      document.body.style.overflow = '';
    }, 300);
  }

  // ── Intercept Gated Actions ───────────────────────────────
  function _interceptActions() {
    // Intercept Generate Sprite form
    const form = document.getElementById('generate-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        if (!_user) {
          e.preventDefault();
          e.stopImmediatePropagation();
          requireAuth('generate');
        }
      }, true); // Capture phase — runs BEFORE app.js handler
    }

    // Intercept Export dropdown
    const exportBtn = document.getElementById('export-dropdown-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', (e) => {
        if (!_user) {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
          requireAuth('export');
        }
      }, true);
    }

    // Intercept Re-roll
    const rerollBtn = document.getElementById('reroll-btn');
    if (rerollBtn) {
      rerollBtn.addEventListener('click', (e) => {
        if (!_user) {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
          requireAuth('reroll');
        }
      }, true);
    }

    // Intercept Test Drive
    const driveBtn = document.getElementById('test-drive-btn');
    if (driveBtn) {
      driveBtn.addEventListener('click', (e) => {
        if (!_user) {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
          requireAuth('test-drive');
        }
      }, true);
    }
  }

  // ── Utilities ─────────────────────────────────────────────
  function _escHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function isAuthenticated() {
    return !!_user;
  }

  function getUser() {
    return _user;
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    if (_isInitialized) return;
    _isInitialized = true;
    await checkSession();
    _interceptActions();
  }

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public API ────────────────────────────────────────────
  return {
    init,
    checkSession,
    login,
    register,
    logout,
    requireAuth,
    isAuthenticated,
    getUser,
    showModal,
    hideModal,
  };
})();
