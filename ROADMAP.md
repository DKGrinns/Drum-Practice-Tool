# Groove Trainer — Roadmap

This is the plan for growing Groove Trainer into a full drum training tool, built over many sessions (cloud or local).

## Rules for every session

1. **Keep the app working.** Each session finishes one step (or a clear part of one). The app must work at the end of every session.
2. **Before pushing:** run `npm test` (unit tests) and `npm run test:browser` (real app in headless Chromium; see `tests/browser/README.md` for setup and the expected results). Add a browser test in `tests/browser/` for each new feature. To try the app by hand: `python3 -m http.server 8000`.
3. **Bump `CACHE_VERSION` in `sw.js`** whenever app files change, so installed copies update.
4. **Add the new files to `ASSETS` in `sw.js`**, so they work offline.
5. **Update this file:** tick off finished items, add notes for the next session, and commit them together with the code.
6. **Keep it simple:** plain HTML/CSS/JS ES modules, no build step and no backend, so it stays free on GitHub Pages. All sounds are synthesized.
7. **Update the README** when a feature changes how you use the app.

To continue, open the repo in Claude Code and say: *"Continue the roadmap in ROADMAP.md."*

## Current state

Version 1 and Steps 1–8 are done: metronome, tempo/gap trainers, swing, 73 grooves, pattern builder, time-feel trainers, mic and MIDI timing feedback with recording, backing band, practice routines and log, gig set lists with pedal support, count-in, learning from records (tab capture, tempo and beat tracking, beat-locked click, slow-down loops, drum focus, rough transcription), offline PWA, and GitHub Pages deployment.

Code layout: `js/app.js` (entry point), `js/ui/*.js` (one module per tab plus core/transport/widgets/mixer/keyboard/items/countin), `js/practice.js` (practice structure, pure), `js/tempo.js` / `js/transcribe.js` (records: tempo, beats, transcription, pure), `js/listen-worklet.js` (time-stretch + capture tap), `js/capture.js` (tab/mic/file sources), `js/engine.js` (audio clock and scheduler), `js/sequencer.js` (pure timing, tested), `js/synth.js` (drum sounds), `js/patterns.js` (pattern model and library), `js/grooves.js` (groove library), `js/storage.js`.

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

### Step 4 — Playing feedback A: microphone timing analysis (section 1) ✅ (done)
- [x] Mic input (`js/mic.js`) with echo cancellation, noise suppression and auto gain off; iOS audio session set to play-and-record while listening.
- [x] Onset detector (`js/onset-worklet.js`): pre-emphasis energy, adaptive floor (in dB), rise-vs-recent-max test, refractory window with loud-attack override, sample-accurate start refinement, peak level. Runs in an AudioWorklet (ScriptProcessor fallback) on the AudioContext clock.
- [x] Latency calibration: speaker test (listens to its own clicks; also measures the speaker-bleed level) and tap test (for headphones), plus ±1 ms fine tune. Stored per device in localStorage (`grooveTrainer.latency`).
- [x] Scoring (`js/timing-analysis.js`): grid of beats/8ths/triplets/16ths with swing, nearest-point matching with latency removed, average, spread, ±10/±20 ms shares, drift trend, per-bar and per-position averages, plain-language verdicts.
- [x] Speaker-bleed filter: quiet onsets that line up with sounds the app played are ignored (the engine logs every beat and every sound).
- [x] Feedback tab: mic toggle, level meter with threshold mark, sensitivity, calibration, live last-hit readout, timeline canvas, stats, take report (on Stop).
- [x] Tests: `tests/onset.test.js` (synthetic kick/snare/hat audio: grooves, ghost notes after backbeats, fast 16ths, noise/swell/ringing, sensitivity, bleed, a hit 15 ms after a click, a randomized 2-minute performance at 44.1 and 48 kHz with zero misses/false hits and 95% within 1.5 ms) and `tests/analysis.test.js`.
- [x] Browser test with a virtual drummer and virtual mic (fixed delay + speaker bleed + room noise): the speaker test measured the delay, and the take report showed exactly +15 ms on the beats / −5 ms on the "&"s as played, with all 20 speaker clicks ignored at high sensitivity. The tap test measured a 200 ms (Bluetooth-like) delay correctly.
- [ ] Needs a real-world check by the user: different phones/laptops, acoustic kit volume, room echo. Tune the default sensitivity (60) if needed.

### Step 5 — Playing feedback B: MIDI kit and recording (section 1) ✅ (done)
- [x] Web MIDI input (`js/midi.js`): note-on parsing, GM + Roland/Alesis/Yamaha drum notes mapped to voices, "learn" mapping (saved), optional app sounds from the pads, drum-module delay offset. Timestamps are converted to the audio clock *as heard* via `getOutputTimestamp()`, so no calibration is needed. There's a message for Safari (no Web MIDI).
- [x] Per-drum timing (`summarizeByVoice`) and dynamics (`dynamics`: ghost/accent groups, evenness, range) in the take report.
- [x] Recording: the worklet streams raw mic samples tagged with audio-clock frames (`js/recorder.js`, `TakeRecorder`, max 3 min/take). The last 5 takes are kept in memory, with Listen, Over the groove (`alignTake`, latency-corrected), WAV download and Report.
- [x] Recent takes history (last 50 summaries in localStorage) for comparing scores over time.
- [x] Tests: `tests/midi-recorder.test.js`. Browser test with a virtual e-kit gave exact per-drum offsets (kick +4, snare +18, ghosts −6 ms) and the right dynamics, the learn mapping worked, and the recorded take scored +12 ms as played; replay alignment checked; WAV download checked.
- [ ] Needs real-world check: a real e-kit (Roland/Alesis/Yamaha) over USB, and the over-the-groove sync by ear.

### Step 6 — Backing band (section 3) ✅ (done)
- [x] Synthesized bass (deep / pluck / upright tones) and chord instruments (reggae skank, funk stab, organ, electric piano) in `js/synth.js`.
- [x] `js/band.js`: Roman-numeral chords in any key, progression presets (incl. 12-bar blues) and custom progressions, 13 band styles with bass and chord rhythms for 16- and 12-step bars, a generic part for odd meters, approach notes into the next chord, chord voicings. Grooves get a matching style automatically (`styleForGroove`).
- [x] The engine plays band notes from the same sequencer steps, so they follow tempo, swing, push/pull (bass with the kick, chords with the snare), the trainers, gap mutes and dropout. Mixer channels "Band: bass" and "Band: chords".
- [x] Band tab (`js/ui/band.js`): on/off, key, chords, style; current and next chord shown under the tempo.
- [x] Tests: `tests/band.test.js` (numerals, progressions, style strings, bass degrees and approach notes, voicings, one-drop skank on 2 and 4 with chord changes, odd meters, every groove gets a playable style). Browser test: skanks exactly on 2 and 4, a jazz walking line with approach notes over ii–V–I, no band notes in gap-trainer silent bars, and sound levels balanced against the drums.
- [ ] Possible later: per-groove custom bass lines (e.g. classic one-drop riffs), more chord voicings and inversions, a bass-only "play along with the bass player" mode, minor-key styles for more genres.

### Step 7 — Practice structure (section 5) ✅ (done)
- [x] Routine builder (`js/ui/practice.js`, Practice tab): blocks with what to play (groove / saved pattern / metronome with meter and subdivision), tempo, minutes, tempo trainer, gap trainer and a note; add, edit, reorder, delete; "Add what's playing"; three starter routines (reggae, funk & soul, Latin & Brazilian). The runner shows a countdown, next block and total time left. The timer runs only while playing and not during the count-in. When time is up the engine stops at the next bar line (`engine.stopAtNextBar`) and the next block starts exactly on that bar line. The user's trainer/gap settings are restored at the end.
- [x] Practice log: every play of 10 s or more (what, seconds, top tempo, routine). Minutes today / 7 days / total, streak, 14-day chart, recent sessions with a "✓ clean" toggle. Feedback takes are reported on the bus (`take`) and steady ones (|mean| ≤ 15 ms, spread ≤ 15 ms, ≥ 16 hits) are marked clean automatically. Best clean tempo per groove/pattern/meter with "Practise". Export/import of routines + log + set lists as one file (merge by id).
- [x] Gig prep (`js/ui/gig.js`, Gig tab): set lists of songs (item, tempo, key → band key, notes, song form). Stage view with big title, next song and Prev/Next. PageDown/→ and PageUp/← (or learned pedal keys, captured before the other shortcuts) work while the Gig tab is open. The song-form map (`parseForm`, `formPosition`) highlights the section and bar while playing and flashes the next section in the last bar. Set-list export/import.
- [x] Count-in (Trainer tab): 1 or 2 bars before PLAY and before each routine block. The sequencer plays the count-in bars (`countIn` events with negative barCount; trainers, gap, dropout, band, feedback grid and pattern start at bar 0). Spoken count-in (`js/ui/countin.js`) uses speechSynthesis on top of the clicks; words are started early by a learned per-device speech delay (default 150 ms). With no voices it falls back to clicks only.
- [x] Tests: `tests/practice.test.js` (items, routines, log/streak/month boundaries, best tempos, clean takes, form parsing/position, count-in words, backup round trip, sequencer count-in incl. trainer/gap/6/8, stopping inside onStep). Browser test `practice-gig.cjs`.
- [ ] Needs a real-world check: the spoken count-in by ear on each device (Windows/Android/iPhone voices start at different speeds; the app learns the delay after a few count-ins), and a real Bluetooth page-turner pedal.
- [ ] Possible later: show the best clean tempo on groove cards, a weekly goal, song-form sections with their own groove (e.g. half-time bridge), and auto-start of the next song.

### Step 8 — Learning from records A: hear what is playing in Chrome (section 7) ✅ (done)
- [x] **Tab audio capture** (`js/capture.js`): `getDisplayMedia` with `suppressLocalAudioPlayback`, so Chrome stops playing the tab itself and the record is heard through the app (focus filters work, click lines up exactly). The video track is stopped at once. Clear 3-step instructions; "no audio track" (box not ticked), cancel, and unsupported browsers each get their own message. If a browser ignores the suppress flag, the app doesn't play the tab a second time and says the focus works on grabbed loops only.
- [x] **Also:** audio files (decodeAudioData, up to 10 min) and the microphone (never played back).
- [x] **Rolling buffer:** 30 or 60 s (`RollingBuffer`, frames on the audio clock, gaps filled), live waveform with beat ticks, **Grab** → clip with waveform, beats and bar lines; loop of 1/2/4/8 bars or Free (drag edges, snapped to beats), tap to move to a bar line, ◀ Bar / Bar ▶.
- [x] **Slow down without changing pitch** (`js/listen-worklet.js`, `Stretcher`): WSOLA (30 ms Hann grains, ±12 ms normalised cross-correlation search), made transient-aware: drum attacks (from `findTransients`) are played once, untouched, exactly at their slowed-down time; grains before a hit never reach into it; the decay between hits takes the stretch. 100% is bit-exact. Seamless loop crossfade. The player reports its musical position so clicks map to exact output times at any speed.
- [x] **Tempo detection** (`js/tempo.js`): STFT spectral flux every 5 ms in kick/snare/upper-mid/hat bands (each band weighted equally), per-band autocorrelation, comb score (beat, 2 and 4 beats, 8ths) × tempo preference around 95 BPM (matches how the groove library counts: one drop 72, funk 96, samba 100), confidence from periodicity and margin over unrelated tempos, ½×/2×/3⁄2/⅔/4⁄3 alternatives. Ellis dynamic-programming beat tracker, line fit for precise BPM and prediction, trimming of beats outside the music, downbeat guess (snare on 2&4 or on 3 only for one-drop/steppers/half-time, kick on 1, chord changes from chroma), swing (8th and 16th). Live: last 12 s re-analysed every second, median-smoothed display. Weights tuned with `tools/tune-tempo.mjs`.
- [x] Beat lights and an optional **click locked to the detected beat** (own synth straight to the output, skipping the engine's compressor delay), beat 1 accented, ±ms nudge, works live and on loops at any speed. "Use … BPM" → `changeBpm`. ½× / 2× / Shift ½ beat / This is 1 / "Also fits" chips.
- [x] **Drum focus filters:** kick (2× low-pass 150 Hz), snare (high-pass 220 + 2.4 kHz lift), hats (2× high-pass 6.5 kHz), with makeup gain.
- [x] **Rough transcription** (`js/transcribe.js`): attack strength per 16th/triplet slot in kick (low-pass 110), snare (1.2–2.5 kHz) and hat (7 kHz+) bands; kicks must ring on and drop in pitch (bass notes don't); snares must be noisy (skanks and stabs are tonal: spectral flatness); band leaks (kick click, hat noise, snare noise) measured and removed; hats kept under snares/kicks where the hat pulse is steady; ghosts and accents. Auto triplet grid for shuffles, swing passed to the pattern. **Open in Builder** via `openInBuilder`.
- [x] Unit tests: `tests/tempo.test.js` (17 synthetic feels × clean/noisy takes: rock, funk with ghosts, one-drop with empty beat 1, swung one-drop, steppers, blues shuffle, jazz ride, Purdie half-time shuffle, samba, neo-soul 16th swing, bossa, ska, cha-cha, dembow, afrobeat, jazz waltz; octave cases, a band speeding up 100→104, tempo change in the live window, confidence on noise and free time, precision ±0.1 BPM at 44.1/48 kHz, downbeat, swing, transients, transcription) and `tests/stretch.test.js` (identity at 100%, pitch and level kept at 50/75%, chord intact, every drum hit once and on the stretched grid at 50–90%, position map within 3.5 ms, seamless loop, stereo). Shared generator `tests/groove-audio.js`.
- [x] Browser test `listen.cjs`: virtual tab, file, mic (see tests/browser/README.md).
- [ ] Known limits: a half-time shuffle with every triplet filled reads as 120 (80 offered under "Also fits"); bossa can lock half a beat off (Shift ½ beat); plain rock/shuffle beats without chord changes can put the 1 on beat 3 (This is 1). Fast/slow octave for jazz, ska and waltz is a ½×/2× press.
- [ ] Needs a real-world check: tab capture on real Chrome/Edge (YouTube, Spotify web), the click by ear against real records, transcription on real mixes (bass-heavy reggae, busy Latin percussion), slow-down quality on real recordings (cymbal tails at 50%).
- [ ] Possible later add-on: ML stem separation to isolate the drums; a zoomable waveform for long files; saving grabbed loops.

### Step 9 — Learning from records B: notation and sharing (section 7)
- [ ] Drum notation view for any pattern or groove (render SVG yourself, or use VexFlow from the cdnjs/jsdelivr CDN with a pinned version, cached by the service worker).
- [ ] Print / save as PDF.
- [ ] Share a pattern as a link (pattern encoded in the URL hash); opening the link offers to import it.

## Notes for the next session

- Next up: **Step 9, notation and sharing.** The transcription result is a normal pattern, so notation of a transcribed loop comes for free once patterns can be drawn.
- Step 8 pieces to reuse: `analyzeClip` / `analyzeEnvelope` / `EnvelopeTracker` (with `trim`) / `findTransients` in `js/tempo.js`; `transcribe` in `js/transcribe.js`; `Stretcher` in `js/listen-worklet.js` (WSOLA, transient-aware, any clip); `RollingBuffer` and `LiveCapture` in `js/capture.js`; the `debug` export in `js/ui/listen.js` for browser tests. Settings live in `S.listen`.
- Tempo weights (`W` in tempo.js) were tuned on the synthetic feels; re-run `node tools/tune-tempo.mjs` after changing the detector (current score 91 of 102; the misses are octave choices, the half-time shuffle and bossa phase). Transcription was checked on two different synthetic kits (tests/groove-audio.js and the app's own DrumSynth, where it is exact); real records are the open question, so ask the user how it does on real songs.
- Shell note for Windows sessions: backticks and `$` inside `node -e "..."` or quoted heredocs get run by the bash wrapper; write patch scripts to the scratchpad (Write tool) and run them, or use the Edit tool.
- Step 7 pieces to reuse: `startPlayback({ at, countIn })`, `stopPlayback()` and `stopAtNextBar(cb)` in transport.js; `applyItem(item)` / `currentItem()` in `js/ui/items.js`; the `take` bus event; `countIn` steps (negative `barCount`) — anything listening to `step` should ignore `ev.countIn`.
- New feature tabs plug in via `registerPanel` / `registerSource` and the event bus in `js/ui/core.js` (see README "Adding a feature tab").
- Local Windows sessions: Git and Node were installed with winget; Playwright with `npm install --no-save playwright` and `npx playwright install chromium`. A fresh PowerShell may need its PATH refreshed after installing.

- The default branch is `claude/hopeful-bohr-j660du`, and `.github/workflows/pages.yml` deploys whatever is pushed to the default branch.
- The user plays mostly reggae, funk, soul and jazz fusion, and also wants Latin and Brazilian grooves.
- The user wants the microphone/MIDI feedback (steps 4–5) and the "learn from records" capture (step 8) to work especially well, so give them extra care and testing.
- The user prefers being asked before parallel agents are started.
