import { SUPABASE_URL, CATALOG_KEY } from './providers/centralCatalog';
const ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4aWp4dWVrZnN4dXpobnVqcWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTc3ODQsImV4cCI6MjEwNzE3Mzc4NH0.pEufQLNvXl4ykAyvjo1Yw3UUlAdGvWVsud1GNQOCJnU';
export interface SearchEvidence { text: string; html: string; sources: { title: string; url: string }[] }
let availability: Promise<boolean> | undefined;
export function groundingAvailable() {
  return availability ||= (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
    try { const response = await fetch(`${SUPABASE_URL}/functions/v1/book-search`, { method: 'POST', headers: { apikey: CATALOG_KEY, Authorization: `Bearer ${ANON_JWT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '' }), signal: controller.signal }); return response.ok && (await response.json()).status === 'invalid'; }
    catch { return false; } finally { clearTimeout(timer); }
  })();
}
export async function groundedSearch(query: string, signal?: AbortSignal): Promise<SearchEvidence | null> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 14000);
  const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/book-search`, { method: 'POST', headers: { apikey: CATALOG_KEY, Authorization: `Bearer ${ANON_JWT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: query.slice(0, 240) }), signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    return data.status === 'ok' && typeof data.text === 'string' && typeof data.html === 'string' && Array.isArray(data.sources) ? data : null;
  } catch { return null; } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
