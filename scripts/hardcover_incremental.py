"""Bounded monthly queue drain. Server budgets remain authoritative; no bulk crawl."""
import os,json,hashlib,sqlite3,time,urllib.request,urllib.error,urllib.parse
from datetime import datetime
from goodreads_snapshot import BASE,PUBLIC_KEY

def main():
 if os.environ.get('HARDCOVER_ENABLED')!='1':
  print('Hardcover enrichment disabled; existing catalog publication continues.');return
 key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
 if not key: print('Hardcover queue credential unavailable; skipped.');return
 def api(path,body=None):
  request=urllib.request.Request(BASE+'/rest/v1/'+path,data=json.dumps(body).encode() if body is not None else None,
   headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
  with urllib.request.urlopen(request,timeout=5) as response:
   raw=response.read(1_000_001)
   if len(raw)>1_000_000: raise ValueError('response too large')
   return json.loads(raw) if raw else None
 try:
  # Scanned jobs already have priority 0; stale verified jobs retain their queue
  # identity. Seed only 20 popular/stored-rated ISBNs, never all catalog works.
  with sqlite3.connect('file:dist/catalog/expanded.db?mode=ro',uri=True) as db:
   columns={r[1] for r in db.execute('pragma table_info(books)')}
   missing="and (hardcover_json is null or hardcover_json='[]')" if 'hardcover_json' in columns else ''
   seeds=db.execute(f"select min(isbn13) from books where authors<>'[]' {missing} group by work_id order by max(coalesce(rating_count,0)) desc,work_id limit 20").fetchall()
  capacity=max(0,2000-len(api('hardcover_jobs?select=cache_key&limit=2001')))
  seeds=seeds[:capacity]
  for (isbn,) in seeds:
   cache_key=hashlib.sha256(('isbn:'+isbn).encode()).hexdigest()
   existing=api('hardcover_jobs?select=cache_key&cache_key=eq.'+cache_key)
   if not existing: api('hardcover_jobs',[{'cache_key':cache_key,'query':{'isbn':isbn},'priority':1}])
  jobs=api('hardcover_jobs?select=query,cache_key&attempts=lt.3&next_attempt=lte.'+urllib.parse.quote(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))+'&order=priority.asc,next_attempt.asc&limit=25')
  completed=0
  deadline=time.monotonic()+120
  for job in jobs:
   if time.monotonic()>deadline: break
   request=urllib.request.Request(BASE+'/functions/v1/hardcover',data=json.dumps(job['query']).encode(),headers={'apikey':PUBLIC_KEY,'Content-Type':'application/json'})
   try:
    with urllib.request.urlopen(request,timeout=8) as response:
     raw=response.read(65537)
     if len(raw)>65536: raise ValueError('response too large')
     result=json.loads(raw);completed+=1
     if result.get('cacheHit') and result.get('found') and result.get('retrievedAt'):
      # A pre-existing cache hit makes no reservation in Edge. Advance this
      # queue checkpoint too, so it cannot crowd out remaining due jobs.
      expires=datetime.fromisoformat(result['retrievedAt'].replace('Z','+00:00')).timestamp()+604800
      api('rpc/finish_hardcover',{'key':job['cache_key'],'seconds':max(300,int(expires-time.time()))})
   except urllib.error.HTTPError as error:
    if error.code in(401,403,404,429,503):break
   time.sleep(6)  # enough for a two-field search reservation, never bypass 429
  print(json.dumps({'hardcover_jobs_attempted_at_most':len(jobs),'completed_responses':completed}))
 except (OSError,ValueError):print('Optional Hardcover enrichment unavailable; catalog publication continues.')

if __name__=='__main__':main()
