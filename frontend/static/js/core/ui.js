import { h } from './dom.js';
import { local } from './store.js';

let box;
export function toast(msg, isErr = false) {
  box ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = box.appendChild(h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg));
  setTimeout(() => t.remove(), 3800);
}

export function applyTheme() {
  const saved = local.get('theme');
  const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function toggleTheme() {
  local.set('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  applyTheme();
  document.dispatchEvent(new Event('themechange'));
}

/** Loading text with a running timer, for the slow model-training endpoints. */
export function progress(label) {
  const t0 = Date.now();
  const el = h('div', { class: 'state', role: 'status' }, label);
  const id = setInterval(() => { el.textContent = `${label} ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
  el.stop = () => clearInterval(id);
  return el;
}

export const errorBox = (e, retry) =>
  h('div', { class: 'state err' }, e.message || 'Something went wrong. ', retry && h('button', { class: 'btn ghost small', onclick: retry }, 'Retry'));
