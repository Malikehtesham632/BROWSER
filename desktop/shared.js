import { hueFor, letterFor } from './ui-helpers.js';
import { normalizeIpcError } from './ipc-error.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function wrapApi(raw) {
  if (!raw) return null;
  const api = {};
  for (const [name, member] of Object.entries(raw)) {
    if (typeof member !== 'function') {
      api[name] = member;
      continue;
    }
    api[name] = (...args) => {
      const result = member(...args);
      if (result && typeof result.then === 'function') {
        return result.catch((error) => {
          throw normalizeIpcError(name, error);
        });
      }
      return result;
    };
  }
  return api;
}

export const ctx = {
  state: { activeTabId: null, tabs: [] },
  api: wrapApi(window.omni),
  searchStatus: null,
  lastQuery: '',
  prefs: null
};

const listeners = new Map();

export function on(name, handler) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(handler);
  return () => listeners.get(name)?.delete(handler);
}

export function emit(name, data) {
  for (const handler of [...(listeners.get(name) || [])]) {
    try {
      handler(data);
    } catch (error) {
      console.error(`[Nova Browser] handler for "${name}" failed`, error);
    }
  }
}

export function activeTab() {
  return ctx.state.tabs.find((tab) => tab.id === ctx.state.activeTabId);
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child);
  }
  return node;
}

const ICONS = {
  back: ['m14.5 5-7 7 7 7'],
  forward: ['m9.5 5 7 7-7 7'],
  reload: ['M20 7v5h-5M4.9 9a7.5 7.5 0 0 1 12.4-2.7L20 9M4 17v-5h5m-1.4 2.7A7.5 7.5 0 0 0 20 15'],
  close: ['m6 6 12 12M18 6 6 18'],
  home: ['m3.5 10 8.5-7 8.5 7v10.5h-6v-7h-5v7h-6z'],
  plus: ['M12 5v14M5 12h14'],
  search: [{ c: [11, 11, 6.5] }, 'm16 16 4.5 4.5'],
  star: ['m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z'],
  lock: [{ r: [5, 11, 14, 9, 2] }, 'M8 11V8a4 4 0 0 1 8 0v3'],
  warning: ['M12 4 2.8 20h18.4z', 'M12 10v4.5M12 17.4v.1'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  sidebar: [{ r: [3.5, 5, 17, 14, 2] }, 'M9.5 5v14'],
  bookmark: ['M7 4h10v16l-5-3.5L7 20z'],
  clock: [{ c: [12, 12, 8.5] }, 'M12 7v5l3 2'],
  up: ['m6 14 6-6 6 6'],
  down: ['m6 10 6 6 6-6'],
  chevron: ['m9 6 6 6-6 6'],
  more: ['m7 7 5 5-5 5M13 7l5 5-5 5'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  globe: [{ c: [12, 12, 8.5] }, 'M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17'],
  trash: ['M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13'],
  zoom: [{ c: [11, 11, 6.5] }, 'm16 16 4.5 4.5M8.5 11h5M11 8.5v5'],
  fullscreen: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  undo: ['M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3'],
  keyboard: [{ r: [3, 6, 18, 12, 2.5] }, 'M7 10h.1M10.5 10h.1M14 10h.1M17 10h.1M8 14h8'],
  info: [{ c: [12, 12, 8.5] }, 'M12 11v5M12 8v.1'],
  exit: ['M10 4H5v16h5M15 8l4 4-4 4M19 12H9'],
  arrow: ['M5 12h14m-6-6 6 6-6 6'],
  location: ['M12 21s6-5.2 6-10a6 6 0 0 0-12 0c0 4.8 6 10 6 10z', { c: [12, 11, 2] }],
  bell: ['M6 17h12l-1.5-2v-4a4.5 4.5 0 0 0-9 0v4zM10 20h4'],
  camera: [{ r: [3.5, 7, 11.5, 10, 2] }, 'm15 11 5.5-3v8L15 13']
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, { filled = false } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', filled ? 'icon filled' : 'icon');
  for (const part of ICONS[name] || []) {
    if (typeof part === 'string') {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', part);
      svg.append(path);
    } else if (part.c) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', part.c[0]);
      circle.setAttribute('cy', part.c[1]);
      circle.setAttribute('r', part.c[2]);
      svg.append(circle);
    } else if (part.r) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      ['x', 'y', 'width', 'height', 'rx'].forEach((attribute, index) => {
        rect.setAttribute(attribute, part.r[index]);
      });
      svg.append(rect);
    }
  }
  return svg;
}

export function setIcon(target, name, options) {
  target.replaceChildren(icon(name, options));
}

export function mountIcons(root = document) {
  for (const node of $$('[data-icon]', root)) {
    if (!node.firstChild) node.append(icon(node.dataset.icon));
  }
}

export function safeIconUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

export function siteIcon({
  url = '',
  icon: iconUrl = '',
  title = '',
  variant = '',
  host = ''
} = {}) {
  const label = host || title || url;
  const node = el('span', { class: `site-icon ${variant}`.trim() });
  node.style.setProperty('--hue', String(hueFor(label)));
  node.append(document.createTextNode(letterFor(label)));
  const src = safeIconUrl(iconUrl);
  if (src) {
    const image = el('img', { alt: '', src, loading: 'lazy', referrerpolicy: 'no-referrer' });
    image.addEventListener('error', () => image.remove());
    node.append(image);
  }
  return node;
}

const PREFERENCES_KEY = 'nova-browser-preferences';
const DEFAULTS = { theme: 'dark', bookmarksBar: 'newtab', motion: 'auto', completed: false };

export function preferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}');
    return { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePreferences(patch) {
  const next = { ...preferences(), ...patch };
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

let toastTimer;
export function showToast(message) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}

export const FRIENDLY_ERROR_MESSAGE =
  'We hit a small snag. Please give us a moment, then try again.';

export function reportUiError(context, error) {
  console.error(`[Nova Browser] ${context}`, error);
  return FRIENDLY_ERROR_MESSAGE;
}

let overlayCount = 0;
const overlayNames = new Set();

export function openOverlay(name) {
  if (overlayNames.has(name)) return;
  overlayNames.add(name);
  overlayCount = overlayNames.size;
  if (overlayCount === 1) ctx.api?.setOverlay(true)?.catch?.(() => {});
}

export function closeOverlay(name) {
  if (!overlayNames.delete(name)) return;
  overlayCount = overlayNames.size;
  if (overlayCount === 0) ctx.api?.setOverlay(false)?.catch?.(() => {});
}

export function overlayIsOpen() {
  return overlayCount > 0;
}
