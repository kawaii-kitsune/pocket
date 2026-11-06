const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assets = new Set(['index.html', 'app.js', 'demo.js', 'icons.js', 'style.css', 'cover.svg']);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!assets.has(file)) { res.writeHead(404).end('Not found'); return; }
  try {
    const data = await readFile(path.join(__dirname, '../src/renderer', file));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(500).end('Could not load preview'); }
});
server.on('error', error => { console.error(`Preview could not start: ${error.message}`); process.exitCode = 1; });
server.listen(4173, '127.0.0.1', () => console.log('Pocket demo: http://127.0.0.1:4173 — resize your browser to 420 × 540. Ctrl+C to stop.'));
