// Локальная раздача dist со сжатием, как у Caddy на сервере, — чтобы честно мерить загрузку на медленной сети.
// node serve.mjs [порт]
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, extname, normalize } from 'node:path';

const ROOT = join(import.meta.dirname, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = +process.argv[2] || 8766;

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // анкета и админка — в сервис приёма анкет (forms/app.py на 8391), как делает Caddy на сервере
  if (p.startsWith('/api/') || p.startsWith('/admin')) {
    const up = request({ host: '127.0.0.1', port: 8391, path: req.url, method: req.method,
      headers: { ...req.headers, 'x-forwarded-for': '127.0.0.1' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end('forms service is down'); });
    req.pipe(up);
    return;
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  try {
    let body = await readFile(file);
    const type = TYPES[extname(file)] || 'application/octet-stream';
    const headers = { 'Content-Type': type };
    if (/text|javascript|json|svg/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body, { level: 6 }); headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers); res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
