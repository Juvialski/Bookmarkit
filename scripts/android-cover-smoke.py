"""Native gallery OCR acceptance on a disposable Android emulator, with first launch offline.
Real samples must be supplied locally; images are not uploaded or committed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile
parser = argparse.ArgumentParser()
parser.add_argument('--adb', default='adb')
parser.add_argument('--serial', default='emulator-5554')
parser.add_argument('--apk', required=True)
parser.add_argument('--covers-dir', default='dist/ocr-images')
args = parser.parse_args()
if not args.serial.startswith('emulator-'):
    raise SystemExit('Use a disposable emulator, never a physical phone')
out = Path('dist/android-phase8'); out.mkdir(parents=True, exist_ok=True)
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
    shell('input', 'keyevent', '224')
    shell('wm', 'dismiss-keyguard')
    shell('am', 'force-stop', package)
    shell('am', 'start', '-n', f'{package}/.MainActivity')
    wait('Point your camera at a book cover')

def lookup(isbn, title, name):
    root = screen()
    if not any(n.attrib.get('content-desc') == 'Title, author, or ISBN' for n in root.iter('node')):
        tap('Search Manually')
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


def network(enabled):
    shell('svc', 'wifi', 'enable' if enabled else 'disable')
    shell('svc', 'data', 'enable' if enabled else 'disable')
    if not enabled:
        for _ in range(15):
            data = shell('dumpsys', 'connectivity')
            if 'Active default network: none' in data:
                (out / 'offline-connectivity.txt').write_text(data, encoding='utf-8'); return
            time.sleep(1)
        raise AssertionError('Network still active')

def pick(filename):
    path = Path(args.covers_dir) / filename
    assert path.is_file(), path
    staged = out / ('gallery-' + filename)
    shutil.copyfile(path, staged)
    remote = '/sdcard/Pictures/BookmarkitPhase8/' + str(time.time_ns()) + '-' + filename
    shell('mkdir', '-p', '/sdcard/Pictures/BookmarkitPhase8')
    adb('push', str(staged.resolve()), remote)
    # Synchronous provider scan avoids first-boot broadcast/indexing races.
    shell('content', 'call', '--uri', 'content://media', '--method', 'scan_file', '--arg', remote)
    time.sleep(2)
    tap('Choose Photo')
    nodes = []
    for _ in range(10):
        root = screen('picker-' + path.stem)
        nodes = [n for n in root.iter('node') if n.attrib.get('content-desc', '').startswith('Photo taken')]
        if nodes: break
        time.sleep(1)
    assert nodes, 'No system-picker photo tile'
    attr = nodes[0].attrib
    x1,y1,x2,y2 = map(int, re.findall(r'\d+', attr['bounds']))
    shell('input', 'tap', str((x1+x2)//2), str((y1+y2)//2))

apk = Path(args.apk)
report = {'apk': str(apk.resolve()), 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest()}
with zipfile.ZipFile(apk) as archive:
    assert archive.getinfo('assets/index.android.bundle').file_size > 100000
    assert any(archive.read(n) == Path('assets/catalog-v3.db').read_bytes() for n in archive.namelist() if n.endswith('.db'))
    report['model_assets'] = [n for n in archive.namelist() if 'text' in n.lower() and ('model' in n.lower() or n.endswith('.tflite'))]
try:
    network(False)
    installed = subprocess.run([args.adb, '-s', args.serial, 'install', '-r', str(apk.resolve())], capture_output=True, text=True)
    report['install'] = installed.stdout + installed.stderr
    if installed.returncode:
        raise AssertionError('Installation failed: ' + report['install'])
    shell('pm', 'clear', package)
    shell('logcat', '-c')
    launch()
    screen('first-launch-offline')
    # Camera remains ungranted: gallery and OCR must still work.
    pick('warbreaker-real.jpg')
    result = wait('View on Goodreads', name='offline-real-warbreaker')
    values = texts(result)
    assert 'Warbreaker' in values and 'Brandon Sanderson' in values, values
    assert any('★' in t for t in values), values
    assert not any(t.startswith('ISBN ') for t in values), values
    report['offline_native_ocr'] = values
    tap('View on Goodreads')
    time.sleep(2)
    activity = shell('dumpsys', 'activity', 'activities')
    (out / 'goodreads-title-activities.txt').write_text(activity, encoding='utf-8')
    assert 'goodreads.com/search?q=Warbreaker' in activity and 'Sanderson' in activity, 'Title browser intent missing'
    report['goodreads_title_intent'] = 'passed'
    launch()
    pick('way-of-kings.jpg')
    result = wait('View on Goodreads', name='offline-synthetic-way')
    assert 'The Way of Kings' in texts(result), texts(result)
    report['offline_multiline_native_ocr'] = texts(result)
    network(True); time.sleep(3)
    launch()
    pick('warbreaker-real.jpg')
    result = wait('View on Goodreads', name='online-real-warbreaker')
    assert 'Warbreaker' in texts(result), texts(result)
    report['online_native_ocr'] = texts(result)
    errors = shell('logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E')
    (out / 'errors.log').write_text(errors, encoding='utf-8')
    assert 'FATAL EXCEPTION' not in errors
    report['result'] = 'passed'
finally:
    network(True)
    (out / 'cover-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
