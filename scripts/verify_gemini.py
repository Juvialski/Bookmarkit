"""Private operational check; --live-text permits ONE request after the circuit expires.

Uses existing authenticated Supabase CLI access; never prints API keys.
"""
import argparse
import json
import subprocess
import urllib.request
from datetime import datetime, timezone
from catalog_publish import BASE


def main(live_text=False):
    result = subprocess.run(['npx.cmd' if __import__('os').name == 'nt' else 'npx',
                             'supabase', 'projects', 'api-keys', '--project-ref',
                             'xxijxuekfsxuzhnujqem', '--reveal', '--output', 'json'],
                            capture_output=True, timeout=120)
    if result.returncode: raise RuntimeError('Authenticated Supabase CLI access required')
    data = json.loads(result.stdout)
    keys = data if isinstance(data, list) else data.get('api_keys', [])
    key = next((r['api_key'] for r in keys if r.get('name') == 'service_role'), None)
    if not key: raise RuntimeError('Existing service-role credential unavailable')
    headers = {'apikey':key, 'Authorization':'Bearer '+key, 'Content-Type':'application/json'}
    def call(path, body=None):
        req = urllib.request.Request(BASE+path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response: return json.load(response)
    circuit = call('/rest/v1/gemini_circuit?select=cooldown_until')
    usage = call('/rest/v1/gemini_project_usage?select=model,task,day,attempts,tokens&order=day.desc')
    check = call('/functions/v1/book-search', {'task':'verify'})
    grounding = call('/functions/v1/book-search', {'query':''})
    print(json.dumps(dict(configuration=check,circuit=circuit,usage=usage,grounding=grounding),indent=2))
    if check.get('status') != 'verified': raise RuntimeError('Free-only configuration verification failed')
    if grounding.get('status') != 'disabled': raise RuntimeError('Grounding must remain disabled')
    if not live_text: return
    if any(r.get('cooldown_until') and datetime.fromisoformat(r['cooldown_until'].replace('Z','+00:00')) > datetime.now(timezone.utc) for r in circuit):
        raise RuntimeError('Existing cooldown is active; no generation request made')
    # One attempt only. No provider/model/key rotation, retries or paid API activation.
    answer = call('/functions/v1/book-search', {'task':'text','query':'Warbreaker by Brandon Sanderson'})
    print(json.dumps(dict(text_status=answer.get('status'), has_text=bool(answer.get('text')))))
    print(json.dumps(dict(usage_after=call('/rest/v1/gemini_project_usage?select=model,task,day,attempts,tokens&order=day.desc'))))
    if answer.get('status') != 'ok' or not answer.get('text'): raise RuntimeError('Live text verification did not succeed; do not retry')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--live-text',action='store_true')
    try: main(parser.parse_args().live_text)
    except Exception:
        # urllib/subprocess exception strings can contain credential-bearing URLs.
        print('Verification stopped safely. Check configuration/cooldown; no automatic retry.')
        raise SystemExit(1) from None
