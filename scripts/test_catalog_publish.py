"""Publication fixtures use no provider credentials or live requests."""
import hashlib
import io
import json
import os
import sqlite3
import tempfile
import unittest
import urllib.error
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
import catalog_publish as publisher
from catalog import build


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.staging = self.root / 'dist/catalog'
        self.staging.mkdir(parents=True)
        self.root_patch = patch.object(publisher, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.folder.cleanup)
        records = [dict(key='/works/OL1W', edition_key='/books/OL1M', title='First',
                        isbn=['9780140328721', '9780765326355'], author_name=['One', 'Two'],
                        author_refs=['/authors/OL1A', '/authors/OL1A', '/authors/OL2A'],
                        ratings_average=4.5, ratings_count=3),
                   dict(key='/works/OL2W', edition_key='/books/OL2M', title='Second',
                        isbn=['9780547928227'], author_name=['One'], author_refs=['/authors/OL1A'],
                        ratings_average=3.5, ratings_count=2)]
        self.source = dict(version='2026-10', generated_date='2026-10-10', source='fixture', records=records)
        (self.staging/'source.json').write_text(json.dumps(self.source))
        (self.staging/'authors.json').write_text(json.dumps({'/authors/OL1A': 'One', '/authors/OL2A': 'Two'}))
        with closing(sqlite3.connect(self.staging/'checkpoint.sqlite')) as db:
            db.execute('CREATE TABLE records(work TEXT PRIMARY KEY, data TEXT)')
            db.executemany('INSERT INTO records VALUES (?,?)', [(r['key'], json.dumps(r)) for r in records])
            db.commit()
        build(self.staging/'source.json', self.staging/'expanded.db')
        self.raw = (self.staging/'expanded.db').read_bytes()
        self.manifest = dict(version='2026-10', schema='v3', works=2, isbns=3,
                             bytes=len(self.raw), sha256=hashlib.sha256(self.raw).hexdigest(), sources=['fixture'])
        (self.staging/'manifest.json').write_text(json.dumps(self.manifest))

    def test_composite_keys_relationships_ratings_and_determinism(self):
        tables = dict(publisher.payloads())
        self.assertEqual(len(tables['catalog_work_authors']), 3)
        self.assertEqual(len(tables['catalog_isbns']), 3)
        self.assertEqual([r['work_id'] for r in tables['catalog_ratings']], ['/works/OL1W', '/works/OL2W'])
        for table, rows in tables.items():
            keys = [tuple(r[k] for k in publisher.KEYS[table]) for r in rows]
            self.assertEqual(keys, sorted(set(keys)))
        self.assertEqual({r['edition_id'] for r in tables['catalog_isbns'][:2]}, {'/books/OL1M', '/books/OL2M'})
        by_isbn = {r['isbn13']:r['edition_id'] for r in tables['catalog_isbns']}
        self.assertEqual(by_isbn['9780765326355'], '/books/OL1M')
        self.source['records'].reverse()
        self.source['records'][1]['author_refs'].reverse()
        (self.staging/'source.json').write_text(json.dumps(self.source))
        self.assertEqual(tables, dict(publisher.payloads()))

    def test_conflicting_duplicate_keys_fail_before_upload(self):
        self.source['records'].append({**self.source['records'][0], 'edition_key':'wrong'})
        (self.staging/'source.json').write_text(json.dumps(self.source))
        with self.assertRaisesRegex(ValueError, 'conflicting records'):
            publisher.payloads()

    def test_partial_upload_recovery_manifest_last_and_repeat_skip(self):
        state, calls = {}, []
        fail = True
        def upload(path, data, content='application/json', method='POST', **options):
            nonlocal fail
            calls.append(path)
            if method == 'GET':
                if '/public/book-catalogs/' in path: return self.raw
                table = path.split('/')[3].split('?')[0]
                return json.dumps(list(state.get(table, {}).values())).encode()
            table = path.split('/')[3]
            if table == 'catalog_work_authors' and fail:
                fail = False
                raise publisher.PublicationError('catalog_work_authors batch 1', 503)
            if '/storage/' in path: return b''
            keys = publisher.KEYS.get(table, ('version',))
            for row in json.loads(data): state.setdefault(table,{})[tuple(row[k] for k in keys)] = row
            return b''
        with patch.object(publisher, 'request', side_effect=upload):
            with self.assertRaises(publisher.PublicationError): publisher.publish()
            self.assertNotIn('catalog_manifests', state)
            publisher.publish()
            self.assertEqual(len(state['catalog_work_authors']), 3)
            self.assertEqual(len(state['catalog_editions']), 2)
            self.assertEqual(len(state['catalog_isbns']), 3)
            self.assertEqual(calls[-1], '/rest/v1/catalog_manifests')
            count = len(calls)
            publisher.publish()
            self.assertTrue(all('/public/' in p or '?' in p for p in calls[count:]))
            self.assertEqual(len(state['catalog_ingestion']), 1)

    def test_corrupt_manifest_or_public_object_never_publishes(self):
        with patch.object(publisher, 'request') as request:
            self.manifest['isbns'] = 4
            (self.staging/'manifest.json').write_text(json.dumps(self.manifest))
            with self.assertRaises(AssertionError): publisher.publish()
            request.assert_not_called()
        with patch.object(publisher, 'request', return_value=b'corrupt'):
            with self.assertRaisesRegex(ValueError, 'checksum'): publisher.verify_file('fixture', self.manifest)

    def test_immutable_storage_conflict_requires_matching_bytes(self):
        def upload(path, data, content='application/json', method='POST', **options):
            if method == 'GET': return self.raw if '/public/' in path else b'[]'
            if '/storage/' in path: raise publisher.PublicationError('storage', 409)
            return b''
        with patch.object(publisher, 'request', side_effect=upload): publisher.publish()

    def test_http_retries_constraints_timeouts_and_secret_sanitization(self):
        for status, code, attempts in [(500,'21000',1),(500,'23503',1),(400,'23514',1),
                                       (503,None,3),(429,None,3),(500,'40001',3)]:
            error = lambda: urllib.error.HTTPError('https://private-token',status,'private-token',{},
                                io.BytesIO(json.dumps({'code':code,'message':'private-token','details':'Authorization secret'}).encode()))
            with patch.dict(os.environ, SUPABASE_SERVICE_ROLE_KEY='fixture-private-token'), \
                 patch.object(publisher.urllib.request, 'urlopen', side_effect=lambda *a,**kw: (_ for _ in ()).throw(error())) as opener, \
                 patch.object(publisher.time, 'sleep'):
                with self.assertRaises(publisher.PublicationError) as raised:
                    publisher.request('/rest/v1/catalog_work_authors',b'[]',context='catalog_work_authors batch 2')
                self.assertEqual(opener.call_count, attempts)
                self.assertIn('batch 2',str(raised.exception))
                self.assertNotIn('private-token',str(raised.exception))
                self.assertNotIn('Authorization',str(raised.exception))
                self.assertEqual(opener.call_args.kwargs['timeout'],120)
        with patch.dict(os.environ, SUPABASE_SERVICE_ROLE_KEY='fixture-private-token'), \
             patch.object(publisher.urllib.request, 'urlopen', side_effect=TimeoutError('private-token')) as opener, \
             patch.object(publisher.time, 'sleep'):
            with self.assertRaises(publisher.PublicationError): publisher.request('/rest/v1/test',b'[]')
            self.assertEqual(opener.call_count,3)
            opener.reset_mock()
            with self.assertRaises(publisher.PublicationError): publisher.request('/rest/v1/catalog_ingestion',b'[]',retry=False)
            self.assertEqual(opener.call_count,1)


if __name__ == '__main__': unittest.main()
