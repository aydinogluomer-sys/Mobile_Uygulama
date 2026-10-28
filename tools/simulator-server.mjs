import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, 'iphone-simulator.html');
const PORT = 8082;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(HTML_PATH).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[iPhone Simulator] Serving on http://localhost:${PORT}`);
});
