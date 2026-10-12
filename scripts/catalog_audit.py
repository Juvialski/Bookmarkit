"""Paginated public catalog inventory and a fixed, reproducible coverage cohort."""
import argparse, json, re, sqlite3, time, unicodedata, urllib.request, urllib.error
from pathlib import Path
from contextlib import closing
from goodreads_snapshot import BASE, PUBLIC_KEY
from catalog import isbn13
from goodreads_historical import normalize

def pages(table, columns='*'):
    rows = []
    for offset in range(0, 200000, 500):
        request = urllib.request.Request(f'{BASE}/rest/v1/{table}?select={columns}&order='+
            ('cache_key' if table=='hardcover_cache' else 'isbn13' if table=='catalog_isbns' else
             'provider_id' if table=='catalog_provider_works' else 'work_id,source' if table=='catalog_ratings' else 'id')+f'&limit=500&offset={offset}', headers={'apikey':PUBLIC_KEY})
        with urllib.request.urlopen(request, timeout=30) as response: page = json.load(response)
        rows.extend(page)
        if len(page)<500: return rows
    raise ValueError('Inventory bound exceeded; refusing partial inventory')

def inventory():
    return {table: pages(table) for table in ['catalog_works','catalog_authors','catalog_editions','catalog_isbns','catalog_ratings','hardcover_cache','catalog_provider_works']}

def cohort():
    source=json.loads(Path('catalog/source.json').read_text('utf-8'))['records']
    titles=json.loads(Path('docs/evidence/hardcover/final-target-titles.json').read_text('utf-8'))
    rows=[]
    for title in titles:
        r=next(r for r in source if normalize(r['title'])==normalize(title) and r.get('author_name') and r.get('isbn'))
        rows.append(dict(title=r['title'],author=r['author_name'][0],isbn=isbn13(r['isbn'][0])))
    rows.extend([dict(title=t,author=a,isbn=i) for t,a,i in [
        ('Outlander','Diana Gabaldon','9780440212560'),('Tomorrow, and Tomorrow, and Tomorrow','Gabrielle Zevin','9780593321201'),
        ('Intermezzo','Sally Rooney',None),('Onyx Storm','Rebecca Yarros',None),('The Mysterious Mr. Quin','Agatha Christie',None),
        ('Pride and Prejudice','Jane Austen','9780141439518'),('Emma','Jane Austen','9780141439587')]])
    return rows

def summarize(data, package):
    works=data['catalog_works']; by_id={w['id']:w for w in works}
    editions={e['id']:e for e in data['catalog_editions']}
    mapped={i['isbn13']:editions[i['edition_id']]['work_id'] for i in data['catalog_isbns']}
    rated={r['work_id'] for r in data['catalog_ratings'] if r['source']=='Open Library'}
    titles={}
    for w in works: titles.setdefault(normalize(w['title']),[]).append(w)
    cases=[]
    with closing(sqlite3.connect(f'file:{Path(package).as_posix()}?mode=ro',uri=True)) as db:
        db.row_factory=sqlite3.Row
        work_only=bool(db.execute("select 1 from sqlite_master where name='work_only_books'").fetchone())
        def search_title(value):
            value=''.join(c for c in unicodedata.normalize('NFKD',value).lower() if not unicodedata.combining(c))
            return ' '.join(re.sub(r'[^\w]+',' ',re.sub(r"[’‘`'.]",'',value)).split())
        for case in cohort():
            matching=[w for w in titles.get(normalize(case['title']),[]) if any(normalize(a)==normalize(case['author']) for a in w['authors'])]
            hit=by_id.get(mapped.get(case['isbn']))
            isbn_hit=bool(hit and normalize(hit['title'])==normalize(case['title']) and any(normalize(a)==normalize(case['author']) for a in hit['authors']))
            start=time.perf_counter(); offline=db.execute('select title,authors,work_id from books where isbn13=?',(case['isbn'],)).fetchone()
            elapsed=(time.perf_counter()-start)*1000
            offline_text=db.execute('select b.title,b.authors from works w join books b on b.isbn13=w.isbn13 where w.normalized_title=?',(search_title(case['title']),)).fetchall()
            if work_only:
                offline_text+=db.execute('select b.title,b.authors from works w join work_only_books b on b.work_id=w.id where w.normalized_title=?',(search_title(case['title']),)).fetchall()
            cases.append({**case,'shared_isbn':isbn_hit,'shared_title_author':len(matching)==1,'shared_ambiguous':len(matching)>1,
                'shared_open_library_rating':len(matching)==1 and matching[0]['id'] in rated,
                'offline_isbn':bool(offline and normalize(offline['title'])==normalize(case['title']) and any(normalize(a)==normalize(case['author']) for a in json.loads(offline['authors']))),
                'offline_title_author':sum(any(normalize(a)==normalize(case['author']) for a in json.loads(r['authors'])) for r in offline_text)==1,
                'offline_isbn_ms':elapsed})
        offline_counts={k:db.execute(sql).fetchone()[0] for k,sql in {
            'works':'select count(*) from works','isbns':'select count(*) from books',
            'with_authors':"select count(distinct work_id) from books where authors<>'[]'",
            'rated_open_library':'select count(distinct work_id) from books where rating is not null'}.items()}
        if work_only:offline_counts['with_authors']=db.execute("select count(*) from (select work_id from books where authors<>'[]' union select work_id from work_only_books where authors<>'[]')").fetchone()[0]
        provider_works={'Hardcover':set(),'Goodreads':set()}
        columns={r[1] for r in db.execute('pragma table_info(books)')}
        offline_counts['goodreads_edition_links']=db.execute('select count(*) from books where goodreads_url is not null').fetchone()[0] if 'goodreads_url' in columns else 0
        for provider,column in [('Hardcover','hardcover_json'),('Goodreads','goodreads_json')]:
            if column in columns:
                for table in ['books']+(['work_only_books'] if work_only else []):
                    if column not in {r[1] for r in db.execute(f'pragma table_info({table})')}:continue
                    for r in db.execute(f'select work_id,{column} from {table} where {column} is not null'):
                        if any(v.get('rating' if provider=='Hardcover' else 'average') is not None for v in json.loads(r[1])):provider_works[provider].add(r[0])
        offline_counts['rating_sources']={p:len(v) for p,v in provider_works.items()}
    rating_sources={s:len({r['work_id'] for r in data['catalog_ratings'] if r['source']==s}) for s in {r['source'] for r in data['catalog_ratings']}}
    return dict(works=len(works),editions=len(editions),isbns=len(mapped),with_authors=sum(bool(w['authors']) for w in works),
        missing_authors=sum(not w['authors'] for w in works),missing_open_library_rating=len(works)-len(rated),
        missing_series=sum(w['series_status']=='unknown' for w in works),missing_covers=sum(not w.get('cover_url') for w in works),
        cover_validation='No images are distributed. Non-null cover URLs require separate live validation.',
        duplicate_title_groups=sum(len(v)>1 for v in titles.values()),conflicting_edition_links=sum(e['work_id'] not in by_id for e in editions.values()),
        searchable_without_isbn=len(set(by_id)-set(mapped.values())),providers={s:sum(w['source']==s for w in works) for s in set(w['source'] for w in works)},
        rating_sources=rating_sources,hardcover_cache_rows=len(data['hardcover_cache']),hardcover_rated_works=len({r['book_id'] for r in data['hardcover_cache'] if r['payload'].get('rating') is not None}),
        offline={**offline_counts,'bytes':Path(package).stat().st_size},cohort=cases)

def online_cohort(out):
    results=[]
    for case in cohort():
        queries=([{'isbn':case['isbn']}] if case['isbn'] else [])+[{'title':case['title'],'author':case['author']}]
        for query in queries:
            request=urllib.request.Request(BASE+'/functions/v1/hardcover',data=json.dumps(query).encode(),headers={'apikey':PUBLIC_KEY,'Content-Type':'application/json'})
            start=time.perf_counter()
            try:
                with urllib.request.urlopen(request,timeout=10) as response:value=json.load(response);status=response.status
            except urllib.error.HTTPError as error:value={};status=error.code
            row={**case,'method':'isbn' if 'isbn' in query else 'title_author','status':status,'ms':(time.perf_counter()-start)*1000,
                'found':bool(value.get('found') and normalize(value.get('title',''))==normalize(case['title']) and any(normalize(a)==normalize(case['author']) for a in value.get('authors',[]))),
                'cache_hit':value.get('cacheHit') is True,'rated':value.get('rating') is not None,'hardcover_id':value.get('hardcoverId'),
                'average':value.get('rating'),'count':value.get('ratingsCount'),'scope':value.get('ratingScope')}
            results.append(row);(out/'online.json').write_text(json.dumps(results,indent=2)+'\n')
            if status in (401,403,404,429,503):return
            if not value.get('cacheHit'):time.sleep(3 if 'isbn' in query else 9)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--package',default='catalog/packages/expanded.db');parser.add_argument('--online-only',action='store_true');args=parser.parse_args()
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    if args.online_only:online_cohort(out);return
    data=inventory();(out/'public-inventory.json').write_text(json.dumps(data),encoding='utf-8')
    report=summarize(data,args.package);(out/'audit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='cohort'},indent=2))
if __name__=='__main__':main()
