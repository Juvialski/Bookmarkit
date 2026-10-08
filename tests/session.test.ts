import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestGate, ensureActive } from '../src/recognition/session';
import { createCachedSearch } from '../src/services/providers/search';
import { identifyBook } from '../src/services/identifyBook';
test('gate rejects double submissions and stale completion after cancellation/retry', () => {
  const gate = createRequestGate();
  const first = gate.acquire()!;
  assert.equal(gate.acquire(), null);
  gate.cancel();
  const second = gate.acquire()!;
  assert.equal(gate.current(first), false);
  gate.release(first);
  assert.equal(gate.acquire(), null);
  assert.equal(gate.current(second), true);
  gate.release(second);
  assert.notEqual(gate.acquire(), null);
});
test('normalized search cache expires and never retains failed or empty requests', async () => {
  let calls = 0, clock = 0;
  const query = { title: 'The Hobbit' };
  const search = createCachedSearch(async () => {
    calls++;
    if (calls === 1) throw Error('offline');
    if (calls === 2) return [];
    return [{ title: 'The Hobbit', authors: [], seriesStatus: 'unknown', ratings: [], warnings: [] }];
  }, () => clock);
  await assert.rejects(search(query));
  assert.deepEqual(await search(query), []);
  await search(query); await search({ title: ' THE HOBBIT ' });
  assert.equal(calls, 3);
  clock = 300001; await search(query); assert.equal(calls, 4);
});
test('cancelled search stops alternate query fan-out', async () => {
  const abort = new AbortController(); let calls = 0;
  await assert.rejects(identifyBook({ candidates: [{ title: 'Missing First' }, { title: 'Missing Second' }] }, {
    search: async () => { calls++; abort.abort(); return []; },
  }, abort.signal));
  assert.equal(calls, 1);
});

test('cancellation guard supports a React Native signal without throwIfAborted', () => {
  assert.doesNotThrow(() => ensureActive({ aborted: false } as AbortSignal));
  assert.throws(() => ensureActive({ aborted: true } as AbortSignal), /cancelled/);
});
