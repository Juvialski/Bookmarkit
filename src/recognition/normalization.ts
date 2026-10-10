export function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[’‘`]/g, "'").replace(/['.]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export function displayText(value: string): string {
  const clean = value.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  // Keep mixed case, initials and numerals. Uppercase OCR is presentation only;
  // provider metadata remains authoritative for the final title/name.
  return clean === clean.toUpperCase() ? clean.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()) : clean;
}
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
export function titleSimilarity(input: string, title: string): number {
  const a = normalizeText(input).slice(0, 240), b = normalizeText(title).slice(0, 240);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Subtitle relationship requires an actual separator in provider/input data.
  const mainA = normalizeText(input.split(/[:—–]/)[0]), mainB = normalizeText(title.split(/[:—–]/)[0]);
  if (mainA === mainB && mainA.length >= 6) return 0.96;
  if (a.replace(/ /g, '') === b.replace(/ /g, '')) return 0.95;
  if (Math.abs(a.length - b.length) / Math.max(a.length, b.length) > 0.22) return 0;
  const similarity = 1 - distance(a, b) / Math.max(a.length, b.length);
  return Math.min(0.94, similarity);
}
export function authorSimilarity(input: string, authors: string[]): number {
  const a = normalizeText(input);
  if (!a) return 0;
  return Math.max(0, ...authors.map(author => {
    const b = normalizeText(author);
    if (a === b || a.replace(/ /g, '') === b.replace(/ /g, '')) return 1;
    const x = a.split(' '), y = b.split(' ');
    if (x.at(-1) !== y.at(-1)) return 0;
    // A surname alone can support a chooser, never an automatic match.
    if (x.length === 1 || y.length === 1) return 0.65;
    const initials = (tokens: string[]) => tokens.slice(0, -1).map(t => t[0]).join('');
    const compact = (tokens: string[]) => tokens.slice(0, -1).join('');
    const compatibleTokens = x.length === y.length && x.slice(0, -1).every((token, i) => token === y[i] || (token[0] === y[i][0] && (token.length === 1 || y[i].length === 1)));
    const compactInitials = x.length === 2 && /^[A-Z.\s]+$/.test(input.split(/\s+/).slice(0, -1).join(' ')) && compact(x) === initials(y);
    const providerInitials = y.length === 2 && /^[A-Z.\s]+$/.test(author.split(/\s+/).slice(0, -1).join(' ')) && compact(y) === initials(x);
    if (compatibleTokens || compactInitials || providerInitials) return 0.94;
    return 0;
  }));
}
