"""Resumable, size-bounded official gzip downloads. Stable identity before resume."""
import gzip, json, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
BASE='https://openlibrary.org/data/ol_dump_{}_latest.txt.gz'
AGENT='BookmarkitCatalog/5 (https://github.com/Juvialski/Bookmarkit)'

def download(kind, folder, seconds=600, maximum=2_000_000_000):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    path=folder/f'{kind}.gz';part=folder/f'{kind}.part';meta=folder/f'{kind}.json'
    url=BASE.format(kind)
    with urllib.request.urlopen(urllib.request.Request(url,method='HEAD',headers={'User-Agent':AGENT}),timeout=30) as response:
        identity={'url':response.url,'etag':response.headers.get('ETag'),'modified':response.headers.get('Last-Modified'),'bytes':int(response.headers['Content-Length'])}
    if identity['bytes']>maximum: raise ValueError('Official dump exceeds disk bound')
    previous=json.loads(meta.read_text()) if meta.exists() else None
    if previous and all(previous.get(k)==identity.get(k) for k in ['etag','modified','bytes']) and urllib.parse.urlsplit(previous['url']).path==urllib.parse.urlsplit(identity['url']).path:
        identity=previous  # Archive mirror hostname changes do not invalidate bytes.
    if previous!=identity:
        part.unlink(missing_ok=True);path.unlink(missing_ok=True)
        meta.write_text(json.dumps(identity),encoding='utf-8')
    if path.exists() and path.stat().st_size==identity['bytes']:return path
    offset=part.stat().st_size if part.exists() else 0
    headers={'User-Agent':AGENT}
    if offset:headers.update({'Range':f'bytes={offset}-','If-Range':identity['etag'] or identity['modified']})
    deadline=time.monotonic()+seconds
    with urllib.request.urlopen(urllib.request.Request(identity['url'],headers=headers),timeout=30) as response:
        if offset and response.status==200:
            # Some archive mirrors ignore Range. Retain the checkpoint while
            # replaying the stable prefix; interruption must never truncate it.
            remaining=offset
            while remaining and time.monotonic()<deadline:
                chunk=response.read1(min(65536,remaining))
                if not chunk:raise ValueError('Incomplete replayed dump prefix')
                remaining-=len(chunk)
            if remaining:raise TimeoutError('Stable prefix replay checkpoint retained')
        elif offset and (response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {offset}-')):
            raise ValueError('Invalid dump range response; existing checkpoint retained')
        with part.open('ab' if offset else 'wb') as output:
            while time.monotonic()<deadline:
                chunk=response.read1(65536)
                if not chunk:break
                output.write(chunk);offset+=len(chunk)
                if offset>identity['bytes']:raise ValueError('Dump size mismatch')
    if offset!=identity['bytes']:raise TimeoutError('Dump checkpoint retained; resume next execution')
    # Verify gzip CRC/end-of-stream before atomically selecting the completed file.
    with gzip.open(part,'rb') as stream:
        while stream.read(1024*1024):pass
    part.replace(path)
    return path

def lines(path, after=0):
    # Uncompressed offset is durable on this pinned local gzip; gzip.seek bounds memory.
    with gzip.open(path,'rt',encoding='utf-8') as stream:
        if after:stream.seek(after)
        while True:
            line=stream.readline()
            if not line:return
            yield stream.tell(),line
