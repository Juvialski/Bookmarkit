"""Offline original-XML coverage audit. Quarantined dry run; no live ingestion."""
import argparse
import hashlib
import html
import json
import pathlib
import re
import sqlite3
import time
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict, Counter
from decimal import Decimal, ROUND_HALF_UP

SOURCE_COMMIT = '6dd165b555a7b47b2dd36743a425776e641ff50c'
SOURCE_HASH = 'f9724dddfbd4d744e97977c4d631684b2aa238739893749ffc66b7cb8f5f3a66'


def normalize(value):
    # Preserve letters in every script: ASCII-only stripping collapses unrelated
    # Arabic/Cyrillic/etc. identities to the same empty string.
    value=unicodedata.normalize('NFKD',html.unescape(value)).casefold()
    return ''.join(character for character in value if character.isalnum())


def valid_isbn(value):
    # Original strings only; no floating point/scientific-notation recovery.
    return bool(re.fullmatch(r'97[89]\d{10}', value or '') and
                sum(int(c)*(1 if i%2 == 0 else 3) for i,c in enumerate(value))%10 == 0)


def parse_xml(raw):
    book = ET.fromstring(raw).find('book')
    if book is None:
        raise ValueError('missing book')
    def text(path):
        return (book.findtext(path) or '').strip()
    def number(path):
        value = text(path)
        return int(value) if value.isdigit() else None
    authors = [a.findtext('name') for a in book.findall('authors/author')
               if not (a.findtext('role') or '').strip() and a.findtext('name')]
    dist = dict(re.findall(r'(5|4|3|2|1|total):(\d+)', text('work/rating_dist')))
    count, total = number('work/ratings_count'), number('work/ratings_sum')
    average = text('average_rating')
    try:
        avg = Decimal(average)
    except Exception:
        avg = Decimal('-1')
    distribution_agrees = (set(dist) == {'1','2','3','4','5','total'} and count and total and
        sum(int(dist[str(n)]) for n in range(1,6)) == count == int(dist['total']) and
        sum(n*int(dist[str(n)]) for n in range(1,6)) == total)
    work_average_agrees = bool(distribution_agrees and avg.is_finite() and 0 <= avg <= 5 and
        (Decimal(total)/Decimal(count)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP) == avg)
    bid, wid = text('id'), text('work/id')
    url = text('url')
    identity_valid = bool(bid.isdigit() and wid.isdigit() and authors and text('title') and
        re.fullmatch(r'https://www\.goodreads\.com/book/show/'+bid+r'(?:[-.][A-Za-z0-9_%.-]+)?', url))
    return dict(book_id=bid, goodreads_work_id=wid, title=text('title'),
        original_title=text('work/original_title'), authors=authors, isbn13=text('isbn13'),
        isbn_valid=valid_isbn(text('isbn13')), url=url, average_rating=float(avg) if avg.is_finite() else None,
        book_rating_count=number('ratings_count'), work_rating_count=count,
        work_ratings_sum=total, work_average_agrees=work_average_agrees,
        rating_scope='work' if work_average_agrees else 'unproven', identity_valid=identity_valid,
        publication_year=number('work/original_publication_year'),
        shelves=[s.get('name') for s in book.findall('popular_shelves/shelf')])


def load_xml(path, verify=True):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if verify and digest != SOURCE_HASH:
        raise ValueError('original XML archive hash differs from audited source')
    with zipfile.ZipFile(path) as archive:
        records = [parse_xml(archive.read(name)) for name in sorted(archive.namelist()) if name.endswith('.xml')]
    return records, digest


def titles(record):
    # Only remove a trailing, explicitly numbered series marker; no fuzzy matching.
    values = [record['title'], record.get('original_title', '')]
    values.append(re.sub(r'\s*\([^()]*,\s*#\d[^()]*\)\s*$', '', record['title']))
    return {normalize(t) for t in values if normalize(t)}


def compatible(row, record):
    return normalize(row['title']) in titles(record) and bool(
        {normalize(a) for a in row['authors'] if normalize(a)} &
        {normalize(a) for a in record['authors'] if normalize(a)})


def reconcile(catalog, records, mappings=()):
    isbn_index, title_index, id_index = defaultdict(list), defaultdict(list), defaultdict(list)
    for record in records:
        id_index[record['book_id']].append(record)
        if record['isbn_valid']:
            isbn_index[record['isbn13']].append(record)
        for title in titles(record):
            title_index[title].append(record)
    # Conflicting duplicates are never silently resolved by ordering.
    duplicate_conflicts = {bid for bid, rows in id_index.items() if len({
        json.dumps({k:r[k] for k in ('title','authors','isbn13','goodreads_work_id','average_rating','work_rating_count')},
                   sort_keys=True) for r in rows}) > 1}
    independent = defaultdict(list)
    contrary = defaultdict(list)
    for mapping in mappings:
        if mapping.get('verified') and mapping.get('evidence_url'):
            independent[mapping['catalog_work_id']].append(mapping)
        elif mapping.get('evidence_url') and (mapping.get('work_link_agrees') is False or mapping.get('author_agrees') is False):
            contrary[mapping['catalog_work_id']].append(mapping)
    grouped = defaultdict(list)
    for row in catalog:
        grouped[row['work_id']].append(row)
    results = []
    for work_id, editions in sorted(grouped.items()):
        exact, rejected, unresolved = {}, [], []
        for row in editions:
            for record in isbn_index[row['isbn13']]:
                trusted = any(m.get('isbn13') == row['isbn13'] and m.get('catalog_title') == row['title'] and
                    str(m.get('goodreads_book_id')) == record['book_id'] and
                    str(m.get('goodreads_work_id')) == record['goodreads_work_id']
                    for m in independent[work_id])
                known_conflict = any(m.get('isbn13') == row['isbn13'] and
                    str(m.get('goodreads_book_id')) == record['book_id'] for m in contrary[work_id])
                if record['book_id'] in duplicate_conflicts or not record['identity_valid'] or known_conflict:
                    rejected.append(record['book_id'])
                elif compatible(row,record) or trusted:
                    exact[record['book_id']] = (record, row['isbn13'])
                elif not row['authors']:
                    unresolved.append(record['book_id'])
                else:
                    rejected.append(record['book_id'])
        work_ids = {r['goodreads_work_id'] for r,_ in exact.values()}
        if len(work_ids) == 1 and not rejected:
            # Multiple editions of the SAME work are allowed as work metadata,
            # but individual ISBN mappings stay edition-specific.
            record, isbn = sorted(exact.values(), key=lambda item:item[0]['book_id'])[0]
            result = dict(work_id=work_id, match='exact_isbn_compatible_identity', isbn13=isbn, record=record)
        elif exact or rejected:
            result = dict(work_id=work_id, match='conflict', conflicting_book_ids=sorted(set(rejected)|set(exact)))
        elif unresolved:
            result = dict(work_id=work_id, match='unvalidated_isbn_identity', candidates=sorted(set(unresolved)))
        else:
            mapped = {}
            for mapping in independent[work_id]:
                for record in records:
                    if (record['book_id'] == str(mapping.get('goodreads_book_id')) and
                        record['goodreads_work_id'] == str(mapping.get('goodreads_work_id')) and
                        record['identity_valid'] and record['book_id'] not in duplicate_conflicts and
                        any(compatible(row,record) for row in editions)):
                        mapped[record['book_id']] = record
            if len(mapped) == 1:
                result = dict(work_id=work_id, match='independent_work_mapping', isbn13=None, record=next(iter(mapped.values())))
            elif mapped:
                result = dict(work_id=work_id, match='ambiguous_candidate', candidates=sorted(mapped))
            else:
                candidates = {record['book_id']:record for row in editions
                    for record in title_index[normalize(row['title'])] if compatible(row,record) and
                    record['identity_valid'] and record['book_id'] not in duplicate_conflicts}
                title_only = {record['book_id'] for row in editions if not row['authors']
                              for record in title_index[normalize(row['title'])]}
                result = dict(work_id=work_id, match='title_author_candidate' if len(candidates)==1 else
                    'ambiguous_candidate' if candidates else 'title_only_unvalidated' if title_only else 'unmatched',
                    candidates=sorted(candidates or title_only))
        results.append(result)
    # Exact matches can ALSO have independent corroboration; report separately.
    for result in results:
        r = result.get('record')
        result['independently_validated'] = bool(r and any(
            str(m.get('goodreads_book_id')) == r['book_id'] and
            str(m.get('goodreads_work_id')) == r['goodreads_work_id']
            for m in independent[result['work_id']]))
    reverse = defaultdict(list)
    for result in results:
        if result.get('record'):
            reverse[result['record']['goodreads_work_id']].append(result)
    for matches in reverse.values():
        if len(matches) > 1:
            for result in matches:
                result.update(match='ambiguous_work_mapping', candidates=[result.pop('record')['book_id']],
                              independently_validated=False)
    return results, sorted(duplicate_conflicts)


def prototype_record(result, digest):
    record = result['record']
    return dict(goodreads_book_id=record['book_id'], goodreads_work_id=record['goodreads_work_id'],
        catalog_work_id=result['work_id'], catalog_isbn13=result['isbn13'],
        average_rating=record['average_rating'], rating_count=record['work_rating_count'], rating_scope='work',
        snapshot_era='2017', exact_retrieval_time=None, historical=True,
        source='zygmuntz/goodbooks-10k original XML@'+SOURCE_COMMIT, source_sha256=digest,
        match_confidence=result['match'], production_eligible=False,
        quarantine_reason='underlying Goodreads reuse permission unresolved', source_url=record['url'])


def import_dry_run(db, records):
    # This database is a SEPARATE ignored scratch artifact, never a catalog copy.
    db.execute('CREATE TABLE IF NOT EXISTS historical_quarantine (catalog_work_id TEXT PRIMARY KEY, goodreads_book_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL)')
    counts = Counter(inserted=0, unchanged=0, conflicts=0)
    for record in records:
        payload = json.dumps(record,sort_keys=True,separators=(',',':'))
        previous = db.execute('SELECT payload FROM historical_quarantine WHERE catalog_work_id=?', (record['catalog_work_id'],)).fetchone()
        if previous:
            counts['unchanged' if previous[0] == payload else 'conflicts'] += 1
        else:
            try:
                db.execute('INSERT INTO historical_quarantine VALUES (?,?,?)',
                    (record['catalog_work_id'],record['goodreads_book_id'],payload))
                counts['inserted'] += 1
            except sqlite3.IntegrityError:
                counts['conflicts'] += 1
    db.commit()
    return dict(counts)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--xml',required=True)
    parser.add_argument('--catalog',default='catalog/packages/expanded.db')
    parser.add_argument('--mappings')
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    output=pathlib.Path(args.output).resolve()
    if not output.is_relative_to(pathlib.Path(__file__).resolve().parents[1]/'dist'):
        parser.error('output must be under ignored dist/')
    output.mkdir(parents=True,exist_ok=True)
    start=time.perf_counter()
    records,digest=load_xml(pathlib.Path(args.xml))
    catalog_path=pathlib.Path(args.catalog).resolve()
    catalog_hash=hashlib.sha256(catalog_path.read_bytes()).hexdigest()
    with sqlite3.connect(catalog_path.as_uri()+'?mode=ro',uri=True) as db:
        db.row_factory=sqlite3.Row
        catalog=[dict(row) for row in db.execute('SELECT isbn13,title,authors,work_id FROM books')]
        for row in catalog:
            row['authors']=json.loads(row['authors'])
        works=db.execute('SELECT count(*) FROM works').fetchone()[0]
    mappings=json.loads(pathlib.Path(args.mappings).read_text(encoding='utf-8')) if args.mappings else []
    results,duplicates=reconcile(catalog,records,mappings)
    usable=[r for r in results if r.get('record',{}).get('work_average_agrees')]
    prototype=[prototype_record(r,digest) for r in usable]
    (output/'matches.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    (output/'prototype.json').write_text(json.dumps(prototype,indent=2),encoding='utf-8')
    scratch=output/'historical-quarantine.sqlite'
    if scratch.exists():
        parser.error('use a fresh output directory for reproducible storage measurement')
    with sqlite3.connect(scratch) as db:
        db.execute('CREATE TABLE IF NOT EXISTS historical_quarantine (catalog_work_id TEXT PRIMARY KEY, goodreads_book_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL)')
        db.commit()
        empty_size=scratch.stat().st_size
        first=import_dry_run(db,prototype)
        second=import_dry_run(db,prototype)
        altered=[dict(prototype[0],rating_count=prototype[0]['rating_count']+1)] if prototype else []
        conflict=import_dry_run(db,altered)
    counts=dict(Counter(r['match'] for r in results))
    report=dict(catalog_works=works,catalog_isbns=len(catalog),compared_works=len(results),
        catalog_sha256=catalog_hash,source_commit=SOURCE_COMMIT,source_sha256=digest,source_records=len(records),
        valid_xml_isbn13=sum(r['isbn_valid'] for r in records),invalid_or_missing_isbn13=sum(not r['isbn_valid'] for r in records),
        work_average_count_distribution_agreement=sum(r['work_average_agrees'] for r in records),
        book_and_work_counts_differ=sum(r['book_rating_count'] != r['work_rating_count'] for r in records),
        duplicate_conflicting_book_ids=duplicates,match_counts=counts,
        independently_validated_matches=sum(r['independently_validated'] for r in results),
        mathematically_usable_matched_pairs=len(usable),production_safe_ratings=0,
        metadata_coverage_percent=round(100*sum(r.get('record') is not None for r in results)/works,4),
        snapshot_era='2017',exact_retrieval_time=None,reuse_permission='unresolved; quarantined',
        dry_run_first=first,dry_run_second=second,dry_run_conflict=conflict,
        compact_payload_bytes=sum(len(json.dumps(r,sort_keys=True,separators=(',',':')).encode()) for r in prototype),
        sqlite_quarantine_bytes=scratch.stat().st_size,sqlite_empty_schema_bytes=empty_size,
        sqlite_data_page_growth_bytes=scratch.stat().st_size-empty_size,
        estimated_separate_offline_database_increase_bytes=scratch.stat().st_size,
        estimated_catalog_growth_percent=round(100*scratch.stat().st_size/catalog_path.stat().st_size,4),
        offline_wall_seconds=round(time.perf_counter()-start,3))
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
