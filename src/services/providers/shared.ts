export type Fetcher = typeof fetch;
export const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
export const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
export function rating(average: unknown, count: unknown) {
  return { average: typeof average === 'number' && Number.isFinite(average) && average > 0 && average <= 5 && count !== 0 ? average : undefined,
    count: typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : undefined };
}
export async function json(url: string, fetcher: Fetcher, allowMissing = false): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try { const response = await fetcher(url, { signal: controller.signal });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error('Provider request failed');
    return await response.json();
  } finally { clearTimeout(timer); }
}
