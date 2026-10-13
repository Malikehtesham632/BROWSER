const DIGITS = /^[1-9]$/;

export function matchShortcut(input) {
  const key = String(input?.key ?? '');
  const lower = key.toLowerCase();
  const ctrl = Boolean(input?.ctrl);
  const shift = Boolean(input?.shift);
  const alt = Boolean(input?.alt);
  if (!key) return null;

  if (ctrl && !alt) {
    if (key === 'Tab') return shift ? 'prev-tab' : 'next-tab';
    if (key === 'PageDown') return 'next-tab';
    if (key === 'PageUp') return 'prev-tab';
    if (key === 'F4') return 'close-tab';
    if (DIGITS.test(key) && !shift) return key === '9' ? 'last-tab' : `tab-${key}`;
    if (key === '+' || key === '=') return 'zoom-in';
    if (key === '-' || key === '_') return 'zoom-out';
    if (key === '0') return 'zoom-reset';
    if (key === 'F5') return 'hard-reload';
    if (shift) {
      if (lower === 't') return 'reopen-tab';
      if (lower === 'b') return 'toggle-bookmarks-bar';
      if (lower === 'r') return 'hard-reload';
      return null;
    }
    if (lower === 'l') return 'focus-address';
    if (lower === 'k') return 'focus-search';
    if (lower === 't') return 'new-tab';
    if (lower === 'w') return 'close-tab';
    if (lower === 'r') return 'reload';
    if (lower === 'f') return 'find';
    if (lower === 'd') return 'bookmark';
    if (lower === 'b') return 'bookmarks-sidebar';
    if (lower === 'h') return 'history-sidebar';
    return null;
  }
  if (alt && !ctrl && !shift) {
    if (key === 'ArrowLeft') return 'back';
    if (key === 'ArrowRight') return 'forward';
    if (key === 'Home') return 'home';
    if (lower === 'd') return 'focus-address';
    return null;
  }
  if (!ctrl && !alt && !shift) {
    if (key === 'F5') return 'reload';
    if (key === 'F6') return 'focus-address';
    if (key === 'F11') return 'fullscreen';
  }
  return null;
}

export function fromKeyboardEvent(event) {
  return {
    key: event.key,
    ctrl: Boolean(event.ctrlKey || event.metaKey),
    shift: Boolean(event.shiftKey),
    alt: Boolean(event.altKey)
  };
}

export function fromElectronInput(input) {
  return {
    key: input.key,
    ctrl: Boolean(input.control || input.meta),
    shift: Boolean(input.shift),
    alt: Boolean(input.alt)
  };
}

export const SHORTCUT_HELP = [
  ['Focus address bar', 'Ctrl+L'],
  ['New tab', 'Ctrl+T'],
  ['Close tab', 'Ctrl+W'],
  ['Reopen closed tab', 'Ctrl+Shift+T'],
  ['Next / previous tab', 'Ctrl+Tab'],
  ['Bookmark this page', 'Ctrl+D'],
  ['Bookmarks sidebar', 'Ctrl+B'],
  ['History sidebar', 'Ctrl+H'],
  ['Bookmarks bar', 'Ctrl+Shift+B'],
  ['Find in page', 'Ctrl+F'],
  ['Reload', 'Ctrl+R'],
  ['Zoom in / out / reset', 'Ctrl + + / − / 0'],
  ['Back / forward', 'Alt+← / →'],
  ['Full screen', 'F11']
];
