# Mayhem Meadows police balance

The Fun Police should turn a sustained spree into a funny chase. A few mistakes or scattered pranks leave room to play; repeated public chaos earns a warning, one pursuing patrol, and then a clearly announced swarm. The player always sees what caused the response, whether they are visible to police, and how to escape.

The current game has four wanted stars. The first three use the existing civilian response, capped at three road patrols, with a police helicopter at three stars. At four stars, Northwatch sends one military air responder after an announced warning: a fighter for a player in an airplane or helicopter, or an armed heavy helicopter for a player in a ground vehicle. These units use real flight controls, sight checks, short directional cannon bursts, last-known-position searches and a return to base. Vehicle changes require a response change through dispatch rather than an extra instant spawn. The HUD identifies the unit and its dispatch/search state.

The tank response is also implemented. After 60 continuous seconds at four stars, armour can dispatch whether the player is on foot, driving or flying. Its cannon still targets ground vehicles only. Physically hitting Northwatch property, a base vehicle or base personnel with a player weapon or heavy driven impact also authorises armour. A base attack raises four stars immediately and bypasses the minute-long buildup, including when the player is on foot. Merely firing inside the perimeter, missing, hitting civilian cover first, or NPC collateral does not count as attacking the base. Dispatch starts with an eight-second mobilisation warning. Pause and menus freeze both clocks; washing, capture and escape cancel the alarm and pending warning.

Only one AI tank responds at a time. Dispatch has a 90-second cooldown, reuses a healthy parked unit when possible, and permits at most two surviving chassis so a borrowed tank is preserved without creating an unlimited reserve. New tanks enter at a clear distant Northwatch road position or the airport perimeter reserve. Routes use only approved broad outskirts roads with room for the physical chassis. Tanks brake for blocked traffic and level crossings, stop if pushed off a suitable road, and wait on their reachable network when a downtown destination has no approved connection. They use a reported approach point and confirmed sightings, search the last known position, then return to their dispatch post. They do not aim the cannon at an on-foot player or an aircraft.

The Warden's turret yaw and gun elevation turn independently of its tracked chassis, with finite aiming rates and a 4.5-second reload. AI fire requires visible ground-vehicle contact, alignment, aim time and a low chassis speed. Shells leave the actual muzzle, fall under gravity, and stop at the first terrain, building, scenery or vehicle hit; solid cover and an obstructed barrel prevent shots through walls. Hull, rotating turret and pitched barrel share articulated contact shapes for vehicles, people, ragdolls and projectiles. At four stars, the current unseen escape countdown is 32 seconds; confirmed military air, armour, infantry or carrier sight resets that shared countdown.

A stopped tank can be borrowed with E: WASD drives, mouse movement aims the turret, and holding left mouse fires. The HUD shows cannon readiness and armour approach/search/return states; the minimap shows a tank and its turret direction. R recovers to a clear approved road without repairing damage. Its hull capacity is 600, with separate engine and handling condition; Repair Tape, the wash and current-ride repairs retain that capacity. Civilian garage storage and saved garage records exclude tanks. The fictional Blender source and preview are in `assets/tanks/`, with `tools/export-tank.py` producing `tank-models.js` for `tanks-render.js`.

Northwatch also has six base guards and a road infantry response. The existing compound personnel become armed guards; they patrol, defend the base during four-star heat, and keep their ground pursuit near the compound. Four stars or an actual player attack on the base starts a separate six-second carrier warning. One six-wheel carrier drives four soldiers from the base toward the reported incident. Clear connected roads must accommodate its 5.8 × 2.4 metre footprint; airfield movement areas are excluded. The driver obeys traffic and level crossings, brakes before deployment, and unloads soldiers one at a time into physically clear positions. Passengers follow the rigid body's position and orientation while riding and are excluded from ground contacts and fire.

Infantry navigate around physical walls and vehicles, use the shared terrain and pedestrian contacts, and respect closed railway crossings. Their rifles turn at finite rates and require alignment, 0.45 seconds of settled aim, a clear ground target and recovery grace to have ended. Fire uses three-shot bursts separated by a 2.2-second reload pause. Rounds travel from the modeled muzzle and stop at the nearest person, vehicle, scenery, building or terrain hit. Only current four-star player contacts cause damage; all soldiers share a ten-point burst budget replenished at 12 points per second. This limits simultaneous concentrated fire while preserving actual shots and cover. Toys and vehicle impacts can stun or tumble soldiers, interrupting movement and fire. They search confirmed positions rather than following an unseen player indefinitely. Airborne targets remain the aircraft response's responsibility.

A confirmed rifle hit pauses passive composure recovery for three seconds. Taking cover stops further hits and allows recovery to resume, while a lone guard can maintain pressure through its reload pauses.

Clearing heat cancels infantry warnings and rounds, returns guards to patrol, and tells deployed squads to walk back to their stopped carrier before its return trip. Carrier dispatch has a 90-second cooldown, reuses parked trucks and caps surviving chassis at two; infantry are capped at 14 including the six guards. Borrowing a carrier preserves that chassis and uses normal E/WASD/R controls, full vehicle contacts, 240 hull health and separate component condition. Repair Tape, the wash and current-ride repairs retain the truck's capacity. Civilian garage storage, armour upgrades and saved garage collections exclude the carrier. The original Blender soldier and truck workshops, previews and MIT manifest are in `assets/troops/`; `tools/export-troops.py` exports articulated geometry to `troop-models.js` for `troops-render.js`.

Run `node --test tests/tanks.test.cjs tests/tank-physics.test.cjs tests/tank-render.test.cjs tests/tank-integration.test.cjs` for focused armour checks, or `node --test tests/soldiers.test.cjs tests/military-transport.test.cjs tests/troop-physics.test.cjs tests/troop-render.test.cjs tests/soldier-integration.test.cjs` for infantry movement, aiming, fire, transport, collisions and actual Game integration. `node tools/tank-browser-check.cjs` and `node tools/soldier-browser-check.cjs` are the companion Chrome gameplay workflows. The military air, tank and infantry responses described here are current behavior; the civilian mischief redesign below is still a proposal.

The remaining sections describe proposed replacement balance rules for a future build. The current prototype still uses immediate heat for police sightings or nearby incident sounds and two-second resident help calls. Unnoticed incidents add no heat and do not reset escape. The new mischief thresholds, revised civilian patrol limit, and expanded feedback below still need implementation and playtesting; the existing fourth military star should remain separate from those three proposed civilian tiers.

## Room for mischief

Show a **Mischief meter from 0 to 100** beside the wanted stars. The meter measures recent reported trouble. The three civilian stars measure the response already dispatched; retain the separate fourth military tier. Keep the warning mark at 25, first pursuit at 50, swarm at 80, and full response at 100 visible on the bar. The examples below illustrate the proposed civilian tiers.

| Mischief | Response | What the player sees |
| --- | --- | --- |
| 0–24 | No pursuit; one ambient patrol continues its route | **ALL CLEAR**. A small incident notice names any report and its meter change. |
| 25–49 | Warning, with no pursuing patrol | **GETTING NOTICED · 32/100** / **Ease off and this will fade. Police dispatch at 50.** |
| 50–79 | One wanted star; one patrol gives chase | **CHASE STARTED · 1 patrol** with the reason and **Break their sight around a corner.** |
| 80–99 | Two wanted stars; up to three patrols converge | **THEY'RE SWARMING · 3 patrols** / **Reinforcements arriving in 4 s.** |
| 100 | Three wanted stars; up to four patrols, the absolute cap | **FULL FUDGE ALERT · 4 patrols** / **Lose sight or use the car wash.** |

Before a chase, start fading the meter after eight seconds without a new report, at three points per second. Show **COOLING OFF** while it drains. Quiet travel between errands clears small reports naturally. There is no money penalty for a warning and no arrest while wanted stars are zero.

Once a chase starts, the wanted tier stays at its highest dispatched level until escape, capture, or a wash. The meter stops passively draining during pursuit. Further reported incidents can raise the response, but simply being chased, driving away, or being seen again adds no mischief. Successful escape clears the meter, wanted stars, and pending reports, so old trouble cannot immediately restart a chase. Changing rides, repainting, or entering a menu does not clear a case.

## What counts and why

| Player action | Reported mischief | Feedback example |
| --- | --- | --- |
| Horn, drifting, speeding, near miss, light traffic nudge, wall scrape, voluntary flop, or a toy shot that hits nobody | 0 | Keep the normal funny driving or toy feedback. |
| Enter an owned, saved, starter, or authorized crew car | 0 | **Crew ride · you're clear.** on the first tutorial entry. |
| Take an unowned civilian car in front of a witness | +8, once when that car is first taken; reentry is free | **Reported: borrowed car · +8 mischief.** |
| Popper or hammer makes a resident tumble | +10 for the action | **Reported: public bonking · +10 mischief.** |
| Cannon bursts on residents | +15 for the burst, regardless of crowd size | **Reported: confetti cannon commotion · +15 mischief.** |
| Player causes a heavy traffic collision | +12 for the crash episode | **Reported: traffic pileup · +12 mischief.** |
| Player knocks down a resident with a moving car | +18 for the crash episode | **Reported: reckless driving · +18 mischief.** |
| Deliberately hit a patrol with a toy or a heavy ram | +25; a directly targeted officer orders at least one wanted star | **Officer targeted · Clench ordered a chase.** |
| Tagged story targets, authorized contract stops, invitation honks, or permitted parade actions | 0, except an announced story pursuit | Show the mission success feedback. |

An incident needs a witness to become a report. Start with residents within 10 world metres and officers within 20, with buildings blocking sight. A resident's own tumble or stolen car can make them a witness. Show a small **REPORTING...** speech bubble and a two-second delay before their report reaches dispatch; an officer who sees the event can report immediately. Everyone recovers, so making a witness tumble again does not erase their report.

The delay gives readable cause and effect. The report carries the incident location and action, rather than broadcasting the player's current coordinates. An unwitnessed incident adds nothing and does not reset an escape timer. A missed toy shot, horn, or ordinary movement never creates a report.

Count the most serious category once per crash or toy action. A cannon hitting six residents is one burst, and one pileup is one crash, even when several contacts occur. Repeated contacts on the same target have a three-second incident cooldown; separate deliberate attacks can still accumulate. Attribute impacts to the initiating actor: police ramming the player into traffic and unattended ragdoll collisions do not create new player reports. Recovery grants three seconds of protection from incidental collision reports; deliberate toy hits still count.

Directly targeting an officer is the only sandbox shortcut to immediate pursuit. A casual scrape against a patrol remains a light nudge. The HUD explicitly names the officer order, even when the meter is below 50; later escalation still uses 80 and 100. Story exceptions must be announced just as clearly.

## How the balance should feel

For a rapid, witnessed spree with no cooling between actions:

- Borrow a car (+8), bonk two residents in separate actions (+20), and cause one heavy traffic crash (+12): **40 points, a warning, and no chase yet**. Drive normally for a while to cool it off.
- Five separate popper pranks reach **50 points and one patrol**. Three more reach **80 and trigger the swarm**. Continued public chaos reaches four patrols at 100.
- One accidental resident collision creates **18 points**. Stop making trouble and it fades; that mistake alone does not summon a chase.

The key choice is to stop while the warning is showing or knowingly push into a chase. One patrol gives the player a forgiving escape lesson. Continuing the spree makes the town dramatically busier without adding endless officers.

## Chase feedback

Reserve a compact police panel separate from the campaign's destination instructions. Keep the reason visible for the whole chase. Name the accumulated reports when they caused dispatch, and show the newest escalation underneath; a tiny final bump should not look like the sole cause of a long spree.

```text
FUN POLICE · CHASE STARTED          ★☆☆
WHY: 5 reported resident pranks
1 patrol pursuing · Break their sight around a corner
```

```text
FUN POLICE · THEY'RE SWARMING        ★★☆
WHY: continued public chaos
Latest report: confetti cannon commotion
2 reinforcements arriving · first in 4 s
```

```text
FUN POLICE · SEARCHING              ★★☆
WHY: reported resident pranks
Nobody sees you · Stay unseen for 18 s
They're checking your last known location
```

On the minimap, mark actively sighting patrols with a solid alert icon and searching patrols with an outlined icon. A last-known-location ring explains where they are converging. Nearby pursuit indicators sit at the screen edge. Text and icon shape convey every state when sound is muted or color is hard to distinguish.

Use a short radio bark at dispatch: **"Public bonking reported. One patrol, reluctantly responding."** The swarm gets a distinct sting and **"That's enough! Bring the spare sirens!"** Keep these short, rate-limited, and subordinate to the persistent text. A warning gets a small chime, not the chase siren. Avoid flashing the whole screen.

The planned J phone log gains a **Trouble** view with the last three reports, the trigger for the current chase, and a plain escape reminder. The main panel remains sufficient to understand the situation without opening it.

## A swarm with room to escape

Reinforcements are announced at least four seconds before the first can reach the player. Additional cars enter two to three seconds apart, from different connected streets. Prefer existing distant patrols; create any new car outside the camera on a clear road at least one block away. If no fair entry exists, delay it and update the countdown. Never appear alongside the player, fill the destination ring, or teleport ahead after a turn.

Use one car as the direct pursuer and the others as road-based interceptors heading toward reported or last-seen positions. They search those places until someone actually spots the player again. Keep at least one open exit at every interception; no complete roadblocks in the compact map. The swarm comes from its numbers, noise, and converging routes.

Starting patrol speed caps are 190, 220, and 240 simulation units per second at wanted levels one, two, and three. The unmodified Party Wagon tops out at 260, so every civilian ride can pull away on a clear straight. Patrols brake for corners and use the same solid contacts as other vehicles. No speed teleporting or compulsory upgrades are needed to escape.

Police contact drains composure at a combined maximum of 15 per second, regardless of how many patrols touch the player. A full meter gives roughly six seconds to break a pin. Allow one second of contact grace after the first shove; composure begins recovering three seconds after contact ends. Biscuits and toy distractions remain useful. On foot, corners, park paths, and toy distractions are the intended escape tools.

## Search and escape

Losing sight immediately changes the panel from **CHASED** to **SEARCHING**. Start the visible escape countdown at 12 seconds for one star, 18 for two, and 24 for three. Patrols continue toward the last confirmed sighting; they do not know a hidden player's new position. Brief sight flicker through a corner does not reset progress: require half a second of continuous sight to confirm a reacquisition, then show **SPOTTED AGAIN · search reset**.

A new witness report while hidden resets search and updates the reported incident location, with **REPORTED AGAIN: [action] · search reset**. Harmless actions and unwitnessed events leave the timer alone. Menus, pause, phone calls, and hidden browser tabs freeze all buildup, report delays, reinforcement arrivals, and escape timers.

Escape ends with **LOST THEM · ALL CLEAR**, a cheerful sting, and three seconds of protection from incidental contacts. Pursuing cars peel away normally; they do not vanish in view. A deliberate new report starts a new buildup.

The $75 car wash remains an optional shortcut that repairs the car and clears the meter, wanted stars, and pending reports. Show its price before use. Scripted campaign chases supply a voucher so a player with no cash always has both a free driving escape and the wash option. Free-roam capture keeps the existing capped $50 cleanup fee; campaign capture and checkpoint retries remain free.

## Campaign use

**Job 1, Wrong Number:** the yellow loaner is authorized. Normal entry and the drive to Sprinkle Garage are clear. Extra voluntary chaos follows the same rules as free roam.

**Job 3, Honk If You Like Trouble:** the first two marked invitation honks add no mischief. Before the third, Pip says, **"Clench is watching this corner. One more honk and he'll chase us. Your call."** The objective repeats **Honk to invite the last guests · starts a 1-patrol chase**. The third honk triggers Clench's scripted one-star order with **WHY: Clench objected to the party invitation**. It is a mission exception, not a general penalty for using the horn; existing higher wanted levels stay intact.

**Job 8, Wash Away Your Worries:** Pip warns about the inspection before the cargo pickup. Its objective states **Collect the disco cargo · starts a 3-patrol chase**. Clench's first-star order begins at pickup, followed by an announced two-star reinforcement wave. Show **WHY: Clench spotted the unapproved party cargo** and a minimum meter of 80. The same staggered arrivals, search rules, and free voucher apply; unrelated higher heat can persist. The route to the wash is ready before the player drives away.

**Job 10, The Grand Unboring:** Bland's permit covers marked hammer targets, cannon beacons, and parade honks. Show **PERMITTED PARADE · story actions are clear**. Required celebration cannot create a chase. Deliberate unrelated collisions or resident pranks still follow the shared rules.

## Playtest targets

The numbers above are starting hypotheses. Adjust incident values, cooling, and arrival spacing before increasing the patrol cap.

- A new player can explain why a chase started from the visible panel, with sound muted.
- A normal trip with one borrowed car, a scrape, and a horn produces no pursuit; a rapid five-to-eight-prank spree produces a visible warning, one patrol, then a swarm.
- One patrol is usually escapable in 15–25 seconds; the three-car swarm takes roughly 25–45 seconds, including its search countdown. A skilled driver can still shorten the chase by breaking sight quickly.
- An unmodified compact and van can escape without buying upgrades, supplies, or a wash. An on-foot player has a workable corner or distraction route.
- A burst, pileup, police shove, or recovery never produces several unexplained reports. Losing sight does not secretly send officers to the player's new position.
- Repeated horns, missed shots, and harmless maneuvers leave search intact. Confirmed reacquisition and a fresh witness report explain any reset.
- Reinforcements always arrive through clear roads after their warning; four patrols and maximum confetti remain smooth in Chrome.
- Story jobs announce their pursuit trigger, supply required escape resources, and permit the finale. Escaping, washing, or capture clears pending reports so old trouble cannot immediately restart pursuit.
