/** Shared, credential-safe HTTP handling for external search providers. */
export class ProviderError extends Error {
  constructor(
    message,
    { provider = 'provider', status = null, retryable = false, code = null, cause } = {}
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRYABLE_STATUS = (status) => status === 408 || status === 425 || status === 429 || status >= 500;
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
]);

function networkCode(error) {
  return error?.cause?.code || error?.code || error?.cause?.cause?.code || null;
}

function isTimeout(error, code) {
  return error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    /timed?\s*out|timeout/i.test(String(error?.message || ''));
}

function isLikelyNetworkError(error, code) {
  return Boolean(code && RETRYABLE_NETWORK_CODES.has(code)) ||
    /fetch failed|connection refused|connection reset|network unreachable|socket hang up|temporary failure in name resolution/i.test(
      `${error?.message || ''} ${error?.cause?.message || ''}`
    );
}

/**
 * Fetch a JSON endpoint with a bounded timeout and retries for transient HTTP
 * and network failures. Error text deliberately excludes response bodies,
 * query text, request URLs, and credentials.
 */
export async function fetchJson(
  url,
  {
    provider = 'provider',
    timeoutMs = 8000,
    retries = 1,
    retryBaseMs = 200,
    fetchImpl = globalThis.fetch,
    ...init
  } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new ProviderError(`${provider} is unavailable: fetch is not supported`, { provider });
  }

  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout < 1) {
    throw new ProviderError(`${provider} has an invalid timeout configuration`, { provider });
  }

  const retryCount = Math.max(0, Math.min(2, Number.isInteger(Number(retries)) ? Number(retries) : 1));
  const baseDelay = Math.max(0, Math.min(2000, Number(retryBaseMs) || 0));
  let lastError;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    let timeoutHandle;
    try {
      const controller = new AbortController();
      // Use a referenced timer so timeout handling works consistently in
      // short-lived CLI runs and tests, not only while Electron is open.
      timeoutHandle = setTimeout(() => {
        controller.abort(new DOMException(`${provider} request timed out`, 'TimeoutError'));
      }, timeout);
      const response = await fetchImpl(url, {
        ...init,
        signal: controller.signal
      });

      if (!response.ok) {
        // Release the response body but never include it in logs/errors: some
        // upstream services echo queries or other request information.
        try {
          await response.body?.cancel();
        } catch {
          // Body cleanup is best-effort.
        }
        throw new ProviderError(`${provider} HTTP ${response.status}`, {
          provider,
          status: response.status,
          retryable: RETRYABLE_STATUS(response.status)
        });
      }

      try {
        return await response.json();
      } catch (cause) {
        throw new ProviderError(`${provider} returned invalid JSON`, {
          provider,
          retryable: true,
          cause
        });
      }
    } catch (error) {
      let normalized;
      if (error instanceof ProviderError) {
        normalized = error;
      } else {
        const code = networkCode(error);
        const timeoutError = isTimeout(error, code);
        const networkError = isLikelyNetworkError(error, code);
        normalized = new ProviderError(
          timeoutError
            ? `${provider} timed out after ${timeout}ms`
            : networkError
              ? `${provider} connection failed${code ? ` (${code})` : ''}`
              : `${provider} request failed${code ? ` (${code})` : ''}`,
          {
            provider,
            code,
            // Timeouts are not repeated: retrying them multiplies the user's
            // wait. Other transient connection failures get a bounded retry.
            retryable: !timeoutError && networkError,
            cause: error
          }
        );
      }

      lastError = normalized;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      if (!normalized.retryable || attempt >= retryCount) throw normalized;
      await sleep(Math.min(2000, baseDelay * 2 ** attempt));
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  throw lastError || new ProviderError(`${provider} request failed`, { provider });
}
