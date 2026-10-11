"""Explicit 20-book acceptance against the deployed fixed-query Edge Function.

Uses only the public project key, never a provider PAT. Stops on rate-limit/auth
errors; output is sanitized and must stay under ignored dist/.
"""
import argparse,json,pathlib,time,urllib.request,urllib.error
from goodreads_snapshot import BASE,PUBLIC_KEY
from goodreads_historical import normalize

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output',required=True);args=parser.parse_args()
 output=pathlib.Path(args.output).resolve()
 if not output.is_relative_to(pathlib.Path(__file__).resolve().parents[1]/'dist'):parser.error('output must be ignored dist/')
 records=json.loads(pathlib.Path('catalog/source.json').read_text(encoding='utf-8'))['records']
 titles=['The Hunger Games','The Way of Kings','Warbreaker',"Harry Potter and the Philosopher's Stone",'Dune','The Road','Pride and Prejudice','Emma','It','To Kill a Mockingbird','Piranesi','Tress of the Emerald Sea','Yumi and the Nightmare Painter','Babel','Fantastic Mr. Fox','The Hobbit','The Shining','The Name of the Wind','The Martian','Gone Girl']
 selected=[next((r for r in records if normalize(r['title'])==normalize(title) and r.get('author_name') and r.get('isbn')),None) for title in titles]
 selected=[r for r in selected if r]
 if not 15<=len(selected)<=25:parser.error('catalog lacks enough selected targets; review target set before testing')
 output.parent.mkdir(parents=True,exist_ok=True);rows=[]
 def call(query):
  started=time.perf_counter()
  req=urllib.request.Request(BASE+'/functions/v1/hardcover',data=json.dumps(query).encode(),headers={'apikey':PUBLIC_KEY,'Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=8) as response:result=json.loads(response.read(65537))
   return response.status,result,round((time.perf_counter()-started)*1000,2)
  except urllib.error.HTTPError as e:return e.code,{},round((time.perf_counter()-started)*1000,2)
 for record in selected:
  for query in [{'isbn':record['isbn'][0]},{'title':record['title'],'author':record['author_name'][0]}]:
   status,result,latency=call(query)
   row={'target':record['title'],'query':query,'status':status,'lookup_ms':latency,'result':result}
   if result.get('found'):
    row['independent_identity_agrees']=normalize(result.get('title',''))==normalize(record['title']) and normalize(result.get('authors',[''])[0])==normalize(record['author_name'][0])
    cache_status,cache_result,cache_latency=call(query)
    row.update(cache_status=cache_status,cache_ms=cache_latency,cache_hit=cache_result.get('cacheHit') is True)
   rows.append(row);output.write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
   if status in (401,403,404,429,503):return
   time.sleep(6)

if __name__=='__main__':main()
