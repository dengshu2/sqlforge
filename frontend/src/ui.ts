/** Small DOM helpers shared by the page. */

export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = kind === 'error' ? 'q-toast q-toast--error q-rise' : 'q-toast q-rise';
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  box.replaceChildren(el); // one at a time: a new one replaces the last
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 250);
  }, kind === 'error' ? 4200 : 2400);
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const coarse = () => matchMedia('(pointer: coarse)').matches;

/** Run fn at most once per `ms`, after the calls stop. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer = 0;
  return (...args: A) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}
