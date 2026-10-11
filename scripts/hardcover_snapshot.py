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
            request=urllib.request.Request(BASE+f'/rest/v1/hardcover_cache?select=ol_work_id,payload&ol_work_id=not.is.null&order=cache_key&limit=1000&offset={offset}',headers={'apikey':PUBLIC_KEY})
            with urllib.request.urlopen(request,timeout=4) as response:
                raw=response.read(2_000_001)
                if len(raw)>2_000_000: return []
                page=json.loads(raw)
            if not isinstance(page,list): return []
            rows.extend(page)
            if len(page)<1000: break
    except (OSError,ValueError): return []
    return rows

def attach(path,records):
    by_work={}
    fields=['found','identity','isbn','title','authors','hardcoverId','url','rating','ratingsCount','seriesName','seriesPosition','verified','ratingScope','retrievedAt']
    for row in records:
        payload=row.get('payload',{})
        if not row.get('ol_work_id') or payload.get('verified') is not True or payload.get('ratingScope')!='work': continue
        average,count=payload.get('rating'),payload.get('ratingsCount')
        if isinstance(average,bool) or not isinstance(average,(float,int)) or not 0<average<=5 or isinstance(count,bool) or not isinstance(count,int) or not 0<count<=9007199254740991: continue
        sanitized={k:payload.get(k) for k in fields if k in payload}
        sanitized['olWorkId']=row['ol_work_id']
        by_work.setdefault(row['ol_work_id'],[]).append(sanitized)
    with sqlite3.connect(path,factory=ClosingConnection) as db:
        if 'hardcover_json' not in {r[1] for r in db.execute('PRAGMA table_info(books)')}:
            db.execute('ALTER TABLE books ADD COLUMN hardcover_json TEXT')
        for work,values in by_work.items():
            db.execute('UPDATE books SET hardcover_json=? WHERE work_id=?',(json.dumps(values,separators=(',',':')),work))
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
