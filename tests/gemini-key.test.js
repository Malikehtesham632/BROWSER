import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiClient } from '../src/ai/gemini.js';

test('the Gemini key is sent in a header and never in the url', async () => {
  const seen = [];
  const client = createGeminiClient(
    {
      ai: { apiKey: 'secret-key', model: 'm1', fallbackModels: [], timeoutMs: 1000, maxRetries: 0 }
    },
    {
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), headers: init.headers });
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"queries":[]}' }] } }] }),
          { status: 200 }
        );
      }
    }
  );
  await client.generateJson({ system: 'a', user: 'b' });
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].url.includes('secret-key'));
  assert.ok(!seen[0].url.includes('key='));
  assert.equal(seen[0].headers['x-goog-api-key'], 'secret-key');
  assert.match(seen[0].url, /models\/m1:generateContent$/);
});
