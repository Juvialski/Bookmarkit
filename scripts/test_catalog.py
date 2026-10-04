import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from catalog import build, isbn13, parse_series, SOURCE, OUTPUT

class CatalogTests(unittest.TestCase):
    def test_conservative_series(self):
        self.assertEqual(parse_series(['Series #0.5', 'series, Book 0.5']), ('Series', '0.5'))
        self.assertIsNone(parse_series(['Series #1', 'Series #2']))
        self.assertIsNone(parse_series(['Series #' + '9' * 400]))
        for statement in ['Series #1', 'Series ; book 1', 'Series (Volume 1)', 'Series (#1)', 'Series : no. 1', 'Series, Vol. 1']:
            self.assertEqual(parse_series([statement]), ('Series', '1'))
        for values in [None, ['Series'], ['Series #1', 'Other #2'], ['Series #1 #2'], ['Series (Book 1'], ['Series #0']]:
            self.assertIsNone(parse_series(values))
    def test_generator(self):
        with tempfile.TemporaryDirectory() as folder:
            source, db = Path(folder)/'source.json', Path(folder)/'catalog.db'
            record = {'key': '/works/OL1W', 'isbn': ['978-0-140-32872-1', '0140328726', 'bad'], 'title': '  Fantastic   Mr. Fox ', 'author_name': [' Roald  Dahl ', 'Roald Dahl'], 'series': ['Example ; book 2'], 'ratings_average': 4.5, 'ratings_count': 3}
            source.write_text(json.dumps({'version': 'fixture', 'generated_date': '2026-10-04', 'source': 'fixture', 'records': [record, {**record, 'title': 'Duplicate'}]}))
            rows = build(source, db)
            self.assertEqual(len(rows), 1)
            first = db.read_bytes()
            build(source, db)
            self.assertEqual(first, db.read_bytes())
            with closing(sqlite3.connect(db)) as connection:
                row = connection.execute('SELECT * FROM books').fetchone()
                self.assertEqual(row[1], 'Fantastic Mr. Fox')
                self.assertEqual(json.loads(row[2]), ['Roald Dahl'])
                self.assertEqual(row[4:7], ('series', 'Example', '2'))
                self.assertEqual(connection.execute("SELECT value FROM metadata WHERE key='version'").fetchone()[0], 'fixture')
                self.assertIn('PRIMARY KEY', connection.execute('EXPLAIN QUERY PLAN SELECT * FROM books WHERE isbn13=?', (row[0],)).fetchone()[3])
            self.assertIsNone(isbn13('9780140328722'))

    def test_bundled_catalog(self):
        with tempfile.TemporaryDirectory() as folder:
            rebuilt = Path(folder)/'rebuilt.db'
            build(SOURCE, rebuilt)
            with closing(sqlite3.connect(OUTPUT)) as db, closing(sqlite3.connect(rebuilt)) as fresh:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual(db.execute('SELECT * FROM books ORDER BY isbn13').fetchall(), fresh.execute('SELECT * FROM books ORDER BY isbn13').fetchall())
                self.assertEqual(db.execute('SELECT * FROM metadata ORDER BY key').fetchall(), fresh.execute('SELECT * FROM metadata ORDER BY key').fetchall())
                count = db.execute('SELECT count(DISTINCT work_id) FROM books').fetchone()[0]
                self.assertGreaterEqual(count, 1000); self.assertLessEqual(count, 10000)
                for isbn in ['9780140328721', '9780765326355', '9780547928227', '9780765320308', '9780140430776']:
                    row = db.execute('SELECT title, authors FROM books WHERE isbn13=?', (isbn,)).fetchone()
                    self.assertTrue(row[0]); self.assertTrue(json.loads(row[1]))
                self.assertEqual(db.execute("SELECT series_status, series_position FROM books WHERE isbn13='9780765326355'").fetchone(), ('series', '1'))
                self.assertEqual(db.execute("SELECT series_status FROM books WHERE isbn13='9780765320308'").fetchone()[0], 'standalone')
                for isbn in ['9781250899651', '9781250899699']:
                    self.assertEqual(db.execute('SELECT series_status, classification_source FROM books WHERE isbn13=?', (isbn,)).fetchone(), ('standalone', 'curated'))
                self.assertEqual(db.execute("SELECT series_position FROM books WHERE isbn13='9780765326362'").fetchone()[0], '2')
                self.assertIsNone(db.execute("SELECT rating FROM books WHERE isbn13='9780140430776'").fetchone()[0])

if __name__ == '__main__': unittest.main()
