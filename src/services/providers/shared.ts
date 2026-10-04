export type Fetcher = typeof fetch;
export const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
export const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
export function httpsCover(value: unknown): string | undefined {
  const candidate = string(value)?.replace(/^http:/i, 'https:');
  try { const url = new URL(candidate || ''); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export type FailureKind = 'rate-limit' | 'server' | 'timeout' | 'network' | 'malformed' | 'unavailable';
export class ProviderError extends Error {
  constructor(public kind: FailureKind) { super(kind); }
}
export function rating(average: unknown, count: unknown) {
  return { average: typeof average === 'number' && Number.isFinite(average) && average > 0 && average <= 5 && count !== 0 ? average : undefined,
    count: typeof count === 'number' && Number.isSafeInteger(count) && count > 0 ? count : undefined };
}
export async function json(url: string, fetcher: Fetcher, allowMissing = false, timeoutMs = 10000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetcher(url, { signal: controller.signal });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new ProviderError(response.status === 429 ? 'rate-limit' : response.status >= 500 ? 'server' : 'unavailable');
    try { return await response.json(); } catch { throw new ProviderError('malformed'); }
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError('timeout');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('network');
  } finally { clearTimeout(timer); }
}
