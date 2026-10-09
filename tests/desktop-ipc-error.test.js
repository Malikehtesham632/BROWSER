import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIpcError } from '../desktop/ipc-error.js';

test('IPC errors expose actionable messages without Electron transport details', () => {
  const error = new Error(
    "Error invoking remote method 'omni:search': Error: No search provider is configured."
  );
  assert.equal(
    normalizeIpcError('omni:search', error).message,
    'No search provider is configured.'
  );
});

test('IPC validation errors remove their remote method and type prefixes', () => {
  const error = new Error(
    "Error invoking remote method 'omni:search': TypeError: Query is too long."
  );
  assert.equal(normalizeIpcError('omni:search', error).message, 'Query is too long.');
});

test('IPC errors without a message use a useful request-specific fallback', () => {
  assert.equal(normalizeIpcError('omni:search', {}).message, 'The omni:search request failed.');
});
