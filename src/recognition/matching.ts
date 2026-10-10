import { BookResult } from '../models/book';
import { BookQuery, Identification } from './types';
import { authorSimilarity, normalizeText, titleSimilarity } from './normalization';
import { mergeClassification } from '../utils/classification';
import { coverCandidates } from '../utils/covers';

function matchBase(query: BookQuery, book: BookResult): { score: number; certain: boolean } {
  if (query.isbn) return { score: query.isbn === book.isbn ? 1 : 0, certain: query.isbn === book.isbn };
  if (query.text) {
    const text = normalizeText(query.text), title = normalizeText(book.title);
    if (text === title) return { score: 0.91, certain: title.split(' ').length >= 2 || title === '1984' };
    if (book.authors.some(a => normalizeText(a) === text)) return { score: 0.78, certain: false };
    const tokens = text.split(' '), titleTokens = title.split(' ').filter((t, i) => !(i === 0 && /^(the|a|an)$/.test(t) && !tokens.includes(t)));
    const fuzzy = titleSimilarity(query.text, book.title);
    if (fuzzy >= 0.88) return { score: fuzzy * 0.91, certain: false };
    for (const name of book.authors) {
      const authorTokens = normalizeText(name).split(' ');
      if (!authorTokens.every(t => tokens.includes(t))) continue;
      const remaining = tokens.filter(t => !authorTokens.includes(t)).join(' ');
      const similarity = titleSimilarity(remaining, book.title);
      if (similarity >= 0.88) return { score: similarity * 0.8 + 0.2, certain: similarity >= 0.95 };
    }
    if (!titleTokens.every(t => tokens.includes(t))) return { score: 0, certain: false };
    const rest = tokens.filter(t => !titleTokens.includes(t));
    const author = book.authors.map(a => normalizeText(a).split(' '));
    const compatible = rest.length > 0 && author.some(a => rest.every(t => a.includes(t)));
    if (!compatible) return { score: 0, certain: false };
    const fullAuthor = author.some(a => a.every(t => tokens.includes(t)));
    return { score: fullAuthor ? 0.99 : 0.88, certain: fullAuthor };
  }
  if (!query.title && query.author) return { score: authorSimilarity(query.author, book.authors) * 0.78, certain: false };
  const title = titleSimilarity(query.title || '', book.title);
  const author = query.author ? authorSimilarity(query.author, book.authors) : 0;
  // Contradictory known authors reject even a perfect title.
  if (query.author && book.authors.length && author === 0) return { score: 0, certain: false };
  if (title < 0.82) return { score: 0, certain: false };
  if (query.author && author > 0) return { score: title * 0.8 + author * 0.2, certain: title >= 0.95 && author >= 0.94 };
  return { score: title * 0.91, certain: !query.author && title === 1 && normalizeText(book.title).split(' ').length >= 2 };
}
export function matchBook(query: BookQuery, book: BookResult): { score: number; certain: boolean } {
  const match = matchBase(query, book);
  if (!query.isbn && query.confidence !== undefined && Number.isFinite(query.confidence) && query.confidence < 0.8) return { score: match.score * 0.9, certain: false };
  return match;
}
export function rankBooks(queries: BookQuery[], books: BookResult[]): Identification | null {
  const ranked = books.map(book => ({ book, match: queries.map(q => matchBook(q, book)).sort((a, b) => b.score - a.score)[0] }))
    .filter(r => r.match && r.match.score >= 0.75).sort((a, b) => b.match.score - a.match.score);
  const distinct: typeof ranked = [];
  for (const row of ranked) {
    const canonical = (book: BookResult) => `${normalizeText(book.title)}|${book.authors.map(normalizeText).sort().join('|')}`;
    const existing = distinct.find(r => (row.book.workId && r.book.workId === row.book.workId) || (row.book.hardcoverId && r.book.hardcoverId === row.book.hardcoverId) || ((!row.book.workId || !r.book.workId) && (!row.book.isbn || !r.book.isbn || row.book.isbn === r.book.isbn) && row.book.authors.length && canonical(r.book) === canonical(row.book)));
    if (!existing) distinct.push(row);
    else {
      const a = existing.book, b = row.book;
      existing.book = { ...a, isbn: a.isbn || b.isbn, workId: a.workId || b.workId, hardcoverId: a.hardcoverId || b.hardcoverId,
        hardcoverUrl: a.hardcoverUrl || b.hardcoverUrl, coverUrl: coverCandidates(a, b)[0], coverUrls: coverCandidates(a, b),
        ...mergeClassification([a, b]), ratings: [...a.ratings, ...b.ratings.filter(r => !a.ratings.some(x => x.provider === r.provider && x.stored === r.stored))] };
    }
  }
  if (!distinct.length) return null;
  const first = distinct[0];
  if (first.match.certain && (!distinct[1] || first.match.score - distinct[1].match.score >= 0.08)) return { kind: 'book', book: first.book };
  return { kind: 'candidates', books: distinct.filter(r => first.match.score - r.match.score <= 0.15).slice(0, 4).map(r => r.book) };
}
