"""Reuse passed native prefix evidence only for a cache-test-only correction."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def verify(evidence, apk, source, head):
    allowed = {'.github/workflows/android-test-apk.yml', 'scripts/android-cache-smoke.py', 'scripts/reuse_native_prefix.py'}
    changed = subprocess.check_output(['git', 'diff', '--name-only', source, head], text=True).splitlines()
    if not changed or 'scripts/android-cache-smoke.py' not in changed or not set(changed) <= allowed:
        raise ValueError('App, backend or unaffected acceptance inputs changed')
    paths = ['android-phase8/cover-report.json', 'android-phase8/layout-report.json',
             'android-result/report.json', 'android-hardcover/report.json']
    reports = [json.loads((evidence / path).read_text('utf-8')) for path in paths]
    if any(report.get('result') != 'passed' for report in reports):
        raise ValueError('Prior native prefix did not pass')
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    if reports[0].get('sha256') != digest:
        raise ValueError('Prior evidence tested a different APK')
    return {'source_sha': source, 'head_sha': head, 'apk_sha256': digest, 'passed_reports': paths}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--head', required=True)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    try:
        receipt = verify(args.evidence, args.apk, args.source, args.head)
        receipt['source_run_id'] = args.run_id
        for directory in ['android-phase8', 'android-result', 'android-hardcover']:
            shutil.copytree(args.evidence / directory, Path('dist') / directory, dirs_exist_ok=True)
        Path('dist/native-prefix-reuse.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        reused = True
    except (ValueError, OSError, subprocess.CalledProcessError):
        reused = False  # Invalid prior evidence always runs the full real suite.
    print('Native prefix evidence reused:', reused)
    import os
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('reused=' + str(reused).lower() + '\n')
