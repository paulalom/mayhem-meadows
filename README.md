# Mayhem Meadows

**A tiny town. Terrible errands. Excellent bad decisions.**

A for-fun, original, GTA-inspired top-down driving sandbox. Borrow a car, run silly errands, scatter confetti, and lose the overenthusiastic Fun Police. Residents yell fake curses and recover from cartoon tumbles.

## Play

Open **index.html** in Chrome. The game uses local HTML, CSS, JavaScript, procedurally drawn art, and synthesized sound. No installation, backend, external assets, or account is required.

Alternatively, with Node.js installed:

```sh
npm start
```

Then open **http://127.0.0.1:4173** in Chrome. This optional server only serves static files on your computer. All game logic runs in the browser.

The first prototype targets desktop keyboards. Its layout adapts to small screens, but touch controls and gamepads are not implemented.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Walk; accelerate, brake/reverse, and steer a car |
| E | Borrow/exit a nearby car; use the car wash |
| Space | Handbrake/drift in a car; confetti popper on foot |
| Shift | Boost in a car; sprint on foot |
| H | Horn; start a party at a party mission ring |
| R | Recover to a safe road position |
| P / Esc | Pause/resume |
| Pointer | Aim the on-foot confetti popper |

Click the game canvas if keyboard focus has moved away from it. Changing tabs or windows pauses the game; resume with the button. Sound and reduced motion controls are in the header.

## The toybox

- **Driving:** compact, sports car, and van handling; traffic; forgiving impacts; drifting and near-miss style points.
- **Disco Delivery:** reach pickup, then deliver the imaginary disco ball.
- **Checkpoint Dash:** drive through a sequence of glowing rings.
- **Party Route:** visit the marked neighborhoods and honk at each ring.
- **Fun Police:** three levels of heat, building-blocked sight, and a visible cooldown after escaping.
- **Garage:** capped boost and armor upgrades, plus repairs. Visit the garage shown on the minimap to buy them.
- **Car wash:** repairs and clears heat for $75.
- **Saving:** cash, upgrades, completion count, best score, and preferences stay in local browser storage. File-open and localhost play may have separate saves. Gameplay continues if saving is denied.

Contract timers determine bonuses. Finishing overtime still pays the base reward. You can abandon a gig without losing banked money. Confetti hits on pedestrians never earn cash.

The [gameplay design](DESIGN.md) explains the intended loops, tuning, scope, and next playtest questions. This is a small playable slice, with simple traffic and patrol AI, rather than a full city simulation.

## Development

No runtime dependencies and no build step.

```sh
npm run check
```

This runs JavaScript syntax checks and deterministic simulation tests. `tools/browser-check.cjs` adds optional Playwright checks with headless Chrome; it requires a separately available Playwright installation, using `PLAYWRIGHT_MODULE_PATH` if necessary. Run it with `node tools/browser-check.cjs`. Browser evidence is ignored by Git.

| File | Responsibility |
| --- | --- |
| core.js | Simulation, map, traffic, police, contracts, rewards, and save validation |
| game.js | Fixed-step game loop, input, rendering, audio, persistence, and HUD |
| index.html / styles.css | Responsive interface and controls |
| tests/core.test.cjs | Simulation regression checks |
| tools/serve.cjs | Optional static development server |

Next priorities: playtest steering and chase tuning, add touch/gamepad controls, then add route variety and cosmetic rewards.
