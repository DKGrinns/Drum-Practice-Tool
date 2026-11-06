# Browser tests

These run the real app in headless Chromium (via Playwright). They cover what the Node unit tests (`npm test`) can't: audio scheduling, the microphone and MIDI pipelines, and the UI.

## Setup (once)

```sh
npm install --no-save playwright
npx playwright install chromium
```

(Cloud sessions already have Chromium and Playwright installed.)

## Run

```sh
npm run test:browser              # all tests (about 5–6 minutes)
node tests/browser/run-all.cjs mic band   # only tests whose file name contains "mic" or "band"
node tests/browser/band.cjs       # a single test
```

Each test starts its own local web server. Screenshots and downloads go to `test-output/`, which git ignores. The runner marks a test as failed if it crashes, prints `FAIL`, or reports page errors. The tests also print measurements: compare them with the expected results below.

## What each test should show

| Test | Checks | Expected |
|---|---|---|
| `regression.cjs` | Core v1 features: metronome, meters, grooves, builder save/rename/duplicate/delete, export/import, trainers, reload persistence, offline | `bpm after one drop 72`, `playhead` > 0, `Imported 2 patterns`, after reload the trainer stays On, `offline … groove cards 73`, `ERRORS: []` |
| `voices-and-upgrade.cjs` | Settings saved by older versions still load; toms/percussion rows; sound peaks | `upgrade: bpm 133 kick muted true`, 17 rows with All drums, `Clv` row stays when used, all peaks below 1.0 |
| `grooves-and-meters.cjs` | Family chips, search, all 73 grooves play, 3/4 · 5/4 · 7/8 in the builder | `played all 73 bad []`, `7/8 dots 7`, `5/4 dots 5` |
| `feel-trainers.cjs` | Click modes, push/pull, humanize, dropout (measured scheduled times) | 2 & 4 gaps `1.000`, kick offsets `20`, snare offsets `35`, humanized kicks within ±12 ms of 20 |
| `dropout-rate.cjs` | Dropout over a longer run | about 50% of non-downbeat clicks kept |
| `mic-feedback.cjs` | Virtual mic (80 ms delay + speaker bleed + room noise) and a virtual drummer: speaker-test calibration, scoring | `heard 10 of 10 clicks`, positions `1+15 1&−5 2+15 2&−5 …` |
| `mic-feedback-bleed.cjs` | Same at high sensitivity: speaker clicks must be ignored | `40 hits`, positions exactly `+15` / `−5`, "sounds from the speaker were ignored" |
| `tap-calibration.cjs` | Tap test with a 200 ms (Bluetooth-like) delay | about 220 ms, spread ±1 ms |
| `midi-and-recording.cjs` | Virtual e-kit: per-drum scoring, dynamics, learn; recorded take, replay over the groove, WAV | positions `1+4 1&−6 2+18 …`, kick `+4 ms`, take `+12 ms`, WAV ≈ 0.5 MB |
| `band.cjs` | Backing band notes, chords, walking bass, gap muting, levels | skanks on beats 2 and 4 at `0.0ms`, Am then Dm, `gap: band notes in silent bars = 0` |
| `practice-gig.cjs` | Count-in (clicks and a fake speech voice), routine runner with 3 short blocks, practice log, clean takes, set list with page-turner keys and pedal learning, form map, backup, reload | count-in clicks 0.5 s apart and first kick at `+3.0000 s`; words `one two three four` each started ≈150 ms early, lead `150 -> ~99 ms`; `block 1 -> 2 … 6.000000 bars` (whole number), `block 2 -> 3 lands on a trainer bar line: yes`, gap notes `= 0`; trainer/gap restored; Steppers listed under best clean tempos; PageDown/→/PageUp/← and the learned ↓/↑ step through songs; form map `Intro … → Verse next [next lit] … End of the form`; backup round trip shows every log row (up to 15) |
| `listen.cjs` | Listen tab with a virtual Chrome tab (a synthesized funk record at 96 BPM in a MediaStream, plus a video track the app must stop), a WAV file and a virtual mic | `live bpm 96`, live beats within a few ms of the record (after a fixed capture delay of about 20 ms), `downbeat guess on record beat 1`, record heard through the app, clicks `worst` under 2 ms with accents on beat 1, beat lights lit, `app tempo now 96`, ½× → 48, grabbed clip 96 BPM and `4 bars`, `position rate 0.750` at 75%, loop clicks every 833 ms, transcription kick 100% / snare 100% / hats ≥ 90%, Builder opened with the pattern, the no-audio message, file `72.0 BPM` with the bar line on the 1, `mic bpm 100` |
| `sound-levels.cjs` | Peak level of each drum sound (offline render) | every peak below 1.0; choke tail ≈ 0 |

The virtual microphone replaces `getUserMedia` with audio generated inside the page, so the full pipeline runs (AudioWorklet detection, calibration, bleed filter, scoring) with known, exact timing.

`tools/render-icons.cjs` regenerates the PNG app icons from the SVGs (also needs Playwright).
