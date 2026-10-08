import { openLibrarySearch } from '../src/services/providers/openLibrarySearch';
import { rankBooks } from '../src/recognition/matching';
async function main() {
  for (const query of [{ title: 'The Way of Kings', author: 'Brandon Sanderson' }, { title: 'Warbreaker', author: 'Brandon Sanderson' }]) {
    try {
      const result = rankBooks([query], await openLibrarySearch(query));
      console.log(JSON.stringify({ query, result }));
    } catch (error) { console.log(JSON.stringify({ query, error: String(error) })); process.exitCode = 1; }
  }
}
void main();
