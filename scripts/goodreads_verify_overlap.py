"""Optional bounded Open Library corroboration of XML/catalog ISBN overlaps.

No Goodreads requests. Saves public identity evidence only. Main reconciliation
is offline and can use the committed evidence instead of repeating this check.
"""
import argparse
import json
import pathlib
import sqlite3
import time
import urllib.request
from datetime import datetime, timezone

from goodreads_historical import load_xml, titles, normalize
from research_goodreads import UA


def check(row, record, edition, work, names):
    isbn=row['isbn13']
    first=isbn[3:12]
    digit=(11-sum(int(c)*(10-i) for i,c in enumerate(first))%11)%11
    ten=first+('X' if digit==10 else str(digit))
    isbn_present=isbn in edition.get('isbn_13',[]) or (isbn.startswith('978') and ten in edition.get('isbn_10',[]))
    author_agrees=bool({normalize(a) for a in names}&{normalize(a) for a in record['authors']})
    work_agrees={'key':row['work_id']} in edition.get('works',[])
    title_agrees=normalize(row['title']) in {normalize(edition.get('title','')),normalize(work.get('title',''))} and (
        normalize(edition.get('title','')) in titles(record) or normalize(work.get('title','')) in titles(record))
    gids=edition.get('identifiers',{}).get('goodreads',[])
    gid_agrees=record['book_id'] in gids
    verified=bool(isbn_present and work_agrees and author_agrees and (title_agrees or gid_agrees))
    return dict(catalog_work_id=row['work_id'],isbn13=isbn,catalog_title=row['title'],
        catalog_authors=row['authors'],goodreads_book_id=record['book_id'],
        goodreads_work_id=record['goodreads_work_id'],xml_title=record['title'],xml_authors=record['authors'],
        edition=edition['key'],edition_title=edition.get('title'),work_title=work.get('title'),work_authors=names,
        isbn_present=isbn_present,work_link_agrees=work_agrees,author_agrees=author_agrees,title_agrees=title_agrees,
        independent_goodreads_ids=gids,goodreads_id_agrees=gid_agrees,verified=verified,
        evidence_url='https://openlibrary.org/isbn/'+isbn+'.json',
        work_evidence_url='https://openlibrary.org'+row['work_id']+'.json')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--xml',required=True)
    parser.add_argument('--catalog',default='catalog/packages/expanded.db')
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    output=pathlib.Path(args.output).resolve()
    if not output.is_relative_to(pathlib.Path(__file__).resolve().parents[1]/'dist'):
        parser.error('output must be under ignored dist/')
    output.parent.mkdir(parents=True,exist_ok=True)
    records,_=load_xml(pathlib.Path(args.xml))
    cache={}
    def fetch(key):
        if key not in cache:
            req=urllib.request.Request('https://openlibrary.org'+key+'.json',headers={'User-Agent':UA})
            with urllib.request.urlopen(req,timeout=25) as response:
                raw=response.read(2_000_001)
                if len(raw)>2_000_000:
                    raise ValueError('response too large')
                cache[key]=json.loads(raw)
            time.sleep(1)
        return cache[key]
    with sqlite3.connect(pathlib.Path(args.catalog).resolve().as_uri()+'?mode=ro',uri=True) as db:
        db.row_factory=sqlite3.Row
        overlaps=[(dict(row),record) for record in records if record['isbn_valid']
                  for row in db.execute('SELECT isbn13,title,authors,work_id FROM books WHERE isbn13=?',(record['isbn13'],))]
    if len(overlaps)>30:
        parser.error('overlap verification limited to 30; offline matching remains available')
    evidence=[]
    for row,record in overlaps:
        row['authors']=json.loads(row['authors'])
        try:
            edition=fetch('/isbn/'+row['isbn13'])
            work=fetch(row['work_id'])
            names=[fetch(a['author']['key'])['name'] for a in work.get('authors',[]) if a.get('author',{}).get('key')]
            item=check(row,record,edition,work,names)
        except Exception as error:
            item=dict(catalog_work_id=row['work_id'],isbn13=row['isbn13'],error=type(error).__name__,verified=False)
        item['observed_at']=datetime.now(timezone.utc).isoformat()
        evidence.append(item)
        output.write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(overlaps=len(overlaps),verified=sum(e['verified'] for e in evidence),distinct_endpoints=len(cache))))


if __name__=='__main__':
    main()
