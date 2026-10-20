## Feature Description
Add an in-game Pause and Resume controller across both sandboxes (`/game` Biome Sandbox and `/physics` Physics Sandbox), featuring a persistent quick-toggle button in the top-right corner of the canvas viewport and a glassmorphic pause overlay menu.

## Detailed Specifications

### 1. Top-Right Corner Floating Toggle Button
- Add a floating glassmorphic button in the top-right corner of the sandbox stage:
  - Default state: `[ ⏸ Pause ]`
  - Paused state: `[ ▶ Resume ]`
  - Position: `top: 18px; right: 18px; z-index: 25;`
  - Styling: Translucent glass pill (`backdrop-filter: blur(8px); background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15);`) with hover neon accent glow.

### 2. State Freeze & Engine Suspension
- When Pause is activated:
  - Set `this.isPaused = true`.
  - Pause physics updates and particle emission timers.
  - Halt engine audio sound loops (`audio.stopEngine()`, `audio.stopFuelAlert()`).
  - Cache `timestamp` so that when resumed, `dt` (delta time) does not experience a huge time-jump spike.

### 3. Glassmorphic Pause Overlay Menu
- When paused, render an elegant centered dialog:
  - Title: **Game Paused**
  - Current Stats Preview: Distance reached, Coins collected, Current Score.
  - Action Buttons:
    - Primary: `[ ▶ Resume Game ]`
    - Secondary: `[ 🔄 Restart Run [R] ]`
    - Tertiary: `[ 🔊 Toggle Sound ]`
    - Link: `[ 🎨 Change Car / Back to Studio ]`

### 4. Keyboard Shortcuts
- Pressing `Escape` or `KeyP` toggles pause / resume state immediately.
- Pressing `KeyR` while paused executes a clean restart.

## Target Files
- `frontend/game.html`
- `frontend/physics.html`
- `frontend/js/game-sandbox.js`
- `frontend/js/physics-game.js`
- `frontend/css/game.css`
- `frontend/css/physics-game.css`

## Acceptance Criteria
- [ ] A floating `[ ⏸ Pause ]` / `[ ▶ Resume ]` button is visible and clickable in the top-right corner of both sandbox stages.
- [ ] Clicking the button or pressing `Esc` / `P` cleanly freezes physics simulation, distance tracking, fuel consumption, and audio.
- [ ] Clicking `Resume` resumes the game seamlessly with no physics glitch or delta time jump.
- [ ] Pause menu options (Resume, Restart, Sound Toggle) operate reliably on touch and mouse.
