import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

export function createStaticHandler(rootDir) {
  const root = path.resolve(rootDir);
  return async function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return false;
    }
    if (pathname.includes('\0')) return false;
    if (pathname === '/') pathname = '/index.html';
    const extension = path.extname(pathname).toLowerCase();
    if (!TYPES[extension]) return false;
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) return false;
    if (path.basename(file).startsWith('.')) return false;
    let data;
    try {
      data = await fs.readFile(file);
    } catch {
      return false;
    }
    const headers = {
      'Content-Type': TYPES[extension],
      'Content-Length': data.length,
      'Cache-Control': extension === '.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    };
    if (extension === '.html') headers['Content-Security-Policy'] = WEB_CSP;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  };
}
