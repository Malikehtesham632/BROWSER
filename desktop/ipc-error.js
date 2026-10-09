export function normalizeIpcError(channel, error) {
  const prefix = `Error invoking remote method '${channel}': `;
  const rawMessage = typeof error?.message === 'string' ? error.message : '';
  const remoteMessage = rawMessage.startsWith(prefix)
    ? rawMessage.slice(prefix.length)
    : rawMessage;
  const message = remoteMessage.replace(/^(?:Error|TypeError|RangeError):\s*/, '');
  return new Error(message || `The ${channel} request failed.`);
}
