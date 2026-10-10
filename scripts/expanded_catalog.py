"""Bounded, restartable monthly dump ingestion. No per-book API calls."""
import argparse, gzip, hashlib, json, sqlite3, time, urllib.request
from pathlib import Path
from catalog import isbn13, build, measure

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://openlibrary.org/data/ol_dump_{}_latest.txt.gz'

def lines(kind):
    request = urllib.request.Request(BASE.format(kind), headers={'User-Agent': 'BookmarkitCatalog/2 (https://github.com/Juvialski/Bookmarkit)'})
    with urllib.request.urlopen(request, timeout=30) as response:
        with gzip.GzipFile(fileobj=response) as stream:
            for line in stream: yield line.decode('utf-8')

def run(target=25000):
    staging = ROOT / 'dist/catalog'; staging.mkdir(parents=True, exist_ok=True)
    checkpoint = staging / 'checkpoint.sqlite'
    db = sqlite3.connect(checkpoint)
    db.execute('CREATE TABLE IF NOT EXISTS records (work TEXT PRIMARY KEY, data TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS checkpoint_metadata(key TEXT PRIMARY KEY,value TEXT)')
    month = time.strftime('%Y-%m')
    previous = db.execute("SELECT value FROM checkpoint_metadata WHERE key='month'").fetchone()
    if previous and previous[0] != month:
        db.execute('DELETE FROM records')
        (staging / 'authors.json').unlink(missing_ok=True)
    db.execute("INSERT OR REPLACE INTO checkpoint_metadata VALUES ('month',?)",(month,)); db.commit()
    count = db.execute('SELECT count(*) FROM records').fetchone()[0]
    if count < target:
        for index, line in enumerate(lines('editions')):
            try:
                value = json.loads(line.split('\t', 4)[4])
                works = value.get('works', [])
                isbns = sorted({isbn13(v) for v in value.get('isbn_13', []) + value.get('isbn_10', [])} - {None})
                if len(works) != 1 or not isbns or not value.get('title'): continue
                key = works[0]['key']
                if not key.startswith('/works/OL'): continue
                record = {'key': key, 'title': value['title'], 'isbn': isbns, 'author_name': [], 'author_refs': [a['key'] for a in value.get('authors', []) if 'key' in a], 'edition_key': value['key'], 'series': value.get('series', [])}
                db.execute('INSERT OR IGNORE INTO records VALUES (?,?)', (key, json.dumps(record)))
                if index % 2000 == 0:
                    db.commit(); count = db.execute('SELECT count(*) FROM records').fetchone()[0]
                    print('Checkpoint works:', count, flush=True)
                    if count >= target: break
            except (ValueError, KeyError, TypeError): continue
        db.commit()
    records = [json.loads(r[0]) for r in db.execute('SELECT data FROM records ORDER BY work')]
    # Resolve only referenced authors from the official bulk dump.
    needed = {a for r in records for a in r['author_refs']}; names = {}
    author_cache = staging / 'authors.json'
    if author_cache.exists(): names = json.loads(author_cache.read_text('utf-8'))
    else:
        started = time.monotonic()
        try:
            for index, line in enumerate(lines('authors')):
                parts = line.split('\t', 4)
                if parts[1] in needed:
                    try:
                        value = json.loads(parts[4]); names[parts[1]] = value.get('name', '')
                    except ValueError: pass
                if index % 100000 == 0:
                    author_cache.write_text(json.dumps(names), encoding='utf-8')
                    print('Resolved authors:', len(names), flush=True)
                if len(names) == len(needed) or time.monotonic() - started > 300: break
        except (TimeoutError, OSError):
            print('Author stream interrupted; preserving resolved names only', flush=True)
        finally: author_cache.write_text(json.dumps(names), encoding='utf-8')
    scores = {}; latest = {}; work_keys = {r['key'] for r in records}
    for line in lines('ratings'):
        parts = line.strip().split('\t')
        try:
            key = '/works/' + parts[0].removeprefix('/works/')
            score = int(parts[2])
            if key not in work_keys or not 1 <= score <= 5: continue
            total, count = scores.get(key, (0, 0)); scores[key] = total + score, count + 1
            latest[key] = max(latest.get(key, ''), parts[3])
        except (ValueError, IndexError): continue
    for r in records:
        r['author_name'] = [names[a] for a in r['author_refs'] if names.get(a)]
        if r['key'] in scores:
            total, count = scores[r['key']]; r.update(ratings_average=total/count, ratings_count=count)
    source = staging / 'source.json'
    source.write_text(json.dumps({'version': time.strftime('%Y-%m'), 'generated_date': time.strftime('%Y-%m-%d'), 'source': BASE.format('editions'), 'records': records}), encoding='utf-8')
    output = staging / 'expanded.db'
    build(source, output)
    with sqlite3.connect(output) as catalog:
        assert catalog.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        catalog.execute('CREATE TABLE editions (id TEXT PRIMARY KEY, work_id TEXT NOT NULL, source_updated TEXT)')
        catalog.executemany('INSERT OR IGNORE INTO editions VALUES (?,?,?)', [(r['edition_key'], r['key'], latest.get(r['key'])) for r in records])
        works = catalog.execute('SELECT count(*) FROM works').fetchone()[0]
        isbns = catalog.execute('SELECT count(*) FROM books').fetchone()[0]
    raw = output.read_bytes()
    manifest = {'version': time.strftime('%Y-%m'), 'schema': 'v3', 'works': works, 'isbns': isbns, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'file': 'expanded.db', 'sources': [BASE.format(k) for k in ['editions', 'authors', 'ratings']]}
    (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(manifest), flush=True); measure(output)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--works', type=int, default=25000)
    run(parser.parse_args().works)
