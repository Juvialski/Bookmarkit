"""Optional verified aggregate cache snapshot; no Hardcover HTTP requests."""
import json
import sqlite3
import urllib.request
from goodreads_snapshot import BASE, PUBLIC_KEY
from goodreads_worker import ClosingConnection

def cached_summaries():
    rows=[]
    try:
        for offset in range(0,5000,1000):
            request=urllib.request.Request(BASE+f'/rest/v1/hardcover_cache?select=ol_work_id,book_id,payload&order=cache_key&limit=1000&offset={offset}',headers={'apikey':PUBLIC_KEY})
            with urllib.request.urlopen(request,timeout=4) as response:
                raw=response.read(2_000_001)
                if len(raw)>2_000_000: return []
                page=json.loads(raw)
            if not isinstance(page,list): return []
            rows.extend(page)
            if len(page)<1000: break
    except (OSError,ValueError): return []
    try:
        request=urllib.request.Request(BASE+'/rest/v1/catalog_provider_works?select=provider_id,work_id&order=provider_id&limit=5000',headers={'apikey':PUBLIC_KEY})
        with urllib.request.urlopen(request,timeout=4) as response:mappings={r['provider_id']:r['work_id'] for r in json.load(response)}
        for r in rows:
            r['catalog_work_id']=mappings.get(r.get('book_id'))
            r['catalog_accepted']=r.get('book_id') in mappings
    except (OSError,ValueError):pass
    return rows

def attach(path,records):
    by_work={}
    fields=['found','identity','isbn','title','authors','hardcoverId','url','rating','ratingsCount','seriesName','seriesPosition','verified','ratingScope','retrievedAt']
    for row in records:
        if row.get('catalog_accepted') is False:continue
        payload=row.get('payload',{})
        work_id=row.get('catalog_work_id') or row.get('ol_work_id')
        if not work_id or payload.get('verified') is not True or payload.get('ratingScope')!='work': continue
        average,count=payload.get('rating'),payload.get('ratingsCount')
        if average is not None or count is not None:
            if isinstance(average,bool) or not isinstance(average,(float,int)) or not 0<average<=5 or isinstance(count,bool) or not isinstance(count,int) or not 0<count<=9007199254740991: continue
        sanitized={k:payload.get(k) for k in fields if k in payload}
        sanitized['catalogWorkId']=work_id
        if str(work_id).startswith('/works/OL'):sanitized['olWorkId']=work_id
        by_work.setdefault(work_id,[]).append(sanitized)
    with sqlite3.connect(path,factory=ClosingConnection) as db:
        if 'hardcover_json' not in {r[1] for r in db.execute('PRAGMA table_info(books)')}:
            db.execute('ALTER TABLE books ADD COLUMN hardcover_json TEXT')
        tables=['books']
        if db.execute("select 1 from sqlite_master where name='work_only_books'").fetchone():
            tables.append('work_only_books')
            if 'hardcover_json' not in {r[1] for r in db.execute('PRAGMA table_info(work_only_books)')}:db.execute('ALTER TABLE work_only_books ADD COLUMN hardcover_json TEXT')
        for work,values in by_work.items():
            # Prefer one latest observation per canonical provider work, deterministically.
            latest={}
            for value in sorted(values,key=lambda r:(r.get('retrievedAt',''),json.dumps(r,sort_keys=True))):latest[value['hardcoverId']]=value
            for table in tables:
                values=list(latest.values())
                columns={r[1] for r in db.execute(f'pragma table_info({table})')}
                if 'classification_source' in columns and db.execute(f"select 1 from {table} where work_id=? and classification_source='curated' limit 1",(work,)).fetchone():
                    values=[{k:v for k,v in value.items() if k not in ('seriesName','seriesPosition')} for value in values]
                db.execute(f'UPDATE {table} SET hardcover_json=? WHERE work_id=?',(json.dumps(values,separators=(',',':')),work))
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
