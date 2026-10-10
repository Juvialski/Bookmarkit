"""Validate and publish an immutable catalog using trusted service credentials."""
import hashlib, json, os, re, sqlite3, time, urllib.request, urllib.error
from contextlib import closing
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://xxijxuekfsxuzhnujqem.supabase.co'

KEYS = {'catalog_works': ('id',), 'catalog_authors': ('id',),
        'catalog_work_authors': ('work_id', 'author_id'), 'catalog_editions': ('id',),
        'catalog_isbns': ('isbn13',), 'catalog_ratings': ('work_id', 'source')}

class PublicationError(RuntimeError):
    def __init__(self, context, status, code=None):
        self.status, self.code = status, code
        # Never echo provider messages/details: they can contain payloads or secrets.
        descriptions = {'21000': 'duplicate conflict key', '23503': 'foreign key violation',
                        '23505': 'unique constraint violation', '23514': 'check constraint violation'}
        super().__init__(f'{context}: HTTP {status}; database code={code or "unavailable"}; '
                         f'{descriptions.get(code, "request failed (provider details withheld)")}')

def request(path, data, content='application/json', method='POST', *, context='catalog request', retry=True):
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':content,'Prefer':'resolution=merge-duplicates'})
    for attempt in range(3 if retry else 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return r.read()
        except urllib.error.HTTPError as error:
            code = None
            try:
                value = json.loads(error.read(8192)).get('code')
                if isinstance(value, str) and re.fullmatch(r'[A-Z0-9]{5}', value): code = value
            except (ValueError, AttributeError): pass
            finally: error.close()
            transient = (code in {'40001', '40P01', '53300', '57P01', '57P02', '57P03'}
                         or bool(code and code.startswith('08'))
                         or (code is None and error.code in {408, 429, 500, 502, 503, 504}))
            if not retry or not transient or attempt == 2:
                raise PublicationError(context, error.code, code) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            if not retry or attempt == 2: raise PublicationError(context, 'transport timeout/unavailable') from None
        time.sleep(2 ** attempt)

def unique_rows(table, rows):
    """Deduplicate before batching; inconsistent identities fail before any upload."""
    unique = {}
    for row in rows:
        key = tuple(row[column] for column in KEYS[table])
        if key in unique and unique[key] != row:
            raise ValueError(f'{table}: conflicting records for the same primary key')
        unique[key] = row
    return [unique[key] for key in sorted(unique)]

def payloads():
    staging = ROOT / 'dist/catalog'
    source = json.loads((staging / 'source.json').read_text('utf-8'))
    with closing(sqlite3.connect(staging / 'expanded.db')) as db:
        db.row_factory = sqlite3.Row
        rows = list(db.execute('SELECT b.*,w.normalized_title FROM books b JOIN works w ON w.isbn13=b.isbn13 ORDER BY w.id'))
        work_isbns = {}
        for isbn,work_id in db.execute('SELECT isbn13,work_id FROM books ORDER BY isbn13'):
            work_isbns.setdefault(work_id,[]).append(isbn)
    records = {r['key']:r for r in unique_rows('catalog_works', [dict(id=r['key'], **r) for r in source['records']])}
    with closing(sqlite3.connect(staging/'checkpoint.sqlite')) as checkpoint:
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
    return [(table, unique_rows(table, values)) for table, values in
            [('catalog_works',works),('catalog_authors',list(authors.values())),('catalog_work_authors',links),('catalog_editions',editions),('catalog_isbns',isbns),('catalog_ratings',ratings)]]

def verify_file(path, manifest):
    raw = request('/storage/v1/object/public/book-catalogs/'+path, None, method='GET', context='public catalog checksum')
    if len(raw) != manifest['bytes'] or hashlib.sha256(raw).hexdigest() != manifest['sha256']:
        raise ValueError('Public catalog checksum/size mismatch')

def record_ingestion(manifest, source):
    # Identity-generated audit rows cannot be blindly retried after ambiguous writes.
    existing = json.loads(request('/rest/v1/catalog_ingestion?select=id&status=eq.published&version=eq.'+manifest['version'], None, method='GET'))
    if not existing:
        request('/rest/v1/catalog_ingestion',json.dumps([dict(version=manifest['version'],sources=source['sources'],completed_at=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),works=source['works'],isbns=source['isbns'],status='published')]).encode(), context='catalog_ingestion batch 1', retry=False)

def publish():
    staging = ROOT / 'dist/catalog'; m=json.loads((staging/'manifest.json').read_text('utf-8')); raw=(staging/'expanded.db').read_bytes()
    assert hashlib.sha256(raw).hexdigest()==m['sha256'] and len(raw)==m['bytes']
    with closing(sqlite3.connect(staging/'expanded.db')) as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert db.execute('SELECT count(*) FROM works').fetchone()[0]==m['works']
        assert db.execute('SELECT count(*) FROM books').fetchone()[0]==m['isbns']
    path=f"{m['version']}/{m['sha256']}.db"
    manifest=dict(version=m['version']+'-'+m['sha256'][:12],schema_version=m['schema'],works=m['works'],isbns=m['isbns'],bytes=m['bytes'],sha256=m['sha256'],url=BASE+'/storage/v1/object/public/book-catalogs/'+path)
    existing=json.loads(request('/rest/v1/catalog_manifests?select=*&sha256=eq.'+m['sha256'],None,method='GET'))
    if existing:
        if any(any(row.get(k) != v for k,v in manifest.items()) for row in existing):
            raise ValueError('Published manifest conflicts with local catalog')
        verify_file(path, m)
        record_ingestion(manifest, m)
        print('Catalog unchanged; publication skipped');return
    tables = payloads()  # Validate all composite keys before the first mutation.
    for table, rows in tables:
        for offset in range(0,len(rows),500):
            request('/rest/v1/'+table,json.dumps(rows[offset:offset+500]).encode(), context=f'{table} batch {offset//500+1}')
        print(table, len(rows), 'rows uploaded', flush=True)
    try: request('/storage/v1/object/book-catalogs/'+path,raw,'application/octet-stream')
    except PublicationError as e:
        if e.status not in (400,409): raise
    verify_file(path, m)  # Including successful uploads, before advertising the file.
    record_ingestion(manifest, m)
    request('/rest/v1/catalog_manifests',json.dumps([manifest]).encode(), context='catalog_manifests batch 1')
    print('Published',m['works'],'works',m['isbns'],'ISBNs')
if __name__=='__main__': publish()
