import { CoverText } from '../src/recognition/types';

export const covers = [
  { title: 'The Hobbit', author: 'J.R.R. Tolkien', titleLines: 'THE HOBBIT', authorLines: 'J.R.R. TOLKIEN' },
  { title: 'Atomic Habits', author: 'James Clear', titleLines: 'ATOMIC\nHABITS', authorLines: 'JAMES CLEAR', subtitle: 'Tiny Changes, Remarkable Results' },
  { title: 'The Way of Kings', author: 'Brandon Sanderson', titleLines: 'THE WAY\nOF KINGS', authorLines: 'BRANDON\nSANDERSON' },
  { title: "Harry Potter and the Philosopher's Stone", author: 'J.K. Rowling', titleLines: 'HARRY POTTER\nAND THE\nPHILOSOPHER’S STONE', authorLines: 'J.K. ROWLING' },
  { title: 'The Alchemist', author: 'Paulo Coelho', titleLines: 'THE ALCHEMIST', authorLines: 'PAULO COELHO', above: true },
  { title: '1984', author: 'George Orwell', titleLines: '1984', authorLines: 'GEORGE ORWELL', above: true },
  { title: 'Pride and Prejudice', author: 'Jane Austen', titleLines: 'PRIDE AND\nPREJUDICE', authorLines: 'JANE AUSTEN' },
  { title: 'The Silent Patient', author: 'Alex Michaelides', titleLines: 'THE SILENT\nPATIENT', authorLines: 'ALEX MICHAELIDES' },
  { title: 'Fourth Wing', author: 'Rebecca Yarros', titleLines: 'FOURTH WING', authorLines: 'REBECCA YARROS' },
  { title: 'Project Hail Mary', author: 'Andy Weir', titleLines: 'PROJECT\nHAIL MARY', authorLines: 'ANDY WEIR' },
];
export function fixtureCover(value: typeof covers[number]): CoverText {
  const block = (text: string, y: number, height: number) => ({ text, boundingBox: { x: 100, y, width: 600, height }, lines: text.split('\n').map(text => ({ text })) });
  const blocks = [block('NEW YORK TIMES BESTSELLER', 40, 25), block(value.titleLines, value.above ? 360 : 200, 220),
    block(value.authorLines, value.above ? 110 : 850, 100), ...(value.subtitle ? [block(value.subtitle, 500, 40)] : []), block('A Novel', 750, 25), block('Penguin Books', 1080, 25)];
  return { text: blocks.map(b => b.text).join('\n'), blocks };
}
