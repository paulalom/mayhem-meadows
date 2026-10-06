# Mayhem Meadows

**A tiny town. Terrible errands. Excellent bad decisions.**

A single-player, third-person 3D, GTA-inspired toybox that runs entirely in the browser. The tone is Saturday-morning cartoon chaos: confetti impacts, springy crashes, grumpy residents yelling “FUDGE NUGGETS!”, and the town's overenthusiastic Fun Police. All characters, art, place names, and audio are original.

## The promise

Within ten seconds you can get into a car. Within a minute you can finish a silly job, skid around a corner, annoy the police, or discover a shortcut. Driving is the main toy; missions give it purpose. Walking lets you change cars and cause a different kind of trouble.

The guiding rule: **a mistake should produce a funny situation before it produces a penalty.**

## The three loops

| Scale | Loop | Why it is fun |
| --- | --- | --- |
| Moment to moment | Spot an opening → accelerate → drift or squeeze through → enjoy the reaction | Movement feels good even with no mission active. |
| One outing, 1–3 minutes | Pick a gig → borrow a ride → make deliveries or collect checkpoints → decide whether to detour for style → get paid → escape heat | A clear destination creates improvisation and small risk/reward decisions. |
| Several outings | Bank cash → improve a ride or buy a silly perk → try a new route or contract → beat your best score | Progress changes what you can do without demanding a grind. |

The player can ignore contracts and play freely. There is no mandatory story sequence.

## Story campaign expansion

[Operation Unboring](CAMPAIGN.md) adds an optional ten-job story about rescuing the cancelled Meadows street party. Its opening phone call sends the player from the yellow Pocket Rocket to Sprinkle Garage. Each stage names the destination, shows the route and distance, and changes to the correct interaction prompt on arrival. The campaign design covers the opening script, mission progression, rewards, checkpoints, phone log, and recovery rules for the next playable milestone.

## Driving and walking

- **Arcade steering:** forward/reverse acceleration, speed-sensitive turning, generous braking, predictable grip, and a handbrake that makes drifting easy to discover.
- **Forgiving collisions:** cars have three-dimensional rigid bodies with gravity and elastic contacts. Walls, other cars, and fixed street/park props can bounce them away, lift a corner, or send them rolling. Height and full orientation determine contact, so a flying or flipped car is not forced into an upright road footprint. Heavy impacts reduce vehicle condition. A wreck becomes a confetti cloud and ejects the player safely.
- **Borrow any civilian car:** press Interact near a stationary car. Traffic slows for intersections. Exiting at speed is blocked with a useful message; exiting while stopped places you on a free side of the car.
- **Three recognizable rides:** a forgiving compact, a fast but loose sports car, and a slower, sturdy van. Their silhouettes and colors explain their character.
- **On foot:** camera-relative movement, sprint, a Space jump with gravity and a landing, car entry, and a short-range confetti popper aimed along the camera view into the 3D world. Jumping requires a fresh press after landing; holding Space cannot produce repeated hops. Confetti can startle residents and distract police; it is a toy, not a realistic weapon system.
- **Immediate recovery:** R returns you to a safe nearby road with a small score penalty and rights a flipped ride, clearing its physical motion as well as its visible pose. No long walk back after a bad crash.
- **Physical tumbles:** moving cars and confetti bursts send residents into jointed ragdolls. On foot, the player tumbles after a vehicle impact or can press F for a voluntary dramatic flop. Gravity, connected limbs, bouncing contacts, and street friction produce a different little mishap each time. Everyone gets up after a few seconds; R skips the player's recovery wait.
- **Solid bodies:** vehicles use finite-height collision shapes and full three-dimensional rotation against the ground, walls, fixed props, and each other. Tree trunks, lamp posts, park benches/fountain, the garage kiosk, and the car wash frame have solid shapes. Standing people cannot walk through cars or each other. Ragdoll joints and limbs contact the ground, building walls, and moving cars. Hits create confetti and fake curses, with no cash reward for hitting people.

Prototype controls: WASD/arrow keys to move or drive; click the town to capture the mouse, then move it to look; hold right mouse for shoulder aiming with slower sensitivity; left-click to use the equipped toy on foot; C to recenter; E to enter/exit or use a nearby service; Space to jump on foot or use the driving handbrake; Shift for boost/sprint; H for horn; F for an on-foot flop; Esc to release the mouse and pause, P to pause; R for recovery. Contract buttons live in the HUD so accepting a gig never depends on finding a tiny interaction point.

## Vehicle condition

Each civilian chassis has two fictional make/model variants with different power, handling, grip and durability. Impacts reduce body, engine and handling health independently for civilian and police vehicles. Engine damage cuts acceleration and speed; running-gear damage reduces steering and grip. Progressive dents, cracked glass and smoke communicate these losses. Critical hull or engine damage starts an eight-second fire warning before an explosion; blasts can start delayed chain fires, move nearby vehicles and knock people over. Drivers can bail out with E or stop and use tape. Full garage/wash repairs restore all systems and visuals; tape restores 55 to each meter and extinguishes the fire. Recovery changes position/orientation without repairing damage. Garage saves retain make/model and all component condition, including dangerous fire state.

## Toys, pockets, and a place to park

Inventory should create new funny choices within seconds. The three toys occupy fixed wheel slots: hold Tab, choose with the pointer, arrows, or 1–3, then release to equip. Escape cancels. The wheel pauses the town and timers; opening it clears movement keys so choosing a toy never accidentally drives into a wall.

| Toy | Character | Cost and constraint |
| --- | --- | --- |
| Confetti popper | Quick, short-range burst; the reliable starter toy | Free, unlimited uses, brief cooldown |
| Inflatable hammer | A close-range padded swing with a firm ragdoll shove | $120 permanent unlock; unlimited uses, slower swing |
| Party cannon | A visible traveling ball that bursts into a wider confetti party | $280 unlock includes six charges; twelve-charge capacity |

Left-click uses the equipped toy on foot. Hold right mouse to aim with a center crosshair, closer shoulder view, and slower sensitivity. The first click on an uncaptured game only captures the mouse; it never accidentally fires. Space jumps on foot and remains the handbrake in a car. Hits produce confetti, fake curses, physics tumbles, and heat. They do not pay cash. Each toy has a different reach and rhythm, so choosing one changes the situation rather than only increasing a number.

Press **I** for pockets. Carry at most five biscuits (+40 composure, $15 each), three repair tapes (+55 current-car condition, $35 each), and three refill packs (+6 cannon charges, $30 each). Starter supplies are two biscuits, one tape, and one refill. Supplies work anywhere they are useful; a full meter, missing car, or locked cannon consumes nothing. A partial top-up uses one item and stops at the cap. Buying supplies requires stopping at Sprinkle Garage.

Press **G** for a three-slot car collection. At Sprinkle Garage, save the civilian ride you are driving, bring a saved ride back out at a collision-safe spot, repair it for $45, or repaint it for $25. Stored rides retain condition and paint, including after a reload. A wreck must be repaired before retrieval. Bringing out a deployed ride moves that car instead of creating a duplicate. Existing boost and armor upgrades apply to every ride. Browsing is available anywhere; car management requires a garage visit.

The added outing loop is **finish a gig → restock or unlock a toy → save a favorite ride → return to free roam with a new way to cause trouble**. No weight limits, sorting chores, random loot tiers, or compulsory shopping interrupt the driving loop. Pocket and collection menus freeze simulation time and release the mouse; closing them returns keyboard focus to the game. A visible prompt asks for a click to capture the mouse again. Persistent inventory is validated and old saves migrate with their cash and upgrades intact.

A full garage can release a slot for a new favorite. Releasing ownership leaves a deployed car in town, preserves its condition, and pays no cash; it is a collection choice rather than a way to farm money.

## Third-person presentation

The camera makes the town feel like a place you can run through. Keep the player, the next corner, and the nearest traffic readable; a pleasing view should also explain where to go.

- **On-foot orbit:** WASD follows the camera's horizontal forward/right directions. Clicking the town captures the mouse; movement looks naturally left/right and up/down without holding a button. C returns the view behind the character. Help offers look sensitivity and an invert up/down preference.
- **Shoulder aiming:** holding right mouse on foot moves the camera closer over the character's shoulder and slows looking. The character turns toward the camera's aim direction, and the crosshair stays centered. Left-click fires or swings the equipped toy. Releasing aim returns to the exploration view.
- **Driving chase:** the camera follows behind the car with enough height to read an intersection. Mouse movement temporarily suspends automatic following so it never fights looking around; after a short delay, return smoothly behind the car.
- **Safe camera distance:** shorten the camera boom when buildings obstruct the view, then ease it back out in open space. The camera must not spend a chase inside a wall.
- **Readable objectives:** glowing ground rings and upright markers reveal mission targets in perspective. A HUD compass supplies bearing and distance when the target is around a corner; the overhead minimap shows routes, services, and patrols.
- **Street movement and physics:** the road map stays flat, but cars use Cannon rigid bodies with gravity, height, and quaternion orientation. Elastic vehicle contacts produce airborne bounces, rolls, and landings against the ground, walls, cars, and fixed street/park props. Upright characters can jump. Fallen characters use a separate three-dimensional joint solver with vertical gravity, limb constraints, and solid contacts. There are no stairs or elevated road routes in this milestone.
- **Partial environment destruction:** outdoor physical props have per-kind durability. Popper bursts chip them, hammer swings break lighter props, cannon blasts damage nearby scenery, and hard chassis impacts can smash obstacles. Destroyed objects immediately leave the standing, vehicle, ragdoll, and aiming collision sets; their instanced visuals and signs disappear together. Debris settles and expires within 4.5 seconds with a shared 120-piece budget. Buildings, the garage kiosk, terrain, roads, and exterior scenic decoration remain intact; garage/wash markers retain their service functions. Destruction raises heat only when caused by the player and resets on reload rather than entering progression saves.
- **Local rendering:** Three.js uses real perspective meshes and WebGL 2, with the renderer and Cannon physics engine bundled beside the game. No runtime asset download or service is needed. A friendly failure overlay explains when the browser cannot create a 3D view.

## Trouble and the Fun Police

The next balance gives the player room for several small incidents before pursuit. A visible mischief meter rises from witnessed reports: ordinary horns, drift, light bumps, owned rides, and authorized story actions add nothing. The meter warns at 25, dispatches one patrol at 50, brings a three-car swarm at 80, and caps the response at four patrols at 100. Quiet travel cools minor trouble before a chase begins.

The [police balance design](POLICE.md) specifies incident values, witness reporting, staggered reinforcement arrivals, persistent chase reasons, and fair escape rules. Every pursuit names its cause. Losing sight immediately shows SEARCHING with a visible 12-, 18-, or 24-second escape countdown. Police follow reported or last-seen locations; fresh sightings and reports explain any search reset.

The swarm creates pressure through converging roads and clear warnings. Every base car can outrun a patrol on a straight, one exit stays open, contact damage is capped across all officers, and reinforcements arrive through distant clear streets. Escape clears both wanted stars and accumulated mischief. The $75 wash remains an optional repair and escape shortcut; campaign pursuits supply a voucher. Free-roam capture retains the modest cleanup fee and preserves upgrades, while campaign capture and checkpoint retries are free.

These thresholds and up to four patrols are proposed tuning for the next gameplay build. The current playable prototype uses immediate heat increments, three pursuit levels, and up to three patrols.

## Contracts

Only one contract is active at a time. Every destination is marked in the world and on the minimap; an off-screen arrow gives direction and distance. Timers start after acceptance, pause with the game, and never secretly run in a background tab.

| Contract | Example | Mechanism |
| --- | --- | --- |
| Ridiculous delivery | “Emergency Disco”: pick up an enormous imaginary disco ball and deliver it to the dance hall. | Reach pickup, then drop-off. Faster and cleaner trips earn a bonus. |
| Checkpoint dash | “The Lawn Enforcement Slalom”: race through a sequence of colorful gates. | Follow 5–7 ordered checkpoints; choose your own roads between them. |
| Party route | “Operation Un-Boring”: bring a confetti parade to three neighborhoods. | Stop at party markers and press the horn; choose a route and add optional driving stunts. Required party actions are authorized under the planned police balance. |

Contract timers control the speed bonus. Finishing overtime still earns base pay; abandoning loses its potential payout, not already-earned cash. The player can retry or choose another immediately. Repeating a contract varies its destination to encourage route learning.

## Scoring and rewards

Cash is for successful contracts and optional style bonuses. Score is for showing off. The two are distinct and clearly labeled.

- Drift for a minimum sustained duration, pass a civilian car closely without contact, or keep a clean driving streak to build style.
- A short combo window rewards linking different stunts. Repeating the same event on the same target has a cooldown; parked-car shuffling and stationary donuts should not print unlimited cash.
- A heavy collision breaks the combo. It should not erase the entire outing.
- Contract pay is the dependable income. Optional style is a bonus, so careful driving remains viable.

First purchases should arrive after one or two jobs: a modest boost upgrade, stronger vehicle condition, or a playful paint color. Prices and effects are shown before purchase. Permanent improvements are small and capped; base cars must already be fun.

Money, purchases, completed-contract counts, settings, and best score are stored locally when browser storage is available. A denied or full storage area should only disable persistence; it must not prevent play. A future settings screen can offer a confirmed save reset.

## The town is a toybox

The playable world spans 600 metres in each direction, with the supplied map covering a 600 × 400 metre coastal region and ocean to the south. The height map supplies the real ground shape. Dense city streets open into curving suburbs, northwest hill roads and coastal neighborhoods; bridges reach the airport side of the river. Short trips around the downtown garage remain quick, while longer outings offer different scenery and elevation.

| District | Layout and identity | Play purpose |
| --- | --- | --- |
| Old Town | Winding streets, small homes and closely spaced fronts west of the center | Shortcuts and readable corners around a compact neighborhood |
| Downtown | Denser shops, taller corners, broad sidewalks and the garage | A lively starting point with quick access to services and contracts |
| Northside | Curving residential loops, detached homes, gardens and quiet courts | A relaxed change of pace with alternative routes and turnaround space |
| West Beach & Marina | Coastal cafes and homes following the bay | Scenic driving beside the shore and harbor |
| Docklands | Warehouses, loading yards and a southern pier approach | Industrial silhouettes, open yards and the car wash |
| Ridge Heights | Northwest hills, hairpins, a summit road and a viewpoint branch | Climbing, coasting and exploring a different kind of road |
| Airport | Terminal, hangars and runway landmarks across the river | A destination reached by two physical bridge routes |
| Tidewell Marsh | Quiet roads along the southeast wetland edge | Open terrain and a quieter lookout beyond the busy city |

Buildings face their streets, with changing setbacks and spacing as the city opens into suburbs. Each rotated building footprint drives rendering, car collision, ragdoll collision and sight obstruction. Open gaps stay open. Sidewalks follow the actual road curves. Houses have deeper garden setbacks; urban fronts keep room for walking past furniture and doorways. Trees, benches and other solid street props use shared visual and physical shapes.

Traffic and patrols follow the same road network that the player sees. Navigation projects a position onto the nearest road, finds a connected route through its junctions, then follows sampled bends. Parked cars sit in clear roadside bays with street access, keeping driving lanes and sidewalks open. Recovery searches clear positions on those roads. Contract destinations use reachable road anchors across the city and suburbs, so the larger world creates different outings without stranding a marker in a garden.

People are 14% smaller, including their standing contacts, ragdoll joints and toy origins. This gives roads, cars and buildings more presence while preserving the jump and driving feel. Camera height follows the new character proportions.

The countryside is playable ground. Bright source pixels create higher northwest hills, while the dark coastal and river regions become water beds. A shared triangulated heightfield drives rendering, vehicle contact, walking, jumps, ragdolls and camera clearance. Road cuts soften steep slopes for the arcade handling, and solid foundations support level buildings on uneven lots. Bridges keep their decks above the river bed. A short submerged delay returns a splashed player or car to a clear road position while preserving progress.

The supplied height PNG is 8-bit RGB, despite the original 16-bit description. Numeric grayscale samples preserve that source precision and load synchronously from bundled JavaScript. Elevation is scaled for the toy world, reaching roughly 32 metres rather than the printed mountain heights. No image request, backend, or network connection is required.

The HUD names the current district. The minimap colors neighborhoods and draws actual curved roads and rotated building footprints, helping players recognize loops, branches, open yards and gaps before choosing a route. Large signs, recognizable rooftops and village greens provide landmarks at street level. Confetti, patrols and objective rings keep their bright accent colors so decoration does not hide the next action.

## Tone and feedback

No blood, graphic injuries, realistic firearms, or grim death screens. Startled residents tumble briefly into confetti, pop back up, and flee. Traffic passengers are abstracted away. Speech bubbles choose short fake curses: “SON OF A BISCUIT!”, “HECKITY HECK!”, “FLIPPIN' TURNIPS!”, and “OH, CRUMBS!”

Crashes get a bassy cartoon thump; pickups get a rising jingle; a perfect drift gets a tiny celebratory accent. Audio starts after a player gesture and has an obvious mute button. Camera shake is restrained and can be disabled alongside extra particles. Confetti is capped and pooled so a big celebration does not overwhelm the browser.

The town has an original synthesized soundtrack on foot. Vehicle radios offer Biscuit FM (disco/funk), Neon Drive (synthwave), Meadow Waves (mellow dub), and off; B/N and radio arrows change the station. Each station has its own multi-bar bass, chord, melody, and percussion patterns. Master, music/radio, and effects levels are adjustable in help and saved locally.

Vehicle audio follows the simulation: engine character differs between compact, sports, and van; throttle, speed, and boost change its pitch and texture. Nearby traffic and pursuing patrol sirens fade with distance and pan relative to the camera. Parked civilian cars and failed engines stay quiet. Seven original Runway-generated samples provide the three engine loops, siren, horn, cartoon crash, and confetti pop. Compressed sounds are embedded in a local JavaScript bundle and decoded after a player gesture, preserving file-open and offline play. Synthesized effects cover loading or unavailable samples; decoded loops replace them on the next active update. Grounded tires squeal during braking or lateral sliding, and footsteps follow actual movement. A bounded audio scheduler and voice limits keep playback manageable. Pausing, opening menus, muting, or hiding the tab cancels playback, including queued music; resuming starts a fresh phrase. Decoding cannot restart paused audio, and Web Audio failures leave gameplay available.

## First playable slice

Build a complete small loop before adding a larger city:

1. One compact hand-built town rendered in third-person 3D with locally bundled Three.js and WebGL 2.
2. Walk, jump, enter/exit, arcade driving with three-dimensional rigid-body collisions, traffic, residents, and confetti.
3. Three reusable contract types with checkpoints, timers, pay, and immediate retry.
4. A readable three-level pursuit system, escape timer, composure, and quick recovery.
5. Garage/wash services, two capped upgrades, local saving, minimap, objective compass, speed display, pause, sound and motion settings.
6. Helpful first-run controls plus a clear “Play” button; no account, installation, or network requirement.

Technical shape: plain HTML/CSS/JavaScript, local geometry and audio, checked-in Three.js and Cannon engine bundles, and no external services. A fixed-step simulation keeps movement consistent across frame rates; 3D rendering uses requestAnimationFrame while a separate 2D canvas draws the minimap. The camera and models interpret simulation state without changing contract, heat, upgrade, or saving rules. Input is scoped to the game, blur clears held keys, and background tabs pause. The static files run from a normal file open as well as any static server; npm is only needed for development checks and regenerating engine or audio bundles.

## Deliberate cuts

No multiplayer, huge procedural city, interiors, stairs, swimming, aircraft, character customization editor, loot grids or weight management, realistic damage, complex combat, story campaign, licensed music, or online economy in this slice. Touch controls and gamepad support can follow once keyboard driving and the camera are good.

## Playtest questions and acceptance checks

- Can a new player enter a car and start a job without reading a manual?
- Is a 30-second free drive enjoyable before rewards exist?
- Does the first contract fit in 1–3 minutes and teach a useful route?
- Can the player read the cause of police attention, notice the warning before dispatch, and cause several small incidents before a chase? Can a new player escape one patrol with a base ride?
- Can mistakes produce a recovery within ten seconds?
- Do car entry, exit, collision resolution, and mission targets avoid inaccessible positions?
- Do airborne cars retain height and full rotation, collide with walls and fixed props, bounce without explosive energy gain, and land safely? Can a flipped car recover without leaving its collision body behind?
- Does Space jump only on foot, require a fresh press after landing, and leave left-click as the toy action? Do jumps pause and recover cleanly?
- Do pause, tab switching, retry, save reload, mute, and reduced motion behave predictably?
- Can players distinguish the three radio stations and vehicle engines, hear nearby pursuing sirens, and balance music against effects? Does radio off keep the engine audible, and do menus and mute silence queued notes without leaking audio nodes after repeated resumes?
- Does the game stay smooth with maximum patrols and confetti active?
- Can players turn a corner, borrow a car, and aim confetti without fighting the camera? Does looking right turn the view right, and does holding aim slow it comfortably?
- Does the first capture click avoid firing? Do Esc, menus, full screen, and tab changes release the mouse safely, clear held input, and show how to resume looking?
- Does the view stay outside buildings, and do markers plus minimap keep destinations easy to find?
- Can a player recognize dense shops, quiet gardens, industrial yards and the riverfront from the street? Do wider pavements remain walkable past props, and do visible building gaps match their collision space?
- Can a player drive from the center into both suburbs and return along connected roads? Do traffic, patrols and recovery follow real bends instead of crossing lots? Do rotated buildings block their visible walls while leaving their empty surrounding corners clear?
- Does shrinking characters preserve consistent standing, aiming, tumbling and recovery, without changing their size during a fall?
- Do file-open play, full screen, camera recentering, and the WebGL failure overlay behave predictably?
- Do falling bodies retain connected limbs and stay outside walls, vehicles, and the ground? Can both residents and the player get up in a safe position?
- Do pause and recovery work during a tumble, and can a crowd of fallen residents stay playable without unbounded physics work?
- Can players switch toys, use a biscuit, and return to driving without stuck keys or timer loss? Does canceling the wheel preserve the equipped toy?
- Do cannon charges and pocket stack limits create light restocking choices? Does retrieval preserve a saved car's condition and prevent duplicates?
- Do old saves keep progress, and do toy unlocks, supplies, paint, and collection survive a reload with no external service?

Tune driving and heat first. More content cannot rescue an unpleasant steering model.
