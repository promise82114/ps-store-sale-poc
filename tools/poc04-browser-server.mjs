import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'artifacts/poc04/phase2');
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://127.0.0.1:4184').pathname;
    if (request.method === 'POST' && ['/results', '/reload-expected'].includes(path)) {
      if (request.headers.origin !== 'http://127.0.0.1:4184') { response.writeHead(403).end(); return; }
      let text = '';
      for await (const chunk of request) { text += chunk; if (text.length > 1_000_000) throw Error('size'); }
      const data = JSON.parse(text);
      const file = path === '/reload-expected' ? 'reload-expected.json'
        : data.phase === 'initial' ? 'browser-initial.json' : data.phase === 'reload' ? 'browser-reload.json' : null;
      if (!file) throw Error('phase');
      await writeFile(resolve(output, file), JSON.stringify(data, null, 2));
      response.writeHead(200).end('saved'); return;
    }
    if (request.method === 'GET' && path === '/previous') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(await readFile(resolve(output, 'reload-expected.json'))); return;
    }
    if (request.method !== 'GET' || !/^\/(?:src\/poc04|tests\/browser|tests\/fixtures)\/[a-z0-9-]+\.(?:mjs|html)$/.test(path)) {
      response.writeHead(404).end(); return;
    }
    response.writeHead(200, { 'Content-Type': path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; object-src 'none'" });
    response.end(await readFile(resolve(root, `.${path}`)));
  } catch { if (!response.headersSent) response.writeHead(500); response.end('test server error'); }
});
server.listen(4184, '127.0.0.1', () => console.log('POC04 offline harness: http://127.0.0.1:4184/tests/browser/poc04.html'));
