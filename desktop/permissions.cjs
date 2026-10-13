const SILENT_ALLOW = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'mediaKeySystem'
]);
const PROMPTED = new Set(['geolocation', 'notifications', 'media']);
const PROMPT_TIMEOUT_MS = 60000;

function originOf(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function describePermission(permission, details = {}) {
  if (permission === 'geolocation') return 'know your location';
  if (permission === 'notifications') return 'send you notifications';
  if (permission === 'media') {
    const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    const video = types.includes('video');
    const audio = types.includes('audio');
    if (video && audio) return 'use your camera and microphone';
    if (video) return 'use your camera';
    if (audio) return 'use your microphone';
    return 'use your camera or microphone';
  }
  return 'use a browser feature';
}

function createPermissionPolicy({ isKnownContents, ask, timeoutMs = PROMPT_TIMEOUT_MS } = {}) {
  const decisions = new Map();
  const pending = new Map();
  let counter = 0;

  function decisionKey(origin, permission) {
    return `${origin}|${permission}`;
  }

  function onRequest(contents, permission, callback, details = {}) {
    if (!isKnownContents(contents)) return callback(false);
    if (SILENT_ALLOW.has(permission)) return callback(true);
    if (!PROMPTED.has(permission)) return callback(false);
    const origin = originOf(details.requestingUrl || contents.getURL?.());
    if (!origin) return callback(false);
    const known = decisions.get(decisionKey(origin, permission));
    if (known !== undefined) return callback(known);
    const id = `p${++counter}`;
    const timer = setTimeout(() => respond(id, false), timeoutMs);
    timer.unref?.();
    pending.set(id, { callback, origin, permission, timer });
    ask({
      id,
      origin,
      host: new URL(origin).host,
      permission,
      action: describePermission(permission, details)
    });
  }

  function respond(id, allow) {
    const item = pending.get(String(id));
    if (!item) return false;
    pending.delete(String(id));
    clearTimeout(item.timer);
    const allowed = allow === true;
    decisions.set(decisionKey(item.origin, item.permission), allowed);
    item.callback(allowed);
    return true;
  }

  function onCheck(contents, permission, requestingOrigin) {
    if (SILENT_ALLOW.has(permission)) return true;
    if (!PROMPTED.has(permission)) return false;
    const origin = originOf(requestingOrigin);
    return Boolean(origin) && decisions.get(decisionKey(origin, permission)) === true;
  }

  function denyAll() {
    for (const id of [...pending.keys()]) respond(id, false);
  }

  return { onRequest, onCheck, respond, denyAll, pendingCount: () => pending.size };
}

module.exports = { createPermissionPolicy, describePermission, originOf, SILENT_ALLOW, PROMPTED };
