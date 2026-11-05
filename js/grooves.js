// grooves.js — the built-in groove library.
//
// Each groove is written in step notation, one string per instrument:
//   '-' off   'x' hit   'X' accent   'g' ghost note
// Spaces and '|' are ignored, so write each beat as a group for readability.
//
// style: the genre family (one of FAMILIES at the bottom), used for the
//        filter chips.
// steps: steps per bar. In 4/4: 16 -> each beat has 4 steps (1 e & a)
//        12 -> each beat has 3 steps (1 trip let), for shuffles / triplet feels
// meter: optional '3/4', '5/4' or '7/8' (default 4/4). Steps per bar then
//        follow PATTERN_METERS in patterns.js, e.g. 3/4 = 12 or 9, 7/8 = 14.
// eighths: true -> each character is an eighth note (expanded to 16ths).
//        Handy for Latin grooves felt "in 2" written over two bars.
// For multi-bar grooves just keep writing: the string length must be
// steps x bars (half that with eighths: true).
//
// bpm, swing (0..1) and swingRes (8 or 16) are the defaults loaded when the
// groove is selected. Instruments you leave out are silent.
// See README.md for how to add your own.

import { parseTrack, normalizePattern } from './patterns.js';

export const GROOVES = [
  // ---------------------------------------------------------------- Reggae
  {
    id: 'one-drop', style: 'Reggae', name: 'One Drop',
    bpm: 72, steps: 16, swing: 0.45, swingRes: 8,
    desc: 'Nothing on 1. Kick and cross-stick land together on 3 — the "drop". Lay back, let the space breathe.',
    tracks: {
      hh:   'x-x- x-x- x-x- x-x-',
      rim:  '---- ---- X--- ----',
      kick: '---- ---- X--- ----',
    },
  },
  {
    id: 'one-drop-triplet', style: 'Reggae', name: 'One Drop (Triplet Hats)',
    bpm: 70, steps: 12,
    desc: 'One drop with the hi-hat skipping on the triplet ("1 – let"), the classic roots shuffle feel.',
    tracks: {
      hh:   'x-x x-x x-x x-x',
      rim:  '--- --- X-- ---',
      kick: '--- --- X-- ---',
    },
  },
  {
    id: 'rockers', style: 'Reggae', name: 'Rockers',
    bpm: 80, steps: 16, swing: 0.2, swingRes: 16,
    desc: 'Kick on 1 and 3 drives it forward; snare on 3 with busy 16th hats and an open-hat lift on the & of 4.',
    tracks: {
      hh:    'XxXx XxXx XxXx Xx-x',
      oh:    '---- ---- ---- --X-',
      snare: '---- ---- X--- ----',
      kick:  'X--- ---- X--- ----',
    },
  },
  {
    id: 'steppers', style: 'Reggae', name: 'Steppers',
    bpm: 76, steps: 16, swing: 0.3, swingRes: 8,
    desc: 'Four on the floor kick marching under a cross-stick on 3. Hi-hat leans on the off-beat 8ths.',
    tracks: {
      hh:   'x-X- x-X- x-X- x-X-',
      rim:  '---- ---- X--- ----',
      kick: 'X--- X--- X--- X---',
    },
  },
  {
    id: 'reggae-hats-offbeat', style: 'Reggae', name: 'Reggae Hats 1: Off-beat Chick',
    bpm: 74, steps: 16, swing: 0.3, swingRes: 8,
    desc: 'Hi-hat only on the "&"s, answering the guitar skank. One drop underneath.',
    tracks: {
      hh:   '--X- --X- --X- --X-',
      rim:  '---- ---- X--- ----',
      kick: '---- ---- X--- ----',
    },
  },
  {
    id: 'reggae-hats-open', style: 'Reggae', name: 'Reggae Hats 2: Open-hat Lift',
    bpm: 74, steps: 16, swing: 0.3, swingRes: 8,
    desc: 'Closed on the beat, open "tssh" on every off-beat. Bigger, more lifted one drop.',
    tracks: {
      hh:   'x--- x--- x--- x---',
      oh:   '--x- --x- --x- --x-',
      rim:  '---- ---- X--- ----',
      kick: '---- ---- X--- ----',
    },
  },
  {
    id: 'reggae-hats-16', style: 'Reggae', name: 'Reggae Hats 3: Sly 16ths',
    bpm: 76, steps: 16, swing: 0.25, swingRes: 16,
    desc: 'Driving 16th hats with ghosted in-betweens and a skip before beat 3. Two bars: the second adds an open hat.',
    tracks: {
      hh:   'Xgxg Xgxg Xgxg Xgxg | Xgxg Xgxg Xgxg Xg-g',
      oh:   '---- ---- ---- ---- | ---- ---- ---- --X-',
      rim:  '---- ---- X--- ---- | ---- ---- X--- ----',
      kick: '---- ---- X--- ---- | ---- ---- X--- ----',
    },
  },

  // ------------------------------------------------------------------ Funk
  {
    id: 'funk-16-ghost', style: 'Funk', name: 'Straight 16th Funk (Ghost Notes)',
    bpm: 96, steps: 16,
    desc: 'Even 16ths on the hat with 8th-note accents. Ghost notes on the snare fill the gaps around a hard backbeat.',
    tracks: {
      hh:    'XxXx XxXx XxXx XxXx',
      snare: '-g-- X--g -g-- X-g-',
      kick:  'X-X- ---- --X- -X--',
    },
  },
  {
    id: 'funk-sync-kick', style: 'Funk', name: 'Syncopated Kick Funk',
    bpm: 100, steps: 16, swing: 0.1, swingRes: 16,
    desc: 'The kick dances on the "a"s and "&"s against a steady backbeat. Open hat on the & of 4 sets up the 1.',
    tracks: {
      hh:    'X-x- X-x- X-x- X---',
      oh:    '---- ---- ---- --X-',
      snare: '---- X--g -g-- X---',
      kick:  'X--x --X- --X- -x--',
    },
  },
  {
    id: 'funk-half-time', style: 'Funk', name: 'Half-time Funk',
    bpm: 84, steps: 16, swing: 0.15, swingRes: 16,
    desc: 'Backbeat only on 3 makes it feel half speed while the 16th hats and ghosts keep it greasy.',
    tracks: {
      hh:    'XxXx XxXx XxXx XxXx',
      snare: '-g-g ---g X--g -g-g',
      kick:  'X--- --X- --X- ----',
    },
  },

  // ------------------------------------------------------------------ Soul
  {
    id: 'soul-backbeat', style: 'Soul & R&B', name: 'Classic Soul Backbeat',
    bpm: 104, steps: 16,
    desc: 'Straight 8ths, fat backbeat on 2 and 4, kick on 1, the & of 2 and 3. Sit right in the pocket.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x-',
      snare: '---- X--- ---- X---',
      kick:  'X--- --X- X--- ----',
    },
  },
  {
    id: 'soul-shuffle', style: 'Soul & R&B', name: 'Soul Shuffle',
    bpm: 96, steps: 12,
    desc: 'Triplet shuffle on the hat, backbeat on 2 and 4 with ghosted pickups on the "let".',
    tracks: {
      hh:    'x-x x-x x-x x-x',
      snare: '--g X-- --g X--',
      kick:  'X-- --x X-- ---',
    },
  },

  // ---------------------------------------------------------------- Fusion
  {
    id: 'half-time-shuffle', style: 'Fusion', name: 'Half-time Shuffle',
    bpm: 82, steps: 12,
    desc: 'Purdie-style: ghost notes on the middle triplet, backbeat on 3. Keep the ghosts whisper-quiet.',
    tracks: {
      hh:    'x-x x-x x-x x-x',
      snare: '-g- -g- Xg- -g-',
      kick:  'X-- --x --- X--',
    },
  },
  {
    id: 'linear', style: 'Fusion', name: 'Linear Groove',
    bpm: 98, steps: 16,
    desc: 'No two limbs ever hit together. Kick, snare and hat interlock into one flowing 16th line.',
    tracks: {
      hh:    '-x-x -x-x -x-- -x-x',
      snare: '--g- X--- --g- X---',
      kick:  'X--- --X- X--X --X-',
    },
  },
  {
    id: 'reggae-funk', style: 'Fusion', name: 'Reggae / Funk Hybrid',
    bpm: 90, steps: 16, swing: 0.25, swingRes: 16,
    desc: 'One-drop space on beat 1 with funk ghost notes and 16th hats. Kick pickups push into the drop on 3.',
    tracks: {
      hh:    'XgXg XgXg XgXg Xg-g',
      oh:    '---- ---- ---- --X-',
      rim:   '---- ---- X--- ----',
      snare: '-g-g ---g --g- -g--',
      kick:  '---- ---x X--- --x-',
    },
  },
  {
    id: 'ride-fusion', style: 'Fusion', name: 'Ride Funk-Fusion',
    bpm: 108, steps: 16, swing: 0.1, swingRes: 16,
    desc: 'Quarter-note ride with bell accents, hi-hat foot on the &s, and a syncopated kick under a ghosted snare.',
    tracks: {
      ride:  'X-x- X-x- X-x- X-x-',
      hh:    '--x- --x- --x- --x-',
      snare: '-g-- X--g --g- X-g-',
      kick:  'X--x --X- -x-- --X-',
    },
  },

  // ------------------------------------------------------- Reggae (more)
  {
    id: 'rocksteady', style: 'Reggae', name: 'Rocksteady',
    bpm: 80, steps: 16, swing: 0.35, swingRes: 8,
    desc: 'The bridge from ska to reggae: slower and smoother, cross-stick on 2 and 4, kick on 1 and 3, hat pushing the off-beats.',
    tracks: {
      hh:   'x-X- x-X- x-X- x-X-',
      rim:  '---- X--- ---- X---',
      kick: 'X--- ---- X--- ----',
    },
  },
  {
    id: 'ska', style: 'Reggae', name: 'Ska',
    bpm: 150, steps: 16, swing: 0.2, swingRes: 8,
    desc: 'Upbeat Jamaican ska: hi-hat chops every off-beat with the guitar, snare on 2 and 4, kick on 1 and 3. Light and bouncy.',
    tracks: {
      hh:    '--X- --X- --X- --X-',
      snare: '---- X--- ---- X---',
      kick:  'X--- ---- X--- ----',
    },
  },
  {
    id: 'nyabinghi', style: 'Reggae', name: 'Nyabinghi (Kit Adaptation)',
    bpm: 66, steps: 12,
    desc: 'Rasta hand-drum rhythm on the kit: the big bass drum (floor tom) on 1, the funde "heartbeat" (low conga) on 2 and 4 with its pickup, shaker on the triplet.',
    tracks: {
      shaker: 'x-x x-x x-x x-x',
      congaL: '--g X-- --g X--',
      tom3:   'X-- --- g-- ---',
    },
  },

  // -------------------------------------------------------------- Caribbean
  {
    id: 'dancehall', style: 'Caribbean', name: 'Dancehall',
    bpm: 96, steps: 16,
    desc: 'Digital-era dancehall: the 3-3-2 kick figure in each half bar under a straight backbeat.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x-',
      snare: '---- X--- ---- X---',
      kick:  'X--x --x- X--x --x-',
    },
  },
  {
    id: 'dembow', style: 'Caribbean', name: 'Reggaeton / Dembow',
    bpm: 92, steps: 16,
    desc: 'Four-on-the-floor kick with the snare on the "a" of 1 and the "&" of 2 in every half bar — the dembow rhythm.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x-',
      snare: '---x --x- ---x --x-',
      kick:  'X--- X--- X--- X---',
    },
  },
  {
    id: 'soca', style: 'Caribbean', name: 'Soca',
    bpm: 150, steps: 16,
    desc: 'Carnival drive: four-on-the-floor kick, open hats on every off-beat, snare on 2 and 4 with pickups.',
    tracks: {
      hh:    'x--- x--- x--- x---',
      oh:    '--x- --x- --x- --x-',
      snare: '---- X--x ---- X-x-',
      kick:  'X--- X--- X--- X---',
    },
  },
  {
    id: 'calypso', style: 'Caribbean', name: 'Calypso',
    bpm: 112, steps: 16, swing: 0.2, swingRes: 16,
    desc: 'Trinidad two-beat: a kick figure that bounces between the beats, cowbell on the off-beats, backbeat on 2 and 4.',
    tracks: {
      cowbell: 'x-X- x-X- x-X- x-X-',
      snare:   '---- X--- ---- X---',
      kick:    'X--x --X- X--x --X-',
    },
  },

  // ----------------------------------------------------------- Funk (more)
  {
    id: 'go-go', style: 'Funk', name: 'Go-go',
    bpm: 92, steps: 16, swing: 0.5, swingRes: 16,
    desc: 'Washington D.C. pocket: swung 16ths, the cowbell call and a laid-back backbeat. It never stops.',
    tracks: {
      hh:      'x-x- x-x- x-x- x---',
      oh:      '---- ---- ---- --x-',
      cowbell: 'X--x --X- --X- X---',
      snare:   '---- X--g ---- X---',
      kick:    'X--- ---x --X- ----',
    },
  },
  {
    id: 'second-line', style: 'Funk', name: 'New Orleans Second Line',
    bpm: 96, steps: 16, swing: 0.5, swingRes: 16,
    desc: 'Street-parade feel: a bass drum figure under a busy, swung snare with ghost notes and accents. Two bars.',
    tracks: {
      snare: 'g-gX g-gX gXg- X-g- | g-gX g-gX ggXg X---',
      hh:    '---- x--- ---- x--- | ---- x--- ---- x---',
      kick:  'X--- --X- ---- X--- | X--- --X- ---- ----',
    },
  },
  {
    id: 'funk-open-hat', style: 'Funk', name: 'Horn-section Funk (16th Hats)',
    bpm: 104, steps: 16,
    desc: 'Two-handed 16th hats, a crisp backbeat and a kick that answers on the "a"s. Open hat on the & of 4 sets up the 1.',
    tracks: {
      hh:    'xxxx xxxx xxxx xx-x',
      oh:    '---- ---- ---- --X-',
      snare: '---- X-g- -g-- X---',
      kick:  'X-x- ---x --X- ----',
    },
  },

  // ------------------------------------------------------ Soul & R&B (more)
  {
    id: 'motown', style: 'Soul & R&B', name: 'Motown',
    bpm: 120, steps: 16,
    desc: 'Detroit drive: snare on every beat with 2 and 4 leaning hardest, tambourine doubling the backbeat.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x-',
      tamb:  '---- X--- ---- X---',
      snare: 'x--- X--- x--- X---',
      kick:  'X--- --x- X--- ----',
    },
  },
  {
    id: 'disco', style: 'Soul & R&B', name: 'Disco',
    bpm: 120, steps: 16,
    desc: 'Four-on-the-floor kick, open hat on every off-beat, backbeat on 2 and 4. Keep it relentless and even.',
    tracks: {
      hh:    'x--- x--- x--- x---',
      oh:    '--X- --X- --X- --X-',
      snare: '---- X--- ---- X---',
      kick:  'X--- X--- X--- X---',
    },
  },
  {
    id: 'soul-ballad', style: 'Soul & R&B', name: 'Soul Ballad (12/8)',
    bpm: 66, steps: 12,
    desc: 'Slow triplet ballad: every triplet on the hat, a big backbeat and a kick pickup into 3.',
    tracks: {
      hh:    'Xxx Xxx Xxx Xxx',
      snare: '--- X-- --- X--',
      kick:  'X-- --x X-- ---',
    },
  },
  {
    id: 'neo-soul', style: 'Soul & R&B', name: 'Neo-soul',
    bpm: 84, steps: 16, swing: 0.55, swingRes: 16,
    desc: 'Lazy, swung 16th pocket in the Dilla / D\'Angelo tradition. Let the kick lean late and breathe.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x-',
      snare: '---- X--- ---- X--g',
      kick:  'X--x ---- --X- -x--',
    },
  },
  {
    id: 'gospel-shuffle', style: 'Soul & R&B', name: 'Gospel Shuffle',
    bpm: 100, steps: 12,
    desc: 'Church shuffle with ghosted pickups into the backbeat — the foundation of gospel chops.',
    tracks: {
      hh:    'x-x x-x x-x x-x',
      snare: '--g X-- --g X-g',
      kick:  'X-- --x X-x ---',
    },
  },

  // ------------------------------------------------------------------ Jazz
  {
    id: 'swing-medium', style: 'Jazz', name: 'Medium Swing',
    bpm: 140, steps: 12,
    desc: 'Ride "ding, ding-a ding", hi-hat foot on 2 and 4, kick feathered softly on every beat, the odd snare comp.',
    tracks: {
      ride:  'X-- x-x X-- x-x',
      hh:    '--- x-- --- x--',
      snare: '--- --- --g ---',
      kick:  'g-- g-- g-- g--',
    },
  },
  {
    id: 'swing-fast', style: 'Jazz', name: 'Up-tempo Swing',
    bpm: 220, steps: 12,
    desc: 'Fast swing: keep the ride light and flowing, foot on 2 and 4, comp sparingly.',
    tracks: {
      ride:  'x-- x-x x-- x-x',
      hh:    '--- x-- --- x--',
      snare: '--- --- --- --g',
    },
  },
  {
    id: 'jazz-waltz', style: 'Jazz', name: 'Jazz Waltz (3/4)',
    meter: '3/4', bpm: 150, steps: 9,
    desc: 'Swinging 3/4: ride on every beat with the skip after 2, hi-hat on 2 and 3, a light kick on 1.',
    tracks: {
      ride:  'X-- x-x x--',
      hh:    '--- x-- x--',
      snare: '--- --- -g-',
      kick:  'g-- --- ---',
    },
  },
  {
    id: 'jazz-ballad', style: 'Jazz', name: 'Jazz Ballad',
    bpm: 60, steps: 12,
    desc: 'Slow and soft: the ride floats over the hi-hat on 2 and 4, with whisper-quiet snare touches.',
    tracks: {
      ride:  'x-- x-x x-- x-x',
      hh:    '--- x-- --- x--',
      snare: 'g-- --- g-- ---',
    },
  },

  // --------------------------------------------------------- Fusion (more)
  {
    id: 'paradiddle-groove', style: 'Fusion', name: 'Paradiddle Groove',
    bpm: 96, steps: 16,
    desc: 'Single paradiddle (RLRR LRLL) split between hi-hat (right) and snare (left): accents on 2 and 4, the rest ghosted.',
    tracks: {
      hh:    'x-xx -x-- x-xx -x--',
      snare: '-g-- X-gg -g-- X-gg',
      kick:  'X--- ---- --X- ----',
    },
  },
  {
    id: 'displaced-backbeat', style: 'Fusion', name: 'Displaced Backbeat',
    bpm: 100, steps: 16,
    desc: 'The backbeat on 2 moves to the "a" of 2: a classic fusion trick that pulls the groove sideways.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x-',
      snare: '---- ---X ---- X---',
      kick:  'X--- --X- X--- ----',
    },
  },
  {
    id: 'fusion-7-8', style: 'Fusion', name: '7/8 Groove (2+2+3)',
    meter: '7/8', bpm: 200, steps: 14,
    desc: 'Odd-time groove grouped 2+2+3 (count 1-2, 1-2, 1-2-3). Here the BPM counts eighth notes.',
    tracks: {
      hh:    'X- x- X- x- X- x- x-',
      snare: '-- -- X- -- -- X- --',
      kick:  'X- -- -- -x X- -- x-',
    },
  },
  {
    id: 'funk-5-4', style: 'Fusion', name: '5/4 Funk',
    meter: '5/4', bpm: 100, steps: 20,
    desc: 'Five beats a bar felt 3+2: backbeats on 2 and 4, then a kick on 5 that tips you back to 1.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x- x-x-',
      snare: '---- X--- ---- X--- --g-',
      kick:  'X--- --X- --X- ---- X--x',
    },
  },

  // ------------------------------------------------------------ Afro-Cuban
  // Grooves felt "in 2" are written in eighth notes (eighths: true) over two
  // bars at their real tempo; each character is one eighth note.
  {
    id: 'salsa-3-2', style: 'Afro-Cuban', name: 'Salsa / Son (3-2 Son Clave)',
    bpm: 180, steps: 16, eighths: true,
    desc: 'The core: 3-2 son clave, bongo bell on the beat, conga tumbao (slap on 2, open tones on 4 and its &), bass anticipations on the kick. Felt in 2.',
    tracks: {
      clave:   'X--X--X- --X-X---',
      cowbell: 'X-x-x-x- X-x-x-x-',
      congaH:  'ggXggg-- ggXggg--',
      congaL:  '------xx ------xx',
      kick:    '---x--x- ---x--x-',
    },
  },
  {
    id: 'salsa-2-3', style: 'Afro-Cuban', name: 'Salsa / Son (2-3 Son Clave)',
    bpm: 180, steps: 16, eighths: true,
    desc: 'The same band groove with the clave turned around: the two-side first. Learn to feel which side of the clave you are on.',
    tracks: {
      clave:   '--X-X--- X--X--X-',
      cowbell: 'X-x-x-x- X-x-x-x-',
      congaH:  'ggXggg-- ggXggg--',
      congaL:  '------xx ------xx',
      kick:    '---x--x- ---x--x-',
    },
  },
  {
    id: 'rumba-clave', style: 'Afro-Cuban', name: 'Rumba (3-2 Rumba Clave)',
    bpm: 110, steps: 16, eighths: true,
    desc: 'Rumba clave — the third note pulled late — with simplified guaguancó-style conga answers and shaker. Felt in 2.',
    tracks: {
      clave:  'X--X---X --X-X---',
      shaker: 'x-x-x-x- x-x-x-x-',
      congaH: '--x--x-- --x--x--',
      congaL: '------xx ---x----',
    },
  },
  {
    id: 'cha-cha', style: 'Afro-Cuban', name: 'Cha-cha-chá',
    bpm: 116, steps: 16,
    desc: 'The "one, two, cha-cha-chá": bell on the beat, güiro (shaker) 8ths, conga slap on 2 and open tones on 4 and its &.',
    tracks: {
      cowbell: 'X--- x--- X--- x---',
      shaker:  'x-x- x-x- x-x- x-x-',
      congaH:  '---- X--- ---- ----',
      congaL:  '---- ---- ---- X-X-',
      kick:    'X--- ---- X--- ----',
    },
  },
  {
    id: 'mambo', style: 'Afro-Cuban', name: 'Mambo',
    bpm: 190, steps: 16, eighths: true,
    desc: 'Big-band mambo energy: 2-3 son clave, driving cowbell accented on 1 and 3, anticipated bass (kick) on the & of 2 and on 4, tumbao congas.',
    tracks: {
      clave:   '--X-X--- X--X--X-',
      cowbell: 'X-x-X-x- X-x-X-x-',
      congaH:  'ggXggg-- ggXggg--',
      congaL:  '------xx ------xx',
      kick:    '---x--x- ---x--x-',
    },
  },
  {
    id: 'bolero', style: 'Afro-Cuban', name: 'Bolero (Kit Adaptation)',
    bpm: 80, steps: 16,
    desc: 'Slow romantic bolero: maracas (shaker) 8ths, bongó martillo on the high conga, cross-stick answering on the & of 2 and on 4.',
    tracks: {
      shaker: 'x-x- x-x- x-x- x-x-',
      congaH: 'X-g- x-g- X-g- x-g-',
      rim:    '---- --X- ---- X---',
      kick:   'X--- ---- X--- ----',
    },
  },
  {
    id: 'songo', style: 'Afro-Cuban', name: 'Songo',
    bpm: 110, steps: 16,
    desc: 'Changuito-style songo: ride bell on the beat, ghosted snare with accents, kick on the & of 2 and on 4, floor tom on the & of 4.',
    tracks: {
      ride:  'X--- X--- X--- X---',
      hh:    '--x- --x- --x- --x-',
      snare: 'g-gX -gg- g-gX -g--',
      tom3:  '---- ---- ---- --X-',
      kick:  '---- --X- ---- X---',
    },
  },
  {
    id: 'bembe-6-8', style: 'Afro-Cuban', name: 'Afro-Cuban 6/8 (Bembé)',
    bpm: 100, steps: 12,
    desc: 'The 12/8 bell pattern at the heart of Afro-Cuban and West African music. Feel four big beats under the bell.',
    tracks: {
      cowbell: 'X-x -xx -x- x-x',
      shaker:  'xgg xgg xgg xgg',
      hh:      'x-- x-- x-- x--',
      congaH:  '--x --- --x ---',
      congaL:  '--- --x --- --x',
      kick:    'X-- --- x-- ---',
    },
  },

  // ----------------------------------------------------------------- Latin
  {
    id: 'merengue', style: 'Latin', name: 'Merengue',
    bpm: 140, steps: 16,
    desc: 'Dominican merengue on the kit: güira on the shaker, the tambora figure on the floor tom with its roll into beat 4.',
    tracks: {
      shaker: 'X-xx X-xx X-xx X-xx',
      tom3:   'X--- X--- X-xx X---',
      rim:    '---- --x- ---- --x-',
      kick:   'X--- X--- X--- X---',
    },
  },
  {
    id: 'cumbia', style: 'Latin', name: 'Cumbia',
    bpm: 95, steps: 16,
    desc: 'Colombian/Mexican cumbia: guacharaca (shaker) chk-chk-ka, kick on 1 and 3, cross-stick on 2 and 4, cowbell and conga on the &s.',
    tracks: {
      shaker:  'x-xx x-xx x-xx x-xx',
      cowbell: '--x- --x- --x- --x-',
      rim:     '---- X--- ---- X---',
      congaL:  '---- --X- ---- --X-',
      kick:    'X--- ---- X--- ----',
    },
  },
  {
    id: 'bachata', style: 'Latin', name: 'Bachata',
    bpm: 128, steps: 16,
    desc: 'Dominican bachata: güira (shaker) 16th figure, bongó martillo on the high conga, bass on 1 and 3.',
    tracks: {
      shaker: 'x-xx x-xx x-xx x-xx',
      congaH: 'X-g- x-g- X-g- x-g-',
      congaL: '---- ---x ---- ---x',
      kick:   'X--- ---- X--- ----',
    },
  },
  {
    id: 'latin-rock', style: 'Latin', name: 'Latin Rock',
    bpm: 110, steps: 16,
    desc: 'Cowbell 8ths over a rock backbeat, with congas filling the spaces between kick and snare.',
    tracks: {
      cowbell: 'X-x- X-x- X-x- X-x-',
      snare:   '---- X--- ---- X---',
      congaH:  '---x --X- ---x --X-',
      kick:    'X--- --X- X--- --X-',
    },
  },

  // ------------------------------------------------------------- Brazilian
  {
    id: 'samba', style: 'Brazilian', name: 'Samba (Kit)',
    bpm: 100, steps: 16,
    desc: 'Samba on the kit: surdo-style kick (soft on 1, pickup on the "a", strong on 2 of each 2/4 bar) under 16ths on the hats accenting the "a".',
    tracks: {
      hh:   'xggX xggX xggX xggX',
      kick: 'x--x X--- x--x X---',
    },
  },
  {
    id: 'batucada', style: 'Brazilian', name: 'Samba Batucada (Kit Adaptation)',
    bpm: 100, steps: 16,
    desc: 'Samba-school layers on the kit: surdos on the toms (2nd surdo on 1, 1st surdo answering on 2), caixa 16ths on snare, tamborim on cross-stick, agogô bells.',
    tracks: {
      agogoH: '--x- x-x- --x- x-x-',
      agogoL: 'x--- ---- x--- ----',
      rim:    'X-XX -X-X -XX- X-X-',
      snare:  'gggX gggX gggX gggX',
      tom2:   'X--- ---- X--- ----',
      tom3:   '---- X--- ---- X---',
    },
  },
  {
    id: 'bossa-nova', style: 'Brazilian', name: 'Bossa Nova',
    bpm: 140, steps: 16,
    desc: 'Cross-stick plays the two-bar bossa clave, kick plays the dotted surdo figure, soft straight 8ths on the hat. Quiet and smooth.',
    tracks: {
      hh:   'x-x- x-x- x-x- x-x- | x-x- x-x- x-x- x-x-',
      rim:  'X--- --X- ---- X--- | ---- X--- --X- ----',
      kick: 'X--- --x- X--- --x- | X--- --x- X--- --x-',
    },
  },
  {
    id: 'partido-alto', style: 'Brazilian', name: 'Partido Alto',
    bpm: 96, steps: 16,
    desc: 'The partido-alto figure on cross-stick over a samba kick and hi-hat foot — the classic samba-pagode groove.',
    tracks: {
      rim:  'x--x --x- -x-- x-x-',
      hh:   '--x- --x- --x- --x-',
      kick: 'x--x X--- x--x X---',
    },
  },
  {
    id: 'baiao', style: 'Brazilian', name: 'Baião',
    bpm: 100, steps: 16,
    desc: 'Northeastern baião: the zabumba figure on the kick, cross-stick on the off-beats, triangle (tambourine) accenting the &s.',
    tracks: {
      tamb: 'gxXx gxXx gxXx gxXx',
      rim:  '--x- --x- --x- --x-',
      kick: 'X--x --X- X--x --X-',
    },
  },
  {
    id: 'maracatu', style: 'Brazilian', name: 'Maracatu (Kit Adaptation)',
    bpm: 90, steps: 16,
    desc: 'Pernambuco maracatu: heavy alfaia drums on the toms, a rolling caixa on snare and the gonguê bell on agogô. Big and stately.',
    tracks: {
      agogoH: 'X-x- -x-x X-x- -x-x',
      snare:  'xggx Xggx xggx Xggx',
      tom2:   '--x- x--- --x- x---',
      tom3:   'X--x --X- X-X- --X-',
    },
  },
  {
    id: 'samba-funk', style: 'Brazilian', name: 'Samba-funk',
    bpm: 100, steps: 16,
    desc: 'A samba kick under a funk backbeat and ghost notes — the Brazilian fusion staple.',
    tracks: {
      hh:    'xgxX xgxX xgxX xgxX',
      snare: '---- X-g- --g- X-g-',
      kick:  'x--x X--x x--x X---',
    },
  },
  {
    id: 'samba-reggae', style: 'Brazilian', name: 'Samba-reggae',
    bpm: 100, steps: 16,
    desc: 'Salvador\'s samba-reggae: heavier, slower surdos on the toms with a reggae lilt, caixa accents in a tresillo shape.',
    tracks: {
      snare: 'Xggg ggXg Xggg ggXg',
      tom2:  'X--- ---- X--x ----',
      tom3:  '---- X--- ---- X---',
    },
  },
  {
    id: 'frevo', style: 'Brazilian', name: 'Frevo',
    bpm: 140, steps: 16,
    desc: 'Recife carnival march: fast, running snare 16ths with accents over a two-beat bass drum.',
    tracks: {
      hh:    '--x- --x- --x- --x-',
      snare: 'XxgX gXxg XxgX gXxg',
      kick:  'X--- X--- X--- X---',
    },
  },

  // --------------------------------------------------------------- African
  {
    id: 'afrobeat', style: 'African', name: 'Afrobeat',
    bpm: 108, steps: 16,
    desc: 'Lagos afrobeat pocket: syncopated kick, ghosted snare, hats opening on the & of 2 and 4. Hypnotic and steady.',
    tracks: {
      hh:     'x-x- x--- x-x- x---',
      oh:     '---- --x- ---- --x-',
      shaker: 'xggx xggx xggx xggx',
      snare:  '---- X-g- -g-- X--g',
      kick:   'X--- --X- -x-- X-x-',
    },
  },
  {
    id: 'highlife', style: 'African', name: 'Highlife',
    bpm: 110, steps: 16,
    desc: 'Ghanaian highlife: a bell timeline over a bouncing kick and cross-stick backbeat. Light and joyful.',
    tracks: {
      cowbell: 'X-x- x--x -x-x --x-',
      shaker:  'xgxg xgxg xgxg xgxg',
      rim:     '---- X--- ---- X---',
      kick:    'X--- --x- X--- --x-',
    },
  },
  {
    id: 'amapiano', style: 'African', name: 'Amapiano Feel',
    bpm: 112, steps: 16,
    desc: 'South African amapiano feel: steady kick, busy shaker 16ths and syncopated rim hits. The log-drum bass is up to you.',
    tracks: {
      shaker: 'xxXx xxXx xxXx xxXx',
      rim:    '---x --x- ---x -x--',
      kick:   'X--- X--- X--- X---',
    },
  },

  // --------------------------------------------------------------- Hip-hop
  {
    id: 'boom-bap', style: 'Hip-hop', name: 'Boom Bap',
    bpm: 90, steps: 16, swing: 0.55, swingRes: 16,
    desc: 'Classic East Coast boom bap: hard backbeat, kick pickup before 3, swung 16th feel.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x-',
      snare: '---- X--- ---- X---',
      kick:  'X--- ---x --X- ----',
    },
  },
  {
    id: 'dilla-feel', style: 'Hip-hop', name: 'Dilla-style Swing',
    bpm: 86, steps: 16, swing: 0.65, swingRes: 16,
    desc: 'Heavily swung, "drunk" 16th feel. Play the kick lazy and the snare right on top.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x-',
      snare: '---- X--- ---- X---',
      kick:  'X-x- ---x -x-- ----',
    },
  },
  {
    id: 'trap', style: 'Hip-hop', name: 'Trap (Half-time)',
    bpm: 140, steps: 16,
    desc: 'Half-time snare on 3, rolling 16th hats and a sparse kick. Good for building fast, even hi-hat hands.',
    tracks: {
      hh:    'xxxx xxxx xxxx xxxx',
      snare: '---- ---- X--- ----',
      kick:  'X--- ---x --X- ----',
    },
  },
  {
    id: 'breakbeat', style: 'Hip-hop', name: 'Classic Breakbeat',
    bpm: 96, steps: 16, swing: 0.2, swingRes: 16,
    desc: 'The 60s/70s funk-break feel behind sampled hip-hop: syncopated kick, ghosted snare, steady ride. Two bars.',
    tracks: {
      ride:  'x-x- x-x- x-x- x-x- | x-x- x-x- x-x- x-x-',
      snare: '---- X--g -g-X ---- | ---- X--g -g-- X---',
      kick:  'X-X- ---- --XX ---- | X-X- ---- --X- ----',
    },
  },

  // ------------------------------------------------------------ Rock & Pop
  {
    id: 'rock-beat', style: 'Rock & Pop', name: 'Rock Beat',
    bpm: 112, steps: 16,
    desc: 'Straight-ahead rock: accented 8ths on the hat, solid 2 and 4, kick on 1, 3 and the & of 3.',
    tracks: {
      hh:    'X-x- X-x- X-x- X-x-',
      snare: '---- X--- ---- X---',
      kick:  'X--- ---- X-X- ----',
    },
  },
  {
    id: 'bo-diddley', style: 'Rock & Pop', name: 'Bo Diddley Beat',
    bpm: 110, steps: 16,
    desc: 'The rock-and-roll "shave and a haircut" clave figure on the toms, with maracas (shaker) 16ths.',
    tracks: {
      shaker: 'Xxxx Xxxx Xxxx Xxxx',
      tom3:   'X--X --X- --X- X---',
      kick:   'X--- ---- X--- ----',
    },
  },

  // ------------------------------------------------------- Blues & Country
  {
    id: 'blues-shuffle', style: 'Blues & Country', name: 'Blues Shuffle',
    bpm: 110, steps: 12,
    desc: 'The basic shuffle: hat on the long-short triplet, backbeat on 2 and 4, kick on 1 and 3.',
    tracks: {
      hh:    'x-x x-x x-x x-x',
      snare: '--- X-- --- X--',
      kick:  'X-- --- X-- ---',
    },
  },
  {
    id: 'slow-blues', style: 'Blues & Country', name: 'Slow Blues (12/8)',
    bpm: 60, steps: 12,
    desc: 'Slow 12/8: every triplet on the ride, foot on 2 and 4, heavy backbeat, kick pickup into 3.',
    tracks: {
      ride:  'Xxx Xxx Xxx Xxx',
      hh:    '--- x-- --- x--',
      snare: '--- X-- --- X--',
      kick:  'X-- --x X-- ---',
    },
  },
  {
    id: 'texas-shuffle', style: 'Blues & Country', name: 'Texas Shuffle (Double Shuffle)',
    bpm: 120, steps: 12,
    desc: 'Both hands shuffle — hat and snare together — with the backbeat accented and a four-on-the-floor kick. Relentless.',
    tracks: {
      hh:    'x-x x-x x-x x-x',
      snare: 'g-g X-g g-g X-g',
      kick:  'X-- X-- X-- X--',
    },
  },
  {
    id: 'train-beat', style: 'Blues & Country', name: 'Train Beat',
    bpm: 160, steps: 16,
    desc: 'Country "train beat": constant 16ths on the snare with accents on 2 and 4, like wheels on a track.',
    tracks: {
      snare: 'gggg Xggg gggg Xggg',
      hh:    '---- x--- ---- x---',
      kick:  'X--- ---- X--- ----',
    },
  },
];

// Genre families, in the order shown as filter chips.
export const FAMILIES = [
  'Reggae', 'Caribbean', 'Funk', 'Soul & R&B', 'Jazz', 'Fusion', 'Afro-Cuban',
  'Latin', 'Brazilian', 'African', 'Hip-hop', 'Rock & Pop', 'Blues & Country',
];

// Convert a library groove into a regular pattern object (see patterns.js).
// Bars are worked out from the length of the longest track.
export function grooveToPattern(g) {
  const parsed = {};
  let len = 0;
  for (const [voice, str] of Object.entries(g.tracks)) {
    let steps = parseTrack(str);
    if (g.eighths) steps = steps.flatMap(v => [v, 0]);
    parsed[voice] = steps;
    len = Math.max(len, steps.length);
  }
  const bars = Math.max(1, Math.ceil(len / g.steps));
  return normalizePattern({
    id: 'groove:' + g.id,
    name: g.name,
    meter: g.meter || '4/4',
    stepsPerBar: g.steps,
    bars,
    bpm: g.bpm,
    swing: g.swing || 0,
    swingRes: g.swingRes || 16,
    tracks: parsed,
  });
}
