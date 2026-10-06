# Mayhem Meadows

**A tiny town. Terrible errands. Excellent bad decisions.**

A for-fun, original, GTA-inspired third-person 3D driving sandbox. Borrow a car, run silly errands, scatter confetti, and lose the overenthusiastic Fun Police. Residents yell fake curses and recover from cartoon tumbles. Explore garden neighborhoods, busy shop rows, warehouse yards and a relaxed riverfront, with hills and countryside beyond town.

## Play

Open **index.html** in a desktop browser with WebGL 2 support. The game uses local HTML, CSS, JavaScript, procedurally modeled art, and synthesized sound. Its Three.js renderer and Cannon physics engine are bundled locally under **vendor/**. No installation, backend, account, or network connection is required to play.

Use a desktop keyboard and mouse with a WebGL 2 capable browser. If the game cannot create its 3D view, it shows a reload prompt; check that browser hardware acceleration is enabled.

Alternatively, with Node.js installed:

```sh
npm start
```

Then open **http://127.0.0.1:4173** in Chrome. This optional server only serves static files on your computer. All game logic runs in the browser.

The layout adapts to small screens, but touch controls and gamepads are not implemented.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Walk relative to the camera; accelerate, brake/reverse, and steer a car |
| Mouse movement | Click the town to capture the mouse, then look around freely |
| Hold right mouse | Aim on foot with a closer shoulder view and slower sensitivity |
| Left-click | Fire the equipped popper/cannon or swing the hammer on foot |
| C | Recenter the camera behind you |
| E | Borrow/exit a nearby car; use the car wash |
| Space | Jump on foot; handbrake/drift while driving |
| Hold Tab | Open the toy wheel; hover, use arrows, or press 1–3; release Tab to equip |
| I | Open pockets to use supplies or shop for supplies and toys |
| G | Browse your garage collection; store, retrieve, or repaint at Sprinkle Garage |
| Shift | Boost in a car; sprint on foot |
| H | Horn; start a party at a party mission ring |
| B / N | Previous / next vehicle radio station, including radio off |
| F | Dramatic ragdoll flop on foot; stand up automatically |
| R | Recover to a safe road position; right a flipped car |
| P / Esc | Pause/resume; Esc also releases the mouse |

Click the town to capture the mouse and start looking around. Your first click captures the mouse without firing a toy. Hold right mouse to aim toward the center crosshair; left-click uses the toy on foot, with or without aiming. Space jumps on foot and remains the driving handbrake. Release it before jumping again. Esc releases the mouse and pauses. Opening a menu also releases it and freezes the town; click the town again after closing the menu. Changing tabs or windows pauses the game. Sound, reduced motion, and full screen controls are in the header. Open help (?) to adjust look sensitivity or invert up/down; camera preferences stay in this browser.

Music starts after Play. On foot, a gentle town soundtrack follows you; in a vehicle, the radio replaces it with **Biscuit FM** (disco/funk), **Neon Drive** (synthwave), or **Meadow Waves** (mellow dub). Press B/N or use the radio arrows to switch stations and cycle through radio off. Open help (?) for separate master, music/radio, and engines/effects volumes. The station and mix survive reloads, and old saves keep their existing mute preference. All music and effects are original Web Audio synthesis, generated locally without downloads or services.

Compact, sports car, and van engines respond to speed, throttle, and boost. Nearby moving traffic and pursuing patrol sirens fade with distance and pan with the view. Grounded tires squeal under hard braking or drifting; horns, crashes, toys, footsteps, and contract jingles have distinct effects. Pause, help, inventory, and background tabs silence audio with the town. Browsers without Web Audio can still play silently.

## The toybox

- **City and suburbs:** winding avenues, irregular junctions, side streets and residential loops connect six neighborhoods across a 280-metre playable world. Market Mile's shops and Waffle Works' yards open into quieter homes in Biscuit Heights, Willow Gardens and Orchard Park, with Riverfront as a scenic destination. Buildings face their streets, sidewalks follow the curves, and gardens become more spacious toward the outskirts. Characters remain 14% smaller with matching physical bodies. The HUD names your district; the minimap draws the actual roads and rotated footprints.
- **Driving:** compact, sports car, and van handling; traffic; drifting and near-miss style points. Parked cars use clear roadside bays with access from the street. Cars are three-dimensional rigid bodies with gravity: impacts can bounce, lift, roll, or flip them before they land. Press R to right your ride and return to a safe road position.
- **Car stats and damage:** six fictional make/model combinations have their own acceleration, top speed, handling, grip and durability. The current-ride display and collection show live performance plus body, engine and handling health. Crashes damage civilian traffic and patrols as well as your ride; dents, cracked windows and engine smoke accompany the reduced power and grip. Critical damage ignites the engine, with an eight-second warning before a blast can shove nearby vehicles and tumble people. Press E to bail out of a burning ride, even at speed. Stop and use Repair Tape to extinguish it; garage repairs and the wash fully restore its systems. Saved rides retain their model and component damage. R rights your vehicle without repairing it.
- **Jumping:** press Space on foot for a jump with gravity and a landing, including onto low solid surfaces. Holding Space does not repeatedly jump; left-click remains the toy action.
- **Third-person camera:** mouse movement looks around on foot, with a closer shoulder view and slower sensitivity while aiming. The driving camera follows smoothly and gives you time to look around before returning behind the car. Buildings shorten the camera distance to keep the view clear. Press C whenever you want to recenter.
- **Navigation:** glowing 3D mission markers, an objective direction/distance indicator, and a separate overhead minimap.
- **Ragdolls:** car impacts and confetti send residents tumbling. The player can take a tumble too. Jointed bodies fall, bounce, slide, and get back up; press F to try it or R to recover immediately.
- **Solid contacts:** vehicle bodies collide with the ground, building walls, other cars, and fixed props: tree trunks, lamp posts, park benches/fountain, garage kiosk, and car wash frame. Contacts account for height and the full vehicle rotation, with an elastic arcade bounce. People bump into vehicles and each other, and fallen limbs collide with the ground, walls, and cars.
- **Destructible scenery:** smash fences, trees, lamp posts, benches, fountains, signs, and the car wash frame with toys or hard vehicle impacts. The popper chips away, the hammer breaks light props, and cannon blasts clear a wider area. Broken scenery scatters temporary debris and stops blocking people, cars, ragdolls, and shots. Player-caused destruction attracts the Fun Police. Buildings and the garage kiosk remain solid; service markers keep working. Scenery resets when you reload the town.
- **Disco Delivery:** reach pickup, then deliver the imaginary disco ball.
- **Checkpoint Dash:** drive through a sequence of glowing rings.
- **Party Route:** visit the marked neighborhoods and honk at each ring.
- **Fun Police:** three levels of heat, building-blocked sight, and a visible cooldown after escaping.
- **Toy wheel:** unlimited short-range confetti popper, an inflatable hammer with a stronger close-range shove ($120), and a party cannon with traveling confetti balls ($280, includes six charges). Hold Tab to choose; Escape cancels. Left-click uses the chosen toy while on foot.
- **Pockets:** biscuits restore 40 composure, repair tape restores 55 condition to your current ride, and refill packs add six cannon charges. Starter pockets contain two biscuits, one tape, and one refill. Stack limits are five biscuits, three tapes, and three refills; the cannon holds twelve charges. Full meters never waste a supply.
- **Garage:** save up to three civilian rides, bring them back out, repair them for $45, and choose a $25 paint color. Release a slot when you find a new favorite. Saved rides retain their condition; retrieving a car preserves damage. Boost and armor upgrades apply to all rides. Stop at Sprinkle Garage to manage the collection or buy supplies and toy unlocks.
- **Car wash:** repairs and clears heat for $75.
- **Saving:** cash, upgrades, completion count, best score, unlocked/equipped toys, pocket stacks, cannon charges, garage collection, and preferences stay in local browser storage. Existing saves gain the starter inventory without losing progress. File-open and localhost play may have separate saves. Gameplay continues if saving is denied.

Contract timers determine bonuses. Finishing overtime still pays the base reward. You can abandon a gig without losing banked money. Confetti hits on pedestrians never earn cash.

The toy wheel and pocket/collection menus freeze the town and mission timer. Browse your collection anywhere, then visit **GARAGE** on the minimap to make purchases or manage rides. Biscuits cost $15, tape costs $35, and refill packs cost $30. Press I or G again, or Escape, to close the menu. Touch driving remains outside this prototype.

The [gameplay design](DESIGN.md) explains the intended loops, neighborhood layouts, tuning, scope, and next playtest questions. This is a small playable slice with simple traffic and patrol AI. The town uses a flat road layout, surrounded by scenic terrain, hills and a river. Vehicles can leave the ground and rotate in three dimensions. On-foot jumping and ragdolls have vertical gravity. Fixed street/park obstacles have collision shapes. Exterior terrain is scenery; there are no stairs, elevated road routes, or building interiors.

The [story campaign design](CAMPAIGN.md) specifies **Operation Unboring**, a proposed ten-job campaign beginning with Spanner's phone call and directions to Sprinkle Garage. Its first playable milestone is the call, the drive, and the garage meeting; campaign gameplay is planned for a later build.

The [police balance design](POLICE.md) proposes a forgiving mischief buildup, explicit chase reasons, announced reinforcement waves, and a capped four-car swarm. These rules are planned for a gameplay update; the current prototype retains its existing three-patrol heat system.

## Texture library

The [generic texture library](assets/textures/README.md) contains eight softly painted building and environment materials, with a contact sheet, repeat previews, and generation prompts. These standalone assets are prepared for later application during the map rework.

## Development

The checked-in engine bundle is ready to play. You do not need npm or a build step to open the game.

```sh
npm run check
```

This runs JavaScript syntax checks, deterministic simulation tests, and camera, vehicle physics, jump, and ragdoll regression tests. `tools/browser-check.cjs` adds optional Playwright checks with headless Chrome; it requires a separately available Playwright installation, using `PLAYWRIGHT_MODULE_PATH` if necessary. Run it with `node tools/browser-check.cjs`. Browser evidence is ignored by Git.

Automated Chrome checks virtualize pointer capture and send relative look events inside isolated test pages, keeping the desktop mouse free. Keyboard/buttons, WebGL rendering, and gameplay still run in Chrome. Native pointer capture remains a manual play check; the normal game uses Chrome's native mouse look. Browser evidence records the input mode.

If you change or upgrade the engine, recreate the locally bundled rendering and physics engines with:

```sh
npm ci
npm run vendor
```

| File | Responsibility |
| --- | --- |
| world.js | Organic road network, neighborhoods, lots, shared landmarks and connected route planning |
| core.js | Simulation, map, traffic, police, contracts, inventory, garage, rewards, and save validation |
| vehicle-physics.js | Cannon vehicle bodies, gravity, orientation, elastic contacts, and fixed obstacle shapes |
| physics.js | Ragdoll joints, gravity, contacts, and automatic get-up |
| scene3d.js | Three.js world, models, perspective camera, lighting, and visual effects |
| audio.js | Local music sequencer, vehicle radio, spatial engines/sirens, effects, and audio lifecycle |
| game.js | Fixed-step game loop, input, audio controls, persistence, HUD, and minimap |
| vendor/three.min.js | Bundled Three.js renderer for offline and file-open play |
| vendor/cannon.min.js / vendor/cannon.cjs | Bundled Cannon physics engine for browser play and Node checks |
| index.html / styles.css | Responsive interface and controls |
| tests/*.test.cjs | Simulation, inventory, garage, camera, vehicle physics, jump, and ragdoll regression checks |
| tools/serve.cjs | Optional static development server |

Next priorities: playtest toy reach and the garage economy, tune chases, add touch/gamepad controls, then add route variety and cosmetic rewards.

Version 0.8.0 replaces the uniform road grid with an organic street network and expands the playable world into two suburbs. Traffic, recovery, missions, collisions, camera clearance and the minimap use the new layout. Automated Chrome checks continue to keep the desktop cursor free.
