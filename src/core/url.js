const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|msclkid|yclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi|ref_src)$/i;

export function canonicalUrlKey(input) {
  let u;
  try { u = new URL(input); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const host = u.host.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  const params = [...u.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const search = params.length ? `?${new URLSearchParams(params)}` : "";
  return `${host}${path}${search}`;
}

function isPrivateIPv4(host) {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a,b] = m.slice(1).map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}
export function isPublicHttpUrl(input) {
  let u;
  try { u = new URL(input); } catch { return false; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host.startsWith("[") || !host.includes(".") ||
      host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return !isPrivateIPv4(host);
}
