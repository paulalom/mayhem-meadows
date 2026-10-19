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
| Mouse movement | Click the town to capture the mouse, then look around; aim a tank turret independently of driving |
| Hold right mouse | Aim on foot; lock and launch fighter missiles; fire armed helicopter rockets |
| Left-click | Use the equipped toy on foot; hold for aircraft machine guns or a borrowed tank's cannon |
| C | Recenter the camera behind you |
| M | Open / close the illustrated city map; Escape also closes it |
| E | Borrow/exit a nearby car or stopped tank; enter aircraft; hop onto/off a train side or rear; use the car wash |
| Space | Jump on foot; handbrake/drift while driving |
| Hold Tab | Open the toy wheel; hover, use arrows, or press 1–3; release Tab to equip |
| I | Open pockets to use supplies or shop for supplies and toys |
| G | Browse your garage collection; store, retrieve, or repaint at Sprinkle Garage |
| Shift | Boost in a car; sprint on foot |
| H | Horn; start a party at a party mission ring |
| B / N | Previous / next vehicle radio station, including radio off |
| F | Dramatic ragdoll flop on foot; parachute bailout from an aircraft |
| W / S in planes | Pitch nose down / up (arrow up / down also work) |
| A / D in planes | Roll / bank left and right (arrow left / right also work); banking coordinates a turn |
| Q / E in planes | Independent yaw / rudder; steer on the ground |
| Shift / Space in planes | Increase / decrease throttle; the setting holds after release |
| X in planes | Exit after landing and stopping; F remains parachute bailout |
| W/S, A/D in helicopters | Forward/back, turn left/right; arrow keys also work |
| Space / Ctrl in helicopters | Climb / descend |
| Shift in helicopters | Braking / hover assist |
| R | Recover to a safe road position; right a flipped car or tank |
| P / Esc | Pause/resume; Esc also releases the mouse |

The table shows default keys. Open **Settings** from the header, pause menu, or Help to choose separate control sets for on foot, cars/trucks, tanks, helicopters, and planes. Choose a preset or click an action's key and press a replacement; Escape cancels capture. Conflicts within a set and reserved menu shortcuts are rejected. Reset this set restores the selected preset. Planes also offer **Classic arcade** for the previous throttle/climb layout. Custom keys, presets, camera sensitivity, audio, and reduced motion save in this browser. Flight and emergency prompts follow your active keys.

Click the town to capture the mouse and start looking around. Your first click captures the mouse without firing a toy. Hold right mouse to aim toward the center crosshair; left-click uses the toy on foot, with or without aiming. Space jumps on foot and remains the driving handbrake. Release it before jumping again. Esc releases the mouse and pauses. Opening a menu also releases it and freezes the town; click the town again after closing the menu. Changing tabs or windows pauses the game. Closing Settings restores whether the town was already paused. Sound, reduced motion, and full screen controls are also in the header.

Music starts after Play. On foot, a gentle town soundtrack follows you; in a vehicle, the radio replaces it with **Biscuit FM** (disco/funk), **Neon Drive** (synthwave), or **Meadow Waves** (mellow dub). Press B/N or use the radio arrows to switch stations and cycle through radio off. The header Volume slider adjusts all game sound from 1% to 10% of the original level, starting at 5%. Open Settings for separate master, music/radio, and engines/effects volumes. The station and mix survive reloads, and old saves keep their existing mute preference. The original radio arrangements are synthesized locally with Web Audio.

Compact, sports car, and van engines blend idle and loaded loops as you accelerate, with gear-change accents, damaged-engine texture, boost, and grounded tire skid. Nearby traffic, patrol sirens, impacts, and resident reactions fade with distance and pan with the view. The [local sound library](assets/audio/README.md) supplies 45 original effects and voice clips: distinct toys, material-specific destruction, collisions, explosions, footsteps, supplies, coastal-town ambience, resident fake curses, Fun Police announcements, and radio station IDs. A burning ride has a local fire loop and an accelerating warning before the explosion. Embedded MP3 bytes preserve offline and direct file-open play; synthesis covers loading or unavailable effects. Town audio stops in menus; deliberate inventory and toy-wheel actions retain brief tactile feedback. Pause, help, mute, and background tabs silence everything. Browsers without Web Audio can still play silently.

## The toybox

- **Coastal city:** the supplied city map guides the layout: dense Downtown, winding Old Town, Northside homes, West Beach and Marina, Docklands, Ridge Heights, the airport, and Tidewell Marsh. Buildings face their streets and keep sidewalks clear; gardens and spacing open up outside the center. Characters remain 14% smaller with matching physical bodies. The HUD names your district; the minimap draws the coastline, terrain, actual roads, and rotated footprints.
- **Playable terrain:** the supplied grayscale PNG shapes the original 600 × 400 metre city. An ImageGen northern extension adds 200 metres for a separate military airfield, making the playable map 600 × 600 metres. Existing city coordinates stay fixed. Road grades are softened for arcade handling, buildings have level foundations, and bridges carry cars and pedestrians over the river. Walking, jumping, car bodies, ragdolls, aiming, and the camera use the same ground triangles. A splash returns you to a safe road.
- **Central Station:** a west-bank railway enters from the north, branches into a two-track Docklands terminus, and continues to freight sidings. Scheduled passenger and container trains use solid platforms, buffers and the station crossover. Warning lights and hinged barriers stop road traffic and pedestrians at level crossings; two river road approaches pass above the trains. The ferry road bend shares one protected crossing, keeping its junction clear of internal barriers. The depot has a solid roof and a marked helicopter landing pad. The cleaned height-map export preserves the original water mask and untouched pixels; rebuild it with `npm run railway-heightmap`.
- **Driving:** compact, sports car, and van handling; traffic; drifting and near-miss style points. Parked cars use clear roadside bays with access from the street. Cars are three-dimensional rigid bodies with gravity: impacts can bounce, lift, roll, or flip them before they land. Press R to right your ride and return to a safe road position.
- **Aviation:** seven original Blender aircraft: the Bramble Skylark trainer, Mirth Islander commuter, civilian Pogo Whirlybird, Channel 6 news helicopter, Biscuit Air Patrol with a side-mounted cartoon cannon, Tumble Heavy Lift transport helicopter, and Fable Firefly fighter. Each uses the same flight handling for player and NPC pilots. Both airfields have level connected pavement, aircraft stands, helipads, queued runway movements and arrivals that go around an obstruction.
- **Northwatch Airbase:** follow the Northwatch button's marker through Pine Ridge to a remote northern compound. Its separate east–west runway has connected taxiways, independent runway reservations, two fighters, heavy lift and utility helicopters. Blender hangars, a tower, barracks, headquarters, workshop and gatehouse have matching physical footprints. Two utility vans use normal driving, damage and recovery; six armed guards patrol the compound and defend it during a four-star alert. Base aircraft can be borrowed, stored, repaired and recovered locally. The perimeter fence leaves a clear road gate.
- **Air jobs and hangars:** the airport button marks the route to your first aircraft. Fly passenger and cargo helicopter trips to the marina and downtown rooftop, follow a sightseeing route, or race through elevated gates. Land and stop for two seconds to load or unload. Three hangar slots preserve aircraft and component damage in local saves; retrieving an owned craft moves it instead of duplicating it. Airport repairs cost $75. G opens hangar management when near the apron; a Hangar tab is available for browsing anywhere.
- **Flight and recovery:** planes have throttle, assisted banking, lift, stalls and landing damage; helicopters hover and climb directly. The flight camera keeps a stable horizon, and the HUD shows altitude above ground, throttle, landing and stall warnings. Extra surrounding airspace provides room for approaches. E exits only after landing; F deploys a steerable parachute. R returns an aircraft to an available stand without repairing it. Mouse look, radio, pause, mute and reduced motion also work in flight.
- **Sky traffic and pursuit:** commuter flights board, taxi, take off, depart, return and land. News helicopters cover reported incidents independently of police. Three stars bring a police air patrol after a six-second warning. The fourth star calls Northwatch: a fighter intercepts a player aircraft, while an armed heavy helicopter pursues a ground vehicle. Military air dispatch is announced and limited to one responding aircraft. Buildings and terrain block sight and gunfire; units search the last confirmed location and return to their airfield when the pursuit ends. NPC fighter cannons fire forward on attack passes, and NPC helicopter cannons fire in short bursts through a limited side arc.
- **Aircraft weapons:** hold left mouse for a continuous machine gun in the Fable Firefly fighter, Biscuit Air Patrol, or Tumble Heavy Lift. The fighter gun follows its nose; helicopter weapons aim with the camera within a forward arc. Hold right mouse in the fighter to acquire an airborne aircraft or tank near the crosshair for one second, then launch automatically. Six guided missiles turn toward the locked target, with two seconds between launches; cover breaks acquisition and guidance. Armed helicopters carry 24 unguided rockets, firing one every 0.3 seconds along the launch direction. Missiles deal 150 damage and rockets 65, making four missiles or ten rockets enough for a fresh Warden tank. The HUD shows ammo, acquisition and reload status. Land and stop at an airfield without firing for three seconds to rearm. Hangar saves preserve remaining ammo. Civilian Pogo and news helicopters stay unarmed.
- **Heavy armour:** 60 continuous seconds at four stars authorises a Northwatch Warden tank, whether the player is on foot, driving or flying. Its cannon engages ground vehicles only. An actual player hit on base property, vehicles or personnel bypasses that minute and raises the base alarm; missed shots and NPC collateral do not. Both triggers give an eight-second mobilisation warning. One AI tank responds at a time, with a 90-second dispatch cooldown, reuse of parked units and a cap of two surviving chassis that preserves a borrowed tank. Routes stay on approved broad outskirts roads around Northwatch, Pine Ridge and the airport perimeter. A tank waits at the reachable edge of its network when a downtown target has no suitable route, stops for traffic and rail barriers, and searches confirmed positions instead of tracking a hidden player. Its turret turns and gun elevates independently; gravity affects shells, and buildings, terrain, scenery and vehicles stop their paths. Hull, turret and barrel have matching articulated contacts for cars, people, ragdolls and shots. Clearing heat sends armour back to its dispatch post.
- **Borrow a Warden:** press E near a stopped tank, drive with WASD, move the mouse to aim, and hold left mouse to fire. The cannon panel and reticle show its 4.5-second reload. The tank has 600 hull health plus engine and handling damage. Repair Tape, the car wash and a current-ride repair preserve that 600-health capacity; R recovers to a clear approved road without repairing damage. Stop and press E to exit. Tanks do not fit in civilian garage slots and are excluded from saved garage collections. The original Blender source, preview and provenance live in `assets/tanks/`; `blender --background --python tools/export-tank.py` rebuilds the mesh bundle.
- **Soldiers and troop carriers:** four stars or an actual attack on the base starts a six-second troop mobilisation warning. A six-wheel Northwatch Carrier drives four soldiers from the compound using roads with clearance for its full body, braking for traffic and railway crossings. It stops before unloading into clear ground positions. Soldiers walk around walls and vehicles, stay off airfield movement areas, aim at a finite rate and fire short three-shot bursts only after acquiring a visible ground target. Buildings, terrain, vehicles and people block rounds. They respect recovery grace, can be knocked down by toys and physical impacts, and share a replenishing damage budget. Guards remain near the base; deployed troops search their last confirmed contact, then reboard for the return journey. Clearing heat recalls both infantry and the carrier.
- **Borrow a Carrier:** E boards or exits a stopped military truck; WASD, braking, damage and R recovery use the shared vehicle physics. Its six animated wheels, four bench seats and soldiers are original Blender models. Passengers follow the truck's physical pose and leave only after it stops at a clear exit. The carrier has 240 hull health with separate engine and handling condition; tape, the wash and current-ride repairs retain that capacity. Military trucks do not fit civilian garage slots or saved garage collections. Only one carrier responds at a time, with a 90-second dispatch cooldown, at most two surviving chassis and a total cap of 14 soldiers including the six base guards.
- **Car stats and damage:** six fictional make/model combinations have their own acceleration, top speed, handling, grip and durability. The current-ride display and collection show live performance plus body, engine and handling health. Crashes damage civilian traffic and patrols as well as your ride; dents, cracked windows and engine smoke accompany the reduced power and grip. Critical damage ignites the engine, with an eight-second warning before a blast can shove nearby vehicles and tumble people. Press E to bail out of a burning ride, even at speed. Stop and use Repair Tape to extinguish it; garage repairs and the wash fully restore its systems. Saved rides retain their model and component damage. R rights your vehicle without repairing it.
- **Jumping:** press Space on foot for a jump with gravity and a landing, including onto low solid surfaces. Holding Space does not repeatedly jump; left-click remains the toy action.
- **Third-person camera:** mouse movement looks around on foot, with a closer shoulder view and slower sensitivity while aiming. The driving camera follows smoothly and gives you time to look around before returning behind the car. Buildings shorten the camera distance to keep the view clear. Press C whenever you want to recenter.
- **Navigation:** glowing 3D mission markers, an objective direction/distance indicator, a separate overhead minimap, and an illustrated city map opened with M. The map pauses the town and includes Central Station, the railway and depot helipad.
- **Ragdolls:** car impacts and confetti send residents tumbling. The player can take a tumble too. Jointed bodies fall, bounce, slide, and get back up; press F to try it or R to recover immediately.
- **Solid contacts:** vehicle bodies collide with the ground, building walls, other cars, and fixed props: tree trunks, lamp posts, park benches/fountain, garage kiosk, and car wash frame. Contacts account for height and the full vehicle rotation, with an elastic arcade bounce. People bump into vehicles and each other, and fallen limbs collide with the ground, walls, and cars.
- **Destructible scenery:** smash fences, trees, lamp posts, benches, fountains, signs, and the car wash frame with toys or hard vehicle impacts. The popper chips away, the hammer breaks light props, and cannon blasts clear a wider area. Broken scenery scatters temporary debris and stops blocking people, cars, ragdolls, and shots. Player-caused destruction attracts the Fun Police when noticed or reported. Buildings and the garage kiosk remain solid; service markers keep working. Scenery resets when you reload the town.
- **Disco Delivery:** reach pickup, then deliver the imaginary disco ball.
- **Checkpoint Dash:** drive through a sequence of glowing rings.
- **Party Route:** visit the marked neighborhoods and honk at each ring.
- **Fun Police:** four levels of heat, earned only when police see an incident within 20 metres, hear its noise nearby, or a resident calls for help. Road patrols remain capped at three; the fourth star adds the military response described above. Buildings block sight and reduce hearing range. Residents within 10 metres who see trouble, and residents hit by a toy or car, show a help bubble and report after two seconds. Patrols search the incident or last-seen location; unseen trouble does not reset your escape countdown. Washing, escape, and capture clear pending calls.
- **Toy wheel:** unlimited short-range confetti popper, an inflatable hammer with a stronger close-range shove ($120), and a party cannon with traveling confetti balls ($280, includes six charges). Hold Tab to choose; Escape cancels. Left-click uses the chosen toy while on foot.
- **Pockets:** biscuits restore 40 composure, repair tape restores 55 condition to your current ride, and refill packs add six cannon charges. Starter pockets contain two biscuits, one tape, and one refill. Stack limits are five biscuits, three tapes, and three refills; the cannon holds twelve charges. Full meters never waste a supply.
- **Garage:** save up to three civilian rides, bring them back out, repair them for $45, and choose a $25 paint color. Release a slot when you find a new favorite. Saved rides retain their condition; retrieving a car preserves damage. Boost and armor upgrades apply to all rides. Stop at Sprinkle Garage to manage the collection or buy supplies and toy unlocks.
- **Car wash:** repairs and clears heat for $75.
- **Saving:** cash, upgrades, completion count, best score, unlocked/equipped toys, pocket stacks, cannon charges, garage collection, and preferences stay in local browser storage. Existing saves gain the starter inventory without losing progress. File-open and localhost play may have separate saves. Gameplay continues if saving is denied.

Contract timers determine bonuses. Finishing overtime still pays the base reward. You can abandon a gig without losing banked money. Confetti hits on pedestrians never earn cash.

The toy wheel and pocket/collection menus freeze the town and mission timer. Browse your collection anywhere, then visit **GARAGE** on the minimap to make purchases or manage rides. Biscuits cost $15, tape costs $35, and refill packs cost $30. Press I or G again, or Escape, to close the menu. Touch driving remains outside this prototype.

The [gameplay design](DESIGN.md) explains the intended loops, neighborhood layouts, tuning, scope, and next playtest questions. This is a small playable slice with traffic, patrol and aviation AI. Vehicles can leave the ground and rotate in three dimensions. On-foot jumping and ragdolls have vertical gravity. Fixed street/park obstacles have collision shapes. The hills, bridges and both airfields are playable; building interiors and swimming remain outside this prototype.

The original reference images are preserved in **assets/**. The attached height map is actually a **1536 × 1024, 8-bit RGB PNG**. Its grayscale values are imported into local numeric data in **height-data.js**; the game does not require image downloads or runtime image decoding. Elevations use an arcade scale rather than the map's printed mountain heights, with additional grading around roads and building pads.

The [story campaign design](CAMPAIGN.md) specifies **Operation Unboring**, a proposed ten-job campaign beginning with Spanner's phone call and directions to Sprinkle Garage. Its first playable milestone is the call, the drive, and the garage meeting; campaign gameplay is planned for a later build.

The [police balance design](POLICE.md) separates the implemented four-star air, armour and infantry responses from proposed civilian balance changes: a forgiving mischief meter, explicit chase reasons, staggered reinforcement waves and a four-car swarm. Those civilian changes remain planned; current road patrols stay capped at three.

## Railway timetable

The timetable runs on elapsed, unpaused gameplay time. The first local leaves the north map edge at 0:08; the next leaves at 5:08. Locals alternate between the two platforms every five minutes. Freight alternates between Docklands and the container siding every ten minutes. The spacing accommodates the longer northern approach. Each service has one persistent consist; delays hold it safely rather than spawning another train into occupied track.

Walk up to either side of a passenger or freight car, or the rear of the train, and press **E** (your on-foot interact key) to grab on, even while it is moving. Your character rides visibly on the outside as the train follows its timetable. Press the same key to hop off onto clear ground; a blocked exit keeps you aboard until there is room. **R** recovers you to a road, and reaching the map edge automatically drops you off safely.

| Service / destination | First departure | Repeat | Station dwell |
| --- | --- | --- | --- |
| Northport Local → Central Platform 1 | 0:08 | 10 minutes | 18 seconds |
| Northport Local → Central Platform 2 | 5:08 | 10 minutes | 18 seconds |
| Docklands Shuttle → freight terminal | 3:50 | 20 minutes | 28 seconds |
| Container Shuttle → yard siding | 13:50 | 20 minutes | 28 seconds |

Passenger consists have two cab cars; freight has a cab at each end of a container wagon. All reverse at the destination without a turning loop. Platform 1 departures use the crossover and return on the other main; other services retrace their arrival route. Off-map departures go to Northport. Maximum speeds are 8 m/s on the main, 4.25 m/s in the yard and 2 m/s over the crossover, with acceleration and braking.

Dispatch reserves complete routes atomically, including junctions and shared approaches. Sections release only after the last car plus a safety margin has cleared. Separate platform berths permit trains to wait at the station without locking the whole approach. Crossing lights warn for three seconds, then arms lower for two seconds. Sensors keep arms up for road users already inside and stop the train until the road is clear and the arms are down. Gates remain closed through tail clearance and successive requests; a two-second clear interval precedes opening. NPC traffic, including pursuing police, obeys the crossing limits. Player vehicles can still be driven into physical barriers or trains. Standing people and ragdolls share their solid envelopes. Pausing freezes trains and gate animation.

The original low-poly fleet is authored in Blender: [preview](assets/trains/fleet-preview.png), [editable workshop](assets/trains/train-workshop.blend), and [export script](tools/export-trains.py). Exported triangles are embedded in `train-models.js` for offline play. `node tools/train-browser-check.cjs` verifies the routes and renders the running trains and crossings in Chrome; evidence is written to the ignored `playtest-evidence/trains/` directory.

The northern ImageGen map, terrain draft and prompts are preserved in [assets/concepts/military-base/](assets/concepts/military-base/). `npm run military-heightmap` rebuilds the cleaned extension and numeric import while retaining every original city image row and its water mask. Runtime grading adds the base's 14 m formation, road approach and level rail bed; the access road stays below 14% grade. The military Blender workshop, preview and export manifest live in `assets/military/`; `tools/export-military.py` exports embedded triangles for offline play. `node tools/military-browser-check.cjs` checks the rendered base and navigation in Chrome.

The original fictional infantry and six-wheel carrier are authored in Blender: [soldier preview](assets/troops/soldier-preview.png), [carrier preview](assets/troops/truck-preview.png), [editable workshops](assets/troops/northwatch-troops.blend), and [MIT provenance manifest](assets/troops/manifest.json). Run `blender --background --python tools/export-troops.py` to rebuild `troop-models.js` and both previews. The exporter creates new workshop scenes. Embedded triangles support offline play; separate hips, torso, head, arm, knee and rifle pivots animate movement, seating and aiming without external textures.

## Alien visitors

Four grumpy alien visitors wander the normal town sidewalks wearing conspicuously fake moustaches, taped-on eyebrows, glasses and tiny hats. Their mustard-and-charcoal outfits and blue-gray heads follow the [approved concept](assets/concepts/aliens-ufo/alien-c-angry-disguise-v1.png). A classic silver saucer occasionally enters from the map edge, hovers over a randomly chosen civilian in an open city location, lifts them in a pale green beam, and flies away. Its undisguised pilot is modeled inside the transparent cockpit. Residents return safely to a clear sidewalk after the visit. The first visit starts after 35–60 seconds of play; later visits are separated by 110–180 seconds. Pausing freezes the event. Saucers cruise above normal traffic, avoid the airport approach and give way to nearby aircraft.

## Texture library

The [generic texture library](assets/textures/README.md) contains eight softly painted building and environment materials, with a contact sheet, repeat previews, and generation prompts. These standalone assets are prepared for later application during the map rework.

## Development

The checked-in engine bundle is ready to play. You do not need npm or a build step to open the game.

```sh
npm run check
```

This runs JavaScript syntax checks, deterministic simulation tests, and camera, vehicle physics, jump, and ragdoll regression tests. `tools/browser-check.cjs` adds optional Playwright checks with headless Chrome; it requires a separately available Playwright installation, using `PLAYWRIGHT_MODULE_PATH` if necessary. Run it with `node tools/browser-check.cjs`. Browser evidence is ignored by Git.

`node tools/military-response-browser-check.cjs` checks the fourth-star HUD, warned Northwatch launches, real fighter/helicopter attacks and damage, recall after clearing heat, and the narrow-screen status layout in Chrome. Reports and screenshots are saved under `playtest-evidence/military-response/`. Simulation tests separately cover fatal aircraft damage and bailout, two physical sortie/return cycles per responder type, cover, mode changes, reserve limits and runway sharing.

For focused tank checks, run `node --test tests/tanks.test.cjs tests/tank-physics.test.cjs tests/tank-render.test.cjs tests/tank-integration.test.cjs`. These cover the continuous dispatch clock, physical base-hit attribution, bounded reserves, approved routes, traffic and crossing stops, articulated contacts, ballistic cover, and borrowing, repair and recovery through the actual Game. The companion Chrome workflow is `node tools/tank-browser-check.cjs`; it exercises the tank HUD, mouse turret aiming, firing and gameplay integration, and saves local playtest evidence.

For infantry and carrier checks, run `node --test tests/soldiers.test.cjs tests/military-transport.test.cjs tests/troop-physics.test.cjs tests/troop-render.test.cjs tests/soldier-integration.test.cjs`. These cover patrol movement, finite aiming, bursts and cover, truck dispatch and physical driving, clear stopped exits, passenger protection, collisions and knockdowns, bounded reserves, and borrowing and repairs through the actual Game. `node tools/soldier-browser-check.cjs` exercises the rendered soldiers and carrier in Chrome and saves local playtest evidence.

Automated Chrome checks virtualize pointer capture and send relative look events inside isolated test pages, keeping the desktop mouse free. Keyboard/buttons, WebGL rendering, and gameplay still run in Chrome. Native pointer capture remains a manual play check; the normal game uses Chrome's native mouse look. Browser evidence records the input mode.

For local performance captures, run `npm start` and open **http://127.0.0.1:4173/?profile=1** in Chrome. Press Play to record up to two minutes, or use **Stop and save trace** to finish early. Captures save under **playtest-evidence/performance/** and can also be downloaded as Chrome Trace Event JSON. Add `&seed=42` for a repeatable town. The report measures scoped CPU work and frame intervals; WebGL timings cover CPU submission, and frame intervals include pauses or background time. The profiler is injected only by the development server for that URL and is absent from static builds.

For camera stutter, use **http://127.0.0.1:4173/?profile=1&camera=1**. This lighter capture records camera and subject transforms, mouse deltas, simulation steps per rendered frame, and supported browser long-frame events. Press **F9** when a stutter occurs to mark it in the saved trace. Try looking around while standing still, then while walking or driving, including near walls; keep Chrome in the foreground while recording.

Run `node tools/performance-check.cjs before` for a deterministic ten-second simulation benchmark covering driving, recovery, dismounting, and a ragdoll tumble. Repeat with another label after making changes; reports include timings, collision-pair counts, and simulation snapshots for comparison. `MAYHEM_BENCHMARK_ROOT` can point at another complete checkout for a baseline run. Keep other CPU-heavy work stopped while measuring; timing results are diagnostic rather than test thresholds.

With `npm start` running, use `node tools/render-performance-check.cjs firefox before` (or `chrome`) for repeatable headless camera turns in three scenes. It requires Playwright with the selected browser installed and saves CPU timings, draw counts, camera distances, and screenshots under **playtest-evidence/performance/**. Repeat with an `after` label to compare changes. `GAME_URL` selects another local server; `RENDER_BENCH_SCENE` and `RENDER_BENCH_TRAINS` can serve saved baseline source files. This isolates rendering from simulation; check the reported browser version and GPU before comparing it with an interactive recording.

If you change or upgrade the engine, recreate the locally bundled rendering and physics engines with:

```sh
npm ci
npm run vendor
```

| File | Responsibility |
| --- | --- |
| world.js | Organic road network, neighborhoods, lots, shared landmarks and connected route planning |
| height-data.js | Numeric grayscale samples and provenance of the supplied height map |
| north-height-data.js / assets/north-heightmap* | Imported northern relief, cleaned terrain exports and preservation manifest |
| military.js / military-models.js / military-render.js | Shared base layout, Blender assets and base presentation |
| tanks.js / tanks-render.js | Bounded armoured response, approved road routes, independent turret, ballistic shells and live presentation |
| tank-models.js / assets/tanks/ / tools/export-tank.py | Original Blender Warden mesh bundle, editable workshop, preview and reproducible export |
| soldiers.js / military-transport.js | Base guards, finite infantry aiming and rounds, four-person carrier dispatch, road travel and stopped boarding |
| troops-render.js / troop-models.js / assets/troops/ / tools/export-troops.py | Articulated Blender soldiers, six-wheel carrier, editable workshops, previews and reproducible export |
| terrain.js | Shared ground triangles, softened road profiles, building pads and bridge surfaces |
| core.js | Simulation, map, traffic, police, contracts, inventory, garage, rewards, and save validation |
| vehicle-physics.js | Cannon vehicle bodies, gravity, orientation, elastic contacts, and fixed obstacle shapes |
| aircraft.js | Shared arcade flight, airport traffic, news/police behavior and side-gun projectiles |
| aircraft-models.js / assets/aircraft/ | Offline Blender mesh bundle, editable source, fleet preview and provenance |
| railway.js / railway-render.js | Shared rail alignment, graded formation, station, crossover, crossings and depot rooftop pad |
| trains.js / trains-render.js | Timetable, reversing consists, route reservations, crossing signals and dynamic presentation |
| train-models.js / assets/trains/ | Blender rail fleet, editable workshop, preview and provenance |
| aliens.js / aliens-render.js | Disguised sidewalk visitors, silver saucer and visible pilot, temporary beam abductions and aircraft separation |
| physics.js | Ragdoll joints, gravity, contacts, and automatic get-up |
| scene3d.js | Three.js world, models, perspective camera, lighting, and visual effects |
| audio.js | Local music sequencer, vehicle radio, spatial engines/sirens, effects, and audio lifecycle |
| assets/audio/ | Generated source sounds, provenance manifest, and embedded offline audio bundle |
| tools/build-audio-assets.cjs | Rebuilds and verifies the audio bundle with `npm run audio-assets` |
| game.js | Fixed-step game loop, input, audio controls, persistence, HUD, and minimap |
| controls.js | Vehicle control presets, custom keyboard bindings, save validation, and action mapping |
| vendor/three.min.js | Bundled Three.js renderer for offline and file-open play |
| vendor/cannon.min.js / vendor/cannon.cjs | Bundled Cannon physics engine for browser play and Node checks |
| index.html / styles.css | Responsive interface and controls |
| tests/*.test.cjs | Simulation, inventory, garage, camera, vehicle physics, jump, and ragdoll regression checks |
| tools/serve.cjs | Optional static development server |

Next priorities: playtest toy reach and the garage economy, tune chases, add touch/gamepad controls, then add route variety and cosmetic rewards.

Version 0.9.0 builds the world around the supplied map and height map, with physical hills, coastlines, river crossings, and distinct coastal districts. Automated Chrome checks continue to keep the desktop cursor free.
