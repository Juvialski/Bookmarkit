import gzip,json,sqlite3,tempfile,unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from smart_catalog import preserve,resolve_authors,popular_targets,select_popular
from catalog import build

class SmartTests(unittest.TestCase):
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

if __name__=='__main__':unittest.main()
