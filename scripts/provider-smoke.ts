// Manual diagnostic only; never run in CI. Sequential ISBNs keep traffic small.
import { googleBooks } from '../src/services/providers/googleBooks';
import { openLibrary } from '../src/services/providers/openLibrary';
import { ProviderError } from '../src/services/providers/shared';

async function main() {
  for (const isbn of ['9780140328721', '9780765326355']) {
    for (const [provider, lookup] of [['Google Books', googleBooks], ['Open Library', openLibrary]] as const) {
      try {
        const book = await lookup(isbn);
        console.log(JSON.stringify({ isbn, provider, found: !!book, title: book?.title, authors: book?.authors,
          coverAvailable: !!book?.coverUrl, rating: book?.rating, series: book?.seriesStatus, warnings: book?.warnings }));
      } catch (error) {
        console.log(JSON.stringify({ isbn, provider, failure: error instanceof ProviderError ? error.kind : 'unavailable' }));
      }
    }
  }
}
void main();
