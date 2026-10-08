export type ScanState = 'idle' | 'capturing' | 'recognizing' | 'searching' | 'choosing-candidate' | 'result' | 'recoverable-error';
export function createRequestGate() {
  let generation = 0;
  let locked = false;
  return {
    acquire() { if (locked) return null; locked = true; return ++generation; },
    current(id: number) { return id === generation; },
    release(id: number) { if (id === generation) locked = false; },
    cancel() { generation++; locked = false; },
  };
}
