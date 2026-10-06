# Mayhem Meadows story campaign

**Operation Unboring** is a short optional campaign about rescuing the town's cancelled street party. It begins with a phone call from Spanner, teaches one useful action at a time, and turns familiar driving, toys, garage visits, and police escapes into a connected comedy. The target is roughly 15–25 minutes for a first playthrough, subject to playtesting in the existing compact town.

This is the design for the next playable campaign milestone. The campaign uses outdoor locations, procedural characters and props, text dialogue, and synthesized phone sounds. It runs locally with the rest of the game.

## Story and characters

Commissioner Beatrice Bland has cancelled the Meadows street party for “unscheduled enjoyment.” Spanner thinks a working van, some supplies, and a very large disco ball can change her mind. His new runner is the player, who becomes the increasingly unreliable member of a surprisingly determined party crew.

| Character | Role and voice |
| --- | --- |
| Spanner | Garage owner and the first caller. Practical, cheerful, and alarmingly relaxed about other people's cars. Gives the player clear jobs and safe places to regroup. |
| Pip | Local DJ and the crew's organizer. Speaks quickly, gives terrible jobs memorable names, and insists that every delivery is an emergency. |
| Captain Clench | Fun Police captain. Treats a party horn like a civic catastrophe. Introduces pursuit pressure and eventually joins the finale with extremely restrained dancing. |
| Commissioner Bland | The party's bureaucratic obstacle. Her real concern is that everything will turn into a mess. The crew wins her over with a working plan and an excellent biscuit. |

The player has short optional reply buttons for jokes. Replies change a line of dialogue, while the mission sequence remains the same. Confetti, fake curses, exaggerated tumbles, and immediate recovery keep the story consistent with the sandbox.

## Opening phone call

The welcome screen offers **New campaign** and **Free roam**, with **Continue campaign** when a story checkpoint exists. The campaign begins with the call; free roam remains available independently.

Choosing **New campaign** starts on foot beside the yellow Pocket Rocket. The phone rings after the scene is visible. A small incoming call card names **Spanner** and offers **Answer [Enter]**. The mission destination appears as soon as the call is answered.

The opening call pauses the town and has three short subtitle beats. Enter or the Next button advances; Escape or Skip call closes the dialogue and keeps the assigned objective. Muting sound leaves every subtitle and instruction available.

> **Spanner:** “You're the runner, right?”
>
> **Player:** “Wrong number.”
>
> **Spanner:** “Close enough. The Fun Police just cancelled our street party. Apparently joy needs a permit.”
>
> **Spanner:** “Take the yellow Pocket Rocket beside you. Meet me at Sprinkle Garage, one intersection north. Follow the lime route.”
>
> **Spanner:** “Oh, and if anyone asks, this is a very small party. Fudge and biscuits, we've got work to do.”

The final button reads **Show me the way [Enter]**. Closing the phone restores keyboard focus to the game and clears held movement keys.

The first car is an authorized crew loaner. Entering it does not start a police chase. Existing cash, owned cars, upgrades, and toy purchases remain available to returning players.

## Opening mission stages

| Stage | What the player sees | Completion |
| --- | --- | --- |
| Answer Spanner | “Spanner calling” with Answer and Read later buttons | Answer assigns the mission. Read later leaves a clear phone reminder and free roam available. |
| Enter the car | **Borrow the yellow Pocket Rocket** / “Beside you · E to enter” | Enter the marked crew car. A returning player may use a current civilian ride. |
| Drive to the garage | **Meet Spanner at Sprinkle Garage** / “One intersection north · about 9 m · Follow the lime route” | Reach the stopped-car arrival ring at the garage. |
| Meet Spanner | **You're at Sprinkle Garage** / “Stop in the ring · E to meet Spanner” | Talk through the car window or on foot. The story interaction takes priority inside this ring. |
| Finish the introduction | “Party crew assembled. Poor judgment confirmed.” | Bank $80 once, establish the first checkpoint, and queue Pip's next call. |

Spanner's arrival line is: “Nice driving. The car was yellow when you left, which is all I ask. We need supplies, a parade ride, and a disco ball the size of a small regret.”

Saving the car through G is an optional tutorial prompt. A full personal garage never blocks the opening mission.

## Directions and phone interface

Every active stage has a destination name, an action verb, a distance, and the relevant input. The objective panel contains one primary task. Its smaller line explains how to complete that task.

```text
WRONG NUMBER                         SPANNER
Meet Spanner at Sprinkle Garage
Drive one intersection north · 9 m
Follow the lime route on your minimap
```

On arrival, the same panel changes to:

```text
WRONG NUMBER                         SPANNER
You're at Sprinkle Garage
Stop in the ring · E to meet Spanner
```

The minimap shows a lime route along usable streets, the player triangle, and a named destination pin. Glowing ground chevrons guide the next street segment; the destination has an upright marker and a generous arrival ring. The existing compass continues to indicate bearing and distance when the destination is off screen.

Routes use the road grid rather than drawing a direct line through buildings. Show the next intersection instruction, such as **Left at the next junction**, only when a turn is actually needed. Recalculate after a wrong turn without failing the mission. When a toy target replaces a travel objective, highlight that target and replace the driving directions with the toy's input.

Building names repeat in the current town, so use labels such as **Disco Depot North** and **Crumb Café Northeast**. Deliveries use street frontage markers rather than building centers. The first trip is short; it needs a clear nearby destination rather than an exaggerated distance.

Press **J** to open the phone's job log, repeat the current instruction, read previous calls, or suspend the campaign. The log pauses the town. This key and the routed street guidance are additions for the campaign build.

Later calls arrive between jobs, after the player has stopped or lost police heat. Answered calls pause simulation and mission timers. Calls wait while the player is falling, in another menu, or already in a conversation. The player can choose Read later; the phone never silently accepts a new job during a chase. Essential dialogue remains in the job log.

## Mission sequence

The first three jobs assemble the crew, the middle four recover its supplies, and the last three make the party possible. Each job changes the action or situation so the campaign has a rhythm beyond repeated deliveries.

| Job | Story and playable stages | Mechanic and reward |
| --- | --- | --- |
| 1 Wrong Number | Spanner calls. Enter the yellow car, drive to Sprinkle Garage, and meet him. | Entry, steering, named directions, and contextual interaction. $80 and the garage checkpoint. |
| 2 Special Delivery | Pip calls: “The bank is holding our party fund. It's mostly biscuits.” Collect the clearly marked parcel at Biscuit Bank North and return it to Spanner. | A pickup and delivery with a visible parcel. $100 and two biscuits, respecting pocket capacity. I explains how to use them. |
| 3 Honk If You Like Trouble | Pick up Pip at Waffle Works North. Visit three marked street corners and honk to invite the neighborhood. Captain Clench considers the third honk a personal insult. | Slow inside each party ring, then H. Introduce one level of heat and a short escape before the next call. $120. |
| 4 The Inflatable Negotiator | At Sprinkle Shop North, the crew's parade sign has three jammed foam hinges. Meet the shopkeeper, receive an inflatable hammer, and bonk the highlighted hinges. The sign springs upright in a ridiculous shower of confetti. | Hold Tab, select the hammer, aim, and Space. Tagged props accept hammer hits; hitting random residents is unnecessary. Permanent hammer unlock and $100. |
| 5 Party Wagon | Return to Spanner for a free blue van. Collect the inflatable mascot at Noodle Hut West and deliver it to the park entrance. The mascot towers awkwardly above the van. | Try different handling and deliver a large cosmetic load. Any suitable van works; the crew loaner is available without a garage slot. $140. |
| 6 Emergency Disco | Pip calls about the missing disco ball. Collect it at Disco Depot North and take it to the park entrance. It spins dramatically above the ride and scatters light while the player takes corners. | A delivery with a distinctive visible cargo and optional clean-driving bonus. A wreck restores the cargo at the latest pickup checkpoint. $160. |
| 7 Pop Goes the Paperwork | The Fudge Factory North has made a party cannon and three absurdly oversized permit stamps. Receive the cannon and fire at the marked foam stamp targets to make the crew's celebration passes. | Tab selects the cannon; Space launches a traveling ball. Permanent cannon unlock, enough mission charges, and $120. |
| 8 Wash Away Your Worries | Clench sees the crew's “definitely not a party” cargo and starts a two-patrol pursuit. Escape behind buildings or follow the marked wash route using a crew voucher. Return to Sprinkle Garage after heat clears. | Read the chase/cooling HUD and choose an escape method. The voucher covers the wash if needed. $180; no mandatory spending. |
| 9 Administrative Mayhem | Meet Bland at Crumb Café Northeast. She wants a sensible party plan and a quiet biscuit break. Collect the final crew sign-off at Bean Palace North and return to Spanner. Bland signs the permit with an unnecessarily enormous pen. | Short street conversations and a final delivery; the antagonist becomes a reluctant guest. $140 and a festival paint voucher. |
| 10 The Grand Unboring | Assemble at the park entrance. Bonk the banner hinge, light three marked party beacons with the cannon, then drive the short parade circuit and honk at its three stops. Return to the entrance for the final confetti burst. Bland applauds once; Clench attempts a very small dance. | Combine toys, driving, route reading, and horn timing. An optional bonus clock rewards style; late completion still succeeds. $300 once and a crew van claim voucher. |

The finale ends with Spanner calling: “Commissioner Bland smiled. Terrifying. Same terrible decisions tomorrow?” The player returns to free roam with the campaign complete, optional Dispatch gigs available, and a celebratory park decoration.

Required toy lessons grant their toys. If a player already owns one, the job uses that toy and grants its normal cash reward without requiring another purchase. Required cannon stages supply enough charges and provide replenishment on retry. Lessons count hits on designated props; physics tumbles remain part of incidental sandbox mischief.

In Job 3, the first two invitation honks are authorized and do not create story heat. The third brings Clench into the scene and raises heat to at least level one. It does not stack a heat level for each invitation. Higher heat from unrelated player mischief can still persist.

## Locations and routes

These are proposed campaign anchors in simulation coordinates. Twenty simulation units equal one world metre. The named shop and business markers sit beside the north or west road frontage, outside the existing building footprints. Actor and loaner placement must also check live vehicles and pedestrians when the stage starts.

| Destination | Anchor |
| --- | --- |
| Player start | (884, 1080) |
| Yellow Pocket Rocket | (916, 1080) |
| Sprinkle Garage | (900, 900) |
| Biscuit Bank North | (205, 360) |
| Waffle Works North | (565, 360) |
| Disco Depot North | (925, 360) |
| Sprinkle Shop North | (1285, 360) |
| Crumb Café Northeast | (1645, 360) |
| Noodle Hut West | (205, 720) |
| Bean Palace North | (565, 720) |
| Fudge Factory North | (925, 720) |
| Park entrance and festival staging | (900, 1080) |
| Cool Down Car Wash | (1620, 1980) |

Job 3's party stops can use the existing road anchors (540, 540), (1620, 900), and (1260, 1980). The finale follows the roads around the park: entrance (900, 1080), northwest corner (900, 900), northeast corner (1260, 900), southeast corner (1260, 1260), southwest corner (900, 1260), and back to the entrance. Place the three parade stops on clear sections of that route. Keep its driving line outside the fountain, benches, and trees.

## Checkpoints and progression

Keep one active job and one primary destination. Campaign jobs share the mission slot with Dispatch. Suspending the campaign saves its checkpoint and clears its actors and guidance before a Dispatch gig can start. Resuming reconstructs that checkpoint with the same next objective.

Save completion after each meaningful stage: meeting a contact, collecting a parcel, reaching a party stop, or activating a target. Store the campaign job, current stage, completed target identifiers, checkpoint, seen calls, reward flags, voucher use, and pending reward claims. Save logical cargo and actor roles rather than live ragdoll joints or traffic positions.

Cash and permanent unlocks are granted once. Reloading after a reward cannot grant it again. Old saves gain a campaign invitation while retaining their money, upgrades, toys, pockets, and collected cars. New campaign restarts the story stages and calls while preserving purchases and previously claimed reward flags. Replaying the story does not pay its cash rewards again; Dispatch gigs remain repeatable. The selection screen states what restarts before the player chooses it.

After a wreck, capture, or abandoned attempt, offer **Retry checkpoint** and **Return to free roam**. Retry places the player at a clear road spot, restores required quest cargo, supplies a working crew loaner if necessary, and replenishes the stage's required cannon charges. It preserves banked cash and permanent purchases. Campaign capture waives the usual $50 cleanup fee, and checkpoint retry has no cash fee. A retry does not repair a damaged personal garage car for free.

A full garage delays claiming a reward van until the player makes space; it never overwrites an owned car. If biscuits or paint vouchers cannot fit, keep the reward claim available in the phone log rather than silently discarding it. Essential actors recover from a tumble and keep their interaction available, so accidentally bonking Spanner cannot break the story.

Timers apply to optional bonuses. Travel jobs and conversations have no hard deadline. Menus, calls, pause, hidden browser tabs, and ragdoll recovery do not consume a campaign bonus clock. Wrong turns and minor crashes prompt useful guidance and funny reactions.

## First campaign build

The first playable campaign milestone is Job 1 end to end: New campaign, Spanner's call, the authorized yellow ride, the garage route, arrival interaction, one-time reward, checkpoint save, and resume after a reload. Add the phone log and controller rules at this stage so subsequent missions can use the same flow.

The remaining jobs build on that foundation with tagged contacts and pickups, toy target hit events, cargo visuals, crew loaners, vouchers, and the festival finale. The existing compass and minimap need route segments and contextual instruction text. The campaign adds local data and small mission hooks to the current client-only simulation.

## Acceptance checks

- A new player can answer or skip the opening call and still identify the yellow car and named garage destination.
- Muted play retains the full dialogue, destination, action, and key prompt. The first call and later calls can be reread in J.
- Car entry changes the primary target from the car to the garage; arrival changes travel guidance to the correct interaction.
- Guidance follows streets, reroutes after a wrong turn, and distinguishes repeated business names.
- Phone controls consume Enter and Escape appropriately, clear held keys, and restore canvas focus without firing a toy or entering a car accidentally.
- Phone, inventory, wheel, help, pause, hidden tabs, and recovery preserve campaign timing and stage state.
- Wrecks, capture, no cash, no ammo, a full garage, and a fallen contact all have a working recovery path.
- Reloading restores the exact logical checkpoint. Replaying or reloading cannot duplicate completion rewards.
- Suspending for a Dispatch gig leaves exactly one active objective; returning to the campaign restores its guidance.
- The campaign runs from a file open or static server with local assets, and its phone cards remain usable on narrow and short viewports.
