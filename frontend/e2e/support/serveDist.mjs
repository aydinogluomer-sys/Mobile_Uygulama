import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'dist');
const PORT = Number(process.env.E2E_PORT ?? 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

async function resolveFile(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '');
  const candidate = path.join(ROOT, clean);
  if (!candidate.startsWith(ROOT)) return null;
  try {
    const s = await stat(candidate);
    if (s.isFile()) return candidate;
  } catch {
    /* SPA fallback */
  }
  return path.join(ROOT, 'index.html');
}

createServer(async (req, res) => {
  const file = await resolveFile(req.url ?? '/');
  if (!file) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res
      .writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving dist on http://127.0.0.1:${PORT}`));
