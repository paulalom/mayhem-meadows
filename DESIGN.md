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

## Driving and walking

- **Arcade steering:** forward/reverse acceleration, speed-sensitive turning, generous braking, predictable grip, and a handbrake that makes drifting easy to discover.
- **Forgiving collisions:** cars bounce and lose some speed; they do not get stuck against corners. Heavy impacts reduce vehicle condition. A wreck becomes a confetti cloud and ejects the player safely.
- **Borrow any civilian car:** press Interact near a stationary car. Traffic slows for intersections. Exiting at speed is blocked with a useful message; exiting while stopped places you on a free side of the car.
- **Three recognizable rides:** a forgiving compact, a fast but loose sports car, and a slower, sturdy van. Their silhouettes and colors explain their character.
- **On foot:** camera-relative movement, sprint, car entry, and a short-range confetti popper aimed into the 3D world with the pointer. Confetti can startle residents and distract police; it is a toy, not a realistic weapon system.
- **Immediate recovery:** a dedicated unstuck action returns you to a safe nearby road with a small score penalty. No long walk back after a bad crash.

Prototype controls: WASD/arrow keys to move or drive; right mouse drag to orbit the camera; C to recenter; E to enter/exit or use a nearby service; Space for handbrake while driving or a confetti burst on foot; Shift for boost/sprint; H for horn; Esc/P to pause; R for recovery. Contract buttons live in the HUD so accepting a gig never depends on finding a tiny interaction point.

## Third-person presentation

The camera makes the town feel like a place you can run through. Keep the player, the next corner, and the nearest traffic readable; a pleasing view should also explain where to go.

- **On-foot orbit:** WASD follows the camera's horizontal forward/right directions. Right mouse drag changes yaw and pitch without locking the pointer. C returns the view behind the character.
- **Driving chase:** the camera follows behind the car with enough height to read an intersection. Let the player look around; return smoothly toward the travel direction so steering and view stay connected.
- **Safe camera distance:** shorten the camera boom when buildings obstruct the view, then ease it back out in open space. The camera must not spend a chase inside a wall.
- **Readable objectives:** glowing ground rings and upright markers reveal mission targets in perspective. A HUD compass supplies bearing and distance when the target is around a corner; the overhead minimap shows routes, services, and patrols.
- **Ground-plane simulation:** preserve the original arcade movement, handling, and collision rules beneath the 3D presentation. Characters and cars move on flat streets; roofs, curbs, and trees provide depth, with no stair, jump, or elevated-road physics in this milestone.
- **Local rendering:** Three.js uses real perspective meshes and WebGL 2, with the engine bundled beside the game. No runtime asset download or service is needed. A friendly failure overlay explains when the browser cannot create a 3D view.

## Trouble and the Fun Police

Heat has three visible levels. The number of pursuing patrols follows the level rather than scaling without limit.

| Heat | Response | Player's opportunity |
| --- | --- | --- |
| 0 | Patrols wander. | Explore and learn the town. |
| 1 | One patrol investigates/chases. | Practice escape; the chase is gentle. |
| 2 | Two patrols pursue. | Use corners, parks, and alleys to break sight. |
| 3 | Three patrols pursue aggressively. | Commit to escape or spend cash on a wash. |

Heat rises from startling residents, hitting traffic hard, and bothering patrols. A borrowed car creates a small first-time heat bump. **There is no cash reward for hitting people.** Different driving stunts are the interesting scoring actions.

Police follow roads and chase the player's last known position. Buildings block their view. When no patrol sees the player, an escape countdown appears; breaking sight must produce immediate readable feedback. New trouble resets that countdown. A car wash clears heat and repairs the car for a visible price.

Police contact gradually drains composure rather than causing an instant fail. If composure runs out, you get a “BUSTED-ISH” screen, lose a modest amount of cash, and reappear at the town square with your upgrades intact. Restarting takes one button.

Prototype target tuning: 8 seconds out of sight to start cooling; approximately 6 seconds per heat level to clear it; 2 seconds of grace after recovery. These values are playtest hypotheses, not fixed requirements.

## Contracts

Only one contract is active at a time. Every destination is marked in the world and on the minimap; an off-screen arrow gives direction and distance. Timers start after acceptance, pause with the game, and never secretly run in a background tab.

| Contract | Example | Mechanism |
| --- | --- | --- |
| Ridiculous delivery | “Emergency Disco”: pick up an enormous imaginary disco ball and deliver it to the dance hall. | Reach pickup, then drop-off. Faster and cleaner trips earn a bonus. |
| Checkpoint dash | “The Lawn Enforcement Slalom”: race through a sequence of colorful gates. | Follow 5–7 ordered checkpoints; choose your own roads between them. |
| Party route | “Operation Un-Boring”: bring a confetti parade to three neighborhoods. | Stop at party markers and press the horn; the challenge is route choice under rising heat. |

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

A compact map is better than an empty large one. Four or five streets in each direction create short blocks, recognizable corners, and plenty of choices.

- **Town square:** safe spawn, garage, a conspicuous first car, and the contract board.
- **Neon market:** tight corners, delivery targets, and lots of civilian traffic.
- **Sprinkle Park:** broad paths and an escape shortcut that cars can squeeze through.
- **Disco district:** open avenues that encourage speed and drifting.
- **Car wash:** visible escape/repair service with an easy entrance.

Visual landmarks matter more than realism. Buildings have chunky roofs, pastel walls, and big signs. Cars and residents have simple, playful 3D silhouettes. Roads, sidewalks, mission rings, and the player's car remain readable under confetti and police effects. The camera follows smoothly with a little look-ahead; the HUD leaves the center of play clear.

## Tone and feedback

No blood, graphic injuries, realistic firearms, or grim death screens. Startled residents tumble briefly into confetti, pop back up, and flee. Traffic passengers are abstracted away. Speech bubbles choose short fake curses: “SON OF A BISCUIT!”, “HECKITY HECK!”, “FLIPPIN' TURNIPS!”, and “OH, CRUMBS!”

Crashes get a bassy cartoon thump; pickups get a rising jingle; a perfect drift gets a tiny celebratory accent. Audio starts after a player gesture and has an obvious mute button. Camera shake is restrained and can be disabled alongside extra particles. Confetti is capped and pooled so a big celebration does not overwhelm the browser.

## First playable slice

Build a complete small loop before adding a larger city:

1. One compact hand-built town rendered in third-person 3D with locally bundled Three.js and WebGL 2.
2. Walk, enter/exit, arcade driving, traffic, residents, collisions, and confetti.
3. Three reusable contract types with checkpoints, timers, pay, and immediate retry.
4. A readable three-level pursuit system, escape timer, composure, and quick recovery.
5. Garage/wash services, two capped upgrades, local saving, minimap, objective compass, speed display, pause, sound and motion settings.
6. Helpful first-run controls plus a clear “Play” button; no account, installation, or network requirement.

Technical shape: plain HTML/CSS/JavaScript, local geometry and audio, a checked-in Three.js engine bundle, and no external services. A fixed-step simulation keeps movement consistent across frame rates; 3D rendering uses requestAnimationFrame while a separate 2D canvas draws the minimap. The camera and models interpret simulation state without changing contract, heat, upgrade, or saving rules. Input is scoped to the game, blur clears held keys, and background tabs pause. The static files run from a normal file open as well as any static server; npm is only needed to regenerate the engine bundle during development.

## Deliberate cuts

No multiplayer, huge procedural city, interiors, stairs, jumping, elevated driving, character customization editor, inventory management, realistic damage, complex combat, story campaign, licensed music, or online economy in this slice. Touch controls and gamepad support can follow once keyboard driving and the camera are good.

## Playtest questions and acceptance checks

- Can a new player enter a car and start a job without reading a manual?
- Is a 30-second free drive enjoyable before rewards exist?
- Does the first contract fit in 1–3 minutes and teach a useful route?
- Does losing police sight visibly begin escape? Can a new player escape heat 1?
- Can mistakes produce a recovery within ten seconds?
- Do car entry, exit, collision resolution, and mission targets avoid inaccessible positions?
- Do pause, tab switching, retry, save reload, mute, and reduced motion behave predictably?
- Does the game stay smooth with maximum patrols and confetti active?
- Can players turn a corner, borrow a car, and aim confetti without fighting the camera?
- Does the view stay outside buildings, and do markers plus minimap keep destinations easy to find?
- Do file-open play, full screen, camera recentering, and the WebGL failure overlay behave predictably?

Tune driving and heat first. More content cannot rescue an unpleasant steering model.
