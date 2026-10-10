// All credentials stay in the backend. Project IDs are the authority for quota.
const GROUNDING_MODELS = new Set(['gemini-2.5-flash-lite']);
const TEXT_MODELS = new Set(['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
export function parseFreeProjects(serialized, now = Date.now()) {
  const input = JSON.parse(serialized || '[]');
  if (!Array.isArray(input) || input.length > 8) throw new Error('Invalid free project configuration');
  const ids = new Set(), numbers = new Set(), keys = new Set();
  return input.map(project => {
    if (!/^[a-z][a-z0-9-]{4,62}$/.test(project.id) || !/^[0-9]{1,20}$/.test(project.number) || ids.has(project.id) || project.billingEnabled !== false || project.authorized !== true || !Array.isArray(project.keys) || !project.keys.length || project.keys.length > 4) throw new Error('Invalid free project configuration');
    if (numbers.has(project.number)) throw new Error('Duplicate Google project');
    ids.add(project.id); numbers.add(project.number);
    for (const key of project.keys) { if (typeof key !== 'string' || key.length < 10 || keys.has(key)) throw new Error('Invalid credential grouping'); keys.add(key); }
    const models = project.models;
    if (!Array.isArray(models) || !models.length) throw new Error('Free model eligibility required');
    for (const m of models) {
      const verified = Date.parse(m.verifiedAt);
      if (!(GROUNDING_MODELS.has(m.id) || TEXT_MODELS.has(m.id)) || m.freeEligible !== true || m.grounding !== GROUNDING_MODELS.has(m.id) || !Number.isFinite(verified) || verified > now || now - verified > 24 * 60 * 60 * 1000 || !Number.isSafeInteger(m.dailyLimit) || m.dailyLimit < 1 || m.dailyLimit > 20 || !Number.isSafeInteger(m.externalUsage) || m.externalUsage < 0 || !Number.isSafeInteger(m.freeRpd) || m.freeRpd <= m.externalUsage || (GROUNDING_MODELS.has(m.id) && m.freeRpd > 500)) throw new Error('Verified free capacity required');
    }
    return project;
  });
}
export function createFreeGemini({ projects = [], billingCheck, keyProjectCheck, modelCheck, reserve, cooldown, recordUsage, fetcher = fetch, now = Date.now, timeoutMs = 6000 } = {}) {
  const pending = new Map();
  async function run(query, task) {
    if (typeof query !== 'string' || query.length < 2 || query.length > 240) return { status: 'invalid' };
    // Only one legitimately eligible project is selected. No retry on another
    // project after quota/restriction enforcement; keys are never rotated.
    for (const project of projects) {
      const model = project.models.find(m => task === 'grounding' ? GROUNDING_MODELS.has(m.id) && m.grounding : TEXT_MODELS.has(m.id) && !m.grounding);
      if (!model || now() - Date.parse(model.verifiedAt) > 86400000) continue;
      if (!billingCheck || !keyProjectCheck || !modelCheck || !(await billingCheck(project.id, project.number)) || !(await keyProjectCheck(project.keys[0], project.number)) || !(await modelCheck(project.keys[0], model.id))) continue;
      const limit = Math.min(model.dailyLimit, model.freeRpd - model.externalUsage, 20);
      if (!reserve || !(await reserve(project.id, model.id, task, limit))) continue;
      try {
        const request = { contents: [{ parts: [{ text: task === 'grounding' ? `Find the book from this literal title, author or ISBN: ${JSON.stringify(query)}. Give its title, author and Goodreads link only when supported by search evidence. Do not guess ratings or series. Cite sources; under 100 words.` : `Normalize only this recognized book title, author or ISBN: ${JSON.stringify(query)}. Do not invent metadata, ratings or series. Return concise text.` }] }], generationConfig: { maxOutputTokens: 512, temperature: 0 } };
        if (task === 'grounding') request.tools = [{ google_search: {} }];
        const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': project.keys[0] }, body: JSON.stringify(request), signal: AbortSignal.timeout(timeoutMs) });
        if ([429,400,403,404].includes(response.status)) {
          await cooldown?.(project.id, model.id, task, response.status === 429 ? 3600 : 86400);
          return { status: response.status === 429 ? 'quota' : 'unavailable' };
        }
        if (!response.ok) return { status: 'unavailable' };
        const data = await response.json(); await recordUsage?.(project.id, model.id, task, data.usageMetadata?.totalTokenCount || 0);
        const candidate = data.candidates?.[0], text = candidate?.content?.parts?.map(p => p.text || '').join('') || '';
        if (task === 'text') return text ? { status: 'ok', text } : { status: 'empty' };
        const metadata = candidate?.groundingMetadata, html = metadata?.searchEntryPoint?.renderedContent;
        const sources = metadata?.groundingChunks?.flatMap(c => c.web?.uri?.startsWith('https://') ? [{ title: c.web.title || 'Source', url: c.web.uri }] : []) || [];
        return text && html && sources.length && metadata.groundingSupports?.length ? { status: 'ok', text, html, sources } : { status: 'empty' };
      } catch { return { status: 'timeout' }; }
    }
    return { status: 'disabled' };
  }
  return async (query, task = 'grounding') => {
    if (task !== 'grounding' && task !== 'text') return { status: 'invalid' };
    const key = JSON.stringify([query,task]);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 4) return { status: 'busy' };
    const call = run(query,task); pending.set(key,call);
    try { return await call; } finally { pending.delete(key); }
  };
}
