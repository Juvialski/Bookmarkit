"""Preserve hosted identities, enrich from official dumps, build an atomic snapshot."""
import argparse, gzip, hashlib, json, sqlite3, time, urllib.request
from contextlib import closing
from pathlib import Path
from catalog import build, isbn13
from catalog_audit import inventory
from bulk_cache import download, lines, BASE, AGENT

ROOT=Path(__file__).resolve().parents[1]

def preserve(data, previous):
    originals={r['key']:r for r in previous}
    works={w['id']:w for w in data['catalog_works']}
    editions={e['id']:e for e in data['catalog_editions']}
    records={}
    for w in works.values():
        old=originals.get(w['id'],{})
        records[w['id']]={**old,'key':w['id'],'title':w['title'],'author_name':w['authors'] or old.get('author_name',[]),
            'isbn':[],'isbn_editions':{},'source_provider':w['source'],'series_status':w['series_status'],
            'series_name':w['series_name'],'series_position':w['series_position'],'classification_source':w['classification_source'],
            'source_updated':w['source_updated']}
    for i in data['catalog_isbns']:
        e=editions[i['edition_id']];r=records[e['work_id']]
        r['isbn'].append(i['isbn13']);r['isbn_editions'][i['isbn13']]=e['id'];r.setdefault('edition_key',e['id'])
    for r in data['catalog_ratings']:
        if r['source']=='Open Library':records[r['work_id']].update(ratings_average=float(r['average']),ratings_count=r['count'])
    return records

def resolve_authors(records, staging, seconds=480):
    names=json.loads((staging/'authors.json').read_text('utf-8')) if (staging/'authors.json').exists() else {}
    needed={ref for r in records.values() for ref in r.get('author_refs',[])}
    try:
        try:path=download('authors',staging/'bulk',seconds=seconds)
        except (OSError,TimeoutError):
            path=staging/'bulk/authors.part'
            if not path.exists() or not path.stat().st_size:raise
            print('Resolving complete author records from the pinned partial dump; incomplete tail excluded',flush=True)
        identity=json.loads((staging/'bulk/authors.json').read_text())
        with closing(sqlite3.connect(staging/'author-progress.sqlite')) as db:
            db.execute('create table if not exists progress(identity text primary key,offset integer not null)')
            db.execute('create table if not exists names(ref text primary key,name text not null)')
            marker=json.dumps([identity,sorted(needed)],sort_keys=True)
            row=db.execute('select offset from progress where identity=?',(marker,)).fetchone();offset=row[0] if row else 0
            names.update(dict(db.execute('select ref,name from names')))
            deadline=time.monotonic()+seconds
            for index,(offset,line) in enumerate(lines(path,offset)):
                parts=line.split('\t',4)
                if len(parts)==5 and parts[1] in needed:
                    value=json.loads(parts[4]);name=value.get('name')
                    if isinstance(name,str) and name.strip():
                        names[parts[1]]=name.strip();db.execute('insert or replace into names values (?,?)',(parts[1],name.strip()))
                if index%10000==0:
                    db.execute('insert or replace into progress values (?,?)',(marker,offset));db.commit()
                    if time.monotonic()>deadline:break
            db.execute('insert or replace into progress values (?,?)',(marker,offset));db.commit()
    except (OSError,EOFError,TimeoutError):print('Author download/pass checkpoint retained; preserving prior names',flush=True)
    for r in records.values():
        previous_authors=list(r.get('author_name',[]))
        refs=r.get('author_refs',[])
        resolved=[names[a] for a in refs if names.get(a)]
        # Partial resolution cannot replace an already complete/correct author list.
        if refs and len(resolved)==len(refs):r['author_name']=list(dict.fromkeys(resolved))
        elif not r.get('author_name'):r['author_name']=list(dict.fromkeys(resolved))
        if r.get('author_name')!=previous_authors:r['source_updated']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    temporary=staging/'authors.json.part';temporary.write_text(json.dumps(names,sort_keys=True),encoding='utf-8');temporary.replace(staging/'authors.json')
    return names

def popular_targets(path, limit=2000):
    # Disk aggregation avoids keeping the full ratings dump in RAM.
    database=path.parent/'popularity.sqlite'
    marker=hashlib.sha256(path.with_suffix('.json').read_bytes()).hexdigest()
    with closing(sqlite3.connect(database)) as db:
        db.execute('create table if not exists counts(work text primary key,n integer,total integer)')
        db.execute('create table if not exists progress(marker text primary key,offset integer)')
        row=db.execute('select offset from progress where marker=?',(marker,)).fetchone()
        if not row:db.execute('delete from counts')
        offset=row[0] if row else 0
        for index,(offset,line) in enumerate(lines(path,offset)):
            parts=line.strip().split('\t')
            try:
                score=int(parts[2]);work='/works/'+parts[0].removeprefix('/works/')
                if not 1<=score<=5:continue
                db.execute('insert into counts values (?,1,?) on conflict(work) do update set n=n+1,total=total+excluded.total',(work,score))
            except (ValueError,IndexError):continue
            if index%10000==0:db.execute('insert or replace into progress values (?,?)',(marker,offset));db.commit()
        db.execute('insert or replace into progress values (?,?)',(marker,offset));db.commit()
        return {w:(total/n,n) for w,n,total in db.execute('select work,n,total from counts order by n desc,work limit ?',(limit,))},database

def select_popular(records, targets, edition_path, staging, seconds=180, marker=None, iterator=None):
    marker=marker or json.dumps(json.loads(edition_path.with_suffix('.json').read_text()),sort_keys=True)
    with closing(sqlite3.connect(staging/'popular-progress.sqlite')) as db:
        db.execute('create table if not exists progress(marker text primary key,offset integer)')
        db.execute('create table if not exists accepted(work text primary key,data text)')
        row=db.execute('select offset from progress where marker=?',(marker,)).fetchone();offset=row[0] if row else 0
        for key,raw in db.execute('select work,data from accepted'):records.setdefault(key,json.loads(raw))
        wanted=set(targets)-set(records);claimed={i for r in records.values() for i in r.get('isbn',[])}
        deadline=time.monotonic()+seconds
        for index,(offset,line) in enumerate(iterator(offset) if iterator else lines(edition_path,offset)):
            try:
                e=json.loads(line.split('\t',4)[4]);works=e.get('works',[])
                if len(works)!=1 or works[0]['key'] not in wanted:continue
                key=works[0]['key'];isbns=sorted({isbn13(v) for v in e.get('isbn_13',[])+e.get('isbn_10',[])}-{None})
                if not isbns or any(i in claimed for i in isbns) or not e.get('title') or not e.get('key','').startswith('/books/OL'):continue
                refs=[a['key'] for a in e.get('authors',[]) if a.get('key','').startswith('/authors/OL')]
                r=dict(key=key,title=e['title'],isbn=isbns,edition_key=e['key'],isbn_editions={i:e['key'] for i in isbns},author_refs=refs,author_name=[],series=e.get('series',[]),source_provider='open-library',ratings_average=targets[key][0],ratings_count=targets[key][1],goodreads_ids={i:e.get('identifiers',{}).get('goodreads',[]) for i in isbns})
                records[key]=r;wanted.remove(key);claimed.update(isbns);db.execute('insert or ignore into accepted values (?,?)',(key,json.dumps(r)))
            except (ValueError,KeyError,TypeError):pass
            finally:
                if index%10000==0:
                    db.execute('insert or replace into progress values (?,?)',(marker,offset));db.commit()
            if not wanted or time.monotonic()>deadline:break
        db.execute('insert or replace into progress values (?,?)',(marker,offset));db.commit()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--skip-popular',action='store_true');parser.add_argument('--author-seconds',type=int,default=480);args=parser.parse_args()
    staging=ROOT/'dist/catalog';staging.mkdir(parents=True,exist_ok=True)
    prior=json.loads((staging/'source.json').read_text('utf-8'))['records'] if (staging/'source.json').exists() else []
    if (staging/'checkpoint.sqlite').exists():
        with closing(sqlite3.connect(staging/'checkpoint.sqlite')) as db:prior.extend(json.loads(r[0]) for r in db.execute('select data from records'))
    data=inventory();records=preserve(data,prior)
    # Reviewed exact editions from the established bundle are useful seeds, not
    # work-search ISBN guesses. Never displace a currently assigned ISBN.
    claimed={i for r in records.values() for i in r['isbn']}
    for r in json.loads((ROOT/'catalog/source.json').read_text('utf-8'))['records']:
        if r.get('edition_key') and r['key'] not in records and r.get('author_name'):
            isbns=sorted({isbn13(i) for i in r.get('isbn',[])}-{None})
            if isbns and not claimed.intersection(isbns):
                records[r['key']]={**r,'isbn':isbns,'isbn_editions':{i:r['edition_key'] for i in isbns},'source_provider':'open-library'};claimed.update(isbns)
    if not args.skip_popular:
        try:
            ratings=download('ratings',staging/'bulk',seconds=120);targets,counts=popular_targets(ratings)
            with closing(sqlite3.connect(counts)) as db:
                for key,r in records.items():
                    rating=db.execute('select total,n from counts where work=?',(key,)).fetchone()
                    if rating:r.update(ratings_average=rating[0]/rating[1],ratings_count=rating[1])
            request=urllib.request.Request(BASE.format('editions'),method='HEAD',headers={'User-Agent':AGENT})
            with urllib.request.urlopen(request,timeout=30) as response:
                url=response.url;marker=json.dumps([url,response.headers.get('ETag'),response.headers.get('Last-Modified')])
            def streamed(after):
                deadline=time.monotonic()+180
                with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':AGENT}),timeout=30) as response:
                    with gzip.GzipFile(fileobj=response) as stream:
                        offset=0
                        for raw in stream:
                            offset+=len(raw)
                            if time.monotonic()>deadline:return
                            if offset>after:yield offset,raw.decode('utf-8')
            select_popular(records,targets,None,staging,marker=marker,iterator=streamed)
        except (OSError,TimeoutError):print('Popular bulk checkpoint retained; preserving catalog',flush=True)
    resolve_authors(records,staging,args.author_seconds)
    from goodreads_snapshot import attach as attach_goodreads,cached_summaries as goodreads_summaries
    from hardcover_snapshot import attach, cached_summaries
    goodreads=goodreads_summaries();hardcover=cached_summaries()
    source={'version':time.strftime('%Y-%m',time.gmtime()),'generated_date':time.strftime('%Y-%m-%d',time.gmtime()),'source':BASE.format('editions'),'records':[records[k] for k in sorted(records)]}
    fingerprint=hashlib.sha256(json.dumps([source['records'],goodreads,hardcover],sort_keys=True,ensure_ascii=False).encode()+
        (ROOT/'scripts/catalog.py').read_bytes()+(ROOT/'scripts/hardcover_snapshot.py').read_bytes()).hexdigest()
    previous_fingerprint=staging/'build-fingerprint.txt'
    if previous_fingerprint.exists() and previous_fingerprint.read_text()==fingerprint and (staging/'expanded.db').exists():
        m=json.loads((staging/'manifest.json').read_text());raw=(staging/'expanded.db').read_bytes()
        if hashlib.sha256(raw).hexdigest()==m['sha256']:
            print('Catalog content unchanged; build skipped',flush=True);return
    (staging/'source.json').write_text(json.dumps(source,ensure_ascii=False),encoding='utf-8')
    output=staging/'expanded.next.db';build(staging/'source.json',output)
    with closing(sqlite3.connect(output)) as db:
        db.execute('create table editions(id text primary key,work_id text not null,source_updated text)')
        db.executemany('insert or ignore into editions values (?,?,?)',[(e['id'],e['work_id'],e['source_updated']) for e in data['catalog_editions']])
        for r in records.values():
            for eid in set(r.get('isbn_editions',{}).values()):db.execute('insert or ignore into editions values (?,?,?)',(eid,r['key'],r.get('source_updated',source['generated_date'])))
        db.commit()
    attach_goodreads(output,goodreads);attach(output,hardcover)
    with closing(sqlite3.connect(output)) as db:
        assert db.execute('pragma integrity_check').fetchone()[0]=='ok'
        works=db.execute('select count(*) from works').fetchone()[0];isbns=db.execute('select count(*) from books').fetchone()[0]
        assert works>=len(data['catalog_works']), 'Refresh would lose existing works'
        for i in data['catalog_isbns']:
            assert db.execute('select 1 from books where isbn13=?',(i['isbn13'],)).fetchone(), 'Refresh would lose existing ISBN'
    raw=output.read_bytes();output.replace(staging/'expanded.db')
    manifest=dict(version=source['version'],schema='v3',works=works,isbns=isbns,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),file='expanded.db',sources=[BASE.format(k) for k in ['editions','authors','ratings']]+['https://api.hardcover.app/v1/graphql'])
    (staging/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8');print(json.dumps(manifest),flush=True)
    previous_fingerprint.write_text(fingerprint,encoding='utf-8')

if __name__=='__main__':main()
