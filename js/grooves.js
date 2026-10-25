// grooves.js — the built-in groove library.
//
// Each groove is written in step notation, one string per instrument:
//   '-' off   'x' hit   'X' accent   'g' ghost note
// Spaces and '|' are ignored, so write each beat as a group for readability.
//
// steps: 16 -> each beat has 4 steps (1 e & a)
//        12 -> each beat has 3 steps (1 trip let), for shuffles / triplet feels
// For multi-bar grooves just keep writing: the string length must be
// steps x bars.
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
    id: 'soul-backbeat', style: 'Soul', name: 'Classic Soul Backbeat',
    bpm: 104, steps: 16,
    desc: 'Straight 8ths, fat backbeat on 2 and 4, kick on 1, the & of 2 and 3. Sit right in the pocket.',
    tracks: {
      hh:    'x-x- x-x- x-x- x-x-',
      snare: '---- X--- ---- X---',
      kick:  'X--- --X- X--- ----',
    },
  },
  {
    id: 'soul-shuffle', style: 'Soul', name: 'Soul Shuffle',
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
];

export const STYLES = ['Reggae', 'Funk', 'Soul', 'Fusion'];

// Convert a library groove into a regular pattern object (see patterns.js).
// Bars are worked out from the length of the longest track.
export function grooveToPattern(g) {
  const parsed = {};
  let len = 0;
  for (const [voice, str] of Object.entries(g.tracks)) {
    parsed[voice] = parseTrack(str);
    len = Math.max(len, parsed[voice].length);
  }
  const bars = Math.max(1, Math.ceil(len / g.steps));
  return normalizePattern({
    id: 'groove:' + g.id,
    name: g.name,
    stepsPerBar: g.steps,
    bars,
    bpm: g.bpm,
    swing: g.swing || 0,
    swingRes: g.swingRes || 16,
    tracks: parsed,
  });
}
