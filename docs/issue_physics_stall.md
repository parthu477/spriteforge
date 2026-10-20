## Bug Description
In the Physics Sandbox (`/physics`), the vehicle becomes completely immobilized on procedural hill slopes:
1. Pressing the **GAS** or **BRAKE** touch pedals (or keyboard keys W/D/ArrowRight) fails to move the car forward.
2. The vehicle tilts upward at an angle on the first slope and stalls with 0 km/h speed and 0 m distance, while fuel drains in the background (dropping to 70% while idle).
3. The car does not recover and remains permanently frozen.

## Root Cause Analysis

### 1. Severe Engine Drive Force Underpowering vs Downhill Gravity
In `frontend/js/physics-engine.js`:
- Vehicle mass = `350 kg`, gravity = `980 px/s²` -> Downward gravity force $F_g = 343,000\text{ N}$.
- On a hill slope ($\theta \approx 25^\circ$), downhill gravitational force component is $\approx 145,000\text{ N}$.
- Engine torque is set to `19,000 N·px`. With wheel radius $r = 16\text{ px}$, drive force is only:
  $$F_{\text{drive}} = \frac{19,000}{16} \approx 1,187.5\text{ N}$$
- The engine drive force ($1,187.5\text{ N}$) is **over 100× weaker** than the downhill gravity force ($145,000\text{ N}$), making it physically impossible for the vehicle to climb any procedural hill slope or move forward from a standstill on an incline.

### 2. Touch Pedal Pointer Event Premature Release
In `frontend/js/physics-game.js`:
- `setupPedal()` registers `pointerleave` without calling `el.setPointerCapture(e.pointerId)`.
- When clicking and holding either pedal with a mouse or touch drag, minor cursor movement across the pedal boundary immediately fires `pointerleave`, resetting `_touchState[type] = 0`.
- Furthermore, `pointerdown` invokes `e.preventDefault()`, which suppresses standard synthetic mouse events on desktop browsers.

### 3. Premature Roof Flip Collision & Input Lockup
- When climbing, rear suspension compression causes the chassis to pitch up.
- The rear roof corner `(-hw, -hh)` touches the slope surface behind the rear wheel, triggering `_checkCrash(terrain)`:
  ```js
  this.crashed = true;
  ```
- In `_handleInput()`:
  ```js
  if (c.crashed || this._gameOver) {
    c.throttle = 0;
    c.braking = false;
    return;
  }
  ```
- Once `c.crashed` is set, `Chassis.update()` completely aborts physics integration (`if (this.crashed) return;`), locking throttle and braking to zero and freezing the car permanently.

## Technical Specifications & Planned Fix

### 1. Rebalance Vehicle Dynamics & Drive Force
- Scale `engineTorque` to appropriately balance mass and slope resistance (e.g. `engineTorque: 120,000–180,000 N·px` or normalize force application relative to `mass * gravity * sin(slope)`).
- Ensure all-wheel drive (AWD) or rear-wheel drive where torque applies to `wheels[0]` (rear wheel) which maintains ground contact during uphill acceleration, rather than front wheel `wheels[1]`.

### 2. Robust Pointer Capture for Touch Pedals
- Add pointer capture to `setupPedal`:
  ```js
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    press();
  });
  el.addEventListener('pointerup', e => {
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    release();
  });
  ```
- Remove fragile `pointerleave` cancellations when pointer is captured.

### 3. Slope Ground Clearance & Robust Crash Detection
- Increase ground clearance and elevate rear roof collision threshold during uphill pitch angles ($\theta < 75^\circ$) so steep hill climbs do not register as fatal crashes.
- Ensure that if a crash occurs, the game over overlay surfaces immediately with an option to restart (`[R]`), rather than hanging silently with zeroed throttle.

## Target Files
- `frontend/js/physics-engine.js`
- `frontend/js/physics-game.js`
- `frontend/physics.html`

## Acceptance Criteria
- [ ] Clicking and holding the **GAS** pedal or pressing `W`/`D`/`ArrowUp`/`ArrowRight` reliably accelerates the vehicle forward over procedural hill slopes.
- [ ] Vehicle has sufficient torque and traction to climb normal and steep hills without stalling.
- [ ] Mouse clicks and touch presses on **GAS** and **BRAKE** pedals do not disconnect or cancel prematurely.
- [ ] Normal uphill driving does not falsely trigger roof collision crashes.
