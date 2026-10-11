"""Bounded anonymous book-page proof of concept; never uploads or clears worker state.

Targets: JSON list with url, title, authors, isbns (optional), goodreads_work_id
(optional). Output must be inside ignored dist/. No raw HTML/session data is saved.
"""
import argparse
import ctypes
import html
import json
import pathlib
import re
import time
import unicodedata
import urllib.error
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone

UA = 'BookmarkitFeasibility/1.0 (bounded public metadata research)'


def normalize(value):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', html.unescape(value)).lower())


def extract(body, target):
    scripts = re.findall(r'<script([^>]*)>(.*?)</script>', body, re.S)
    cache = None
    ld = None
    for attrs, text in scripts:
        if '__NEXT_DATA__' in attrs:
            cache = json.loads(text)['props']['pageProps']['apolloState']
        if 'application/ld+json' in attrs:
            value = json.loads(text)
            if isinstance(value, dict) and value.get('@type') == 'Book':
                ld = value
    if not cache or not ld:
        raise ValueError('missing book JSON-LD or Apollo metadata')
    bid = re.search(r'/book/show/(\d+)', target['url']).group(1)
    roots = [v for k, v in cache['ROOT_QUERY'].items() if k.startswith('getBookByLegacyId(')]
    if len(roots) != 1:
        raise ValueError('ambiguous root book')
    book = cache[roots[0]['__ref']]
    if str(book.get('legacyId')) != bid:
        raise ValueError('root book ID mismatch')
    work = cache[book['work']['__ref']]
    author = cache[book['primaryContributorEdge']['node']['__ref']]['name']
    isbn = (book.get('details') or {}).get('isbn13')
    expected_titles = [target['title'], target.get('independent_work_title', target['title'])]
    if normalize(book['title']) not in [normalize(t) for t in expected_titles]:
        raise ValueError('title mismatch')
    if normalize(author) not in [normalize(a) for a in target['authors']]:
        raise ValueError('primary author mismatch')
    if target.get('isbns') and isbn not in target['isbns']:
        raise ValueError('ISBN mismatch; edition must be reviewed separately')
    if target.get('goodreads_work_id') and str(work.get('legacyId')) != str(target['goodreads_work_id']):
        raise ValueError('Goodreads work ID mismatch')
    stats = work['stats']
    aggregate = ld['aggregateRating']
    avg, count = stats['averageRating'], stats['ratingsCount']
    if isinstance(avg, bool) or not isinstance(avg, (int, float)) or not 0 <= avg <= 5:
        raise ValueError('invalid average')
    if isinstance(count, bool) or not isinstance(count, int) or count <= 0:
        raise ValueError('invalid count')
    if aggregate.get('ratingValue') != avg or aggregate.get('ratingCount') != count:
        raise ValueError('JSON-LD/Apollo rating disagreement')
    if normalize(ld.get('isbn', '')) != normalize(isbn or ''):
        raise ValueError('JSON-LD/Apollo ISBN disagreement')
    series = []
    for placement in book.get('bookSeries', []):
        item = placement.get('series', {})
        if '__ref' in item:
            item = cache[item['__ref']]
        series.append({'title': item.get('title'), 'position': placement.get('userPosition')})
    return dict(book_id=bid, goodreads_work_id=work.get('legacyId'), url=book['webUrl'],
                catalog_work_id=target.get('work_id'), title=book['title'], author=author,
                isbn13=isbn, average_rating=avg, ratings_count=count, rating_scope='work',
                series=series, match='exact_isbn_title_author' if target.get('isbns') else 'title_author_work_review_required',
                jsonld_agrees=True)


def peak_memory_mib():
    if not hasattr(ctypes, 'windll'):
        return None
    class Memory(ctypes.Structure):
        _fields_ = [('cb', ctypes.c_ulong), ('faults', ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in ['peak_ws', 'ws', 'peak_paged', 'paged', 'peak_nonpaged', 'nonpaged', 'pagefile', 'peak_pagefile']]
    memory = Memory()
    memory.cb = ctypes.sizeof(memory)
    ctypes.windll.kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    ok = ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(memory), memory.cb)
    return round(memory.peak_ws / 1048576, 2) if ok else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--targets', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--limit', type=int, default=3)
    parser.add_argument('--spacing', type=float, default=15)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[1]
    output = pathlib.Path(args.output).resolve()
    if not output.is_relative_to(root / 'dist'):
        parser.error('output must be inside ignored repository dist/')
    if not 1 <= args.limit <= 20 or args.spacing < 15:
        parser.error('limit must be 1..20 and spacing at least 15 seconds')
    targets = json.loads(pathlib.Path(args.targets).read_text(encoding='utf-8'))[:args.limit]
    for target in targets:
        if not re.fullmatch(r'https://www\.goodreads\.com/book/show/\d+(?:[-.][A-Za-z0-9_%.-]+)?', target['url']):
            parser.error('only exact public Goodreads book URLs are allowed')
    rows = []
    output.parent.mkdir(parents=True, exist_ok=True)
    def save():
        output.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding='utf-8')
    def request(url):
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                return response.status, response.headers.get('x-amzn-waf-action'), response.read(4_000_001).decode('utf-8')
        except urllib.error.HTTPError as error:
            return error.code, error.headers.get('x-amzn-waf-action'), ''
    status, action, body = request('https://www.goodreads.com/robots.txt')
    if status != 200 or action:
        rows.append(dict(kind='robots', status=status, blocked=True)); save(); return
    policy = urllib.robotparser.RobotFileParser()
    policy.parse(body.splitlines())
    blocks = 0
    for target in targets:
        if (output.parent / 'PAUSE').exists() or (output.parent / 'STOP').exists():
            break
        deadline = time.monotonic() + args.spacing
        while time.monotonic() < deadline:
            if (output.parent / 'PAUSE').exists() or (output.parent / 'STOP').exists():
                return
            time.sleep(min(1, max(0, deadline - time.monotonic())))
        row = dict(url=target['url'], observed_at=datetime.now(timezone.utc).isoformat())
        started, cpu = time.perf_counter(), time.process_time()
        try:
            if not policy.can_fetch(UA, target['url']):
                raise ValueError('robots denied')
            status, action, body = request(target['url'])
            row['http_status'] = status
            blocked = status in (202, 403, 405, 429) or action in ('challenge', 'captcha') or any(
                marker in body.lower() for marker in ['awswaf', 'verify you are human', 'request blocked'])
            row['blocked'] = blocked
            blocks = blocks + 1 if blocked else 0
            if status == 200 and not blocked:
                row['result'] = extract(body, target)
            else:
                row['error'] = 'access blocked' if blocked else 'unavailable response'
        except (ValueError, KeyError, urllib.error.URLError, TimeoutError) as error:
            row['error'] = str(error)[:150]
        row.update(seconds=round(time.perf_counter() - started, 3), cpu_seconds=round(time.process_time() - cpu, 4), peak_python_mib=peak_memory_mib())
        rows.append(row); save()
        print(json.dumps(row), flush=True)
        if blocks >= 3:
            break


if __name__ == '__main__':
    main()
