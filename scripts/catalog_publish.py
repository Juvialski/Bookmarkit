"""Validate and publish an immutable catalog using trusted service credentials."""
import hashlib, json, os, sqlite3, urllib.request, urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://xxijxuekfsxuzhnujqem.supabase.co'

def request(path, data, content='application/json', method='POST'):
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':content,'Prefer':'resolution=merge-duplicates'})
    with urllib.request.urlopen(req, timeout=120) as r: return r.read()

def payloads():
    staging = ROOT / 'dist/catalog'
    source = json.loads((staging / 'source.json').read_text('utf-8'))
    db = sqlite3.connect(staging / 'expanded.db'); db.row_factory = sqlite3.Row
    rows = list(db.execute('SELECT b.*,w.normalized_title FROM books b JOIN works w ON w.isbn13=b.isbn13'))
    work_isbns = {}
    for isbn,work_id in db.execute('SELECT isbn13,work_id FROM books'):
        work_isbns.setdefault(work_id,[]).append(isbn)
    records = {r['key']:r for r in source['records']}
    with sqlite3.connect(staging/'checkpoint.sqlite') as checkpoint:
        original_records = {r[0]:json.loads(r[1]) for r in checkpoint.execute('SELECT work,data FROM records')}
    stamp = source['generated_date']+'T00:00:00Z'
    works, editions, isbns, ratings, authors, links = [], [], [], [], {}, []
    author_names = json.loads((staging/'authors.json').read_text('utf-8'))
    for row in rows:
        r=records[row['work_id']]
        title = row['normalized_title']
        works.append(dict(id=row['work_id'],title=row['title'],authors=json.loads(row['authors']),normalized_title=title,source='open-library',source_updated=stamp,series_status=row['series_status'],series_name=row['series_name'],series_position=row['series_position'],classification_source=row['classification_source']))
        editions.append(dict(id=r['edition_key'],work_id=r['key'],title=r['title'],source_updated=stamp))
        refs = r.get('author_refs', [])
        if not refs:
            # Checkpoint retains original references even for an interrupted author pass.
            refs = original_records.get(r['key'],{}).get('author_refs',[])
        for ref in refs:
            if author_names.get(ref):
                authors[ref]=dict(id=ref,name=author_names[ref],source_updated=stamp)
                links.append(dict(work_id=r['key'],author_id=ref))
        for isbn in work_isbns[row['work_id']]:
            isbn10=None
            if isbn.startswith('978'):
                nine=isbn[3:12]; check=(-sum((10-i)*int(c) for i,c in enumerate(nine)))%11
                isbn10=nine+('X' if check==10 else str(check))
            isbns.append(dict(isbn13=isbn,isbn10=isbn10,edition_id=r['edition_key']))
        if row['rating'] and row['rating_count']: ratings.append(dict(work_id=r['key'],source='Open Library',average=row['rating'],count=row['rating_count'],source_updated=stamp))
    return [('catalog_works',works),('catalog_authors',list(authors.values())),('catalog_work_authors',links),('catalog_editions',editions),('catalog_isbns',isbns),('catalog_ratings',ratings)]

def publish():
    staging = ROOT / 'dist/catalog'; m=json.loads((staging/'manifest.json').read_text('utf-8')); raw=(staging/'expanded.db').read_bytes()
    assert hashlib.sha256(raw).hexdigest()==m['sha256'] and len(raw)==m['bytes']
    with sqlite3.connect(staging/'expanded.db') as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert db.execute('SELECT count(*) FROM works').fetchone()[0]==m['works']
    for table, rows in payloads():
        for offset in range(0,len(rows),500): request('/rest/v1/'+table,json.dumps(rows[offset:offset+500]).encode())
    path=f"{m['version']}/{m['sha256']}.db"
    try: request('/storage/v1/object/book-catalogs/'+path,raw,'application/octet-stream')
    except urllib.error.HTTPError as e:
        if e.code not in (400,409): raise
        # Existing immutable object must contain exactly the same bytes.
        with urllib.request.urlopen(BASE+'/storage/v1/object/public/book-catalogs/'+path) as r:
            assert hashlib.sha256(r.read()).hexdigest()==m['sha256']
    manifest=dict(version=m['version']+'-'+m['sha256'][:12],schema_version=m['schema'],works=m['works'],isbns=m['isbns'],bytes=m['bytes'],sha256=m['sha256'],url=BASE+'/storage/v1/object/public/book-catalogs/'+path)
    request('/rest/v1/catalog_manifests',json.dumps([manifest]).encode())
    request('/rest/v1/catalog_ingestion',json.dumps([dict(version=manifest['version'],sources=m['sources'],completed_at=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),works=m['works'],isbns=m['isbns'],status='published')]).encode())
    print('Published',m['works'],'works',m['isbns'],'ISBNs')
if __name__=='__main__': publish()
