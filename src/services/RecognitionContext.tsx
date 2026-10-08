import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { getNetworkStateAsync } from 'expo-network';
import { router } from 'expo-router';
import { BookResult } from '../models/book';
import { RecognitionRequest } from '../recognition/types';
import { interpretCover } from '../recognition/coverParser';
import { createRequestGate, ScanState } from '../recognition/session';
import { identifyBook, manualQuery } from './identifyBook';
import { createCachedLookup, lookupBook } from './bookLookup';
import { createLocalCatalog, createLocalSearch } from './localCatalog';
import { readCover } from './coverOcr';
import { createCachedSearch } from './providers/search';

interface Session {
  book: BookResult | null; candidates: BookResult[]; loading: boolean; state: ScanState; status: string; error: string; recognized: string;
  scan: (value: string, author?: string) => void; cover: (uri: string) => Promise<void>; reset: () => void; choose: (book: BookResult) => void;
}
const Context = createContext<Session | null>(null);
export function RecognitionProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const dependencies = useMemo(() => ({ catalog: createLocalSearch(db), search: createCachedSearch(), isbn: createCachedLookup(value => lookupBook(value, undefined, createLocalCatalog(db))),
    online: async () => { try { const state = await getNetworkStateAsync(); return state.isConnected !== false && state.isInternetReachable !== false; } catch { return true; } } }), [db]);
  const [book, setBook] = useState<BookResult | null>(null), [candidates, setCandidates] = useState<BookResult[]>([]);
  const [state, setState] = useState<ScanState>('idle'), [error, setError] = useState(''), [recognized, setRecognized] = useState('');
  const gate = useRef(createRequestGate());
  const controller = useRef<AbortController | null>(null);
  const loading = state === 'capturing' || state === 'recognizing' || state === 'searching';
  const status = state === 'recognizing' ? 'Reading cover on your device…' : 'Looking up your book…';
  function cancel() { gate.current.cancel(); controller.current?.abort(); setState('idle'); setBook(null); setCandidates([]); setError(''); }
  function reset() { cancel(); router.replace('/'); }
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { if (loading) { cancel(); return true; } return false; });
    const app = AppState.addEventListener('change', next => { if (next !== 'active' && loading) cancel(); });
    return () => { back.remove(); app.remove(); };
  }, [loading]);
  useEffect(() => () => { gate.current.cancel(); controller.current?.abort(); }, []);
  function choose(value: BookResult) { setBook(value); setState('result'); router.replace('/result'); }
  async function run(request: (signal: AbortSignal) => Promise<RecognitionRequest>, phase: ScanState) {
    const id = gate.current.acquire();
    if (id === null) return;
    const abort = new AbortController(); controller.current = abort;
    setState(phase); setError('');
    try {
      const query = await request(abort.signal);
      if (!gate.current.current(id)) return;
      setState('searching');
      const result = await identifyBook(query, dependencies, abort.signal);
      if (!gate.current.current(id)) return;
      if (result.kind === 'book') choose(result.book);
      else { setCandidates(result.books); setState('choosing-candidate'); router.push('/candidates'); }
    } catch (err) {
      if (!gate.current.current(id)) return;
      gate.current.release(id);
      setError(err instanceof Error ? err.message : 'Lookup failed. Please try again.'); setState('recoverable-error');
    }
  }
  function scan(value: string, author?: string) { void run(async () => {
    if (!value.trim() && author?.trim()) return { author: author.trim(), origin: 'manual' };
    const query = manualQuery(value);
    return !query.isbn && author?.trim() ? { title: value.trim(), author: author.trim(), origin: 'manual' } : query;
  }, 'searching'); }
  async function cover(uri: string) {
    await run(async signal => {
      let text;
      try { text = await readCover(uri); } catch { throw new Error('Cover could not be read. Try a clearer photo or use Search Manually.'); }
      signal.throwIfAborted();
      const candidates = interpretCover(text);
      setRecognized(candidates[0]?.title || text.text.replace(/\s+/g, ' ').slice(0, 240));
      if (!candidates.length) throw new Error('No readable title found. Try a clearer photo or correct the search below.');
      return { origin: 'cover', rawOcrText: text.text, candidates };
    }, 'recognizing');
  }
  return <Context.Provider value={{ book, candidates, loading, state, status, error, recognized, scan, cover, reset, choose }}>{children}</Context.Provider>;
}
export function useRecognition() { const session = useContext(Context); if (!session) throw new Error('Recognition context missing'); return session; }
