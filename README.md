# Mayhem Meadows

**A tiny town. Terrible errands. Excellent bad decisions.**

A for-fun, original, GTA-inspired third-person 3D driving sandbox. Borrow a car, run silly errands, scatter confetti, and lose the overenthusiastic Fun Police. Residents yell fake curses and recover from cartoon tumbles. The same little town now has chunky buildings, modeled cars and residents, and a camera that follows you through the streets.

## Play

Open **index.html** in a desktop browser with WebGL 2 support. The game uses local HTML, CSS, JavaScript, procedurally modeled art, and synthesized sound. Its Three.js engine is bundled in **vendor/three.min.js**. No installation, backend, account, or network connection is required to play.

Use a desktop keyboard and mouse with a WebGL 2 capable browser. If the game cannot create its 3D view, it shows a reload prompt; check that browser hardware acceleration is enabled.

Alternatively, with Node.js installed:

```sh
npm start
```

Then open **http://127.0.0.1:4173** in your browser. This optional server only serves static files on your computer. All game logic runs in the browser.

The layout adapts to small screens, but touch controls and gamepads are not implemented.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Walk relative to the camera; accelerate, brake/reverse, and steer a car |
| Right mouse drag | Orbit the camera and look up/down |
| C | Recenter the camera behind you |
| E | Borrow/exit a nearby car; use the car wash |
| Space | Handbrake/drift in a car; use your equipped toy on foot |
| Hold Tab | Open the toy wheel; hover, use arrows, or press 1–3; release Tab to equip |
| I | Open pockets to use supplies or shop for supplies and toys |
| G | Browse your garage collection; store, retrieve, or repaint at Sprinkle Garage |
| Shift | Boost in a car; sprint on foot |
| H | Horn; start a party at a party mission ring |
| F | Dramatic ragdoll flop on foot; stand up automatically |
| R | Recover to a safe road position |
| P / Esc | Pause/resume |
| Pointer | Aim your on-foot toy into the 3D world |

Click the game canvas if keyboard focus has moved away from it. Changing tabs or windows pauses the game; resume with the button. Sound, reduced motion, and full screen controls are in the header. Looking around uses a right-button drag; the game does not capture or lock your pointer.

## The toybox

- **Driving:** compact, sports car, and van handling; traffic; forgiving impacts; drifting and near-miss style points.
- **Third-person camera:** an orbit view on foot, a following view while driving, and a safe camera distance around buildings. Press C whenever you want to recenter.
- **Navigation:** glowing 3D mission markers, an objective direction/distance indicator, and a separate overhead minimap.
- **Ragdolls:** car impacts and confetti send residents tumbling. The player can take a tumble too. Jointed bodies fall, bounce, slide, and get back up; press F to try it or R to recover immediately.
- **Solid contacts:** vehicles use their rotated footprints against buildings and other vehicles. People bump into vehicles and each other, and fallen limbs collide with the ground, walls, and cars.
- **Disco Delivery:** reach pickup, then deliver the imaginary disco ball.
- **Checkpoint Dash:** drive through a sequence of glowing rings.
- **Party Route:** visit the marked neighborhoods and honk at each ring.
- **Fun Police:** three levels of heat, building-blocked sight, and a visible cooldown after escaping.
- **Toy wheel:** unlimited short-range confetti popper, an inflatable hammer with a stronger close-range shove ($120), and a party cannon with traveling confetti balls ($280, includes six charges). Hold Tab to choose; Escape cancels. Space uses the chosen toy while on foot.
- **Pockets:** biscuits restore 40 composure, repair tape restores 55 condition to your current ride, and refill packs add six cannon charges. Starter pockets contain two biscuits, one tape, and one refill. Stack limits are five biscuits, three tapes, and three refills; the cannon holds twelve charges. Full meters never waste a supply.
- **Garage:** save up to three civilian rides, bring them back out, repair them for $45, and choose a $25 paint color. Release a slot when you find a new favorite. Saved rides retain their condition; retrieving a car preserves damage. Boost and armor upgrades apply to all rides. Stop at Sprinkle Garage to manage the collection or buy supplies and toy unlocks.
- **Car wash:** repairs and clears heat for $75.
- **Saving:** cash, upgrades, completion count, best score, unlocked/equipped toys, pocket stacks, cannon charges, garage collection, and preferences stay in local browser storage. Existing saves gain the starter inventory without losing progress. File-open and localhost play may have separate saves. Gameplay continues if saving is denied.

Contract timers determine bonuses. Finishing overtime still pays the base reward. You can abandon a gig without losing banked money. Confetti hits on pedestrians never earn cash.

The toy wheel and pocket/collection menus freeze the town and mission timer. Browse your collection anywhere, then visit **GARAGE** on the minimap to make purchases or manage rides. Biscuits cost $15, tape costs $35, and refill packs cost $30. Press I or G again, or Escape, to close the menu. Touch driving remains outside this prototype.

The [gameplay design](DESIGN.md) explains the intended loops, tuning, scope, and next playtest questions. This is a small playable slice with simple traffic and patrol AI. Driving and upright movement use flat streets, while ragdolls have vertical gravity and three-dimensional joint contacts. Decorative trees, lamps, and curbs remain scenery. There are no stairs, jumps, or building interiors.

The [story campaign design](CAMPAIGN.md) specifies **Operation Unboring**, a proposed ten-job campaign beginning with Spanner's phone call and directions to Sprinkle Garage. Its first playable milestone is the call, the drive, and the garage meeting; campaign gameplay is planned for a later build.

## Development

The checked-in engine bundle is ready to play. You do not need npm or a build step to open the game.

```sh
npm run check
```

This runs JavaScript syntax checks, deterministic simulation tests, and camera and ragdoll regression tests. `tools/browser-check.cjs` adds optional Playwright checks with headless Chrome; it requires a separately available Playwright installation, using `PLAYWRIGHT_MODULE_PATH` if necessary. Run it with `node tools/browser-check.cjs`. Browser evidence is ignored by Git.

If you change or upgrade the engine, recreate the locally bundled Three.js file with:

```sh
npm ci
npm run vendor
```

| File | Responsibility |
| --- | --- |
| core.js | Simulation, map, traffic, police, contracts, inventory, garage, rewards, and save validation |
| physics.js | Ragdoll joints, gravity, contacts, and automatic get-up |
| scene3d.js | Three.js world, models, perspective camera, lighting, and visual effects |
| game.js | Fixed-step game loop, input, audio, persistence, HUD, and minimap |
| vendor/three.min.js | Bundled Three.js engine for offline and file-open play |
| index.html / styles.css | Responsive interface and controls |
| tests/*.test.cjs | Simulation, inventory, garage, camera, and ragdoll regression checks |
| tools/serve.cjs | Optional static development server |

Next priorities: playtest toy reach and the garage economy, tune chases, add touch/gamepad controls, then add route variety and cosmetic rewards.
