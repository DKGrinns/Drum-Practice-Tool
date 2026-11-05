# Groove Trainer — Roadmap

This is the plan for growing Groove Trainer into a full drum training tool, built over many sessions (cloud or local).

## Rules for every session

1. **Keep the app working.** Each session finishes one step (or a clear part of one). The app must work at the end of every session.
2. **Before pushing:** run `npm test`, then try the app in a browser (`python3 -m http.server 8000`). Check that features that already worked still work.
3. **Bump `CACHE_VERSION` in `sw.js`** whenever app files change, so installed copies update.
4. **Add the new files to `ASSETS` in `sw.js`**, so they work offline.
5. **Update this file:** tick off finished items, add notes for the next session, and commit them together with the code.
6. **Keep it simple:** plain HTML/CSS/JS ES modules, no build step and no backend, so it stays free on GitHub Pages. All sounds are synthesized.
7. **Update the README** when a feature changes how you use the app.

To continue, open the repo in Claude Code and say: *"Continue the roadmap in ROADMAP.md."*

## Current state

Version 1 and Steps 1–3 are done: metronome, tempo trainer, gap trainer, swing, 16 grooves (reggae, funk, soul, fusion), pattern builder with save/export/import, offline PWA, and GitHub Pages deployment.

Code layout: `js/app.js` (entry point), `js/ui/*.js` (one module per tab plus core/transport/widgets/mixer/keyboard), `js/engine.js` (audio clock and scheduler), `js/sequencer.js` (pure timing, tested), `js/synth.js` (drum sounds), `js/patterns.js` (pattern model and library), `js/grooves.js` (groove library), `js/storage.js`.

**Deployment:** turn Pages on once, under Settings → Pages → Source: **GitHub Actions**. The site is then at https://dkgrinns.github.io/Drum-Practice-Tool/

## Build order

### Step 1 — Groundwork and new sounds ✅ (done)
- [x] Split `js/app.js` into `js/ui/` modules: core (settings, engine, event bus, source and tab registries), widgets, transport, metronome, grooves, builder, trainer, mixer, keyboard.
- [x] Tabs are registered from modules (`registerPanel`); the tab bar scrolls sideways on phones when it gets more tabs.
- [x] New synthesized voices: high/mid/floor tom, cowbell, agogô high/low, clave, shaker, tambourine, conga high/low (17 voices in all).
- [x] Builder shows the core kit plus any extra drum the pattern uses; an **All drums** toggle shows every row. The mixer has a collapsible "Toms & percussion" section.
- [x] Pattern format: exports leave out silent tracks; old (v1) files and saved settings still load (tested).
- [ ] Step probability / flams: skipped for now (not cheap). Revisit later if wanted.

### Step 2 — Groove library expansion ✅ (done)
- [x] Patterns support 4/4, 3/4, 5/4 and 7/8 (`meter` field, `PATTERN_METERS` in patterns.js); the builder has a time-signature selector, and the grid splits rows on whole beats.
- [x] Grooves can be written in eighth notes (`eighths: true`) for Latin grooves felt in 2, at their real tempo.
- [x] 73 grooves in 13 families:
  - **Reggae:** one drop (2 versions), rockers, steppers, three reggae hi-hat variations, rocksteady, ska, nyabinghi
  - **Caribbean:** dancehall, reggaeton/dembow, soca, calypso
  - **Funk:** 16th funk with ghosts, syncopated kick, half-time, go-go, New Orleans second line, horn-section 16th funk
  - **Soul & R&B:** soul backbeat, soul shuffle, Motown, disco, 12/8 soul ballad, neo-soul, gospel shuffle
  - **Jazz:** medium and up-tempo swing, jazz waltz (3/4), ballad
  - **Fusion:** half-time shuffle, linear, reggae/funk hybrid, ride funk-fusion, paradiddle groove, displaced backbeat, 7/8, 5/4 funk
  - **Afro-Cuban:** salsa/son 3-2 and 2-3, rumba clave, cha-cha-chá, mambo, bolero, songo, 6/8 bembé
  - **Latin:** merengue, cumbia, bachata, Latin rock
  - **Brazilian:** samba, batucada, bossa nova, partido alto, baião, maracatu, samba-funk, samba-reggae, frevo
  - **African:** afrobeat, highlife, amapiano feel
  - **Hip-hop:** boom bap, Dilla-style swing, trap, classic breakbeat
  - **Rock & Pop:** rock beat, Bo Diddley
  - **Blues & Country:** blues shuffle, slow blues, Texas shuffle, train beat
- [x] Grooves panel: genre chips with counts, a search box, and section headings.
- [x] Tests: every groove's length, voices, meter and family are checked; son clave positions, 3/4 / 5/4 / 7/8 playback and `setMeter` are tested.
- [ ] Still to add later: ijexá, Mozambique, cáscara/mambo-bell variations, highlife/Afrobeat bell variations, more Rock & Pop (half-time, pop ballad). Several Latin/Brazilian patterns are marked "Kit Adaptation"; the user may want to refine them by ear.

### Step 3 — Time-feel trainers (section 2) ✅ (done)
- [x] Click modes: every beat, 2 & 4, the "&"s only, beat 1 only, beat 1 every N bars. They work for the metronome (`metronomeSequence` clickMode) and for the click layer under grooves (`clickLayer` in sequencer.js).
- [x] Click dropout: random silent beats (click and groove), seeded random generator, keep-beat-1 option, progressive mode (+10% every N bars up to a max).
- [x] Push/pull: whole-groove offset ±50 ms vs. the click, plus per-drum offsets (kick, snare & rim, hats, ride, percussion) and presets (`js/feel.js`). The engine applies them when scheduling and never schedules in the past.
- [x] Humanize: random timing ±12 ms and velocity ±25% at 100%. Clicks are never moved or humanized.
- [x] New **Feel** tab (`js/ui/feel.js`); the status line shows dropout % and the click mode.
- [x] Tests: `tests/feel.test.js` (click modes, sparse timing, click layer, dropout rate, repeatability and beat-1 safety, beat-level muting in grooves, offsets, humanize limits). A browser check measured the real scheduled times: kick +20 ms, snare +35 ms with a 20 ms groove offset and a +15 ms snare offset.

### Step 4 — Playing feedback A: microphone timing analysis (section 1)
This must work well.
- [ ] Mic input via `getUserMedia` with echo cancellation, noise suppression and auto gain turned **off**.
- [ ] Onset detection in an AudioWorklet (energy/spectral flux with adaptive threshold), timestamped on the audio clock.
- [ ] Latency calibration: the app plays clicks and the player taps along, or the app hears its own clicks through the speakers. Store the result per device.
- [ ] Match each hit to the nearest grid step, then show early/late in ms per hit, the average offset, consistency (standard deviation), and a rushing/dragging trend.
- [ ] Live view: a scrolling hit timeline. Per-bar summary and an end-of-take report.
- [ ] Handle bleed from the app's own click. Advise headphones, or ignore onsets at known click times.
- [ ] Test onset detection and scoring with synthetic audio buffers in Node (pure functions).

### Step 5 — Playing feedback B: MIDI kit and recording (section 1)
- [ ] Web MIDI input (Chrome/Edge/Android; **not** supported in iOS Safari, so show a message there). Map GM drum notes to voices, with a mapping editor.
- [ ] Per-drum timing scoring using MIDI timestamps, plus dynamics: velocity per hit, and ghost note vs. accent consistency.
- [ ] Record takes from the mic (and the MIDI hit list), play a take back over the groove, keep the last few takes, and compare scores over time.

### Step 6 — Backing band (section 3)
- [ ] Synthesized bass (sub sine/saw with filter envelope) and a chord instrument (reggae skank, funk stabs, soul organ/keys).
- [ ] Bass and chord patterns stored with grooves, with a key/chord-progression setting (simple: key, plus a progression like I–IV or i–iv).
- [ ] Band mixer channels, and band parts that follow tempo, swing, trainers and gap mutes.
- [ ] Defaults for the main styles: one drop, rockers, steppers, funk, soul, bossa, samba, son.

### Step 7 — Practice structure (section 5)
- [ ] Routine builder: a list of blocks (groove or metronome settings + duration + trainer settings), run in order with a timer and auto-advance.
- [ ] Practice log: minutes per day, what was practised, best clean tempo per groove, streaks. Stored in localStorage, with export/import.
- [ ] Gig prep: set lists of songs (tempo, meter, groove or pattern, notes), a next/previous song control (bind it to keyboard keys, so a Bluetooth page-turner pedal works), and a song-form map.
- [ ] Spoken count-in using `speechSynthesis`, with a synthesized-click fallback.

### Step 8 — Learning from records A: hear what is playing in Chrome (section 7)
This must work well.
- [ ] **Tab audio capture:** `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`. The player picks the Chrome tab playing music and ticks "Also share tab audio". Stop the video track right away and keep the audio. Desktop Chrome/Edge only; whole-system audio is reliable only on Windows. Show clear instructions and handle "no audio track" (the user forgot to tick the box).
- [ ] **Also support:** loading a local audio file (decodeAudioData), and the microphone as a fallback.
- [ ] **Rolling buffer:** keep the last 30–60 s of captured audio. "Grab" a section, set loop points on a waveform, and loop it.
- [ ] **Slow down without changing pitch:** a time-stretch (WSOLA or phase vocoder) in an AudioWorklet, at 50–100% speed.
- [ ] **Tempo detection:** onset envelope → autocorrelation/tempogram → BPM estimate with confidence, plus beat tracking. Show a live BPM and a "use this tempo" button.
- [ ] Beat lights and an optional click locked to the detected beat, so you can play along with the record.
- [ ] **Drum focus filters:** kick (low-pass), snare (band-pass), hats/cymbals (high-pass), to make parts easier to hear.
- [ ] **Rough transcription helper:** detect kick/snare/hat onsets in the loop, quantize them to the grid, and open the result in the pattern builder for correction.
- [ ] Unit tests for tempo detection and time-stretch on synthetic signals.
- [ ] Possible later add-on (not in the first version): ML stem separation to isolate the drums.

### Step 9 — Learning from records B: notation and sharing (section 7)
- [ ] Drum notation view for any pattern or groove (render SVG yourself, or use VexFlow from the cdnjs/jsdelivr CDN with a pinned version, cached by the service worker).
- [ ] Print / save as PDF.
- [ ] Share a pattern as a link (pattern encoded in the URL hash); opening the link offers to import it.

## Notes for the next session

- Next up: **Step 4, microphone timing analysis** (must work well). Useful hooks:
  - `bus.on('step', ev)` gives each step as it is heard; `ev.time` is on the audio clock (`engine.ctx.currentTime`).
  - The Sequencer can tell you the grid time of every step. For scoring, match mic onsets against the scheduled step times; collect them in `Engine.handleStep`, which knows each step's exact time, rather than in the visual queue.
  - Use an AudioWorklet for onset detection, and keep the detection maths in a pure module so it can be tested in Node with synthetic buffers.
- New feature tabs plug in via `registerPanel` / `registerSource` and the event bus in `js/ui/core.js` (see README "Adding a feature tab").

- The default branch is `claude/hopeful-bohr-j660du`, and `.github/workflows/pages.yml` deploys whatever is pushed to the default branch.
- The user plays mostly reggae, funk, soul and jazz fusion, and also wants Latin and Brazilian grooves.
- The user wants the microphone/MIDI feedback (steps 4–5) and the "learn from records" capture (step 8) to work especially well, so give them extra care and testing.
- The user prefers being asked before parallel agents are started.
