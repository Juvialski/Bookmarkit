export interface CatalogManifest { version: string; schema: 'v3'; works: number; isbns: number; bytes: number; sha256: string; url: string }
export function validateManifest(value: unknown): CatalogManifest {
  const m = value as CatalogManifest;
  if (!m || !/^[a-zA-Z0-9.-]{1,40}$/.test(m.version) || m.schema !== 'v3' || !Number.isSafeInteger(m.works) || m.works < 1 || !Number.isSafeInteger(m.isbns) || m.isbns < m.works || !Number.isSafeInteger(m.bytes) || m.bytes < 4096 || m.bytes > 40_000_000 || !/^[a-f0-9]{64}$/.test(m.sha256)) throw new Error('Catalog unavailable. Try again.');
  const url = new URL(m.url);
  if (url.protocol !== 'https:' || url.hostname !== 'xxijxuekfsxuzhnujqem.supabase.co' || !url.pathname.startsWith('/storage/v1/object/public/book-catalogs/') || url.username || url.password) throw new Error('Catalog unavailable. Try again.');
  return m;
}
