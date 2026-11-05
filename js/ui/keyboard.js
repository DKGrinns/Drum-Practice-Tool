// keyboard.js — desktop shortcuts: Space play/stop, T tap, ↑/↓ tempo.

import { $ } from './core.js';
import { togglePlay, tap, changeBpm, shownBpm } from './transport.js';

function isTyping(el) {
  return el && (el.isContentEditable || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(el.type)));
}

document.addEventListener('keydown', e => {
  if ($('dialog').open || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = isTyping(e.target);
  if (e.code === 'Space' && !typing) {
    e.preventDefault(); // stop the focused button from also being "clicked"
    if (!e.repeat) togglePlay();
    return;
  }
  if (typing || e.target.type === 'range') return;
  if (e.key === 't' || e.key === 'T') tap();
  else if (e.key === 'ArrowUp') { e.preventDefault(); changeBpm(shownBpm() + (e.shiftKey ? 5 : 1)); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); changeBpm(shownBpm() - (e.shiftKey ? 5 : 1)); }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault();
});
