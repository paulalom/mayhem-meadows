# Game sound library

The library contains 45 original effects and voice clips generated with Runway on 2026-10-06. The palette is a warm coastal town with rattling cars, cheap party supplies, and overly serious officials. Physical foley carries ordinary actions; occasional comic details punctuate bigger mishaps. The prompts, task IDs, durations, voice presets, and source digests are recorded in `manifest.json`.

| Group | Assets |
| --- | --- |
| Driving | Three idle engine loops, three loaded loops, tire skid, boost, horn, door |
| Impacts | Light/heavy vehicle collisions, wood/metal/stone/foliage destruction, explosion, original cartoon crash fallback |
| Toys | Confetti pop, inflatable hammer, cannon launch, cannon burst |
| Movement and supplies | Pavement/grass/sand steps, splash, biscuit, tape, refill |
| Environment | Coast, town, nature, and docks ambience; local engine fire |
| Characters and radio | Five resident fake curses, pursuit/search announcements, three station IDs; siren loop |

`samples.js` embeds the compressed MP3 bytes for both localhost and direct file-open play. The game decodes them locally after the first player gesture and routes them through the volume, distance, stereo, and pause controls. No account, service, or connection is needed while playing. Sample peaks are bounded before playback; loops fade at their edges. Repeated effects vary subtly, voice overlap is restrained, and important speech/warnings briefly lower the music.

Synthesized effects remain available while decoding or if a sample is unavailable. The town soundtrack and radio retain locally synthesized instrumental arrangements with warmer electric-piano, plucked bass/guitar, organ, synth, and percussion textures. Generated instrumental tracks were unavailable on the connected plan during this pass; no account upgrade is required to play. Campaign phone calls and dialogue remain part of the future campaign design.

To rebuild the browser bundle after changing the source files:

```sh
npm run audio-assets
```

`npm run check` verifies that the embedded data matches the source MP3s and their recorded digests, and tests event routing, spatial sound, warnings, mixing, and lifecycle behavior. The optional Chrome browser checks measure actual Web Audio output and verify offline decoding, menus, pause, and mute. Listen to each source MP3 here to review or replace it. Source files are deliberately preserved separately from the generated JavaScript bundle.
