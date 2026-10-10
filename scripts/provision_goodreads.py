"""Provision one scoped Windows credential and test hosted ingestion without secrets in output."""
import argparse
import hashlib
import json
import os
import secrets
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from goodreads_worker import validate_summary
from goodreads_snapshot import BASE, PUBLIC_KEY
from windows_credential import save

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--credential', type=Path, required=True)
    parser.add_argument('--records', type=Path)
    args = parser.parse_args()
    if os.name != 'nt': raise RuntimeError('Windows required for DPAPI')
    token = secrets.token_hex(32)
    save(args.credential, token)
    commands = [
        ['npx.cmd','supabase','secrets','set','--project-ref','xxijxuekfsxuzhnujqem','GOODREADS_COLLECTOR_TOKEN_SHA256='+hashlib.sha256(token.encode()).hexdigest()],
        ['npx.cmd','supabase','functions','deploy','goodreads-ingest','--project-ref','xxijxuekfsxuzhnujqem','--no-verify-jwt','--use-api']]
    for command in commands:
        result=subprocess.run(command, capture_output=True, timeout=120)
        if result.returncode: raise RuntimeError('Hosted provisioning failed; provider details withheld')
    def call(data, credential=None, path='/functions/v1/goodreads-ingest'):
        headers={'Content-Type':'application/json'}
        if credential: headers['x-collector-token']=credential
        if path.startswith('/rest/'): headers['apikey']=PUBLIC_KEY
        request=urllib.request.Request(BASE+path,data=json.dumps(data).encode(),headers=headers)
        try:
            with urllib.request.urlopen(request,timeout=30) as response: return response.status,json.load(response)
        except urllib.error.HTTPError as error: return error.code, None
    report = dict(unauthorized=call([])[0], wrong_token=call([], '0'*64)[0], authenticated_empty=call([],token)[0],
                  invalid_batch=call([{'average':6}],token)[0], anon_rpc=call({'records':[]}, path='/rest/v1/rpc/ingest_goodreads')[0],
                  anonymous_insert=call({},path='/rest/v1/goodreads_summaries')[0], dpapi_stored=True)
    if args.records:
        records=json.loads(args.records.read_text('utf-8'))
        for record in records: validate_summary(record)
        status, ack=call(records,token)
        report.update(ingestion_status=status, ingestion_ack=ack, verified_records=len(records))
        if status != 200: raise RuntimeError('Verified ingestion rejected; preserve catalog identities and investigate linkage')
        if status==200:
            repeat_status, repeat_ack=call(records,token)
            report.update(idempotent_status=repeat_status,idempotent_ack=repeat_ack)
    target=ROOT/'docs/evidence/goodreads/hosted.json'; target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
    assert report['unauthorized']==401 and report['wrong_token']==401 and report['authenticated_empty']==200
    assert report['invalid_batch']==400 and report['anon_rpc'] in (401,403,404) and report['anonymous_insert'] in (401,403)


if __name__=='__main__':
    try: main()
    except RuntimeError as error:
        print(str(error)); raise SystemExit(1) from None
    except Exception:
        print('Provisioning stopped; credentials and provider details withheld.'); raise SystemExit(1) from None
