# Mayhem Meadows

**A tiny town. Terrible errands. Excellent bad decisions.**

A for-fun, original, GTA-inspired third-person 3D driving sandbox. Borrow a car, run silly errands, scatter confetti, and lose the overenthusiastic Fun Police. Residents yell fake curses and recover from cartoon tumbles. Explore a coastal city, winding hill roads, suburbs, a marina, docks, and the airport across the river.

## Play

Play online in Chrome: **[Mayhem Meadows](https://paulalom.github.io/mayhem-meadows/)**.

Open **index.html** in a desktop browser with WebGL 2 support. The game uses local HTML, CSS, JavaScript, procedurally modeled art, generated sound effects, and synthesized music. Its Three.js renderer and Cannon physics engine are bundled locally under **vendor/**. No installation, backend, account, or network connection is required to play.

Use a desktop keyboard and mouse with a WebGL 2 capable browser. If the game cannot create its 3D view, it shows a reload prompt; check that browser hardware acceleration is enabled.

Alternatively, with Node.js installed:

```sh
npm start
```

Then open **http://127.0.0.1:4173** in Chrome. This optional server only serves static files on your computer. All game logic runs in the browser.

The layout adapts to small screens, but touch controls and gamepads are not implemented.

## Hosting

GitHub Pages publishes the game at **https://paulalom.github.io/mayhem-meadows/**. Each push to **main** runs the game checks, packages the static files, and deploys them through **.github/workflows/pages.yml**. Failed checks prevent deployment. You can also publish from the repository's **Actions** tab with **Publish game to GitHub Pages → Run workflow**. In **Settings → Pages**, the publishing source must be **GitHub Actions**.

To prepare the same bundle for any static web host:

```sh
npm run build
```

Upload the contents of **dist/**, keeping its folder structure. This command only copies the ready-to-play browser files and their licenses; no dependency installation or engine rebuild is needed. Relative asset paths support both a domain root and a project path such as **/mayhem-meadows/**. Add new runtime assets to **tools/build-site.cjs** when extending the game.

Hosting serves each player their own game; it does not add multiplayer. Saves stay in each browser and are separate from file-open or localhost saves. Your desktop does not need to stay on for GitHub Pages players.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Walk relative to the camera; accelerate, brake/reverse, and steer a car |
| Mouse movement | Click the town to capture the mouse, then look around freely |
| Hold right mouse | Aim on foot with a closer shoulder view and slower sensitivity |
| Left-click | Fire the equipped popper/cannon or swing the hammer on foot |
| C | Recenter the camera behind you |
| E | Borrow/exit a nearby car or landed aircraft; use the car wash |
| Space | Jump on foot; handbrake/drift while driving |
| Hold Tab | Open the toy wheel; hover, use arrows, or press 1–3; release Tab to equip |
| I | Open pockets to use supplies or shop for supplies and toys |
| G | Browse your garage collection; store, retrieve, or repaint at Sprinkle Garage |
| Shift | Boost in a car; sprint on foot |
| H | Horn; start a party at a party mission ring |
| B / N | Previous / next vehicle radio station, including radio off |
| F | Dramatic ragdoll flop on foot; parachute bailout from an aircraft |
| Space / Ctrl in aircraft | Climb / descend; W/S controls plane throttle or helicopter forward/back movement, A/D turns |
| Shift in aircraft | Plane boost; helicopter braking/hover assist |
| R | Recover to a safe road position; right a flipped car |
| P / Esc | Pause/resume; Esc also releases the mouse |

Click the town to capture the mouse and start looking around. Your first click captures the mouse without firing a toy. Hold right mouse to aim toward the center crosshair; left-click uses the toy on foot, with or without aiming. Space jumps on foot and remains the driving handbrake. Release it before jumping again. Esc releases the mouse and pauses. Opening a menu also releases it and freezes the town; click the town again after closing the menu. Changing tabs or windows pauses the game. Sound, reduced motion, and full screen controls are in the header. Open help (?) to adjust look sensitivity or invert up/down; camera preferences stay in this browser.

Music starts after Play. On foot, a gentle town soundtrack follows you; in a vehicle, the radio replaces it with **Biscuit FM** (disco/funk), **Neon Drive** (synthwave), or **Meadow Waves** (mellow dub). Press B/N or use the radio arrows to switch stations and cycle through radio off. The header Volume slider adjusts all game sound from 1% to 10% of the original level, starting at 5%. Open help (?) for separate master, music/radio, and engines/effects volumes. The station and mix survive reloads, and old saves keep their existing mute preference. The original radio arrangements are synthesized locally with Web Audio.

Compact, sports car, and van engines blend idle and loaded loops as you accelerate, with gear-change accents, damaged-engine texture, boost, and grounded tire skid. Nearby traffic, patrol sirens, impacts, and resident reactions fade with distance and pan with the view. The [local sound library](assets/audio/README.md) supplies 45 original effects and voice clips: distinct toys, material-specific destruction, collisions, explosions, footsteps, supplies, coastal-town ambience, resident fake curses, Fun Police announcements, and radio station IDs. A burning ride has a local fire loop and an accelerating warning before the explosion. Embedded MP3 bytes preserve offline and direct file-open play; synthesis covers loading or unavailable effects. Town audio stops in menus; deliberate inventory and toy-wheel actions retain brief tactile feedback. Pause, help, mute, and background tabs silence everything. Browsers without Web Audio can still play silently.

## The toybox

- **Coastal city:** the supplied city map guides the layout: dense Downtown, winding Old Town, Northside homes, West Beach and Marina, Docklands, Ridge Heights, the airport, and Tidewell Marsh. Buildings face their streets and keep sidewalks clear; gardens and spacing open up outside the center. Characters remain 14% smaller with matching physical bodies. The HUD names your district; the minimap draws the coastline, terrain, actual roads, and rotated footprints.
- **Playable terrain:** the supplied grayscale PNG shapes the ground, including the northern ridge, river, and coast. The reference covers roughly 600 × 400 metres inside a 600-metre square world. Road grades are softened for arcade handling, buildings have level foundations, and bridges carry cars and pedestrians over the river. Walking, jumping, car bodies, ragdolls, aiming, and the camera use the same ground triangles. A splash returns you to a safe road.
- **Central Station:** a west-bank railway enters from the north, branches into a two-track Docklands terminus, and continues to freight sidings. The station has solid platforms and canopies, buffers, a crossover between the platform tracks, a forecourt, and pedestrian access behind the buffers. River bridge approaches cross above the railway; quieter roads have open level-crossing gates. The depot has a solid roof and a marked helicopter landing pad. This update adds the infrastructure; scheduled moving trains are not implemented. The cleaned height-map export preserves the original water mask and untouched pixels; rebuild it with `npm run railway-heightmap`.
- **Driving:** compact, sports car, and van handling; traffic; drifting and near-miss style points. Parked cars use clear roadside bays with access from the street. Cars are three-dimensional rigid bodies with gravity: impacts can bounce, lift, roll, or flip them before they land. Press R to right your ride and return to a safe road position.
- **Aviation:** seven original Blender aircraft: the Bramble Skylark trainer, Mirth Islander commuter, civilian Pogo Whirlybird, Channel 6 news helicopter, Biscuit Air Patrol with a side-mounted cartoon cannon, Tumble Heavy Lift transport helicopter, and Fable Firefly fighter. Each uses the same flight handling for player and NPC pilots. The airport has level connected pavement, aircraft stands, helipads, queued runway movements and arrivals that go around an obstruction. Visiting military aircraft use a separate apron; a military base remains future content.
- **Air jobs and hangars:** the airport button marks the route to your first aircraft. Fly passenger and cargo helicopter trips to the marina and downtown rooftop, follow a sightseeing route, or race through elevated gates. Land and stop for two seconds to load or unload. Three hangar slots preserve aircraft and component damage in local saves; retrieving an owned craft moves it instead of duplicating it. Airport repairs cost $75. G opens hangar management when near the apron; a Hangar tab is available for browsing anywhere.
- **Flight and recovery:** planes have throttle, assisted banking, lift, stalls and landing damage; helicopters hover and climb directly. The flight camera keeps a stable horizon, and the HUD shows altitude above ground, throttle, landing and stall warnings. Extra surrounding airspace provides room for approaches. E exits only after landing; F deploys a steerable parachute. R returns an aircraft to an available stand without repairing it. Mouse look, radio, pause, mute and reduced motion also work in flight.
- **Sky traffic and pursuit:** commuter flights board, taxi, take off, depart, return and land. News helicopters cover reported incidents independently of police. At maximum heat, a six-second warning precedes a single air patrol. Buildings and terrain block its sight; it searches the last confirmed location and returns to base after the pursuit. Its right-side cannon uses visible short bursts and a limited firing arc. Flying the patrol helicopter gives the player the same cannon; aim the camera to the right and hold left mouse to fire.
- **Car stats and damage:** six fictional make/model combinations have their own acceleration, top speed, handling, grip and durability. The current-ride display and collection show live performance plus body, engine and handling health. Crashes damage civilian traffic and patrols as well as your ride; dents, cracked windows and engine smoke accompany the reduced power and grip. Critical damage ignites the engine, with an eight-second warning before a blast can shove nearby vehicles and tumble people. Press E to bail out of a burning ride, even at speed. Stop and use Repair Tape to extinguish it; garage repairs and the wash fully restore its systems. Saved rides retain their model and component damage. R rights your vehicle without repairing it.
- **Jumping:** press Space on foot for a jump with gravity and a landing, including onto low solid surfaces. Holding Space does not repeatedly jump; left-click remains the toy action.
- **Third-person camera:** mouse movement looks around on foot, with a closer shoulder view and slower sensitivity while aiming. The driving camera follows smoothly and gives you time to look around before returning behind the car. Buildings shorten the camera distance to keep the view clear. Press C whenever you want to recenter.
- **Navigation:** glowing 3D mission markers, an objective direction/distance indicator, and a separate overhead minimap.
- **Ragdolls:** car impacts and confetti send residents tumbling. The player can take a tumble too. Jointed bodies fall, bounce, slide, and get back up; press F to try it or R to recover immediately.
- **Solid contacts:** vehicle bodies collide with the ground, building walls, other cars, and fixed props: tree trunks, lamp posts, park benches/fountain, garage kiosk, and car wash frame. Contacts account for height and the full vehicle rotation, with an elastic arcade bounce. People bump into vehicles and each other, and fallen limbs collide with the ground, walls, and cars.
- **Destructible scenery:** smash fences, trees, lamp posts, benches, fountains, signs, and the car wash frame with toys or hard vehicle impacts. The popper chips away, the hammer breaks light props, and cannon blasts clear a wider area. Broken scenery scatters temporary debris and stops blocking people, cars, ragdolls, and shots. Player-caused destruction attracts the Fun Police when noticed or reported. Buildings and the garage kiosk remain solid; service markers keep working. Scenery resets when you reload the town.
- **Disco Delivery:** reach pickup, then deliver the imaginary disco ball.
- **Checkpoint Dash:** drive through a sequence of glowing rings.
- **Party Route:** visit the marked neighborhoods and honk at each ring.
- **Fun Police:** three levels of heat, earned only when police see an incident within 20 metres, hear its noise nearby, or a resident calls for help. Buildings block sight and reduce hearing range. Residents within 10 metres who see trouble, and residents hit by a toy or car, show a help bubble and report after two seconds. Patrols search the incident or last-seen location; unseen trouble does not reset your escape countdown. Washing, escape, and capture clear pending calls.
- **Toy wheel:** unlimited short-range confetti popper, an inflatable hammer with a stronger close-range shove ($120), and a party cannon with traveling confetti balls ($280, includes six charges). Hold Tab to choose; Escape cancels. Left-click uses the chosen toy while on foot.
- **Pockets:** biscuits restore 40 composure, repair tape restores 55 condition to your current ride, and refill packs add six cannon charges. Starter pockets contain two biscuits, one tape, and one refill. Stack limits are five biscuits, three tapes, and three refills; the cannon holds twelve charges. Full meters never waste a supply.
- **Garage:** save up to three civilian rides, bring them back out, repair them for $45, and choose a $25 paint color. Release a slot when you find a new favorite. Saved rides retain their condition; retrieving a car preserves damage. Boost and armor upgrades apply to all rides. Stop at Sprinkle Garage to manage the collection or buy supplies and toy unlocks.
- **Car wash:** repairs and clears heat for $75.
- **Saving:** cash, upgrades, completion count, best score, unlocked/equipped toys, pocket stacks, cannon charges, garage collection, and preferences stay in local browser storage. Existing saves gain the starter inventory without losing progress. File-open and localhost play may have separate saves. Gameplay continues if saving is denied.

Contract timers determine bonuses. Finishing overtime still pays the base reward. You can abandon a gig without losing banked money. Confetti hits on pedestrians never earn cash.

The toy wheel and pocket/collection menus freeze the town and mission timer. Browse your collection anywhere, then visit **GARAGE** on the minimap to make purchases or manage rides. Biscuits cost $15, tape costs $35, and refill packs cost $30. Press I or G again, or Escape, to close the menu. Touch driving remains outside this prototype.

The [gameplay design](DESIGN.md) explains the intended loops, neighborhood layouts, tuning, scope, and next playtest questions. This is a small playable slice with traffic, patrol and aviation AI. Vehicles can leave the ground and rotate in three dimensions. On-foot jumping and ragdolls have vertical gravity. Fixed street/park obstacles have collision shapes. The hills, bridges and airport are playable; building interiors, swimming and a military base remain outside this prototype.

The original reference images are preserved in **assets/**. The attached height map is actually a **1536 × 1024, 8-bit RGB PNG**. Its grayscale values are imported into local numeric data in **height-data.js**; the game does not require image downloads or runtime image decoding. Elevations use an arcade scale rather than the map's printed mountain heights, with additional grading around roads and building pads.

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
| height-data.js | Numeric grayscale samples and provenance of the supplied height map |
| terrain.js | Shared ground triangles, softened road profiles, building pads and bridge surfaces |
| core.js | Simulation, map, traffic, police, contracts, inventory, garage, rewards, and save validation |
| vehicle-physics.js | Cannon vehicle bodies, gravity, orientation, elastic contacts, and fixed obstacle shapes |
| aircraft.js | Shared arcade flight, airport traffic, news/police behavior and side-gun projectiles |
| aircraft-models.js / assets/aircraft/ | Offline Blender mesh bundle, editable source, fleet preview and provenance |
| physics.js | Ragdoll joints, gravity, contacts, and automatic get-up |
| scene3d.js | Three.js world, models, perspective camera, lighting, and visual effects |
| audio.js | Local music sequencer, vehicle radio, spatial engines/sirens, effects, and audio lifecycle |
| assets/audio/ | Generated source sounds, provenance manifest, and embedded offline audio bundle |
| tools/build-audio-assets.cjs | Rebuilds and verifies the audio bundle with `npm run audio-assets` |
| game.js | Fixed-step game loop, input, audio controls, persistence, HUD, and minimap |
| vendor/three.min.js | Bundled Three.js renderer for offline and file-open play |
| vendor/cannon.min.js / vendor/cannon.cjs | Bundled Cannon physics engine for browser play and Node checks |
| index.html / styles.css | Responsive interface and controls |
| tests/*.test.cjs | Simulation, inventory, garage, camera, vehicle physics, jump, and ragdoll regression checks |
| tools/serve.cjs | Optional static development server |

Next priorities: playtest toy reach and the garage economy, tune chases, add touch/gamepad controls, then add route variety and cosmetic rewards.

Version 0.9.0 builds the world around the supplied map and height map, with physical hills, coastlines, river crossings, and distinct coastal districts. Automated Chrome checks continue to keep the desktop cursor free.
