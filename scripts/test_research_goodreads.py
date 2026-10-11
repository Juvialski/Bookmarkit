"""Offline, synthetic checks of the research parser's acceptance boundaries."""
import json
import unittest
import contextlib
import io
import pathlib
import tempfile
from unittest.mock import patch
from research_goodreads import main
from research_goodreads import extract


class ResearchParserTests(unittest.TestCase):
    def setUp(self):
        self.target = {'url': 'https://www.goodreads.com/book/show/1', 'title': 'Example',
                       'authors': ['Example Author'], 'isbns': ['9780439023481'], 'goodreads_work_id': '2'}
        self.cache = {
            'ROOT_QUERY': {'getBookByLegacyId({"legacyId":"1"})': {'__ref': 'Book:1'}},
            'Book:1': {'legacyId': 1, 'title': 'Example', 'webUrl': self.target['url'],
                       'details': {'isbn13': '9780439023481'}, 'work': {'__ref': 'Work:2'},
                       'primaryContributorEdge': {'node': {'__ref': 'Author:3'}}},
            'Author:3': {'name': 'Example Author'},
            'Work:2': {'legacyId': 2, 'stats': {'averageRating': 4.5, 'ratingsCount': 100}}}
        self.ld = {'@type': 'Book', 'isbn': '9780439023481',
                   'aggregateRating': {'ratingValue': 4.5, 'ratingCount': 100, 'reviewCount': 20}}

    def body(self):
        return '<script id="__NEXT_DATA__">' + json.dumps({'props': {'pageProps': {'apolloState': self.cache}}}) + \
               '</script><script type="application/ld+json">' + json.dumps(self.ld) + '</script>'

    def test_count_uses_ratings_not_reviews_and_scope_is_work(self):
        record = extract(self.body(), self.target)
        self.assertEqual(record['ratings_count'], 100)
        self.assertEqual(record['rating_scope'], 'work')

    def test_rejects_wrong_isbn_author_work_book_and_url(self):
        changes = [('Book:1', 'legacyId', 999), ('Author:3', 'name', 'Other Author'),
                   ('Work:2', 'legacyId', 999), ('Book:1', 'webUrl', 'https://example.com')]
        for key, field, value in changes:
            with self.subTest(field=field):
                old = self.cache[key][field]; self.cache[key][field] = value
                with self.assertRaises(ValueError): extract(self.body(), self.target)
                self.cache[key][field] = old
        self.target['isbns'] = ['9780765326355']
        with self.assertRaises(ValueError): extract(self.body(), self.target)

    def test_rejects_disagreement_and_missing_metadata(self):
        self.ld['aggregateRating']['ratingCount'] = 101
        with self.assertRaises(ValueError): extract(self.body(), self.target)
        with self.assertRaises(ValueError): extract('<html>Challenge</html>', self.target)

    def test_pause_and_stop_prevent_even_robots_request(self):
        research = pathlib.Path(__file__).resolve().parents[1] / 'dist'
        research.mkdir(exist_ok=True)
        for control in ['PAUSE', 'STOP']:
            with tempfile.TemporaryDirectory(dir=research) as directory:
                folder = pathlib.Path(directory)
                (folder / control).touch()
                (folder / 'targets.json').write_text(json.dumps([self.target]))
                args = ['probe', '--targets', str(folder / 'targets.json'), '--output', str(folder / 'out.json')]
                with patch('sys.argv', args), patch('urllib.request.urlopen') as request:
                    main()
                    request.assert_not_called()

    def test_three_consecutive_blocks_stop_without_a_fourth_book(self):
        research = pathlib.Path(__file__).resolve().parents[1] / 'dist'
        research.mkdir(exist_ok=True)
        class Response:
            status = 200
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return b'User-agent: *\nAllow: /'
        class Block(Response):
            status = 202
            headers = {'x-amzn-waf-action': 'challenge'}
            def read(self, limit): return b''
        with tempfile.TemporaryDirectory(dir=research) as directory:
            folder = pathlib.Path(directory)
            (folder / 'targets.json').write_text(json.dumps([self.target] * 4))
            args = ['probe', '--targets', str(folder / 'targets.json'), '--output', str(folder / 'out.json'), '--limit', '4']
            with patch('sys.argv', args), patch('urllib.request.urlopen', side_effect=[Response(), Block(), Block(), Block()]) as request, \
                 patch('time.monotonic', side_effect=range(0, 2000, 20)), patch('time.sleep'), contextlib.redirect_stdout(io.StringIO()):
                main()
            self.assertEqual(request.call_count, 4)
            self.assertEqual(len(json.loads((folder / 'out.json').read_text())), 3)


if __name__ == '__main__':
    unittest.main()
