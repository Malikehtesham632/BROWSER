import { OmniError } from '../core/errors.js';

function extractOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n');
}

function parseJson(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = Math.min(...[trimmed.indexOf('['), trimmed.indexOf('{')].filter((x) => x >= 0));
  if (Number.isFinite(start)) {
    for (let end = trimmed.length; end > start; end--) {
      try {
        return JSON.parse(trimmed.slice(start, end));
      } catch {}
    }
  }
  throw new OmniError('AI_BAD_JSON', 'OpenAI returned invalid JSON', 502);
}

export function createOpenAIClient(config, deps = {}) {
  const apiKey = config.ai?.apiKey || '';
  const fetchImpl = deps.fetchImpl || fetch;
  const model = config.ai?.model || 'gpt-5.6-luna';
  const timeoutMs = config.ai?.timeoutMs || 30000;
  const maxOutputTokens = config.ai?.maxOutputTokens || 4000;

  async function generateJson({ system, user }) {
    if (!apiKey) throw new OmniError('AI_NOT_CONFIGURED', 'OpenAI query AI is not configured', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: [
            { role: 'system', content: [{ type: 'input_text', text: system }] },
            { role: 'user', content: [{ type: 'input_text', text: user }] }
          ],
          max_output_tokens: maxOutputTokens
        }),
        signal: controller.signal
      });
      const body = await res.text();
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        throw new OmniError('AI_HTTP', `OpenAI returned non-JSON (${res.status})`, 502);
      }
      if (!res.ok)
        throw new OmniError(
          'AI_HTTP',
          `OpenAI API error (${res.status}): ${String(data?.error?.message || 'request failed').slice(0, 300)}`,
          502
        );
      return parseJson(extractOutputText(data));
    } catch (e) {
      if (e?.name === 'AbortError')
        throw new OmniError('AI_TIMEOUT', 'OpenAI query generation timed out', 504);
      if (e instanceof OmniError) throw e;
      throw new OmniError(
        'AI_NETWORK',
        `OpenAI request failed: ${String(e?.message || e).slice(0, 300)}`,
        502
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return { generateJson, model };
}
