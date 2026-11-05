# Groove Trainer

A drum practice app built around reggae, funk, soul and fusion, with grooves from many more styles. It has a metronome, a tempo trainer, a gap (mute) trainer, a library of 73 loopable grooves, a step-sequencer pattern builder, a backing band, timing feedback by microphone or e-kit, practice routines with a log, and gig set lists that a page-turner pedal can step through. It runs in the browser with no build step and no server code, and once installed it works offline as an app.

**Live app:** https://dkgrinns.github.io/Drum-Practice-Tool/

All the sounds (kick, snare, cross-stick, hi-hats, ride, three toms, cowbell, agogô bells, clave, shaker, tambourine, congas, the clicks, and the backing band's bass, guitar skank, clav, organ and electric piano) are synthesized with the Web Audio API, so nothing is downloaded. Your settings and patterns are saved in the browser on your device.

## Install it as an app

After you open the link once, the app works fully offline.

| Device | How to install |
|---|---|
| **iPhone / iPad (Safari)** | Open the link in **Safari**, tap the **Share** button, then **Add to Home Screen**. Launch it from the home-screen icon to get a full-screen app with no browser bars. |
| **Android (Chrome)** | Open the link and tap **Install app** when it pops up, or use the **⋮** menu → **Install app** (older versions say **Add to Home screen**). |
| **Desktop Chrome / Edge** | Open the link and click the **install icon** at the right of the address bar (a monitor with a down arrow), or use the menu → **Cast, save and share → Install page as app** (Chrome) / **Apps → Install this site as an app** (Edge). It opens in its own window. |

Tip for iPhone: playback ignores the ring/silent switch on recent iOS versions. If you hear nothing, check the media volume.

## How to use it

The top panel (the left column on wide screens) is always visible. It has the beat lights, a big BPM display, the − / + buttons (hold to repeat), the tempo slider, **TAP** for tap tempo, the swing control and **PLAY / STOP**.

The **Metronome**, **Grooves** and **Builder** tabs each choose what PLAY plays (the tab that's playing gets a green dot). If you switch tabs while playing, the change happens at the next bar line so you never lose the beat. The **Trainer** tab doesn't change what's playing.

- **Metronome:** choose 4/4, 3/4, 5/4, 6/8, 12/8 or 7/8, and quarters, 8ths, triplets or 16ths. You can turn the beat-1 accent on or off, and the click and the subdivision click have separate volumes. In 6/8 and 12/8 the BPM counts the dotted quarter (12/8 = four big beats). In 7/8 it counts eighth notes, grouped 2+2+3.
- **Swing:** goes from straight (0%) to a full triplet shuffle (100%), on 8th-note or 16th-note pairs. Triplet grids are already swung, so swing has no effect on them and the slider dims.
- **Grooves:** 73 grooves in 13 genre families: Reggae, Caribbean, Funk, Soul & R&B, Jazz, Fusion, Afro-Cuban, Latin, Brazilian, African, Hip-hop, Rock & Pop, and Blues & Country. Use the genre chips or the search box (try "clave", "shuffle", "6/8" or "ghost"). Tap a groove to load it with its own tempo and swing, then press PLAY. Tap it again to restore its default tempo. The mixer lets you mute or turn down any drum, for example mute the kick and play it yourself. Toms and percussion are under **Toms & percussion** in the mixer. The **Click** channel adds a metronome click on top of the groove. **Open in Builder** copies the groove into the pattern builder.
  - Grooves "felt in 2", like salsa, mambo and rumba, use their real tempo (e.g. salsa at 180). The 7/8 groove counts eighth notes as beats.
  - Grooves marked "Kit Adaptation" are simplified versions of percussion-ensemble rhythms. Use them as a starting point, and adjust them in the builder to match the records you're playing along to.
- **Builder:** a grid in 4/4, 3/4, 5/4 or 7/8, with 16ths or triplets (7/8 is 16ths only), 1 to 4 bars long. Tap a cell to step through off → hit → accent → ghost → off, and tap a drum name to hear it. The grid shows the core kit plus any toms or percussion the pattern uses; press **All drums** to show every row (toms, cowbell, agogô, clave, shaker, tambourine, congas). You can edit while it plays. **Save** stores the pattern along with the current tempo and swing. Use **Rename**, **Duplicate** and **Delete** to manage patterns, and **Export** / **Export all** / **Import** to back them up as JSON files.
- **Band** (backing band): turn it on and a synthesized bass and chord instrument play along with any groove or pattern (not the plain metronome). They follow the tempo, swing, push/pull feel, tempo trainer, gap trainer and dropout.
  - *Key:* any of the 12 keys.
  - *Chords:* the style's own chords, a preset (one-chord vamps, i–iv, i–♭VII, I–IV–V, I–vi–IV–V, ii–V–I, 12-bar blues and more), or your own, written as numbers in the key with one chord per bar. For example `i iv i v` or `ii7 V7 Imaj7 Imaj7`: upper case = major, lower case = minor, add `7` or `maj7`, and write ♭ as `b` (`bVII`).
  - *Style:* matches the groove automatically, or pick one: reggae one drop (skank on 2 and 4), rockers/steppers, ska (off-beat skank), dancehall/soca, funk (clav stabs), soul (electric piano), blues/shuffle (organ, boogie bass), jazz (walking bass and comping), bossa nova, samba, salsa (tumbao bass and montuno), afrobeat/highlife, rock/pop. Odd meters get a simple part.
  - The current and next chord are shown under the tempo. **Band: bass** and **Band: chords** have their own mixer channels.
- **Feel** (time-feel trainers):
  - *Click:* thin the click out so you have to supply the missing beats. Choose every beat, 2 & 4 only, the "&"s only, beat 1 only, or one click every N bars. This works with the metronome and, when **Click under grooves & patterns** is on, under any groove.
  - *Click dropout:* random beats go completely silent, both the click and the groove. Keep playing through them. You can always keep beat 1, and **Get harder** adds 10% more silent beats every few bars, up to a limit you set.
  - *Push / pull:* move the whole groove ahead of the click (pushing) or behind it (laid back), up to 50 ms. Per-drum timing lets you set, for example, a lazy snare or a late kick. The presets include Laid back, Pushing, Lazy backbeat, Reggae lean and Dilla drunk. The click never moves; it's your reference.
  - *Humanize:* small random timing (up to ±12 ms) and volume changes on every hit. Clicks stay perfect.
- **Feedback** (timing analysis through the microphone):
  1. Press **Start listening** and allow the microphone. Put the phone or laptop a couple of metres from the kit.
  2. **Calibrate once per device.** With speakers, use **Speaker test**: stay quiet while the app plays 10 clicks and listens to itself. With headphones, use **Tap test**: hit a drum exactly with 16 clicks. Calibrate again if you switch between speakers, wired headphones and Bluetooth.
  3. Set **Sensitivity** so every hit, including your ghost notes, makes the meter jump past the white mark, and nothing registers when you're not playing.
  4. Press **Play** on anything (metronome, a groove, your pattern, with any trainer) and play along. Each hit is matched to the nearest beat, 8th, triplet or 16th (your choice; swing is taken into account). You see how early or late it was in milliseconds, plus a timeline of recent hits, your average, your spread (consistency), the share of hits within ±10 ms, and whether you're drifting (rushing or dragging).
  5. Press **Stop** for the take report: a summary in plain words, your average at each position in the bar (e.g. you rush the "&" of 4), and a bar-by-bar chart. This works through gap-trainer silences and click dropout too.
  - With speakers, the app ignores quiet sounds that line up with its own clicks and drums (speaker bleed), so they aren't scored as your hits. Headphones still give the cleanest results.
  - **Electronic kit (MIDI):** choose **Electronic kit (MIDI)**, plug the kit in by USB and press **Connect**. Each hit is timed exactly by the kit, so no calibration is needed. The take report adds a **By drum** table (timing and velocity for each drum) and **snare dynamics**: how even your ghost notes and accents are, and the gap between them. Standard General MIDI notes map automatically; to fix a pad, choose the drum, press **Learn** and hit the pad. **Play the app's drum sounds from the pads** turns practice pads into a kit. Web MIDI works in Chrome and Edge on computers and in Chrome on Android, but not in Safari (iPhone, iPad or Mac).
  - **Recording takes:** turn on **Record takes** (with the mic on), and every take from Play to Stop is recorded. **Recorded takes** keeps the last 5 until you close the app: **Listen**, **Over the groove** (plays the take in time with the same groove, latency-corrected), **WAV** (download) and **Report**. **Recent takes** lists the scores of your last takes so you can compare them over time.
  - Tips: louder is fine, because the detector looks for attacks, not volume. Very soft double kicks played with a felt beater can be missed. On iPhone, the playback volume may drop while the mic is on (an iOS rule), so headphones help there.
- **Trainer:**
  - The *tempo trainer* starts at the start BPM and changes by X BPM every Y bars until it reaches the target, then holds there. The target can also be lower than the start. While it runs, the big display shows the current tempo and the status line shows when the next change comes.
  - The *gap trainer* plays N bars, then goes silent for M bars, and repeats. By default the beat lights also go dark during the silent bars, so you can check whether you're still on the 1 when the sound comes back.
  - Both trainers work with the metronome, grooves and your own patterns, and they count from bar 1 each time you press PLAY.
  - *Count-in:* turn it on and PLAY first counts you in, for 1 or 2 bars at the starting tempo. **Spoken** has a voice count "one, two, three, four" over the clicks (2 bars: "one — two — one two three four"). **Clicks** gives clicks only. The clicks are timed exactly. The voice is started a little early to make up for the device's speech delay, which the app learns as you use it. If the browser has no speech voices, you get the clicks. The trainers, gap trainer and form map all start after the count-in.
- **Practice:**
  - *Routines:* a routine is a list of blocks. Each block has what to play (a groove, one of your saved patterns or the metronome), a tempo, how many minutes, and optionally the tempo trainer ("speed up to 84, +2 every 8 bars"), the gap trainer and a note. Three starter routines are included (reggae, funk & soul, Latin & Brazilian); edit them or make your own. Use **+ Add what's playing** to add the groove and tempo you have selected now. **Start routine** runs the blocks in order with a big countdown. The timer only runs while playing, so **Pause** (or STOP) pauses it. When a block's time is up, the bar finishes and the next block starts right on the bar line (after a count-in at the new tempo, if the count-in is on). **Back**, **Skip** and **End** do what they say. Your own trainer settings come back when the routine ends.
  - *Practice log:* every time you play for 10 seconds or more it is logged: what, how long, the tempo (the top tempo if the trainer was on) and the routine. You see minutes today, the last 7 days, your streak (days in a row with at least a minute of practice) and a chart of the last 14 days.
  - *Best clean tempos:* tap **✓ clean** on a session you played cleanly, and the best clean tempo for that groove or pattern is listed, with **Practise** to load it at that tempo. With the Feedback tab listening (mic or e-kit), steady takes (within ±15 ms on average, spread under 15 ms) are marked clean for you.
  - *Backup:* **Export all** saves routines, the log and set lists to one file; **Import** merges a file back in (also on another device).
- **Gig** (set lists for rehearsals and gigs):
  - Make a set list with **New**, then add songs. **+ Add what's playing** adds the groove and tempo you have selected, or use **+ Add song** and **Edit**. Each song has what to play and its tempo, an optional key (sets the backing band's key), notes, and a song form such as `Intro 4, Verse 16, Chorus 8 x2, Solo 16, Outro 4` (sections and their length in bars; `x2` repeats a section).
  - The stage view at the top shows the song in big letters with its notes, the next song, and **◀ Previous / Next ▶**. Loading a song sets the groove, tempo and key and turns the tempo trainer off. While playing, the change happens at the next bar line. While you play, the form map lights up the section you're in, shows the bar ("Verse · bar 5 of 16") and flashes the next section during the last bar.
  - **Bluetooth page-turner pedal:** pair the pedal with the phone, tablet or laptop. While the Gig tab is open, <kbd>Page Down</kbd> or <kbd>→</kbd> goes to the next song and <kbd>Page Up</kbd> or <kbd>←</kbd> to the previous one, which covers most pedals. If yours sends something else, press **Set pedal keys** and press the pedal's two buttons. A pedal that sends ↑/↓ then turns songs on the Gig tab instead of changing the tempo.
  - **Export set lists** / **Import** to share a set list with the band.

**Keyboard:** <kbd>Space</kbd> play/stop · <kbd>T</kbd> tap tempo · <kbd>↑</kbd>/<kbd>↓</kbd> ±1 BPM (hold <kbd>Shift</kbd> for ±5) · on the Gig tab <kbd>Page Down</kbd>/<kbd>→</kbd> next song, <kbd>Page Up</kbd>/<kbd>←</kbd> previous (or your pedal's keys).

## Adding new grooves

Grooves live in [`js/grooves.js`](js/grooves.js). Add an object to the `GROOVES` array:

```js
{
  id: 'my-groove',            // unique, no spaces
  style: 'Funk',              // genre family: one of FAMILIES at the bottom of grooves.js
  name: 'My Groove',
  bpm: 95,                    // default tempo
  steps: 16,                  // 16 = 16th grid, 12 = triplet grid (per bar of 4/4)
  // meter: '3/4',            // optional: 3/4 (12 or 9 steps), 5/4 (20 or 15), 7/8 (14)
  // eighths: true,           // optional: each character is an eighth note
  swing: 0.2, swingRes: 16,   // optional default swing (0..1) on 8ths or 16ths
  desc: 'One sentence about the feel.',
  tracks: {                   // any of: ride, oh, hh, rim, snare, kick, tom1, tom2, tom3,
                              // cowbell, agogoH, agogoL, clave, shaker, tamb, congaH, congaL
    hh:    'XxXx XxXx XxXx XxXx',
    snare: '---- X--g -g-- X---',
    kick:  'X--x --X- --X- -x--',
  },
},
```

In the step strings, `-` is a rest, `x` a hit, `X` an accent and `g` a ghost note. Spaces and `|` are ignored, so you can group the steps by beat or by bar. For a 2-bar groove, write 32 steps (or 24 on a triplet grid). Run `npm test` afterwards: it checks that every groove has a valid length and voice names.

You can also build a groove in the Builder, export it, and copy the step strings out of the JSON file.

## Development

The app is plain HTML, CSS and ES modules, so any static web server will run it:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
npm test                        # timing, patterns, feel, onset detection and scoring tests (Node 18+, no dependencies)
npm run test:browser            # the real app in headless Chromium (needs Playwright, see tests/browser/README.md)
```

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | Layout: mobile-first, dark, high contrast |
| `js/app.js` | Entry point: loads the UI modules and registers the tabs in order |
| `js/ui/core.js` | Settings, audio engine, event bus, and the registries for sources (what Play plays) and tabs |
| `js/ui/transport.js` | Tempo, tap, swing, play/stop, beat lights, status line |
| `js/ui/metronome.js`, `grooves.js`, `builder.js`, `band.js`, `feel.js`, `feedback.js`, `trainer.js`, `practice.js`, `gig.js` | One module per tab |
| `js/ui/items.js` | "What to play" for routine blocks and songs: apply it, label it, the chooser form; the `saved` source plays a saved pattern without touching the builder |
| `js/ui/countin.js` | Spoken count-in (speechSynthesis), started early by the learned speech delay |
| `js/practice.js` | Routines, practice log (minutes per day, streak, best clean tempo), set lists, song form, count-in words, backup format (pure) |
| `js/ui/mixer.js`, `widgets.js`, `keyboard.js` | Mixer, shared UI helpers, desktop shortcuts |
| `js/engine.js` | AudioContext and the lookahead scheduler loop |
| `js/sequencer.js` | Pure timing: step times, swing, tempo trainer, gap trainer, click dropout, click modes, count-in bars |
| `js/feel.js` | Push/pull offsets, per-drum microtiming, humanize (pure functions) |
| `js/band.js` | Backing band: chord numerals, progressions, band styles (bass + chord rhythms), notes per step (pure) |
| `js/onset-worklet.js` | Drum-hit (onset) detector; runs as an AudioWorklet, also importable for tests |
| `js/timing-analysis.js` | Scoring: grid, hit matching, summaries, latency estimation, speaker-bleed filter (pure) |
| `js/mic.js` | Microphone input (no echo cancellation/noise suppression/auto gain) feeding the detector; raw audio for recording |
| `js/midi.js` | Web MIDI e-kit input: GM drum map, pad learning, timestamps converted to the audio clock as heard |
| `js/recorder.js` | Sample-aligned take recording, WAV export, playback alignment over the groove |
| `js/synth.js` | Synthesized drum voices |
| `js/patterns.js` | Pattern model, metronome patterns, saved-pattern library, JSON import/export |
| `js/grooves.js` | The groove library |
| `js/storage.js` | localStorage wrapper (every access is in try/catch) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and installability |

**How the timing works:** a worker timer wakes the engine every 25 ms. That timer never times notes itself. On each wake-up, the sequencer works out the exact audio-clock time of every step in the next 120 ms, and Web Audio plays those notes sample-accurately. Step times come from the beat start and the beat length rather than from adding up timer intervals, so there is no drift. The tests check this over 1000 bars.

**Adding a feature tab:** write `js/ui/<feature>.js` exporting `panel` (`{ id, label, source?, onShow? }`), add a `<section id="panel-<id>" class="panel">` to `index.html`, and register it in `js/app.js`. Modules talk through the event bus in `core.js` (`step`, `play`, `stop`, `sequence`, `tempo`).

**Adding a drum sound:** add it to `KIT_VOICES` in `js/patterns.js` and give it a sound in `js/synth.js`. Old saved patterns and exported files still load.

**When you change app files**, bump `CACHE_VERSION` in `sw.js`. Installed copies then download the new version in the background and use it on their next launch.

**Deployment:** `.github/workflows/pages.yml` runs the tests on every push and publishes the site to GitHub Pages from the default branch. In the repository settings, **Settings → Pages → Build and deployment → Source** must be set to **GitHub Actions**.
