import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from goodreads_worker import database, enqueue, extract, collect, sample, validate_summary, ClosingConnection
from goodreads_snapshot import attach

TARGET = dict(work_id='/works/OL1W', title='A fixture', authors=['Test Author'], isbn13='9780439023481')


def payload():
    return dict(book=dict(legacy_id=123, title='A fixture', contributors=[dict(name='Test Author', role='Author')],
        isbn13=TARGET['isbn13'], work=dict(id='work:456'), web_url='https://www.goodreads.com/book/show/123-a-fixture',
        retrieved_at='2026-01-01T00:00:00Z', stats=dict(average_rating=4.83, ratings_count=1284631, via='book')),
        work=dict(id='work:456', legacy_id=456, level=dict(average_rating=1, ratings_count=1), stats=dict(average_rating=4.7, ratings_count=2000000, via='s1')))


class GoodreadsTests(unittest.TestCase):
    def test_matching_and_populations(self):
        self.assertEqual(extract(payload(), TARGET)['rating_scope'], 'work')
        p = payload(); p['work']['stats'] = None
        self.assertIsNone(extract(p, TARGET))
        self.assertIsNone(extract(p, {**TARGET, 'isbn13': None}))
        self.assertIsNone(extract([payload(), payload()], TARGET))
        self.assertIsNone(extract(payload(), {**TARGET, 'title': 'Different title'}))
        self.assertIsNone(extract(payload(), {**TARGET, 'authors': ['Other Author']}))
        p = payload(); p['book']['work']['id'] = 'work:999'
        self.assertIsNone(extract(p, TARGET))

    def test_invalid_counts_series_and_scores(self):
        for score in [0, 6, float('nan')]:
            r = extract(payload(), TARGET); r['average'] = score
            with self.assertRaises(ValueError): validate_summary(r)
        p = payload(); p['book']['series'] = [dict(series=dict(name='A series'), position='1-3')]
        self.assertIsNone(extract(p, TARGET)['series_position'])

    def test_durable_queue_dedup_and_priorities(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'queue.sqlite'
            with database(path) as db:
                enqueue(db, [{**TARGET, 'priority': 3}, {**TARGET, 'priority': 0}])
                self.assertEqual(db.execute('SELECT count(*) FROM queue').fetchone()[0], 1)
                self.assertEqual(db.execute('SELECT priority FROM queue').fetchone()[0], 0)
                db.execute("UPDATE queue SET status='running'"); db.commit()
            with database(path) as db:
                Path(tmp, 'STOP').touch()
                collect(db, 'unused', tmp, pilot=True)
                self.assertEqual(db.execute('SELECT status FROM queue').fetchone()[0], 'pending')

    def test_three_blocks_open_persistent_circuit(self):
        class Process:
            returncode = 4
            def communicate(self, timeout=None): return b'', b'blocked: AWS WAF'
        with tempfile.TemporaryDirectory() as tmp, database(Path(tmp)/'queue.sqlite') as db:
            enqueue(db, [{**TARGET, 'isbn13': str(i)} for i in range(5)])
            with patch('goodreads_worker.subprocess.Popen', return_value=Process()) as run, patch('goodreads_worker.time.sleep'), patch('goodreads_worker.time.monotonic', side_effect=range(0,10000,20)):
                collect(db, 'unused', tmp, pilot=True)
                self.assertEqual(run.call_count, 3)
                collect(db, 'unused', tmp, pilot=True)
                self.assertEqual(run.call_count, 3)
            self.assertTrue(db.execute("SELECT 1 FROM control WHERE key='blocked'").fetchone())

    def test_optional_offline_column_and_allowlist(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'catalog.db'
            with sqlite3.connect(path, factory=ClosingConnection) as db:
                db.execute('CREATE TABLE books(work_id TEXT)'); db.execute('INSERT INTO books VALUES(?)', (TARGET['work_id'],))
            r=extract(payload(), TARGET); r['reviews']='excluded'; r['image_url']='excluded'
            attach(path, [r])
            with sqlite3.connect(path, factory=ClosingConnection) as db:
                value=json.loads(db.execute('SELECT goodreads_json FROM books').fetchone()[0])[0]
                self.assertNotIn('reviews', value); self.assertNotIn('image_url', value)
            attach(path, [])  # compatible and non-destructive when source unavailable

    def test_pilot_has_100_unique_catalog_targets(self):
        records=sample(Path(__file__).resolve().parent.parent/'catalog/source.json')
        self.assertEqual(len(records), 100)
        self.assertEqual(len({(r['work_id'], r['isbn13']) for r in records}), 100)
        self.assertTrue(any(r['isbn13'] is None for r in records))


if __name__ == '__main__': unittest.main()
