"""Verify v1.3.0 personal-cache migration using a disposable emulator."""
from pathlib import Path
exec(compile(Path('scripts/android-cover-smoke.py').read_text('utf-8').split('apk = Path(args.apk)')[0], 'upgrade-helpers', 'exec'))
out = Path('dist/android-upgrade'); out.mkdir(parents=True, exist_ok=True)
report = {'result': 'running'}
try:
    assert args.baseline_apk, 'A real v1.3.0 baseline APK is required'
    # Reset only the disposable test installation before creating the old data.
    try: adb('uninstall', package)
    except subprocess.CalledProcessError: pass
    adb('install', str(Path(args.baseline_apk).resolve()))
    old = shell('dumpsys', 'package', package)
    report['baseline_version_name'] = re.search(r'versionName=(\S+)', old).group(1)
    report['baseline_version_code'] = int(re.search(r'versionCode=(\d+)', old).group(1))
    assert report['baseline_version_name'] == '1.3.0', report
    # Create a genuine v1 personal record with the prior app before installing v5.
    network(True); launch()
    lookup('9780593321201','Tomorrow, and Tomorrow, and Tomorrow','v130-personal-created')
    time.sleep(8)
    network(True); launch(); tap('Offline books'); wait('Download'); tap('Download')
    wait('Delete expanded catalog', timeout=90, name='v120-data-created')
    network(False); adb('install', '-r', str(Path(args.apk).resolve()))
    new = shell('dumpsys', 'package', package)
    report['installed_version_name'] = re.search(r'versionName=(\S+)', new).group(1)
    report['installed_version_code'] = int(re.search(r'versionCode=(\d+)', new).group(1))
    assert report['installed_version_name'] == json.loads(Path('app.json').read_text('utf-8'))['expo']['version'], report
    assert report['installed_version_code'] > report['baseline_version_code'], report
    launch(); tap('Offline books'); wait('Delete expanded catalog', name='v130-data-retained-offline')
    report['offline_download_survives_upgrade'] = True
    tap('Delete expanded catalog')
    end = time.monotonic()+10
    while any(t.lower() == 'delete expanded catalog' for t in texts(screen())):
        assert time.monotonic() < end, 'Catalog remained selected'
        time.sleep(0.5)
    tap('Back to scanner')
    lookup('9780593321201','Tomorrow, and Tomorrow, and Tomorrow','v140-personal-retained-offline')
    report['v130_personal_cache_survives_upgrade']=True
    report['result'] = 'passed'
except Exception as error:
    report['result'] = 'failed'; report['failure'] = str(error); raise
finally:
    network(True); (out/'report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, indent=2))
