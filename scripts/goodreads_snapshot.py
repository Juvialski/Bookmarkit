"""Optional cached Goodreads summaries; failure never blocks monthly publishing."""
import json
import sqlite3
import urllib.request
import time
from goodreads_worker import validate_summary, ClosingConnection

BASE = 'https://xxijxuekfsxuzhnujqem.supabase.co'
PUBLIC_KEY = 'sb_publishable_wzIGwfmaZRYy8GmHZIq41Q_MNjHxhtX'


def cached_summaries():
    rows = []
    deadline = time.monotonic() + 30
    try:
        for offset in range(0, 50000, 1000):
            if time.monotonic() >= deadline: break
            url = BASE + f'/rest/v1/goodreads_summaries?select=*&order=book_id&limit=1000&offset={offset}'
            with urllib.request.urlopen(urllib.request.Request(url, headers={'apikey': PUBLIC_KEY}), timeout=10) as response:
                page = json.load(response)
            if not isinstance(page, list): return []
            rows.extend(page)
            if len(page) < 1000: break
    except (OSError, ValueError): return []
    return rows


def attach(path, records):
    by_work = {}
    for r in records:
        try: validate_summary(r)
        except (ValueError, TypeError, KeyError): continue
        # Explicit allowlist excludes review text, images and arbitrary payloads.
        fields = ['book_id', 'goodreads_work_id', 'work_id', 'isbn13', 'average', 'rating_count', 'rating_scope', 'url',
                  'retrieved_at', 'match_confidence', 'status', 'series_name', 'series_position']
        by_work.setdefault(r['work_id'], []).append({k: r.get(k) for k in fields})
    with sqlite3.connect(path, factory=ClosingConnection) as db:
        if 'goodreads_json' not in {r[1] for r in db.execute('PRAGMA table_info(books)')}:
            db.execute('ALTER TABLE books ADD COLUMN goodreads_json TEXT')
        for work, rows in by_work.items():
            db.execute('UPDATE books SET goodreads_json=? WHERE work_id=?', (json.dumps(rows, separators=(',', ':')), work))
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
