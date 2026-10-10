import { createGroundedSearch } from './gemini.mjs';
const url = Deno.env.get('SUPABASE_URL')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const search = createGroundedSearch({
 key: Deno.env.get('GEMINI_API_KEY'), enabled: Deno.env.get('GEMINI_GROUNDING_ENABLED') === 'true',
 freeTierVerified: Deno.env.get('GEMINI_FREE_TIER_VERIFIED') === 'true',
 models: (Deno.env.get('GEMINI_MODELS') || 'gemini-2.5-flash-lite,gemini-2.5-flash').split(','),
 reserve: async () => {
  const response = await fetch(`${url}/rest/v1/rpc/reserve_grounding`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ daily_limit: Math.min(20, Math.max(0, Number(Deno.env.get('GEMINI_DAILY_LIMIT') || '0'))) }) });
  return response.ok && await response.json() === true;
 }
});
Deno.serve(async req => {
 const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey,authorization,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
 if (req.method === 'OPTIONS') return new Response(null, { headers });
 if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
 // Gateway verifies the anon JWT; quota remains project-wide, including abusive clients.
 if (Number(req.headers.get('content-length') || '0') > 2048) return new Response('{}', { status: 413, headers });
 try { const body = await req.text(); if (body.length > 2048) return new Response('{}', { status: 413, headers }); return new Response(JSON.stringify(await search(JSON.parse(body).query)), { headers }); }
 catch { return new Response(JSON.stringify({ status: 'unavailable' }), { headers }); }
});
