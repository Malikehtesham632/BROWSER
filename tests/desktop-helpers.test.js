import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addressUrl,
  displayUrl,
  hostOf,
  groupHistory,
  searchProgress,
  searchStep,
  formatSeconds,
  newDomains,
  providerLabel,
  nextIndex,
  hueFor,
  letterFor
} from '../desktop/ui-helpers.js';
import { matchShortcut, fromElectronInput, fromKeyboardEvent } from '../desktop/shortcuts.js';

test('address bar text becomes a web address only when it looks like one', () => {
  assert.equal(addressUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(addressUrl('example.com'), 'https://example.com');
  assert.equal(addressUrl('localhost:3000/x'), 'https://localhost:3000/x');
  assert.equal(addressUrl('192.168.1.1'), 'https://192.168.1.1');
  assert.equal(addressUrl('python asyncio'), null);
  assert.equal(addressUrl('what is node.js used for'), null);
  assert.equal(addressUrl('javascript:alert(1)'), null);
  assert.equal(addressUrl('file:///c:/x'), null);
  assert.equal(addressUrl(''), null);
  assert.equal(addressUrl(null), null);
});

test('addresses are shown the short, friendly way', () => {
  assert.equal(displayUrl('https://www.example.com/'), 'example.com');
  assert.equal(displayUrl('https://example.com/docs?a=1#top'), 'example.com/docs?a=1#top');
  assert.equal(displayUrl('http://example.com/'), 'http://example.com');
  assert.equal(displayUrl('about:blank'), 'about:blank');
  assert.equal(hostOf('https://www.example.com/x'), 'example.com');
  assert.equal(hostOf('nonsense'), '');
});

test('colours and letters for site badges are stable', () => {
  assert.equal(hueFor('example.com'), hueFor('example.com'));
  assert.ok(hueFor('a') >= 0 && hueFor('a') < 360);
  assert.equal(letterFor('https://www.example.com'), 'E');
  assert.equal(letterFor(''), 'N');
});

test('history is grouped by day', () => {
  const now = new Date(2026, 9, 9, 15, 0, 0).getTime();
  const day = 86400000;
  const entries = [
    { url: 'a', lastVisit: now - 1000 },
    { url: 'b', lastVisit: new Date(2026, 9, 8, 10).getTime() },
    { url: 'c', lastVisit: now - 4 * day },
    { url: 'd', lastVisit: now - 30 * day }
  ];
  const groups = groupHistory(entries, now);
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Yesterday', 'Last 7 days', 'Older']);
  assert.deepEqual(groups.map((g) => g.items[0].url), ['a', 'b', 'c', 'd']);
  assert.deepEqual(groupHistory([], now), []);
});

test('search progress only moves forward and ends at 100', () => {
  const values = [
    searchProgress({ stage: 'start', total: 3 }),
    searchProgress({ stage: 'provider', done: 1, total: 3 }),
    searchProgress({ stage: 'provider', done: 2, total: 3 }),
    searchProgress({ stage: 'provider', done: 3, total: 3 }),
    searchProgress({ stage: 'ranking', done: 3, total: 3 }),
    searchProgress({ stage: 'finished' })
  ];
  for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1], values.join());
  assert.equal(values.at(-1), 100);
  assert.ok(searchProgress({ stage: 'start', total: 0 }) > 0);
  assert.ok(searchProgress({ stage: 'provider', done: 9, total: 3 }) <= 92);
});

test('search steps follow the real progress', () => {
  assert.equal(searchStep({ stage: 'start', total: 3 }), 1);
  assert.equal(searchStep({ stage: 'provider', done: 1, total: 3 }), 2);
  assert.equal(searchStep({ stage: 'provider', done: 3, total: 3 }), 3);
  assert.equal(searchStep({ stage: 'ranking', done: 3, total: 3 }), 3);
  assert.equal(searchStep({ stage: 'finished' }), 4);
});

test('time is shown in seconds', () => {
  assert.equal(formatSeconds(800), '0.8 s');
  assert.equal(formatSeconds(12400), '12 s');
  assert.equal(formatSeconds(-5), '0.0 s');
  assert.equal(formatSeconds('x'), '0.0 s');
});

test('new domains are only reported once', () => {
  const seen = new Set();
  const first = newDomains([{ url: 'https://www.a.com/1' }, { url: 'https://b.com/' }, { url: 'bad' }], seen);
  assert.deepEqual(first, ['a.com', 'b.com']);
  assert.deepEqual(newDomains([{ url: 'https://a.com/2' }, { url: 'https://c.com' }], seen), ['c.com']);
  assert.equal(newDomains([{ url: 'https://d.com' }, { url: 'https://e.com' }], new Set(), 1).length, 1);
});

test('provider names are friendly', () => {
  assert.equal(providerLabel('serper'), 'Google · Serper');
  assert.equal(providerLabel('custom'), 'Custom');
  assert.equal(providerLabel(''), 'Source');
});

test('list selection wraps around', () => {
  assert.equal(nextIndex(-1, 3, 1), 0);
  assert.equal(nextIndex(-1, 3, -1), 2);
  assert.equal(nextIndex(2, 3, 1), 0);
  assert.equal(nextIndex(0, 3, -1), 2);
  assert.equal(nextIndex(0, 0, 1), -1);
});

test('keyboard shortcuts match the ones people know from Firefox', () => {
  const press = (key, mods = {}) => matchShortcut({ key, ctrl: false, shift: false, alt: false, ...mods });
  assert.equal(press('l', { ctrl: true }), 'focus-address');
  assert.equal(press('L', { ctrl: true }), 'focus-address');
  assert.equal(press('t', { ctrl: true }), 'new-tab');
  assert.equal(press('T', { ctrl: true, shift: true }), 'reopen-tab');
  assert.equal(press('w', { ctrl: true }), 'close-tab');
  assert.equal(press('Tab', { ctrl: true }), 'next-tab');
  assert.equal(press('Tab', { ctrl: true, shift: true }), 'prev-tab');
  assert.equal(press('3', { ctrl: true }), 'tab-3');
  assert.equal(press('9', { ctrl: true }), 'last-tab');
  assert.equal(press('d', { ctrl: true }), 'bookmark');
  assert.equal(press('b', { ctrl: true }), 'bookmarks-sidebar');
  assert.equal(press('B', { ctrl: true, shift: true }), 'toggle-bookmarks-bar');
  assert.equal(press('h', { ctrl: true }), 'history-sidebar');
  assert.equal(press('f', { ctrl: true }), 'find');
  assert.equal(press('F5'), 'reload');
  assert.equal(press('F5', { ctrl: true }), 'hard-reload');
  assert.equal(press('R', { ctrl: true, shift: true }), 'hard-reload');
  assert.equal(press('ArrowLeft', { alt: true }), 'back');
  assert.equal(press('ArrowRight', { alt: true }), 'forward');
  assert.equal(press('Home', { alt: true }), 'home');
  assert.equal(press('F11'), 'fullscreen');
  assert.equal(press('=', { ctrl: true }), 'zoom-in');
  assert.equal(press('-', { ctrl: true }), 'zoom-out');
  assert.equal(press('0', { ctrl: true }), 'zoom-reset');
});

test('plain typing and unknown shortcuts are left alone', () => {
  const press = (key, mods = {}) => matchShortcut({ key, ctrl: false, shift: false, alt: false, ...mods });
  assert.equal(press('a'), null);
  assert.equal(press('l'), null);
  assert.equal(press('Tab'), null);
  assert.equal(press('c', { ctrl: true }), null);
  assert.equal(press('v', { ctrl: true }), null);
  assert.equal(press('a', { ctrl: true }), null);
  assert.equal(press('x', { ctrl: true, shift: true }), null);
  assert.equal(press('ArrowLeft'), null);
  assert.equal(matchShortcut(null), null);
  assert.equal(matchShortcut({}), null);
});

test('keyboard events from the page and from the window give the same result', () => {
  assert.equal(matchShortcut(fromElectronInput({ key: 't', control: true })), 'new-tab');
  assert.equal(matchShortcut(fromElectronInput({ key: 't', meta: true })), 'new-tab');
  assert.equal(matchShortcut(fromKeyboardEvent({ key: 't', ctrlKey: true })), 'new-tab');
  assert.equal(matchShortcut(fromKeyboardEvent({ key: 't', metaKey: true, shiftKey: true })), 'reopen-tab');
});
