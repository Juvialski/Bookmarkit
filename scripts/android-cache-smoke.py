"""Native persistent-cache acceptance; live providers and actual release SQLite."""
import sqlite3
from pathlib import Path
exec(compile(Path('scripts/android-result-smoke.py').read_text('utf-8').split('original_font =')[0], 'result-helpers', 'exec'))
out = Path('dist/android-cache'); out.mkdir(parents=True, exist_ok=True)
report = {'result': 'running', 'offline_records': 0, 'latency_scope': 'Lookup button tap to title; includes accessibility polling, excludes typing'}
isbn, title = '9780593321201', 'Tomorrow, and Tomorrow, and Tomorrow'
try:
    with sqlite3.connect('assets/catalog-v3.db') as db:
        assert not db.execute('SELECT 1 FROM books WHERE isbn13=?', (isbn,)).fetchone()
        assert not db.execute("SELECT 1 FROM books WHERE title='Intermezzo'").fetchone()
    network(True); launch()
    start = time.monotonic(); lookup(isbn, title, 'new-online-initial')
    report['initial_lookup_seconds'] = round(lookup_latency, 3)
    root = description('out of 5 stars', name='new-online-rated')
    label = rating_evidence(root); report['online_rating'] = label
    # Let bounded progressive enrichment finish before comparing persisted values.
    time.sleep(8); root = screen('online-enriched'); label = rating_evidence(root)
    report['enriched_rating'] = label
    network(False); launch()
    start = time.monotonic(); lookup(isbn, title, 'restart-offline')
    description(label, name='restart-offline-rated')
    report['offline_lookup_seconds'] = round(lookup_latency, 3)
    report['offline_records'] += 1
    network(True); launch(); lookup('Intermezzo Sally Rooney', 'Intermezzo', 'no-isbn-online')
    book_result('Intermezzo', 'no-isbn-selected'); time.sleep(8)
    root = screen('no-isbn-enriched')
    assert not any(t.startswith('ISBN ') for t in texts(root)), texts(root)
    label2 = rating_evidence(root)
    network(False); launch(); lookup('Intermezzo Sally Rooney', 'Intermezzo', 'no-isbn-offline')
    book_result('Intermezzo', 'no-isbn-offline-selected'); description(label2)
    report['offline_records'] += 1
    # Same-version install with -r verifies personal cache survives APK replacement.
    # The preceding native-cover job separately verifies v1.2.0 -> this version.
    adb('install', '-r', str(Path(args.apk).resolve())); launch()
    lookup(isbn, title, 'reinstall-offline'); description(label)
    report['apk_replacement_persistence'] = 'passed'
    network(True); launch(); tap('Offline books'); wait('Download'); tap('Download')
    wait('Delete expanded catalog', timeout=90, name='catalog-installed')
    tap('Delete expanded catalog'); wait('Download'); tap('Back to scanner')
    network(False); launch(); lookup(isbn, title, 'catalog-replacement-offline'); description(label)
    report['catalog_replacement_persistence'] = 'passed'
    assert 'FATAL EXCEPTION' not in shell('logcat', '-d', '-s', 'AndroidRuntime:E')
    report['result'] = 'passed'
except Exception as error:
    report['result'] = 'failed'; report['failure'] = str(error); raise
finally:
    network(True); (out/'report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, indent=2))
