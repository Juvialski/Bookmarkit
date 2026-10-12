"""Operator-only commands using existing CLI credentials; never prints secrets."""
import argparse,json,os,subprocess,urllib.request,urllib.error
from catalog_publish import BASE,publish
from goodreads_snapshot import PUBLIC_KEY

def credential():
    result=subprocess.run(['npx.cmd' if os.name=='nt' else 'npx','supabase','projects','api-keys',
        '--project-ref','xxijxuekfsxuzhnujqem','--reveal','--output','json'],capture_output=True,timeout=120)
    if result.returncode:raise RuntimeError('Existing CLI authorization unavailable')
    data=json.loads(result.stdout);rows=data if isinstance(data,list) else data['api_keys']
    return next(r['api_key'] for r in rows if r.get('name')=='service_role')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('operation',choices=['publish','enrich','authorization','references']);args=parser.parse_args()
    os.environ['SUPABASE_SERVICE_ROLE_KEY']=credential()
    if args.operation=='publish':publish();return
    if args.operation=='references':
        from pathlib import Path
        from catalog_publish import request
        records=json.loads(Path('dist/catalog/source.json').read_text('utf-8'))['records']
        rows=[{'id':r['key'],'refs':r['author_refs']} for r in records if r.get('author_refs') and r['key'].startswith('/works/OL')]
        accepted=0
        for offset in range(0,len(rows),500):accepted+=json.loads(request('/rest/v1/rpc/retain_catalog_author_refs',json.dumps({'records':rows[offset:offset+500]}).encode()))
        print(json.dumps({'retained_author_reference_sets':accepted}));return
    if args.operation=='enrich':
        os.environ['HARDCOVER_ENABLED']='1'
        from hardcover_incremental import main as enrich
        enrich();return
    report={}
    for label,path,body in [
        ('anonymous_catalog_ingestion','/rest/v1/rpc/accept_hardcover_catalog',{'cache_identity':'0'*64}),
        ('anonymous_series_ingestion','/rest/v1/rpc/sync_hardcover_series',{'provider_identity':'1'}),
        ('anonymous_catalog_write','/rest/v1/catalog_provider_works',{}),
        ('private_queue_read','/rest/v1/hardcover_jobs?select=cache_key&limit=1',None),
        ('public_mapping_read','/rest/v1/catalog_provider_works?select=provider_id,work_id&limit=1',None)]:
        request=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'apikey':PUBLIC_KEY,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(request,timeout=10) as response:report[label]=response.status
        except urllib.error.HTTPError as error:report[label]=error.code
    assert report['public_mapping_read']==200 and all(s in (401,403) for k,s in report.items() if k!='public_mapping_read')
    from pathlib import Path
    Path('dist/v5/authorization.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Catalog operation stopped safely: '+type(error).__name__+'; credentials/provider details withheld');raise SystemExit(1) from None
