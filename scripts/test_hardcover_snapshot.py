import unittest,json,sqlite3,tempfile,pathlib
from unittest.mock import patch
from hardcover_snapshot import attach,cached_summaries
from goodreads_worker import ClosingConnection

class SnapshotTests(unittest.TestCase):
 def test_optional_column_attribution_identity_and_private_fields(self):
  with tempfile.TemporaryDirectory() as folder:
   path=pathlib.Path(folder)/'catalog.db'
   with sqlite3.connect(path,factory=ClosingConnection) as db:
    db.execute('create table books(isbn13 text,work_id text,goodreads_json text)')
    db.execute('insert into books values(?,?,?)',('9780765326355','/works/OL1W','protected-goodreads'))
   payload={'found':True,'title':'Fixture','authors':['Writer'],'hardcoverId':'123','rating':4.56,'ratingsCount':18432,'ratingScope':'work','verified':True,'coverUrl':'https://private-images.example','secret':'never-copy'}
   attach(path,[{'ol_work_id':'/works/OL1W','payload':payload}])
   with sqlite3.connect(path,factory=ClosingConnection) as db:
    row=db.execute('select goodreads_json,hardcover_json from books').fetchone()
    self.assertEqual(row[0],'protected-goodreads')
    record=json.loads(row[1])[0]
    self.assertEqual(record['ratingScope'],'work');self.assertEqual(record['ratingsCount'],18432)
    self.assertNotIn('coverUrl',record);self.assertNotIn('secret',record)
   attach(path,[{'ol_work_id':'/works/OL1W','payload':dict(payload,ratingsCount=0)}])
   with sqlite3.connect(path,factory=ClosingConnection) as db: self.assertEqual(db.execute('select hardcover_json from books').fetchone()[0],row[1])
 def test_outage_returns_no_optional_metadata(self):
  with patch('urllib.request.urlopen',side_effect=OSError('offline')):
   self.assertEqual(cached_summaries(),[])

if __name__=='__main__':unittest.main()
