// app.js — entry point. Loads the UI modules, registers the tabs in order,
// draws the initial state and registers the service worker.
//
// Where things live (js/ui/):
//   core.js       settings, audio engine, event bus, source + tab registries
//   widgets.js    shared UI helpers (segmented buttons, dialogs, toasts)
//   transport.js  tempo, tap, swing, play/stop, beat lights, status line
//   metronome.js, grooves.js, builder.js, feel.js, trainer.js   one module per tab
//   mixer.js      per-drum volume/mute
//   keyboard.js   desktop shortcuts
//
// To add a feature tab: write js/ui/<feature>.js exporting `panel`
// ({ id, label, source?, onShow? }), add a <section id="panel-<id>"
// class="panel"> to index.html, and register it below.

import { S, registerPanel, showTab, refreshSequence } from './ui/core.js';
import { renderPlay, renderBpm, renderStatus } from './ui/transport.js';
import * as metronome from './ui/metronome.js';
import * as grooves from './ui/grooves.js';
import * as builder from './ui/builder.js';
import * as trainer from './ui/trainer.js';
import * as feel from './ui/feel.js';
import { renderMixers } from './ui/mixer.js';
import './ui/keyboard.js';

for (const m of [metronome, grooves, builder, feel, trainer]) registerPanel(m.panel);

metronome.renderMetronome();
grooves.renderGrooves();
renderMixers();
trainer.renderTrainer();
feel.renderFeel();
showTab(S.tab);
refreshSequence(true);
builder.renderBuilder();
renderPlay();
renderBpm();
renderStatus(null);

// Offline support: register the service worker (needs http/https).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
