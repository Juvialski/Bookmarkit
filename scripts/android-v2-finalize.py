"""Resume only the final UI checks for the identical, already exercised APK."""
import hashlib, json
from pathlib import Path
source=Path('scripts/android-cover-smoke.py').read_text('utf-8')
exec(compile(source.split('apk = Path(args.apk)')[0], 'android-cover-smoke-helpers', 'exec'))
report=json.loads((out/'cover-report.json').read_text('utf-8'))
assert report['sha256']==hashlib.sha256(Path(args.apk).read_bytes()).hexdigest()
required=['offline_native_ocr','goodreads_title_intent','offline_multiline_native_ocr','offline_manual_title_author','offline_manual_isbn10','ambiguous_matches','expanded_download','expanded_offline_book','expanded_deletion','online_native_ocr']
assert all(key in report for key in required), 'Run full acceptance first'
try:
    network(True);launch()
    tap('Choose Photo');wait('Photos');shell('input','keyevent','4')
    wait('Point at a book cover',name='picker-cancelled')
    report['picker_cancellation']='passed'
    tap('Allow camera');wait('While using the app');tap('While using the app')
    wait('Scan Book',name='scanner-camera')
    report['camera_permission']='Native Android permission dialog accepted; camera screen loaded'
    logs=shell('logcat','-d','-s','AndroidRuntime:E','ReactNativeJS:E')
    (out/'errors.log').write_text(logs,encoding='utf-8');assert 'FATAL EXCEPTION' not in logs
    report['previous_harness_failure']=report.pop('failure',None)
    report['result']='passed'
finally:
    (out/'cover-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
