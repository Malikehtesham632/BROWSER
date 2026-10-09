function normalizeBrowserAddress(input) {
  const value = String(input || '').trim();
  if (!value) return null;

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) return null;
    if (!/^(?:localhost|(?:\[[\da-f:]+\])|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w-]+\.)+[\w-]+)(?::\d+)?(?:[/?#]|$)/i.test(candidate)) {
      return null;
    }
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

module.exports = { normalizeBrowserAddress };
