import hashlib, json, sqlite3, sys, time
from pathlib import Path
from catalog import isbn13
root=Path(sys.argv[1] if len(sys.argv)>1 else 'dist/catalog')
m=json.loads((root/'manifest.json').read_text('utf-8')); raw=(root/'expanded.db').read_bytes()
assert len(raw)==m['bytes'] and hashlib.sha256(raw).hexdigest()==m['sha256']
with sqlite3.connect(root/'expanded.db') as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert db.execute('SELECT count(*) FROM works').fetchone()[0]==m['works']
    assert db.execute('SELECT count(*) FROM books').fetchone()[0]==m['isbns']
    assert not db.execute('SELECT b.work_id FROM books b LEFT JOIN editions e ON e.work_id=b.work_id WHERE e.id IS NULL LIMIT 1').fetchone()
    assert all(isbn13(row[0])==row[0] for row in db.execute('SELECT isbn13 FROM books'))
    assert not db.execute("SELECT 1 FROM books WHERE series_status='standalone' AND classification_source<>'curated'").fetchone()
    columns={r[1] for r in db.execute('pragma table_info(books)')}
    if 'edition_id' in columns:
        assert not db.execute('select 1 from books b left join editions e on e.id=b.edition_id and e.work_id=b.work_id where e.id is null limit 1').fetchone()
    from goodreads_historical import normalize
    rules=json.loads(Path('docs/catalog-classifications.json').read_text('utf-8'))
    for row in db.execute('select title,authors,series_status from books'):
        for rule in rules:
            if normalize(row[0])==normalize(rule['title']) and any(normalize(a)==normalize(rule['author']) for a in json.loads(row[1])):
                assert row[2]==rule['series_status'], 'Reviewed classification must be preserved'
    assert {'works_title','books_work_id'} <= {r[0] for r in db.execute("select name from sqlite_master where type='index'")}
    sample=db.execute('SELECT isbn13 FROM books LIMIT 1').fetchone()[0]
    times=[]
    for _ in range(1000):
        start=time.perf_counter(); assert db.execute('SELECT * FROM books WHERE isbn13=?',(sample,)).fetchone(); times.append((time.perf_counter()-start)*1000)
    report=dict(works=m['works'],isbns=m['isbns'],bytes=m['bytes'],sha256=m['sha256'],rated_works=db.execute('SELECT count(DISTINCT work_id) FROM books WHERE rating IS NOT NULL').fetchone()[0],works_with_authors=db.execute("SELECT count(DISTINCT work_id) FROM books WHERE authors <> '[]'").fetchone()[0],warm_isbn_median_ms=sorted(times)[500],warm_isbn_p95_ms=sorted(times)[950])
(root/'validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
