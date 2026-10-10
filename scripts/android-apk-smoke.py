"""Targeted standalone APK acceptance. Requires a booted, disposable Android emulator.

python scripts/android-apk-smoke.py --adb /path/to/adb --apk dist/bookmarkit-android-test.apk
Clears Bookmarkit data, changes emulator network state, restores network in finally.
No Metro, test backend, or extra Python packages are used.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--adb', default='adb')
parser.add_argument('--serial', default='emulator-5554')
parser.add_argument('--apk', default='dist/bookmarkit-android-test.apk')
args = parser.parse_args()
if not args.serial.startswith('emulator-'):
    raise SystemExit('Use a disposable emulator, never a physical phone')
out = Path('dist/android-smoke')
out.mkdir(parents=True, exist_ok=True)
package = 'com.juvialski.bookmarkit'

def adb(*values):
    return subprocess.check_output([args.adb, '-s', args.serial, *values], timeout=60)

def shell(*values):
    return adb('shell', *values).decode('utf-8', errors='replace')

def screen(name=None):
    shell('uiautomator', 'dump', '/sdcard/bookmarkit-smoke.xml')
    xml = shell('cat', '/sdcard/bookmarkit-smoke.xml')
    if name:
        (out / f'{name}.xml').write_text(xml, encoding='utf-8')
        (out / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    return ET.fromstring(xml)

def wait(text, timeout=45, name=None):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        root = screen()
        if any(text.lower() in n.attrib.get('text', '').lower() for n in root.iter('node')):
            if name:
                root = screen(name)
            return root
        time.sleep(1)
    screen('failure')
    raise AssertionError(f'Timed out waiting for {text}')

def tap(text=None, resource=None, description=None):
    root = screen()
    for node in root.iter('node'):
        attr = node.attrib
        if ((text and attr.get('text', '').lower() == text.lower()) or
            (resource and attr.get('resource-id') == resource) or
            (description and attr.get('content-desc') == description)):
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', attr['bounds']))
            shell('input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
            return
    raise AssertionError(f'Cannot find {text or resource or description}')

def launch():
    shell('am', 'force-stop', package)
    shell('am', 'start', '-n', f'{package}/.MainActivity')
    wait('Point at a book cover')

def lookup(isbn, title, name):
    root = screen()
    if not any(n.attrib.get('content-desc') == 'Title, author, or ISBN' for n in root.iter('node')):
        tap('Search')
    tap(description='Title, author, or ISBN')
    shell('input', 'keyevent', '123')
    for _ in range(100):
        shell('input', 'keyevent', '67')
    shell('input', 'text', isbn)
    shell('input', 'keyevent', '4')
    tap('Look up book')
    return wait(title, name=name)

def texts(root):
    return [n.attrib['text'] for n in root.iter('node') if n.attrib.get('text')]

apk = Path(args.apk)
report = {'apk': str(apk.resolve()), 'bytes': apk.stat().st_size,
          'sha256': hashlib.sha256(apk.read_bytes()).hexdigest()}
with zipfile.ZipFile(apk) as archive:
    assert archive.getinfo('assets/index.android.bundle').file_size > 100_000
    catalog = Path('assets/catalog-v3.db').read_bytes()
    databases = [n for n in archive.namelist() if n.endswith('.db')]
    assert any(archive.read(n) == catalog for n in databases), 'Catalog differs or is absent'
    report['bundled_catalog'] = databases
    report['abis'] = sorted({n.split('/')[1] for n in archive.namelist() if n.startswith('lib/')})

try:
    shell('svc', 'wifi', 'enable')
    shell('svc', 'data', 'enable')
    adb('install', '-r', str(apk.resolve()))
    shell('pm', 'clear', package)
    shell('logcat', '-c')
    launch()
    screen('initial')
    tap('Allow camera')
    wait('While using the app', name='permission-dialog')
    tap('While using the app')
    wait('Scan Book', name='camera')
    report['camera_permission'] = 'Android dialog accepted; camera screen and torch control loaded'
    report['online'] = texts(lookup('9780765326355', 'The Way of Kings', 'online'))
    tap('View on Goodreads')
    time.sleep(3)
    activity = shell('dumpsys', 'activity', 'activities')
    (out / 'goodreads-activities.txt').write_text(activity, encoding='utf-8')
    assert 'goodreads.com/search?q=9780765326355' in activity, 'ISBN browser intent missing'
    screen('goodreads')
    report['goodreads'] = 'External browser received exact ISBN Goodreads URL'
    shell('svc', 'wifi', 'disable')
    shell('svc', 'data', 'disable')
    for _ in range(15):
        connectivity = shell('dumpsys', 'connectivity')
        if 'Active default network: none' in connectivity:
            break
        time.sleep(1)
    assert 'Active default network: none' in connectivity, 'Emulator still has a network'
    report['offline_network'] = connectivity
    (out / 'offline-connectivity.txt').write_text(report.pop('offline_network'), encoding='utf-8')
    launch()
    report['offline_series'] = texts(lookup('9780765326355', 'The Way of Kings', 'offline-series'))
    assert any('#1' in t for t in report['offline_series'])
    assert any('Stormlight' in t for t in report['offline_series'])
    assert any('out of 5 stars' in n.attrib.get('content-desc', '') for n in screen().iter('node'))
    tap('Scan Another')
    report['offline_standalone'] = texts(lookup('9780765320308', 'Warbreaker', 'offline-standalone'))
    assert 'Standalone' in report['offline_standalone']
    shell('svc', 'wifi', 'enable')
    shell('svc', 'data', 'enable')
    time.sleep(3)
    launch()
    report['reconnected'] = texts(lookup('9780140328721', 'Fantastic Mr', 'reconnected'))
    assert 'Series unknown' in report['reconnected']
    logs = shell('logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E')
    (out / 'errors.log').write_text(logs, encoding='utf-8')
    assert 'FATAL EXCEPTION' not in logs
    report['result'] = 'passed'
finally:
    shell('svc', 'wifi', 'enable')
    shell('svc', 'data', 'enable')
    (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
