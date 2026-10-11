"""Offline synthetic safety, identity and historical boundary tests."""
import contextlib
import copy
import io
import json
import pathlib
import sqlite3
import tempfile
import unittest

from goodreads_phase2 import run
from goodreads_historical import parse_xml, valid_isbn, reconcile, import_dry_run, prototype_record
from test_research_goodreads import ResearchParserTests


XML = b'''<GoodreadsResponse><book><id>1</id><title>Example</title>
<isbn13>9780439023481</isbn13><url>https://www.goodreads.com/book/show/1</url>
<authors><author><name>Example Author</name><role/></author></authors>
<average_rating>4.50</average_rating><ratings_count>20</ratings_count>
<work><id>2</id><original_title>Example</original_title><ratings_count>100</ratings_count>
<ratings_sum>450</ratings_sum><rating_dist>5:50|4:50|3:0|2:0|1:0|total:100</rating_dist></work>
</book></GoodreadsResponse>'''


class RunnerTests(unittest.TestCase):
    def targets(self, n):
        return [dict(url='https://www.goodreads.com/book/show/'+str(i+1),title='Example',
                     authors=['Example Author'],isbns=['9780439023481'],provenance={'kind':'synthetic'}) for i in range(n)]

    def test_three_blocks_durable_resume_no_retry(self):
        calls=[]
        def fetch(url):
            calls.append(url)
            return (200,None,'User-agent: *\nAllow: /') if url.endswith('robots.txt') else (202,'challenge','')
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            output=pathlib.Path(directory)/'result.json'
            report=run(self.targets(5),output,fetch=fetch,sleep=lambda _:None)
            self.assertEqual((report['attempted'],report['blocks'],report['status']),(3,3,'access_circuit_open'))
            run(self.targets(5),output,fetch=fetch,sleep=lambda _:None)
            self.assertEqual(len(calls),4)

    def test_pause_and_interrupted_checkpoint_never_refetch(self):
        with tempfile.TemporaryDirectory() as directory:
            output=pathlib.Path(directory)/'result.json'
            pause=output.parent/'PAUSE'; pause.touch()
            calls=[]
            def fetch(url):
                calls.append(url)
                return 200,None,'User-agent: *\nAllow: /'
            run(self.targets(2),output,fetch=fetch,sleep=lambda _:None)
            self.assertEqual(calls,[])
            pause.unlink()
            report=json.loads(output.read_text()); report['rows']=[dict(url=self.targets(2)[0]['url'],error='interrupted_request_outcome_unknown')]
            output.write_text(json.dumps(report))
            with contextlib.redirect_stdout(io.StringIO()):
                run(self.targets(2),output,fetch=fetch,sleep=lambda _:None)
            self.assertNotIn(self.targets(2)[0]['url'],calls)
            with self.assertRaises(ValueError):
                run(self.targets(3),output,fetch=fetch,sleep=lambda _:None)

    def test_exact_live_extraction_and_conservative_spacing(self):
        fixture=ResearchParserTests(); fixture.setUp()
        target=dict(fixture.target,provenance={'kind':'synthetic'})
        waits=[]
        def fetch(url):
            return (200,None,'User-agent: *\nAllow: /') if url.endswith('robots.txt') else (200,None,fixture.body())
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            report=run([target],pathlib.Path(directory)/'result.json',fetch=fetch,sleep=waits.append)
        self.assertEqual(sum(waits),15)
        self.assertEqual(report['verified'],1)
        self.assertEqual(report['rows'][0]['result']['rating_scope'],'work')


class HistoricalTests(unittest.TestCase):
    def setUp(self):
        self.record=parse_xml(XML)
        self.catalog=[dict(work_id='/works/OL1W',isbn13='9780439023481',title='Example',authors=['Example Author'])]

    def test_original_isbn_and_work_population_not_book_count(self):
        self.assertEqual(self.record['isbn13'],'9780439023481')
        self.assertTrue(self.record['work_average_agrees'])
        self.assertEqual(self.record['book_rating_count'],20)
        self.assertEqual(self.record['work_rating_count'],100)
        self.assertFalse(valid_isbn('9.78043902348e+12'))
        self.assertFalse(valid_isbn('9780439023482'))
        record=parse_xml(XML.replace(b'<ratings_sum>450',b'<ratings_sum>451'))
        self.assertFalse(record['work_average_agrees'])

    def test_missing_author_wrong_edition_and_conflicting_duplicate_rejected(self):
        results,_=reconcile(self.catalog,[self.record])
        self.assertEqual(results[0]['match'],'exact_isbn_compatible_identity')
        for authors in ([],['Other Author']):
            bad=[dict(self.catalog[0],authors=authors)]
            results,_=reconcile(bad,[self.record])
            self.assertNotIn('record',results[0])
        conflicting=dict(self.record,goodreads_work_id='99')
        results,duplicates=reconcile(self.catalog,[self.record,conflicting])
        self.assertEqual(duplicates,['1'])
        self.assertEqual(results[0]['match'],'conflict')
        different=dict(self.record,book_id='9',goodreads_work_id='99')
        results,_=reconcile(self.catalog,[self.record,different])
        self.assertEqual(results[0]['match'],'conflict')

    def test_work_mapping_requires_independent_evidence_not_title_similarity(self):
        catalog=[dict(self.catalog[0],isbn13='9780765326355')]
        mapping=dict(catalog_work_id='/works/OL1W',goodreads_book_id='1',goodreads_work_id='2',verified=True,evidence_url='https://openlibrary.org/books/OL1M.json')
        results,_=reconcile(catalog,[self.record],[mapping])
        self.assertEqual(results[0]['match'],'independent_work_mapping')
        results,_=reconcile(catalog,[self.record],[dict(mapping,verified=False)])
        self.assertEqual(results[0]['match'],'title_author_candidate')

    def test_dry_run_counts_idempotency_conflict_and_historical_isolation(self):
        results,_=reconcile(self.catalog,[self.record])
        prototype=prototype_record(results[0],'synthetic-hash')
        self.assertIsNone(prototype['exact_retrieval_time'])
        self.assertFalse(prototype['production_eligible'])
        self.assertEqual(prototype['snapshot_era'],'2017')
        with sqlite3.connect(':memory:') as db:
            self.assertEqual(import_dry_run(db,[prototype]),dict(inserted=1,unchanged=0,conflicts=0))
            self.assertEqual(import_dry_run(db,[prototype]),dict(inserted=0,unchanged=1,conflicts=0))
            self.assertEqual(import_dry_run(db,[dict(prototype,rating_count=101)]),dict(inserted=0,unchanged=0,conflicts=1))
            self.assertEqual(json.loads(db.execute('SELECT payload FROM historical_quarantine').fetchone()[0])['rating_count'],100)


if __name__=='__main__':
    unittest.main()
