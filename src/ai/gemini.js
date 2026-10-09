import { OmniError } from '../core/errors.js';
import { CircuitBreaker } from '../core/circuit.js';

function extractOutputText(data) {
  const parts = [];
  for (const candidate of data?.candidates || []) for (const part of candidate?.content?.parts || []) if (typeof part?.text === 'string') parts.push(part.text);
  return parts.join('\n');
}

function parseJson(text) {
  const trimmed = String(text || '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) try { return JSON.parse(fenced[1]); } catch {}
  const starts = [trimmed.indexOf('{'), trimmed.indexOf('[')].filter(x => x >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start >= 0) for (let end = trimmed.length; end > start; end--) try { return JSON.parse(trimmed.slice(start, end)); } catch {}
  throw new OmniError('AI_BAD_JSON', 'Gemini returned invalid JSON', 502);
}

function retryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function isRetryableStatus(status) { return [408, 429, 500, 502, 503, 504].includes(status); }

export function createGeminiClient(config, deps = {}) {
  const apiKey = config.ai?.apiKey || '';
  const fetchImpl = deps.fetchImpl || fetch;
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const random = deps.random || Math.random;
  const model = config.ai?.model || 'gemini-3.8-flash';
  const fallbackModels = Array.isArray(config.ai?.fallbackModels) ? config.ai.fallbackModels.filter(Boolean) : [];
  const models = [...new Set([model, ...fallbackModels])];
  const timeoutMs = Math.max(1000, Number(config.ai?.timeoutMs ?? 30000));
  const maxOutputTokens = Math.max(128, Number(config.ai?.maxOutputTokens ?? 4000));
  const maxRetries = Math.max(0, Number(config.ai?.maxRetries ?? 3));
  const retryBaseMs = Math.max(100, Number(config.ai?.retryBaseMs ?? 1000));
  const maxRetryDelayMs = Math.max(retryBaseMs, Number(config.ai?.maxRetryDelayMs ?? 15000));
  const breakerThreshold = Math.max(1, Number(config.ai?.breakerThreshold ?? 3));
  const breakerCooldownMs = Math.max(1000, Number(config.ai?.breakerCooldownMs ?? 30000));
  const breaker = deps.breaker || new CircuitBreaker({ threshold: breakerThreshold, cooldownMs: breakerCooldownMs });
  const cache = deps.cache || null;

  async function requestModel(targetModel, { system, user }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens, responseMimeType: 'application/json' }
        }),
        signal: controller.signal
      });
      const body = await res.text();
      let data;
      try { data = JSON.parse(body); } catch {
        const e = new OmniError('AI_HTTP', `Gemini returned non-JSON (${res.status})`, 502); e.retryable = res.status >= 500; e.providerStatus = res.status; throw e;
      }
      if (!res.ok) {
        const message = String(data?.error?.message || 'request failed').slice(0, 300);
        const e = new OmniError('AI_HTTP', `Gemini API error (${res.status}): ${message}`, res.status === 429 ? 429 : res.status >= 500 ? 502 : res.status);
        e.retryable = isRetryableStatus(res.status); e.retryAfterMs = retryAfterMs(res.headers?.get?.('retry-after')); e.providerStatus = res.status;
        throw e;
      }
      if (data?.promptFeedback?.blockReason) throw new OmniError('AI_BLOCKED', `Gemini blocked the query-generation request: ${data.promptFeedback.blockReason}`, 502);
      const text = extractOutputText(data);
      if (!text) throw new OmniError('AI_EMPTY', 'Gemini returned an empty query-generation response', 502);
      return parseJson(text);
    } catch (e) {
      if (e?.name === 'AbortError') { const x = new OmniError('AI_TIMEOUT', `Gemini query generation timed out (${targetModel})`, 504); x.retryable = true; throw x; }
      if (e instanceof OmniError) throw e;
      const x = new OmniError('AI_NETWORK', `Gemini request failed: ${String(e?.message || e).slice(0, 300)}`, 502); x.retryable = true; throw x;
    } finally { clearTimeout(timer); }
  }

  async function requestWithRetry(targetModel, payload) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try { return await requestModel(targetModel, payload); }
      catch (error) {
        lastError = error;
        if (!error.retryable || attempt >= maxRetries) throw error;
        const exponential = Math.min(maxRetryDelayMs, retryBaseMs * (2 ** attempt));
        const jitter = Math.floor(random() * Math.min(500, exponential * 0.25));
        await sleep(Math.min(maxRetryDelayMs, error.retryAfterMs ?? exponential + jitter));
      }
    }
    throw lastError;
  }

  async function generateJson({ system, user }) {
    if (!apiKey) throw new OmniError('AI_NOT_CONFIGURED', 'Gemini query AI is not configured', 503);
    const cacheKeyModel = models.join('|');
    if (cache) {
      const hit = await cache.get(cacheKeyModel, system, user);
      if (hit) return hit;
    }
    let lastError;
    for (const targetModel of models) {
      if (breaker.isOpen(targetModel)) continue;
      try {
        const result = await requestWithRetry(targetModel, { system, user });
        breaker.success(targetModel);
        if (cache) await cache.set(cacheKeyModel, system, user, result);
        return result;
      } catch (error) {
        lastError = error;
        if (error.retryable) breaker.failure(targetModel); else throw error;
      }
    }
    throw new OmniError('AI_UNAVAILABLE', `Gemini query AI is temporarily unavailable after trying: ${models.join(', ')}`, 503, { cause: lastError?.message });
  }

  return { generateJson, model, fallbackModels, models, breaker, cache };
}
