import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHardcoverLookup, LookupError, validIsbn } from './hardcover.mjs';

export function createBookServer(lookup = createHardcoverLookup({ token: process.env.HARDCOVER_API_TOKEN })) {
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed.' });
    const path = req.url?.split('?')[0];
    if (path === '/health') return send(200, { status: 'ok' });
    const match = /^\/api\/books\/([^/]{1,64})\/hardcover$/.exec(path || '');
    if (!match) return send(404, { error: 'Not found.' });
    if (!validIsbn(match[1])) return send(400, { error: 'Invalid ISBN-13.' });
    try { send(200, await lookup(match[1])); }
    catch (error) { send(error instanceof LookupError ? error.status : 502, { error: 'Book service temporarily unavailable.' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createBookServer();
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 3001), '0.0.0.0', () => console.log('Book proxy listening.'));
  process.on('SIGTERM', () => { server.close(); server.closeIdleConnections(); });
}
