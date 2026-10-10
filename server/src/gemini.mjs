// Portable Node/Deno adapter. Never persists answers or extracts a numerical rating.
export const FREE_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
export function createGroundedSearch({ key, enabled = false, freeTierVerified = false, models = FREE_MODELS, reserve, fetcher = fetch, timeoutMs = 6000 } = {}) {
  return async query => {
    if (!enabled || !key || !freeTierVerified || typeof reserve !== 'function') return { status: 'disabled' };
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 240) return { status: 'invalid' };
    const allowed = models.filter(m => FREE_MODELS.includes(m)).slice(0, 2);
    if (!allowed.length) return { status: 'tier-unavailable' };
    for (const model of allowed) {
      // Shared durable quota reservation counts failures too. Never switch to paid models.
      if (!(await reserve())) return { status: 'quota' };
      try {
        const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({ contents: [{ parts: [{ text: `Find the book identified by this literal search text: ${JSON.stringify(query)}. Find its title, author, and a Goodreads link if supported by search evidence. Do not guess ratings or series. Keep the answer under 100 words and cite sources.` }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 512, temperature: 0 } })
        });
        if (response.status === 429) return { status: 'quota' };
        if ([400, 403, 404].includes(response.status)) continue;
        if (!response.ok) return { status: 'unavailable' };
        const data = await response.json(), candidate = data.candidates?.[0], metadata = candidate?.groundingMetadata;
        const text = candidate?.content?.parts?.map(p => p.text || '').join('') || '';
        const html = metadata?.searchEntryPoint?.renderedContent;
        const sources = metadata?.groundingChunks?.flatMap(c => c.web?.uri?.startsWith('https://') ? [{ title: c.web.title || 'Source', url: c.web.uri }] : []) || [];
        if (!text || !html || !sources.length || !metadata.groundingSupports?.length) return { status: 'empty' };
        return { status: 'ok', text, html, sources, model };
      } catch { return { status: 'timeout' }; }
    }
    return { status: 'model-unavailable' };
  };
}
