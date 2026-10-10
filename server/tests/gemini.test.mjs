import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroundedSearch } from '../src/gemini.mjs';
const config = { key: 'fixture', enabled: true, freeTierVerified: true, reserve: async () => true };
test('disabled, missing credentials and paid model choices never call Google', async () => {
  const fetcher = async () => { throw new Error('must not call'); };
  assert.equal((await createGroundedSearch({ fetcher })('Warbreaker')).status, 'disabled');
  assert.equal((await createGroundedSearch({ ...config, models: ['gemini-3.5-flash-lite'], fetcher })('Warbreaker')).status, 'tier-unavailable');
});
test('quota is reserved before every attempt; 429 stops retries', async () => {
  let calls = 0;
  const search = createGroundedSearch({ ...config, fetcher: async () => { calls++; return new Response('', { status: 429 }); } });
  assert.equal((await search('Warbreaker')).status, 'quota'); assert.equal(calls, 1);
  assert.equal((await createGroundedSearch({ ...config, reserve: async () => false })('Warbreaker')).status, 'quota');
});
test('unavailable model uses a real supported fallback and requires grounding presentation', async () => {
  const models = [];
  const search = createGroundedSearch({ ...config, fetcher: async url => { models.push(url); return models.length === 1 ? new Response('', { status: 404 }) : Response.json({ candidates: [{ content: { parts: [{ text: 'Warbreaker by Brandon Sanderson.' }] }, groundingMetadata: { searchEntryPoint: { renderedContent: '<div>Google search suggestions</div>' }, groundingChunks: [{ web: { uri: 'https://example.org/book', title: 'Book' } }], groundingSupports: [{ segment: { text: 'Warbreaker' }, groundingChunkIndices: [0] }] } }] }); } });
  const result = await search('Warbreaker'); assert.equal(result.status, 'ok'); assert.match(models[1], /gemini-2.5-flash:/); assert.equal(result.rating, undefined);
  const empty = createGroundedSearch({ ...config, fetcher: async () => Response.json({ candidates: [{ content: { parts: [{ text: 'invented' }] } }] }) });
  assert.equal((await empty('Warbreaker')).status, 'empty');
});
test('timeout and tier failure are quiet and bounded', async () => {
  assert.equal((await createGroundedSearch({ ...config, fetcher: async () => { throw new Error('timeout'); } })('Warbreaker')).status, 'timeout');
  assert.equal((await createGroundedSearch({ ...config, fetcher: async () => new Response('', { status: 403 }) })('Warbreaker')).status, 'model-unavailable');
});
