import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { openDatabaseAsync, SQLiteDatabase, useSQLiteContext } from 'expo-sqlite';
import * as FS from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { BookCatalog } from '../recognition/types';
import { createLocalSearch } from './localCatalog';
import { CATALOG_KEY, SUPABASE_URL } from './providers/centralCatalog';
import { CatalogManifest, validateManifest } from './catalogManifest';
interface OfflineState { catalog: BookCatalog; bundled: number; installed: CatalogManifest | null; available: CatalogManifest | null; progress: number | null; error: string; refresh: () => Promise<void>; download: () => Promise<void>; cancel: () => void; remove: () => Promise<void> }
const Context = createContext<OfflineState | null>(null);
export function OfflineCatalogProvider({ children }: { children: ReactNode }) {
  const bundledDb = useSQLiteContext(), [bundled, setBundled] = useState(0);
  const [installed, setInstalled] = useState<CatalogManifest | null>(null), [available, setAvailable] = useState<CatalogManifest | null>(null);
  const [progress, setProgress] = useState<number | null>(null), [error, setError] = useState('');
  const current = useRef<CatalogManifest | null>(null), operation = useRef<FS.DownloadResumable | null>(null), generation = useRef(0), busy = useRef(false);
  const directory = `${FS.documentDirectory}catalogs/`, name = (m: CatalogManifest) => `${m.sha256}.db`;
  async function select(manifest: CatalogManifest | null) {
    await bundledDb.runAsync('INSERT OR REPLACE INTO offline_settings(key,value) VALUES (?,?)', 'installed', JSON.stringify(manifest));
    current.current = manifest; setInstalled(manifest);
  }
  async function validateDb(db: SQLiteDatabase, m: CatalogManifest) {
    const integrity = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    const works = await db.getFirstAsync<{ n: number }>('SELECT count(*) n FROM works');
    const isbns = await db.getFirstAsync<{ n: number }>('SELECT count(*) n FROM books');
    const schema = await db.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key='catalog_schema'");
    if (integrity?.integrity_check !== 'ok' || works?.n !== m.works || isbns?.n !== m.isbns || schema?.value !== 'v3') throw new Error('Catalog damaged. Retry download.');
  }
  useEffect(() => { let active = true;
    void (async () => {
      await bundledDb.execAsync('CREATE TABLE IF NOT EXISTS offline_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
      const count = await bundledDb.getFirstAsync<{ n: number }>('SELECT count(*) n FROM works');
      if (active) setBundled(count?.n || 0);
      try {
        const row = await bundledDb.getFirstAsync<{ value: string }>("SELECT value FROM offline_settings WHERE key='installed'");
        if (!row || row.value === 'null') return;
        const m = validateManifest(JSON.parse(row.value)), db = await openDatabaseAsync(name(m), {}, directory);
        try { await validateDb(db, m); } finally { await db.closeAsync(); }
        if (active) { current.current = m; setInstalled(m); }
      } catch { await select(null); }
    })().catch(() => { if (active) setError('Offline books unavailable.'); });
    const lifecycle = generation, downloadOperation = operation;
    return () => { active = false; lifecycle.current++; void downloadOperation.current?.pauseAsync().catch(() => {}); };
  }, [bundledDb]); // eslint-disable-line react-hooks/exhaustive-deps
  async function refresh() {
    setError('');
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/catalog_manifests?select=*&order=published_at.desc&limit=1`, { headers: { apikey: CATALOG_KEY }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      const rows = await response.json();
      if (rows[0]) setAvailable(validateManifest({ ...rows[0], schema: rows[0].schema_version }));
    } catch { setError('Could not check updates. Retry when connected.'); }
  }
  async function download() {
    if (!available || busy.current) return;
    busy.current = true; const id = ++generation.current, m = available, temporary = `${directory}${name(m)}.part`;
    setProgress(0); setError('');
    try {
      await FS.makeDirectoryAsync(directory, { intermediates: true });
      operation.current = FS.createDownloadResumable(m.url, temporary, {}, p => { if (id === generation.current) setProgress(Math.min(0.95, p.totalBytesWritten / m.bytes)); });
      const result = await operation.current.downloadAsync();
      if (id !== generation.current || !result || result.status !== 200) throw new Error('Download stopped. Retry.');
      const file = new File(temporary);
      if (file.size !== m.bytes) throw new Error('Download incomplete. Retry.');
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
      const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (hex !== m.sha256) throw new Error('Download damaged. Retry.');
      const test = await openDatabaseAsync(`${name(m)}.part`, {}, directory);
      try { await validateDb(test, m); } finally { await test.closeAsync(); }
      if (id !== generation.current) return;
      const destination = `${directory}${name(m)}`;
      // Replace an unselected remnant too: a corrupt file must not defeat retry.
      await FS.deleteAsync(destination, { idempotent: true });
      await FS.moveAsync({ from: temporary, to: destination });
      if (id !== generation.current) return;
      const previous = current.current;
      await select(m);
      if (previous && previous.sha256 !== m.sha256) await FS.deleteAsync(`${directory}${name(previous)}`, { idempotent: true }).catch(() => {});
    } catch (err) { if (id === generation.current) setError(err instanceof Error ? err.message : 'Download failed. Retry.'); }
    finally { await FS.deleteAsync(temporary, { idempotent: true }).catch(() => {}); operation.current = null; busy.current = false; setProgress(null); }
  }
  function cancel() { generation.current++; void operation.current?.pauseAsync().catch(() => {}); }
  async function remove() { if (busy.current) return; const previous = current.current; await select(null); if (previous) await FS.deleteAsync(`${directory}${name(previous)}`, { idempotent: true }); }
  const catalog: BookCatalog = useMemo(() => ({ async search(query) {
    const m = current.current;
    if (m) {
      try { const db = await openDatabaseAsync(name(m), {}, directory); try { const books = await createLocalSearch(db).search(query); if (books.length) return books; } finally { await db.closeAsync(); } }
      catch { await select(null).catch(() => {}); }
    }
    return createLocalSearch(bundledDb).search(query);
  } }), [bundledDb]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Context.Provider value={{ catalog, bundled, installed, available, progress, error, refresh, download, cancel, remove }}>{children}</Context.Provider>;
}
export function useOfflineCatalog() { const value = useContext(Context); if (!value) throw new Error('Catalog context missing'); return value; }
