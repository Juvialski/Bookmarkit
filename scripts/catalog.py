"""Small Open Library snapshot -> deterministic bundled SQLite (Python stdlib only)."""
import argparse
import gzip
import json
import re
import sqlite3
import time
import urllib.parse
import urllib.request
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'catalog/source.json'
OUTPUT = ROOT / 'assets/catalog-v1.db'

def isbn13(value):
    s = re.sub(r'[\s-]', '', str(value))
    if len(s) == 10 and re.fullmatch(r'\d{9}[\dXx]', s):
        if (sum((10-i)*int(c) for i,c in enumerate(s[:9])) + (10 if s[-1].upper() == 'X' else int(s[-1]))) % 11:
            return None
        s = '978' + s[:9]
        s += str((-sum(int(c)*(1 if i%2 == 0 else 3) for i,c in enumerate(s)))%10)
    if not re.fullmatch(r'97[89]\d{10}', s): return None
    return s if sum(int(c)*(1 if i%2 == 0 else 3) for i,c in enumerate(s))%10 == 0 else None

def text(value):
    return ' '.join(value.split()) if isinstance(value, str) else ''

def parse_series(values):
    # Match the online adapter's numbered-statement rules, including parentheses.
    if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], str): return None
    match = re.fullmatch(r'(.+?)(?:\s*[;,:-]\s*|\s+)(?:\((?:#\s*|(?:book|vol\.?|volume|no\.?)\s+)(\d+(?:\.\d+)?)\)|(?:#\s*|(?:book|vol\.?|volume|no\.?)\s+)(\d+(?:\.\d+)?))\s*[.;]?', values[0].strip(), re.I)
    if not match: return None
    name = match[1].strip().rstrip(';,:-').strip()
    position = match[2] or match[3]
    if not name or re.search(r'[#()]|\b(?:book|vol\.?|volume|no\.?)\s+\d', name, re.I) or float(position) <= 0: return None
    return name, position

def fetch(url):
    time.sleep(1)
    request = urllib.request.Request(url, headers={'User-Agent': 'BookmarkitSmallCatalog/1.0 (https://github.com/Juvialski/Bookmarkit)'})
    with urllib.request.urlopen(request, timeout=60) as response: return json.load(response)

def refresh():
    records = []
    fields = 'key,title,author_name,isbn,ratings_average,ratings_count'
    for page in range(1, 12):
        query = urllib.parse.urlencode({'q': 'language:eng AND isbn:*', 'sort': 'readinglog', 'limit': 100, 'page': page, 'fields': fields})
        data = fetch('https://openlibrary.org/search.json?' + query)
        records.extend(data['docs'])
        print('Fetched page', page, flush=True)
    query = urllib.parse.urlencode({'q': 'language:eng AND isbn:* AND NOT ratings_count:[1 TO *]', 'limit': 5, 'fields': fields})
    records.extend(fetch('https://openlibrary.org/search.json?' + query)['docs'])
    # Exact editions take priority over work-level search records.
    seeds = []
    for isbn in ['9780140328721', '9780765326355', '9780547928227', '9780061120084', '9780451524935', '9780060530921', '9780765320308']:
        edition = fetch(f'https://openlibrary.org/isbn/{isbn}.json')
        work_key = edition.get('works', [{}])[0].get('key')
        work = fetch('https://openlibrary.org' + work_key + '.json') if work_key else {}
        refs = edition.get('authors') or [a.get('author', a) for a in work.get('authors', [])]
        authors = [fetch('https://openlibrary.org' + a['key'] + '.json').get('name') for a in refs]
        ratings = fetch('https://openlibrary.org' + work_key + '/ratings.json').get('summary', {}) if work_key else {}
        seeds.append({'key': work_key or edition['key'], 'title': edition['title'], 'isbn': [isbn], 'author_name': authors,
                      'ratings_average': ratings.get('average'), 'ratings_count': ratings.get('count'),
                      'series': edition.get('series', work.get('series', [])), 'edition_key': edition['key']})
    for record in records:
        record['isbn'] = sorted({isbn13(value) for value in record.get('isbn', [])} - {None})[:8]
    SOURCE.write_text(json.dumps({'version': 'v1', 'generated_date': time.strftime('%Y-%m-%d', time.gmtime()),
                                 'source': 'https://openlibrary.org/search.json', 'records': seeds + records}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def build(source=SOURCE, output=OUTPUT):
    data = json.loads(Path(source).read_text(encoding='utf-8'))
    curated = json.loads((ROOT / 'catalog/curated.json').read_text(encoding='utf-8')) if Path(source) == SOURCE else {}
    rows = {}
    for record in data['records']:
        title = text(record.get('title'))
        authors = list(dict.fromkeys(text(a) for a in record.get('author_name', []) if text(a)))
        if not title: continue
        override = next((curated[i] for i in record.get('isbn', []) if i in curated), {})
        series = override.get('series', record.get('series', []))
        parsed = parse_series(series)
        average, count = record.get('ratings_average'), record.get('ratings_count')
        count = count if type(count) is int and count >= 0 else None
        average = average if type(average) in (float, int) and 0 < average <= 5 and count != 0 else None
        for isbn in sorted({isbn13(value) for value in record.get('isbn', [])} - {None})[:8]:
            if isbn and isbn not in rows:
                rows[isbn] = (isbn, title, json.dumps(authors, ensure_ascii=False), record.get('key'),
                              'series' if parsed else 'standalone' if override.get('series_status') == 'standalone' else 'unknown', parsed[0] if parsed else None,
                              parsed[1] if parsed else None, average, count)
    output = Path(output)
    if output.exists(): output.unlink()
    with closing(sqlite3.connect(output)) as db:
        db.execute('CREATE TABLE books (isbn13 TEXT PRIMARY KEY, title TEXT NOT NULL, authors TEXT NOT NULL, work_id TEXT, series_status TEXT NOT NULL, series_name TEXT, series_position TEXT, rating REAL, rating_count INTEGER) WITHOUT ROWID')
        db.execute('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID')
        db.executemany('INSERT INTO books VALUES (?,?,?,?,?,?,?,?,?)', [rows[k] for k in sorted(rows)])
        db.executemany('INSERT INTO metadata VALUES (?,?)', [(k, data[k]) for k in ['version', 'generated_date', 'source']])
        db.commit()
        db.execute('VACUUM')
    return rows

def measure(output=OUTPUT):
    raw = Path(output).read_bytes()
    with closing(sqlite3.connect(output)) as db:
        count = db.execute('SELECT count(*) FROM books').fetchone()[0]
        books = db.execute('SELECT count(DISTINCT work_id) FROM books').fetchone()[0]
        start = time.perf_counter()
        for _ in range(10000): db.execute('SELECT * FROM books WHERE isbn13=?', ('9780765326355',)).fetchone()
        elapsed = (time.perf_counter()-start)*1000/10000
    print(json.dumps({'books': books, 'isbns': count, 'sqlite_bytes': len(raw), 'gzip_bytes': len(gzip.compress(raw, mtime=0)), 'bytes_per_isbn': len(raw)/count, 'warm_lookup_ms': elapsed}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    if args.refresh: refresh()
    build()
    measure()
