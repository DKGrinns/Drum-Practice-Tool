// storage.js — tiny localStorage wrapper.
// Every access is wrapped in try/catch: storage can be missing, full, or
// blocked (private browsing, disabled site data), and the app must keep
// working without it.

const PREFIX = 'grooveTrainer.';

export function load(key, fallback) {
  try {
    const raw = globalThis.localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

export function save(key, value) {
  try {
    globalThis.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

export function remove(key) {
  try {
    globalThis.localStorage.removeItem(PREFIX + key);
  } catch (err) {
    /* ignore */
  }
}
