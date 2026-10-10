"""Result UI acceptance with real stored/live metadata in a standalone release APK.
Uses a disposable emulator only; never injects production ratings or book results.
"""
import json
from pathlib import Path
exec(compile(Path('scripts/android-cover-smoke.py').read_text('utf-8').split('apk = Path(args.apk)')[0], 'android-cover-smoke-helpers', 'exec'))
out = Path('dist/android-result'); out.mkdir(parents=True, exist_ok=True)
report = {'result': 'running', 'metadata': 'real bundled catalog and live providers'}

def description(fragment, timeout=50, name=None):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        root = screen()
        if any(fragment in n.attrib.get('content-desc', '') for n in root.iter('node')):
            return screen(name) if name else root
        time.sleep(1)
    screen('failure')
    raise AssertionError('Missing accessibility description: ' + fragment)

def rating_evidence(root):
    return next(n.attrib['content-desc'] for n in root.iter('node') if 'out of 5 stars' in n.attrib.get('content-desc', ''))

original_font = shell('settings', 'get', 'system', 'font_scale').strip()
try:
    shell('wm', 'size', '1080x1920'); shell('wm', 'density', '480')
    shell('settings', 'put', 'system', 'font_scale', '1.0')
    network(False); launch()
    lookup('9780312722753', 'Show me!', 'fully-rated')
    root = description('5.0 out of 5 stars', name='fully-rated')
    assert '3 ratings, Open Library' in rating_evidence(root)
    report['fully_rated'] = rating_evidence(root)
    tap('Scan another')
    lookup('9780765320308', 'Warbreaker', 'offline-result')
    root = description('out of 5 stars', name='fractional-offline')
    label = rating_evidence(root)
    assert label.startswith('4.') and 'ratings, Open Library' in label, label
    description('Cover unavailable', name='no-cover')
    report['fractional_offline'] = label
    tap('Scan another')
    shell('settings', 'put', 'system', 'font_scale', '1.3')
    launch(); lookup('9780765320308', 'Warbreaker', 'large-text-top')
    tap('View on Goodreads')
    report['layout'] = {'dp': '360x640', 'font_scale': 1.3, 'goodreads_reachable': True}
    shell('settings', 'put', 'system', 'font_scale', '1.0')
    network(True); time.sleep(3); launch()
    lookup('9780765320308', 'Warbreaker', 'isbn-initial')
    root = description('Cover of Warbreaker', name='isbn-online-cover')
    report['isbn_online'] = {'cover': 'loaded', 'rating': rating_evidence(root)}
    # dumpsys retains Chrome's original ActivityRecord intent when an existing
    # tab receives another URL. Start a fresh browser process so this assertion
    # observes this click's exact ISBN intent rather than the earlier title URL.
    shell('am', 'force-stop', 'com.android.chrome')
    tap('View on Goodreads'); time.sleep(2)
    activities = shell('dumpsys', 'activity', 'activities')
    (out / 'goodreads-isbn.txt').write_text(activities, encoding='utf-8')
    assert 'goodreads.com/search?q=9780765320308' in activities
    report['goodreads_isbn'] = 'passed'
    launch(); pick('warbreaker-real.jpg')
    # book_result uses the global report only if a candidate needs selection.
    book_result('Warbreaker', 'front-cover-initial')
    root = description('Cover of Warbreaker', name='front-cover-online')
    report['front_cover_online'] = {'native_gallery_ocr': True, 'cover': 'loaded', 'rating': rating_evidence(root)}
    errors = shell('logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E')
    (out / 'errors.log').write_text(errors, encoding='utf-8')
    assert 'FATAL EXCEPTION' not in errors
    report['result'] = 'passed'
except Exception as error:
    report['result'] = 'failed'; report['failure'] = str(error)
    raise
finally:
    shell('settings', 'put', 'system', 'font_scale', original_font if original_font not in ('null', '') else '1.0')
    shell('wm', 'size', 'reset'); shell('wm', 'density', 'reset'); network(True)
    (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
