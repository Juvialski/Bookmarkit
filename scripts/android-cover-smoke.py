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
parser.add_argument('--baseline-apk')
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
    if name:
        (out / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    for attempt in range(6):
        try:
            shell('rm', '-f', '/sdcard/bookmarkit-smoke.xml')
            shell('uiautomator', 'dump', '/sdcard/bookmarkit-smoke.xml')
            xml = shell('cat', '/sdcard/bookmarkit-smoke.xml')
            root = ET.fromstring(xml)
            labels = texts(root)
            anr = next((text for text in labels if "isn't responding" in text), '')
            if anr:
                if not any(system in anr for system in ('Pixel Launcher', 'System UI', 'Process system')):
                    raise AssertionError('Application ANR: ' + anr)
                (out / 'emulator-system-dialog.png').write_bytes(adb('exec-out', 'screencap', '-p'))
                close = next(n for n in root.iter('node') if n.attrib.get('text') == 'Close app')
                x1,y1,x2,y2 = map(int, re.findall(r'\d+', close.attrib['bounds']))
                shell('input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
                time.sleep(2); continue
            if name: (out / f'{name}.xml').write_text(xml, encoding='utf-8')
            return root
        except (subprocess.CalledProcessError, ET.ParseError):
            if attempt == 5: raise
            time.sleep(2)

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
    for attempt in range(4):
        root = screen()
        for node in root.iter('node'):
            attr = node.attrib
            if ((text and attr.get('text', '').lower() == text.lower()) or
                (resource and attr.get('resource-id') == resource) or
                (description and attr.get('content-desc') == description)):
                x1,y1,x2,y2 = map(int, re.findall(r'\d+', attr['bounds']))
                if x2 > x1 and y2 > y1:
                    shell('input', 'tap', str((x1+x2)//2), str((y1+y2)//2)); return
        bounds = root.find('node').attrib['bounds']
        _,_,width,height = map(int, re.findall(r'\d+', bounds))
        shell('input', 'swipe', str(width//2), str(height*3//4), str(width//2), str(height//3), '300')
    raise AssertionError('Cannot find ' + str(text or resource or description))

def launch():
    shell('input', 'keyevent', '224')
    shell('wm', 'dismiss-keyguard')
    shell('am', 'force-stop', 'com.google.android.apps.nexuslauncher')
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
    shell('input', 'text', isbn.replace(' ', '%s'))
    shell('input', 'keyevent', '4')
    tap('Look up book')
    return wait(title, name=name)

def texts(root):
    return [n.attrib['text'] for n in root.iter('node') if n.attrib.get('text')]


def network(enabled):
    shell('cmd', 'connectivity', 'airplane-mode', 'disable' if enabled else 'enable')
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
    scan_result = shell('content', 'call', '--uri', 'content://media', '--method', 'scan_file', '--arg', remote)
    (out / ('scan-' + path.stem + '.txt')).write_text(scan_result, encoding='utf-8')
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

def book_result(title, name):
    end = time.monotonic() + 60
    while time.monotonic() < end:
        root = screen()
        values = texts(root)
        if any('view on goodreads' in text.lower() for text in values):
            assert title in values, values
            return screen(name)
        if 'Which book?' in values:
            candidate = next((n for n in root.iter('node') if n.attrib.get('content-desc', '').startswith(title + ', ')), None)
            assert candidate is not None, values
            x1,y1,x2,y2 = map(int, re.findall(r'\d+', candidate.attrib['bounds']))
            shell('input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
            report.setdefault('candidate_selections', []).append(title)
        time.sleep(1)
    screen('failure'); raise AssertionError('No book result for ' + title)

apk = Path(args.apk)
report = {'apk': str(apk.resolve()), 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest()}
with zipfile.ZipFile(apk) as archive:
    assert archive.getinfo('assets/index.android.bundle').file_size > 100000
    assert any(archive.read(n) == Path('assets/catalog-v3.db').read_bytes() for n in archive.namelist() if n.endswith('.db'))
    report['model_assets'] = [n for n in archive.namelist() if 'text' in n.lower() and ('model' in n.lower() or n.endswith('.tflite'))]
try:
    network(False)
    if args.baseline_apk:
        adb('install', '-r', str(Path(args.baseline_apk).resolve()))
        report['baseline_version'] = re.search(r'versionCode=(\d+)', shell('dumpsys', 'package', package)).group(1)
    installed = subprocess.run([args.adb, '-s', args.serial, 'install', '-r', str(apk.resolve())], capture_output=True, text=True)
    report['install'] = installed.stdout + installed.stderr
    if installed.returncode:
        raise AssertionError('Installation failed: ' + report['install'])
    report['installed_version'] = re.search(r'versionCode=(\d+)', shell('dumpsys', 'package', package)).group(1)
    assert report['installed_version'] == '2'
    shell('pm', 'clear', package)
    shell('logcat', '-c')
    launch()
    screen('first-launch-offline')
    # Camera remains ungranted: gallery and OCR must still work.
    pick('warbreaker-real.jpg')
    result = book_result('Warbreaker', 'offline-real-warbreaker')
    values = texts(result)
    assert 'Warbreaker' in values and 'Brandon Sanderson' in values, values
    assert any('★' in t for t in values), values
    assert not any(t.startswith('ISBN ') for t in values), values
    connectivity = shell('dumpsys', 'connectivity')
    assert 'Active default network: none' in connectivity, 'Network reconnected during OCR'
    (out / 'offline-after-ocr-connectivity.txt').write_text(connectivity, encoding='utf-8')
    report['offline_native_ocr'] = values
    tap('View on Goodreads')
    time.sleep(2)
    # A fresh disposable emulator browser has a first-run screen, no account.
    for step in range(4):
        browser = screen('external-browser-' + str(step))
        labels = texts(browser)
        action = next((label for label in ('Use without an account', 'Accept & continue', 'No thanks', 'Not now') if label.lower() in [text.lower() for text in labels]), None)
        if not action: break
        tap(action); time.sleep(2)
    activity = shell('dumpsys', 'activity', 'activities')
    (out / 'goodreads-title-activities.txt').write_text(activity, encoding='utf-8')
    assert 'goodreads.com/search?q=Warbreaker' in activity and 'Sanderson' in activity, 'Title browser intent missing'
    report['goodreads_title_intent'] = 'passed'
    shell('am', 'start', '-n', f'{package}/.MainActivity')
    wait('Warbreaker')
    tap('Scan Another')
    pick('way-of-kings.jpg')
    result = book_result('The Way of Kings', 'offline-synthetic-way')
    assert 'The Way of Kings' in texts(result), texts(result)
    report['offline_multiline_native_ocr'] = texts(result)
    tap('Scan Another')
    report['offline_manual_title_author'] = texts(lookup('Brandon Sanderson The Way of Kings', 'The Way of Kings', 'offline-manual-title-author'))
    tap('Scan Another')
    report['offline_manual_isbn10'] = texts(lookup('0140328726', 'Fantastic Mr', 'offline-manual-isbn10'))
    network(True); time.sleep(3)
    launch()
    pick('warbreaker-real.jpg')
    result = book_result('Warbreaker', 'online-real-warbreaker')
    assert 'Warbreaker' in texts(result), texts(result)
    report['online_native_ocr'] = texts(result)
    tap('Scan Another')
    tap('Choose Photo')
    shell('input', 'keyevent', '4')
    wait('Point your camera at a book cover', name='picker-cancelled')
    report['picker_cancellation'] = 'passed'
    errors = shell('logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E')
    (out / 'errors.log').write_text(errors, encoding='utf-8')
    assert 'FATAL EXCEPTION' not in errors
    report['result'] = 'passed'
finally:
    network(True)
    (out / 'cover-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
