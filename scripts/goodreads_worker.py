"""Conservative public-page collector. No browser, cookies, bypass or service key.

SQLite owns checkpoints; Goodreads CLI v0.3.1 owns robots and HTTP parsing.
Only normalized summaries persist: never reviews, descriptions or images.
"""
import argparse
import ctypes
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try: return super().__exit__(*args)
        finally: self.close()


def normalized(value):
    value = unicodedata.normalize('NFKD', str(value)).casefold()
    return ' '.join(re.sub(r'[^\w]+', ' ', ''.join(c for c in value if not unicodedata.combining(c))).split())


def stamp():
    return datetime.now(timezone.utc).isoformat()


def database(path):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=5, factory=ClosingConnection)
    db.row_factory = sqlite3.Row
    db.executescript('''
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS queue (
        key TEXT PRIMARY KEY, target TEXT NOT NULL, priority INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_at REAL NOT NULL DEFAULT 0, elapsed REAL, summary TEXT, uploaded_at TEXT);
      CREATE INDEX IF NOT EXISTS queue_ready ON queue(status,next_at,priority);
      CREATE TABLE IF NOT EXISTS control (key TEXT PRIMARY KEY,value TEXT);
    ''')
    return db


def enqueue(db, targets):
    for target in targets:
        key = hashlib.sha256(json.dumps([target['work_id'], target.get('isbn13')]).encode()).hexdigest()
        db.execute('''INSERT INTO queue(key,target,priority) VALUES(?,?,?) ON CONFLICT(key)
          DO UPDATE SET priority=min(queue.priority,excluded.priority)''', (key, json.dumps(target), target.get('priority', 3)))
    db.commit()


def sample(source, limit=100):
    records = json.loads(Path(source).read_text('utf-8'))['records']
    # Stratify by catalog popularity/rating population rather than 100 adjacent rows.
    records = sorted(records, key=lambda r: -(r.get('ratings_count') or 0))
    selected = records[:limit // 2] + records[-limit // 4:]
    step = max(1, len(records) // max(1, limit - len(selected)))
    selected += records[::step]
    unique = list({r['key']: r for r in selected + records}.values())[:limit]
    targets = []
    for index, r in enumerate(unique):
        isbns = r.get('isbn') or []
        # Include work-only lookups and alternate editions; each remains a distinct queue item.
        targets.append(dict(work_id=r['key'], title=r['title'], authors=r.get('author_name') or [],
                            isbn13=None if index % 5 == 0 else (isbns[index % len(isbns)] if isbns else None),
                            priority=2 if index < limit // 2 else 3))
    return targets


def validate_summary(record):
    if not isinstance(record, dict): raise ValueError('invalid summary')
    if record.get('status') != 'verified' or record.get('match_confidence') not in ('exact_isbn', 'title_author'):
        raise ValueError('unverified match')
    book_id = str(record.get('book_id', ''))
    if not re.fullmatch(r'[1-9]\d{0,15}', book_id): raise ValueError('invalid book id')
    if not re.fullmatch(r'https://www\.goodreads\.com/book/show/' + book_id + r'(?:[-.][A-Za-z0-9_%.-]+)?', record.get('url', '')):
        raise ValueError('invalid source URL')
    if record.get('rating_scope') not in ('edition', 'work'): raise ValueError('unknown rating population')
    score, count = record.get('average'), record.get('rating_count')
    if type(score) not in (int, float) or not 0 < score <= 5: raise ValueError('invalid score')
    if type(count) is not int or not 0 < count <= 9007199254740991: raise ValueError('invalid count')
    if not re.fullmatch(r'/works/OL\d+W', record.get('work_id', '')): raise ValueError('invalid linked work')
    if record.get('rating_scope') == 'edition' and not record.get('isbn13'): raise ValueError('edition requires exact ISBN')
    if record.get('isbn13'):
        from catalog import isbn13
        if isbn13(record['isbn13']) != record['isbn13']: raise ValueError('invalid ISBN')
    retrieved = datetime.fromisoformat(record['retrieved_at'].replace('Z', '+00:00'))
    if retrieved.tzinfo is None or retrieved.timestamp() > time.time() + 300: raise ValueError('invalid timestamp')
    if not isinstance(record.get('evidence'), dict) or not record['evidence'].get('method'): raise ValueError('missing evidence')
    if record.get('series_position') and not re.fullmatch(r'\d+(?:\.\d+)?', record['series_position']): raise ValueError('invalid series position')
    return record


def extract(payload, target):
    bundles = payload if isinstance(payload, list) else [payload]
    matches = []
    for bundle in bundles:
        b = bundle.get('book', {})
        if not b or b.get('robots'): continue
        contributors = b.get('contributors') or []
        authors = [c.get('name', '') for c in contributors if c.get('role') in ('Author', 'author')]
        # Fail closed even for ISBN when identifying text contradicts the catalog.
        title_matches = normalized(b.get('title')) == normalized(target['title'])
        author_matches = bool(target['authors']) and bool(set(map(normalized, authors)) & set(map(normalized, target['authors'])))
        exact = bool(target.get('isbn13')) and b.get('isbn13') == target['isbn13']
        if not title_matches or not author_matches or (target.get('isbn13') and not exact): continue
        work = bundle.get('work') or {}
        if not b.get('work', {}).get('id') or b['work']['id'] != work.get('id'): continue
        # CLI's separate stats objects name the observed population. Never copy
        # edition stats to another edition or treat suggest scores as page stats.
        stats = work.get('stats') or {}
        scope = 'work'
        # Audited v0.3.1 copies Work.stats to both output objects. Only Apollo
        # level-1 fields are proven work aggregates; JSON-LD fallback is unclear.
        levels = work.get('level') or {}
        if stats.get('via') != 's1' or levels.get('average_rating') != 1 or levels.get('ratings_count') != 1: continue
        series = b.get('series') or []
        s = series[0] if len(series) == 1 else {}
        position = s.get('position', '')
        if not re.fullmatch(r'\d+(?:\.\d+)?', position) or float(position) <= 0: position = None
        record = dict(book_id=str(b.get('legacy_id', '')), goodreads_work_id=str(work['legacy_id']) if work.get('legacy_id') else None,
                      work_id=target['work_id'], isbn13=target.get('isbn13') if exact else None,
                      average=stats.get('average_rating'), rating_count=stats.get('ratings_count'), rating_scope=scope,
                      url=b.get('web_url'), retrieved_at=b.get('retrieved_at'), status='verified',
                      match_confidence='exact_isbn' if exact else 'title_author',
                      evidence=dict(method='goodread-v0.3.1', title=b.get('title'), authors=authors,
                                    matched_isbn=b.get('isbn13') if exact else None, stats_via=stats.get('via')),
                      series_name=s.get('series', {}).get('title') if position else None, series_position=position)
        try: matches.append(validate_summary(record))
        except (ValueError, KeyError, TypeError): continue
    return matches[0] if len(matches) == 1 else None


def safe_to_run():
    if os.name != 'nt': return False  # Windows host guard fails closed elsewhere.
    if not idle_on_ac(): return False
    class Power(ctypes.Structure):
        _fields_ = [('ac', ctypes.c_ubyte), ('flags', ctypes.c_ubyte), ('percent', ctypes.c_ubyte),
                    ('reserved', ctypes.c_ubyte), ('life', ctypes.c_ulong), ('full', ctypes.c_ulong)]
    power = Power()
    if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(power)) or power.ac != 1: return False
    # Total processor utilization plus interactive processes. Unknown readings pause.
    command = "$busy=(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average; $apps=Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'hubstaff|steam|epicgames|valorant|fortnite|minecraft' }; if($null -eq $busy -or $busy -gt 40 -or $apps){exit 1}"
    try: return subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command], capture_output=True, timeout=15, creationflags=0x08000000).returncode == 0
    except (OSError, subprocess.TimeoutExpired): return False


def idle_on_ac():
    if os.name != 'nt': return False
    class LastInput(ctypes.Structure):
        _fields_ = [('size', ctypes.c_uint32), ('tick', ctypes.c_uint32)]
    info = LastInput(); info.size = ctypes.sizeof(info)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)): return False
    idle = (ctypes.windll.kernel32.GetTickCount() - info.tick) & 0xffffffff
    power = (ctypes.c_ubyte * 12)()
    return idle >= 120000 and bool(ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(power))) and power[0] == 1


def collect(db, cli, state, interval=15, pilot=False, max_books=100):
    interval = max(10, interval)
    state = Path(state); state.mkdir(parents=True, exist_ok=True)
    # Single-host lock prevents overlapping tasks/CLI subprocesses.
    lock = open(state / 'worker.lock', 'a+b')
    if os.name == 'nt':
        import msvcrt
        lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
        try: msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError: lock.close(); return
    elif not pilot:
        lock.close(); return
    process = None
    try:
        db.execute("UPDATE queue SET status='pending' WHERE status='running'"); db.commit()
        if db.execute("SELECT 1 FROM control WHERE key='blocked'").fetchone(): return
        for row in db.execute("SELECT key,summary FROM queue WHERE status='verified'").fetchall():
            fetched = datetime.fromisoformat(json.loads(row['summary'])['retrieved_at'].replace('Z', '+00:00')).timestamp()
            if time.time() - fetched >= 30 * 86400:
                db.execute("UPDATE queue SET status='pending',priority=case when priority<=1 then priority else 4 end,attempts=0 WHERE key=?", (row['key'],))
        db.commit()
        previous_blocks = db.execute("SELECT value FROM control WHERE key='consecutive_blocks'").fetchone()
        attempted = 0; blocks = int(previous_blocks[0]) if previous_blocks else 0
        while attempted < max_books:
            if (state / 'STOP').exists() or (state / 'PAUSE').exists(): return
            if not pilot and not safe_to_run(): return
            row = db.execute("SELECT * FROM queue WHERE status='pending' AND next_at<=? ORDER BY priority,key LIMIT 1", (time.time(),)).fetchone()
            if not row: return
            target = json.loads(row['target']); query = target.get('isbn13') or target['title'] + ' ' + ' '.join(target['authors'])
            db.execute("UPDATE queue SET status='running', attempts=attempts+1 WHERE key=?", (row['key'],)); db.commit()
            start = time.monotonic()
            args = [str(cli), 'lookup', query, '--json', '--depth', 'quick', '--limit', '2', '--delay', f'{interval}s', '--retries', '0', '--timeout', '20s', '--data-dir', str(state / 'cache')]
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=(0x08000000 | 0x00000040) if os.name == 'nt' else 0)
            # communicate with a short timeout drains pipes while retaining immediate stop.
            out = err = b''
            while True:
                try: out, err = process.communicate(timeout=1); break
                except subprocess.TimeoutExpired:
                    if (state / 'STOP').exists() or (state / 'PAUSE').exists() or time.monotonic() - start > 90 or (not pilot and not idle_on_ac()):
                        process.kill(); process.communicate()
                        db.execute("UPDATE queue SET status='pending' WHERE key=?", (row['key'],)); db.commit(); return
            elapsed = time.monotonic() - start
            blocked = any(word in err.lower() for word in (b'blocked', b'waf', b'challenge', b'robots', b'429', b'403'))
            record = None
            if process.returncode == 0:
                try: record = extract(json.loads(out), target)
                except (ValueError, KeyError, TypeError): pass
            status = 'verified' if record else 'blocked' if blocked else 'unmatched' if process.returncode == 0 else 'unavailable'
            # Network interruptions retry at most twice, with a durable backoff.
            next_at = 0
            if status == 'unavailable' and row['attempts'] < 2:
                status = 'pending'; next_at = time.time() + 3600 * (row['attempts'] + 1)
            # Failures never erase last-good summaries or uploaded checkpoints.
            db.execute('UPDATE queue SET status=?,elapsed=?,summary=coalesce(?,summary),next_at=?,uploaded_at=case when ? is null then uploaded_at else null end WHERE key=?',
                       (status, elapsed, json.dumps(record) if record else None, next_at, record and 'new', row['key'])); db.commit()
            attempted += 1; blocks = blocks + 1 if blocked else 0
            db.execute("INSERT OR REPLACE INTO control VALUES('consecutive_blocks',?)", (str(blocks),)); db.commit()
            with open(state / 'operations.log', 'a', encoding='utf-8') as log:
                log.write(f'{stamp()} {row["key"][:10]} {status} {elapsed:.1f}s\n')
            if (state / 'operations.log').stat().st_size > 1000000:
                (state / 'operations.log').replace(state / 'operations.previous.log')
            if blocks >= 3:
                db.execute("INSERT OR REPLACE INTO control VALUES('blocked',?)", (stamp(),)); db.commit(); return
            until = time.monotonic() + interval
            while time.monotonic() < until:
                if (state / 'STOP').exists() or (state / 'PAUSE').exists(): return
                time.sleep(0.25)
    finally:
        if process is not None and process.poll() is None:
            process.kill(); process.communicate()
        lock.close()


def sync(db, credential):
    if os.name != 'nt': raise RuntimeError('Windows DPAPI credential required')
    from windows_credential import load
    token = load(credential)
    if not re.fullmatch(r'[a-f0-9]{64}', token): raise RuntimeError('Collector credential unavailable')
    import urllib.request
    import urllib.error
    while True:
        rows = db.execute("SELECT key,summary FROM queue WHERE summary IS NOT NULL AND uploaded_at IS NULL LIMIT 25").fetchall()
        if not rows: return
        summaries = [validate_summary(json.loads(row['summary'])) for row in rows]
        body = json.dumps(summaries).encode()
        req = urllib.request.Request('https://xxijxuekfsxuzhnujqem.supabase.co/functions/v1/goodreads-ingest', data=body,
                                     headers={'Content-Type': 'application/json', 'x-collector-token': token})
        try:
            with urllib.request.urlopen(req, timeout=20) as response: ack = json.load(response)
            if ack.get('acknowledged') != len(rows): return
        except (urllib.error.URLError, TimeoutError, ValueError): return  # next launch retries identical batch
        db.executemany('UPDATE queue SET uploaded_at=? WHERE key=? AND summary=?', [(stamp(), row['key'], row['summary']) for row in rows]); db.commit()


def report(db):
    rows = list(db.execute('SELECT status,elapsed,summary FROM queue'))
    counts = {status: sum(r['status'] == status for r in rows) for status in sorted({r['status'] for r in rows})}
    attempted = sum(r['elapsed'] is not None for r in rows)
    elapsed = [r['elapsed'] for r in rows if r['elapsed'] is not None]
    return dict(planned=len(rows), attempted=attempted, statuses=counts, verified=counts.get('verified', 0),
                verified_rate=counts.get('verified', 0) / attempted if attempted else None,
                mean_seconds=sum(elapsed) / len(elapsed) if elapsed else None,
                precision='not independently adjudicated', circuit_open=bool(db.execute("SELECT 1 FROM control WHERE key='blocked'").fetchone()))


def main():
    if os.name == 'nt': ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x40)
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', type=Path, default=ROOT / 'dist/goodreads-worker')
    parser.add_argument('--cli', type=Path)
    parser.add_argument('--pilot', action='store_true')
    parser.add_argument('--seed', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--export', type=Path)
    parser.add_argument('--targets', type=Path, help='JSON list: scanned missing=priority 0, scanned stale=1, popular=2, rest=3')
    parser.add_argument('--sync-credential', type=Path)
    parser.add_argument('--limit', type=int, default=100)
    args = parser.parse_args()
    with database(args.state / 'queue.sqlite') as db:
        if args.seed: enqueue(db, sample(args.seed, args.limit))
        if args.targets: enqueue(db, json.loads(args.targets.read_text('utf-8')))
        if args.cli: collect(db, args.cli.resolve(), args.state, pilot=args.pilot, max_books=args.limit)
        if args.sync_credential: sync(db, args.sync_credential)
        result = report(db)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True); args.report.write_text(json.dumps(result, indent=2) + '\n')
        if args.export:
            args.export.parent.mkdir(parents=True, exist_ok=True)
            args.export.write_text(json.dumps([json.loads(r[0]) for r in db.execute("SELECT summary FROM queue WHERE summary IS NOT NULL")], indent=2) + '\n')
        print(json.dumps(result))


if __name__ == '__main__': main()
