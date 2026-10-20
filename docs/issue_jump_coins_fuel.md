## Feature Description
Enhance core gameplay across both sandboxes (`/game` Biome Sandbox and `/physics` Physics Sandbox) by implementing a car jump action, replacing static collectible limits with infinite procedural generation, and rebalancing fuel endurance so players can enjoy continuous driving until a physical crash occurs.

## Detailed Specifications

### 1. Car Jump Mechanic (Keyboard + On-Screen Control)
- **Controls**:
  - Keyboard: `Space` key triggers jump while vehicle is on the ground.
  - On-Screen Touch / Mouse: Add a dedicated `[ 🚀 JUMP ]` button in the pedals control bar alongside `BRAKE` and `GAS`.
- **Physics & Visual Feedback**:
  - When triggered on the ground, apply an immediate vertical impulse:
    - Biome Sandbox: `car.vy = -380 px/s; car.onGround = false;`
    - Physics Sandbox: `c.vel.y = -520 px/s; c.onGround = false;`
  - Emit upward dust/exhaust burst particles from rear wheels.
  - Play retro jump / spring sound FX.

### 2. Infinite Procedural Coins (Replacing 20-Coin Limit)
- **Current Limitation**: Currently, `_spawnCoins()` only spawns 20 coins statically, causing all collectibles to disappear after driving ~300 meters.
- **Infinite Chunk Spawning**:
  - Dynamically generate coin clusters ahead of the player as `cameraX` advances.
  - Formations:
    - Rolling hill contours: following terrain height curves.
    - Jump arches: curved arc formations over hill crests and ramps.
    - Bonus Star Coins (+100 pts) at high altitudes rewarding mid-air jumps.
  - Automatically cull collected or off-screen coins behind the camera (`wx < cameraX - 500`) to maintain peak performance with zero memory leaks.

### 3. Extended Fuel Endurance (Drive Until Driver Crashes)
- **Current Limitation**: Currently, `_spawnFuelCans()` only spawns 8 static canisters, and high drain rates cause fuel starvation at ~300 meters.
- **Endurance Rebalancing**:
  - Decrease baseline idle fuel consumption rate (from 1.2%/s down to 0.4%/s).
  - Dynamically spawn red fuel canisters procedurally every 250–350 meters ahead of the player, ensuring skilled drivers can keep driving indefinitely.
  - Fuel only terminates the run if the player deliberately avoids canisters or fails to maintain momentum.

## Target Files
- `frontend/js/game-sandbox.js`
- `frontend/js/physics-game.js`
- `frontend/game.html`
- `frontend/physics.html`
- `frontend/css/game.css`
- `frontend/css/physics-game.css`

## Acceptance Criteria
- [ ] Pressing `Space` or clicking the on-screen `[ JUMP ]` pedal makes the vehicle jump smoothly off the ground.
- [ ] Coins spawn continuously and infinitely as the player drives forward beyond 1,000+ meters.
- [ ] Fuel canisters spawn procedurally at fair intervals, allowing continuous driving until an actual crash or flip occurs.
- [ ] Off-screen collectibles are pruned from memory to avoid performance degradation.
