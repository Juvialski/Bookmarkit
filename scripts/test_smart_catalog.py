import gzip,json,sqlite3,tempfile,unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from smart_catalog import preserve,resolve_authors,popular_targets,select_popular,reviewed_metadata
from catalog import build
from bulk_cache import download
from catalog_audit import summarize

class SmartTests(unittest.TestCase):
 def test_reviewed_standalone_and_planned_sequel_are_independent_of_ratings(self):
  records={'t':dict(title='Tress of the Emerald Sea',author_name=['Brandon Sanderson'],series_status='series',series_name="Hoid's Travails",ratings_average=4.2),
   'w':dict(title='Warbreaker',author_name=['Brandon Sanderson'],series_status='series'),
   'other':dict(title='Warbreaker',author_name=['Other Writer'],series_status='series')}
  reviewed_metadata(records)
  self.assertEqual(records['t']['series_status'],'standalone');self.assertEqual(records['t']['ratings_average'],4.2)
  self.assertEqual(records['w']['series_status'],'unknown');self.assertTrue(records['w']['planned_sequel'])
  self.assertEqual(records['other']['series_status'],'series')
 def test_preserve_all_editions_names_and_classification(self):
  data={'catalog_works':[dict(id='/works/OL1W',title='Known',authors=['Verified Writer'],series_status='unknown',series_name=None,series_position=None,classification_source='unknown',source='open-library',source_updated='2026-10-01')],
   'catalog_editions':[dict(id='/books/OL1M',work_id='/works/OL1W'),dict(id='/books/OL2M',work_id='/works/OL1W')],
   'catalog_isbns':[dict(isbn13='9780140328721',edition_id='/books/OL1M'),dict(isbn13='9780765326355',edition_id='/books/OL2M')],'catalog_ratings':[]}
  records=preserve(data,[dict(key='/works/OL1W',author_name=[],author_refs=['/authors/OL1A'])])
  self.assertEqual(records['/works/OL1W']['author_name'],['Verified Writer'])
  self.assertEqual(len(set(records['/works/OL1W']['isbn_editions'].values())),2)
  with tempfile.TemporaryDirectory() as folder:
   staging=Path(folder)
   with patch('smart_catalog.download',side_effect=TimeoutError()):resolve_authors(records,staging)
   self.assertEqual(records['/works/OL1W']['author_name'],['Verified Writer'])

 def test_author_resume_and_incomplete_preservation(self):
  with tempfile.TemporaryDirectory() as folder:
   staging=Path(folder);(staging/'bulk').mkdir();path=staging/'bulk/authors.gz'
   (staging/'bulk/authors.json').write_text('{}')
   with gzip.open(path,'wt',encoding='utf-8') as stream:
    for i in [1,2]:stream.write('/type/author\t/authors/OL'+str(i)+'A\t1\t2026\t'+json.dumps({'name':'Writer '+str(i)})+'\n')
   records={'x':dict(author_refs=['/authors/OL1A','/authors/OL2A'],author_name=['Previously Correct'])}
   with patch('smart_catalog.download',return_value=path):
    resolve_authors(records,staging)
    self.assertEqual(records['x']['author_name'],['Writer 1','Writer 2'])
    resolve_authors(records,staging)
    self.assertEqual(records['x']['author_name'],['Writer 1','Writer 2'])

 def test_popular_rank_never_chooses_wrong_identity_and_checkpoint_is_idempotent(self):
  with tempfile.TemporaryDirectory() as folder:
   staging=Path(folder);path=staging/'ratings.gz';(staging/'ratings.json').write_text('{}')
   with gzip.open(path,'wt',encoding='utf-8') as stream:
    stream.write('OL2W\tOL2M\t5\t2026-10-01\nOL2W\tOL2M\t3\t2026-10-01\nOL1W\tOL1M\t4\t2026-10-01\n')
   targets,_=popular_targets(path,1);self.assertEqual(targets,{'/works/OL2W':(4.0,2)})
   self.assertEqual(popular_targets(path,1)[0],targets)
   editions=staging/'editions.gz';(staging/'editions.json').write_text('{}')
   with gzip.open(editions,'wt',encoding='utf-8') as stream:
    for i,isbn in [(1,'9780140328721'),(2,'9780765326355')]:
     stream.write('edition\t/books/OL'+str(i)+'M\t1\t2026\t'+json.dumps(dict(key=f'/books/OL{i}M',title=f'Book {i}',works=[{'key':f'/works/OL{i}W'}],isbn_13=[isbn],authors=[{'key':'/authors/OL1A'}]))+'\n')
   records={};select_popular(records,targets,editions,staging);select_popular(records,targets,editions,staging)
   self.assertEqual(list(records),['/works/OL2W']);self.assertEqual(records['/works/OL2W']['isbn_editions'],{'9780765326355':'/books/OL2M'})

 def test_work_only_and_exact_edition_goodreads_link(self):
  with tempfile.TemporaryDirectory() as folder:
   source=Path(folder)/'source.json';output=Path(folder)/'snapshot.db'
   source.write_text(json.dumps(dict(version='test',generated_date='2026-10-12',source='fixture',records=[
    dict(key='hardcover:123',title='No ISBN',author_name=['Author'],isbn=[]),
    dict(key='/works/OL1W',title='Edition',author_name=['Author'],isbn=['9780140328721'],edition_key='/books/OL1M',goodreads_ids={'9780140328721':['123']})])))
   build(source,output)
   with closing(sqlite3.connect(output)) as db:
    self.assertEqual(db.execute('select count(*) from works').fetchone()[0],2)
    self.assertEqual(db.execute('select count(*) from books').fetchone()[0],1)
    self.assertEqual(db.execute('select goodreads_url from books').fetchone()[0],'https://www.goodreads.com/book/show/123')
    self.assertEqual(db.execute('pragma integrity_check').fetchone()[0],'ok')

 def test_dump_mirror_change_retains_byte_checkpoint_and_validates_gzip(self):
  with tempfile.TemporaryDirectory() as folder:
   staging=Path(folder);raw=gzip.compress(b'complete official fixture\n');offset=10
   (staging/'authors.part').write_bytes(raw[:offset])
   (staging/'authors.json').write_text(json.dumps(dict(url='https://mirror-one.example/dump.gz',etag='same',modified='date',bytes=len(raw))))
   class Response:
    def __init__(self,head):self.head=head;self.status=200 if head else 206;self.url='https://mirror-two.example/dump.gz';self.position=offset;self.headers={'ETag':'same','Last-Modified':'date','Content-Length':str(len(raw)),'Content-Range':f'bytes {offset}-{len(raw)-1}/{len(raw)}'}
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read1(self,size):chunk=raw[self.position:self.position+size];self.position+=len(chunk);return chunk
   with patch('bulk_cache.urllib.request.urlopen',side_effect=[Response(True),Response(False)]):path=download('authors',staging)
   self.assertEqual(path.read_bytes(),raw)

 def test_coverage_title_normalization_matches_actual_snapshot_index(self):
  with tempfile.TemporaryDirectory() as folder:
   source=Path(folder)/'source.json';output=Path(folder)/'catalog.db'
   source.write_text(json.dumps(dict(version='test',generated_date='2026-10-12',source='fixture',records=[dict(key='/works/OL1W',title='The Common Title',author_name=['An Author'],isbn=['9780140328721'])])))
   build(source,output)
   data={'catalog_works':[dict(id='/works/OL1W',title='The Common Title',authors=['An Author'],series_status='unknown',source='open-library')],
    'catalog_editions':[dict(id='/books/OL1M',work_id='/works/OL1W')],'catalog_isbns':[dict(isbn13='9780140328721',edition_id='/books/OL1M')],'catalog_ratings':[],'hardcover_cache':[]}
   with patch('catalog_audit.cohort',return_value=[dict(title='The Common Title',author='An Author',isbn='9780140328721')]):report=summarize(data,output)
   self.assertTrue(report['cohort'][0]['offline_title_author']);self.assertTrue(report['cohort'][0]['shared_isbn'])

if __name__=='__main__':unittest.main()
