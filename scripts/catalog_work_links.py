"""Resolve at most 20 cross-provider candidates using exact public ISBN editions.

Same title/author only discovers a candidate; it never proves an identity link.
No client JSON, ratings, images or OCR is accepted by this operator job.
"""
import json,time,urllib.request,urllib.error
from catalog_audit import inventory
from catalog_publish import request
from goodreads_historical import normalize
from catalog import isbn13
from bulk_cache import AGENT

def main():
    data=inventory();works={w['id']:w for w in data['catalog_works']};mapping={p['provider_id']:p['work_id'] for p in data['catalog_provider_works']}
    linked={r['alias_work_id'] for r in data.get('catalog_work_links',[])};attempted=accepted=0;seen=set()
    for c in data['hardcover_cache']:
        canonical=mapping.get(c['book_id']);isbn=c.get('isbn13')
        if not canonical or not isbn or canonical in seen or works[canonical]['source']!='hardcover':continue
        seen.add(canonical);base=works[canonical]
        candidates=[w for w in works.values() if w['source']=='open-library' and w['id'] not in linked and normalize(w['title'])==normalize(base['title']) and
            any(normalize(a)==normalize(c['primary_author']) for a in w['authors'])]
        if not candidates:continue
        attempted+=1
        try:
            query=urllib.request.Request(f'https://openlibrary.org/isbn/{isbn}.json',headers={'User-Agent':AGENT})
            with urllib.request.urlopen(query,timeout=10) as response:
                raw=response.read(65537)
                if len(raw)>65536:continue
                edition=json.loads(raw)
            refs=edition.get('works',[])
            exact=any(isbn13(i)==isbn for i in edition.get('isbn_13',[])+edition.get('isbn_10',[]))
            if len(refs)!=1 or not exact or normalize(edition.get('title',''))!=normalize(c['title']):continue
            alias=next((w for w in candidates if w['id']==refs[0].get('key')),None)
            if not alias:continue
            result=json.loads(request('/rest/v1/rpc/accept_catalog_work_link',json.dumps({'cache_identity':c['cache_key'],'edition':{
                'key':edition['key'],'work_id':alias['id'],'isbn13':isbn,'title':edition['title']}}).encode()))
            accepted+=int(result is True)
        except urllib.error.HTTPError as error:
            if error.code in (401,403,429,503):break
        except (OSError,ValueError,KeyError):pass
        time.sleep(1)
        if attempted>=20:break
    print(json.dumps({'exact_edition_requests':attempted,'accepted_work_links':accepted}))

if __name__=='__main__':main()
