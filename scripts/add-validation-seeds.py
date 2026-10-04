"""Explicit opt-in network refresh of three validation editions; never run in CI."""
import json
from catalog import SOURCE, fetch

seeds = []
for isbn in ['9781250899651', '9781250899699', '9780765326362']:
    edition = fetch(f'https://openlibrary.org/isbn/{isbn}.json')
    key = edition.get('works', [{}])[0].get('key')
    work = fetch(f'https://openlibrary.org{key}.json') if key else {}
    ratings = fetch(f'https://openlibrary.org{key}/ratings.json').get('summary', {}) if key else {}
    refs = edition.get('authors') or [a.get('author', a) for a in work.get('authors', [])]
    authors = [fetch(f"https://openlibrary.org{a['key']}.json").get('name') for a in refs]
    seeds.append({'key': key, 'title': edition['title'], 'isbn': [isbn], 'author_name': authors,
                  'series': edition.get('series', work.get('series', [])), 'edition_key': edition['key'],
                  'ratings_average': ratings.get('average'), 'ratings_count': ratings.get('count')})
    print(isbn, edition['title'], flush=True)
data = json.loads(SOURCE.read_text(encoding='utf-8'))
data['records'] = seeds + [r for r in data['records'] if r.get('isbn') not in [s['isbn'] for s in seeds]]
SOURCE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
