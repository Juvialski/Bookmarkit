import { BookQuery, CoverText, OcrBlock } from './types';
import { displayText, normalizeText } from './normalization';

// Anchored labels only: a subtitle containing these words is kept.
const noise = /^(?:a novel|(?:#?\d+\s+)?(?:new york times |sunday times |international |national )?(?:best[ -]?selling author|best[ -]?seller)|(?:now a )?(?:major )?motion picture|movie tie[ -]?in(?: edition)?|(?:\d+(?:st|nd|rd|th) )?(?:anniversary|revised|special|paperback|hardcover) edition|winner of .+|penguin(?: books| classics)?|harpercollins|bloomsbury|scholastic|vintage|tor books)$/i;
function useful(text: string) {
  return !!normalizeText(text) && !noise.test(text.trim()) && !/^[“"].+[”"](?:\s*[-—].+)?$/.test(text.trim());
}
export function interpretCover(result: CoverText): BookQuery[] {
  const source: OcrBlock[] = result.blocks.length ? result.blocks : result.text.split(/\n\s*\n/).map(text => ({ text }));
  const blocks = source
    .map(block => ({ ...block, text: (block.lines?.map(l => l.text) || block.text.split('\n')).filter(useful).join(' ').trim() }))
    .filter(b => useful(b.text)).slice(0, 12);
  const output: BookQuery[] = [];
  const seen = new Set<string>();
  const add = (title: string, author?: string) => {
    const key = `${normalizeText(title)}|${normalizeText(author || '')}`;
    if (seen.has(key) || !useful(title)) return;
    const titleBlock = blocks.find(b => b.text === title), authorBlock = blocks.find(b => b.text === author);
    seen.add(key); output.push({ title: displayText(title).slice(0, 240), author: author ? displayText(author).slice(0, 160) : undefined, origin: 'cover', confidence: titleBlock?.confidence, titleBox: titleBlock?.boundingBox, authorBox: authorBlock?.boundingBox });
  };
  const positioned = [...blocks].sort((a, b) => (a.boundingBox?.y || 0) - (b.boundingBox?.y || 0));
  const groups: typeof blocks = [];
  for (const block of positioned) {
    const previous = groups.at(-1);
    const a = previous?.boundingBox, b = block.boundingBox;
    if (previous && a && b && b.y >= a.y && b.y - (a.y + a.height) < Math.min(a.height, b.height) * 0.8 && Math.abs(a.x - b.x) < Math.max(a.width, b.width) * 0.25) {
      previous.text += ` ${block.text}`;
      previous.boundingBox = { ...a, height: b.y + b.height - a.y };
    } else groups.push({ ...block });
  }
  const grouped = [...groups].sort((a, b) => (b.boundingBox?.height || 0) - (a.boundingBox?.height || 0));
  for (const title of grouped) {
    for (const author of groups.filter(g => g !== title && g.text.split(/\s+/).length >= 2 && g.text.split(/\s+/).length <= 5 && !/\d/.test(g.text))) add(title.text, author.text);
    add(title.text);
  }
  // Native blocks group split titles/names. Geometry orders likely titles first,
  // but alternatives remain available for author-above-title and unusual covers.
  const ordered = [...blocks].sort((a, b) => {
    const size = (block: typeof a) => block.boundingBox ? block.boundingBox.height / Math.max(1, block.text.split(' ').length / 3) : 0;
    return size(b) - size(a);
  });
  for (const title of ordered) {
    const authors = blocks.filter(b => b !== title && b.text.split(/\s+/).length >= 2 && b.text.split(/\s+/).length <= 5 && !/\d/.test(b.text));
    for (const author of authors) add(title.text, author.text);
    add(title.text);
  }
  // Adjacent separate native blocks may form a multi-line title or author.
  for (let i = 0; i < positioned.length - 1; i++) {
    const a = positioned[i], b = positioned[i + 1];
    const close = !a.boundingBox || !b.boundingBox || b.boundingBox.y - (a.boundingBox.y + a.boundingBox.height) < Math.max(a.boundingBox.height, b.boundingBox.height) * 1.5;
    if (!close) continue;
    const joined = `${a.text} ${b.text}`;
    for (const other of blocks.filter(v => v !== a && v !== b)) { add(joined, other.text); add(other.text, joined); }
    add(joined);
  }
  // One undifferentiated block: bounded splits instead of guessing one name.
  if (blocks.length === 1) {
    const lines = result.text.split('\n').filter(useful);
    for (let i = 1; i < lines.length; i++) { add(lines.slice(0, i).join(' '), lines.slice(i).join(' ')); add(lines.slice(i).join(' '), lines.slice(0, i).join(' ')); }
  }
  return output.slice(0, 32);
}
