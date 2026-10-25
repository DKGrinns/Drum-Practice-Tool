# Groove Trainer

A drum practice app for reggae, funk, soul and fusion players. It has a metronome, a tempo trainer, a gap (mute) trainer, a library of loopable grooves and a step-sequencer pattern builder. It runs in the browser with no build step and no server code, and once installed it works offline as an app.

**Live app:** https://dkgrinns.github.io/Drum-Practice-Tool/

All the sounds (kick, snare, cross-stick, hi-hats, ride and clicks) are synthesized with the Web Audio API, so nothing is downloaded. Your settings and patterns are saved in the browser on your device.

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
- **Grooves:** tap a groove to load it with its own tempo and swing, then press PLAY. Tap it again to restore its default tempo. The mixer lets you mute or turn down any drum, for example mute the kick and play it yourself. The **Click** channel adds a metronome click on top of the groove. **Open in Builder** copies the groove into the pattern builder.
- **Builder:** a grid of 16ths or triplets, 1 to 4 bars long. Tap a cell to step through off → hit → accent → ghost → off, and tap a drum name to hear it. You can edit while it plays. **Save** stores the pattern along with the current tempo and swing. Use **Rename**, **Duplicate** and **Delete** to manage patterns, and **Export** / **Export all** / **Import** to back them up as JSON files.
- **Trainer:**
  - The *tempo trainer* starts at the start BPM and changes by X BPM every Y bars until it reaches the target, then holds there. The target can also be lower than the start. While it runs, the big display shows the current tempo and the status line shows when the next change comes.
  - The *gap trainer* plays N bars, then goes silent for M bars, and repeats. By default the beat lights also go dark during the silent bars, so you can check whether you're still on the 1 when the sound comes back.
  - Both trainers work with the metronome, grooves and your own patterns, and they count from bar 1 each time you press PLAY.

**Keyboard:** <kbd>Space</kbd> play/stop · <kbd>T</kbd> tap tempo · <kbd>↑</kbd>/<kbd>↓</kbd> ±1 BPM (hold <kbd>Shift</kbd> for ±5).

## Adding new grooves

Grooves live in [`js/grooves.js`](js/grooves.js). Add an object to the `GROOVES` array:

```js
{
  id: 'my-groove',            // unique, no spaces
  style: 'Funk',              // Reggae | Funk | Soul | Fusion (filter chips)
  name: 'My Groove',
  bpm: 95,                    // default tempo
  steps: 16,                  // 16 = 16th grid, 12 = triplet grid (per bar of 4/4)
  swing: 0.2, swingRes: 16,   // optional default swing (0..1) on 8ths or 16ths
  desc: 'One sentence about the feel.',
  tracks: {                   // any of: ride, oh, hh, rim, snare, kick
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
npm test                        # timing + pattern save/load tests (Node 18+, no dependencies)
```

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | Layout: mobile-first, dark, high contrast |
| `js/app.js` | UI wiring and settings |
| `js/engine.js` | AudioContext and the lookahead scheduler loop |
| `js/sequencer.js` | Pure timing: step times, swing, tempo trainer, gap trainer |
| `js/synth.js` | Synthesized drum voices |
| `js/patterns.js` | Pattern model, metronome patterns, saved-pattern library, JSON import/export |
| `js/grooves.js` | The groove library |
| `js/storage.js` | localStorage wrapper (every access is in try/catch) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and installability |

**How the timing works:** a worker timer wakes the engine every 25 ms. That timer never times notes itself. On each wake-up, the sequencer works out the exact audio-clock time of every step in the next 120 ms, and Web Audio plays those notes sample-accurately. Step times come from the beat start and the beat length rather than from adding up timer intervals, so there is no drift. The tests check this over 1000 bars.

**When you change app files**, bump `CACHE_VERSION` in `sw.js`. Installed copies then download the new version in the background and use it on their next launch.

**Deployment:** `.github/workflows/pages.yml` runs the tests on every push and publishes the site to GitHub Pages from the default branch. In the repository settings, **Settings → Pages → Build and deployment → Source** must be set to **GitHub Actions**.
