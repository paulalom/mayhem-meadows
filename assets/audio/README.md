# Game sound library

Seven original effects were generated with Runway on 2026-10-06: compact, sports, and van engine loops; a police siren loop; a horn; a cartoon collision; and a confetti pop. The prompts, task IDs, durations, and source digests are recorded in `manifest.json`.

`samples.js` embeds the compressed MP3 bytes for both localhost and direct file-open play. The game decodes them locally after the first player gesture and routes them through the existing volume, distance, stereo, and pause controls. No account, service, or connection is needed while playing. Synthesized effects remain available while decoding or if a sample is unavailable; radio music and other gameplay effects retain their original synthesized arrangements.

To rebuild the browser bundle after changing the source files:

```sh
npm run audio-assets
```

`npm run check` verifies that the embedded data matches the source MP3s and their recorded digests. Listen to each source MP3 here to review or replace it. Source files are deliberately preserved separately from the generated JavaScript bundle.
