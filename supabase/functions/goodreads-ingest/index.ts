import { validRecord } from './validate.ts';

// Function gateway JWT verification is disabled only for this endpoint; a
// random collector token is checked here. A hash is kept in server secrets.
Deno.serve(async req => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (status: number, body: object = {}) => new Response(JSON.stringify(body), { status, headers });
  if (req.method !== 'POST') return reply(405);
  const token = req.headers.get('x-collector-token') || '';
  const expected = Deno.env.get('GOODREADS_COLLECTOR_TOKEN_SHA256') || '';
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(expected)) return reply(401);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).map(b => b.toString(16).padStart(2, '0')).join('');
  let difference = 0; for (let i = 0; i < 64; i++) difference |= digest.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference !== 0) return reply(401);
  // Bound streaming body size before JSON parsing, even without Content-Length.
  const reader = req.body?.getReader(); if (!reader) return reply(400);
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) { const { value, done } = await reader.read(); if (done) break;
    length += value.length; if (length > 65536) { await reader.cancel(); return reply(413); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let records: unknown;
  try { records = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply(400); }
  if (!Array.isArray(records) || records.length > 25 || !records.every(r => validRecord(r))) return reply(400);
  const base = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  try {
    const response = await fetch(`${base}/rest/v1/rpc/ingest_goodreads`, { method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ records }), signal: AbortSignal.timeout(10000) });
    return response.ok ? reply(200, { acknowledged: records.length, changed: await response.json() }) : reply(422);
  } catch { return reply(503); }
});
