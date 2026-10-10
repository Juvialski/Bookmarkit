// All credentials stay in the backend. Project IDs are the authority for quota.
const GROUNDING_MODELS = new Set(['gemini-2.5-flash-lite']);
const TEXT_MODELS = new Set(['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
// Private operational verification: no quota reservation or generation request.
export async function verifyFreeConfiguration({ projects, checks, authorization, service, serviceCheck }) {
  // Management API may issue a different valid legacy service JWT than the one
  // injected into the function. Verify its service-only database access instead
  // of trusting decoded JWT claims or demanding identical token bytes.
  if (!service || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return { status: 'unauthorized' };
  if (authorization !== `Bearer ${service}` && !(await serviceCheck?.(authorization))) return { status: 'unauthorized' };
  if (!projects.length) return { status: 'disabled', projects: [] };
  const results = [];
  for (const project of projects) {
    try {
      const billingDisabled = await checks.billingCheck(project.id, project.number);
      const keyOwned = await checks.keyProjectCheck(project.keys[0], project.number);
      const models = [];
      for (const model of project.models) models.push({ id: model.id, available: await checks.modelCheck(project.keys[0], model.id), grounding: model.grounding });
      results.push({ billingDisabled, keyOwned, models });
    } catch { results.push({ billingDisabled: false, keyOwned: false, models: [] }); }
  }
  return { status: results.every(r => r.billingDisabled && r.keyOwned && r.models.length && r.models.every(m => m.available)) ? 'verified' : 'disabled', projects: results };
}
export function readFreeProjects(get) {
  if (get('GEMINI_ENABLED') !== 'true') return [];
  if (get('GEMINI_FREE_PROJECTS_JSON')) return parseFreeProjects(get('GEMINI_FREE_PROJECTS_JSON'));
  return parseFreeProjects(JSON.stringify([{
    id: get('GEMINI_PROJECT_ID'), number: get('GEMINI_PROJECT_NUMBER'),
    keys: [get('GEMINI_API_KEY')], authorized: true, billingEnabled: false,
    models: [get('GEMINI_TEXT_MODEL') || 'gemini-3.5-flash-lite', get('GEMINI_GROUNDING_MODEL')].filter(Boolean)
      .map(id => ({ id, grounding: GROUNDING_MODELS.has(id), freeEligible: true, dailyLimit: 5, freeRpd: 5, externalUsage: 0 }))
  }]));
}
export function parseFreeProjects(serialized) {
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
      // These are conservative local limits, not a daily operator attestation.
      // Live billing, key ownership and model access remain mandatory below.
      if (!(GROUNDING_MODELS.has(m.id) || TEXT_MODELS.has(m.id)) || m.freeEligible !== true || m.grounding !== GROUNDING_MODELS.has(m.id) || !Number.isSafeInteger(m.dailyLimit) || m.dailyLimit < 1 || m.dailyLimit > 20 || !Number.isSafeInteger(m.externalUsage) || m.externalUsage < 0 || !Number.isSafeInteger(m.freeRpd) || m.freeRpd <= m.externalUsage || (GROUNDING_MODELS.has(m.id) && m.freeRpd > 500)) throw new Error('Verified free capacity required');
    }
    return project;
  });
}
export function createFreeGemini({ projects = [], billingCheck, keyProjectCheck, modelCheck, reserve, cooldown, recordUsage, fetcher = fetch, now = Date.now, timeoutMs = 6000 } = {}) {
  const pending = new Map();
  let blockedUntil = 0;
  async function run(query, task) {
    if (typeof query !== 'string' || query.length < 2 || query.length > 240) return { status: 'invalid' };
    if (now() < blockedUntil) return { status: 'unavailable' };
    // Only one legitimately eligible project is selected. No retry on another
    // project after quota/restriction enforcement; keys are never rotated.
    for (const project of projects) {
      const model = project.models.find(m => task === 'grounding' ? GROUNDING_MODELS.has(m.id) && m.grounding : TEXT_MODELS.has(m.id) && !m.grounding);
      if (!model) continue;
      try {
        if (!billingCheck || !keyProjectCheck || !modelCheck || !(await billingCheck(project.id, project.number)) || !(await keyProjectCheck(project.keys[0], project.number)) || !(await modelCheck(project.keys[0], model.id))) continue;
        const limit = Math.min(model.dailyLimit, model.freeRpd - model.externalUsage, 20);
        if (!reserve || !(await reserve(project.id, model.id, task, limit))) continue;
        // Recheck after reservation, immediately before generation. An owner can
        // change billing externally; no once-only confirmation is authoritative.
        if (!(await billingCheck(project.id, project.number))) return { status: 'disabled' };
        const request = { contents: [{ parts: [{ text: task === 'grounding' ? `Find the book from this literal title, author or ISBN: ${JSON.stringify(query)}. Give its title, author and Goodreads link only when supported by search evidence. Do not guess ratings or series. Cite sources; under 100 words.` : `Normalize only this recognized book title, author or ISBN: ${JSON.stringify(query)}. Do not invent metadata, ratings or series. Return concise text.` }] }], generationConfig: { maxOutputTokens: 512, temperature: 0 } };
        if (task === 'grounding') request.tools = [{ google_search: {} }];
        const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': project.keys[0] }, body: JSON.stringify(request), signal: AbortSignal.timeout(timeoutMs) });
        if ([429,400,401,403,404].includes(response.status)) {
          const seconds = response.status === 429 ? 3600 : 86400;
          blockedUntil = now() + seconds * 1000;
          try { await cooldown?.(project.id, model.id, task, seconds); } catch { /* retain the in-instance circuit */ }
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
