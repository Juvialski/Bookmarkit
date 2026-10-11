"""Manual bounded runner experiment. Sanitized checkpoints only; no uploads."""
import argparse
import hashlib
import json
import pathlib
import time
import urllib.error
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone

from research_goodreads import UA, extract, peak_memory_mib


def memory_mib():
    try:
        import resource
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024, 2)
    except ImportError:
        return peak_memory_mib()


def request(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            raw = response.read(4_000_001)
            if len(raw) > 4_000_000:
                raise ValueError('document exceeds bounded size')
            return response.status, response.headers.get('x-amzn-waf-action'), raw.decode('utf-8')
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get('x-amzn-waf-action'), ''


def blocked(status, action, body):
    return status in (202, 403, 405, 429) or action in ('challenge', 'captcha') or any(
        marker in body.lower() for marker in ('awswaf', 'verify you are human', 'request blocked'))


def save(path, report):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def run(targets, output, spacing=15, fetch=request, sleep=time.sleep):
    if not 1 <= len(targets) <= 30 or spacing < 15:
        raise ValueError('1..30 targets and at least 15 seconds spacing required')
    import re
    for target in targets:
        if not re.fullmatch(r'https://www\.goodreads\.com/book/show/\d+(?:[-.][A-Za-z0-9_%.-]+)?', target['url']):
            raise ValueError('only exact public book URLs allowed')
        if not target.get('provenance') or not target.get('isbns'):
            raise ValueError('independently sourced URL/ISBN identity required')
    if len({t['url'] for t in targets}) != len(targets):
        raise ValueError('duplicate target URLs')
    digest = hashlib.sha256(json.dumps(targets, sort_keys=True).encode()).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    report = json.loads(output.read_text(encoding='utf-8')) if output.exists() else dict(
        target_sha256=digest, selected=len(targets), rows=[], consecutive_blocks=0,
        circuit_open=False, segments=[], status='incomplete')
    if report['target_sha256'] != digest:
        raise ValueError('checkpoint target set changed')
    if report['circuit_open'] or report['status'] == 'complete':
        return report
    start, cpu = time.perf_counter(), time.process_time()
    def finish(status):
        report['status'] = status
        report['segments'].append(dict(wall_seconds=round(time.perf_counter()-start, 3),
            cpu_seconds=round(time.process_time()-cpu, 4),
            peak_python_mib=memory_mib()))
        report['attempted'] = len(report['rows'])
        report['http_200'] = sum(r.get('http_status') == 200 for r in report['rows'])
        report['blocks'] = sum(r.get('blocked', False) for r in report['rows'])
        report['verified'] = sum('result' in r for r in report['rows'])
        save(output, report)
        return report
    def controlled():
        return any((output.parent/name).exists() for name in ('PAUSE', 'STOP'))
    if controlled():
        return finish('paused')
    try:
        status, action, body = fetch('https://www.goodreads.com/robots.txt')
    except (urllib.error.URLError, TimeoutError, ValueError):
        return finish('robots_unavailable')
    if status != 200 or blocked(status, action, body):
        report['circuit_open'] = True
        return finish('robots_blocked')
    policy = urllib.robotparser.RobotFileParser()
    policy.parse(body.splitlines())
    completed = {r['url'] for r in report['rows']}
    for target in targets:
        if target['url'] in completed:
            continue
        # Resume waits too: never bursts book requests after process interruption.
        for _ in range(int(spacing)):
            if controlled():
                return finish('paused')
            sleep(1)
        if not policy.can_fetch(UA, target['url']):
            return finish('robots_denied')
        row = dict(url=target['url'], target_title=target['title'],
                   observed_at=datetime.now(timezone.utc).isoformat())
        before, before_cpu = time.perf_counter(), time.process_time()
        # Checkpoint an in-flight request BEFORE fetching. On resume it is left
        # unresolved, never fetched twice; unknown network outcome is conservative.
        row['error'] = 'interrupted_request_outcome_unknown'
        report['rows'].append(row)
        save(output, report)
        try:
            status, action, body = fetch(target['url'])
            row['http_status'] = status
            row['blocked'] = blocked(status, action, body)
            report['consecutive_blocks'] = report['consecutive_blocks']+1 if row['blocked'] else 0
            if report['consecutive_blocks'] >= 3:
                report['circuit_open'] = True
            row.pop('error')
            if status == 200 and not row['blocked']:
                row['result'] = extract(body, target)
                row['result']['population_evidence'] = 'resolved Apollo Book.work -> Work.stats; JSON-LD average/ratingCount agreement'
            else:
                row['error'] = 'access_blocked' if row['blocked'] else 'unavailable_response'
        except ValueError as error:
            row['error'] = str(error) if row.get('http_status') == 200 else 'network_or_parse_error'
        except (KeyError, TypeError, urllib.error.URLError, TimeoutError):
            # Do not persist arbitrary exception text (could contain response data).
            row['error'] = 'identity_or_rating_rejected' if row.get('http_status') == 200 else 'network_or_parse_error'
        row['seconds'] = round(time.perf_counter()-before, 3)
        row['cpu_seconds'] = round(time.process_time()-before_cpu, 4)
        save(output, report)
        print(json.dumps(row), flush=True)
        if report['circuit_open']:
            return finish('access_circuit_open')
    return finish('complete')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subset', choices=['a', 'b'], required=True)
    parser.add_argument('--targets', default='docs/evidence/goodreads/phase2-targets.json')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[1]
    output = pathlib.Path(args.output).resolve()
    if not output.is_relative_to(root/'dist'):
        parser.error('output must be under ignored dist/')
    targets = json.loads(pathlib.Path(args.targets).read_text(encoding='utf-8'))
    run([t for t in targets if t['subset'] == args.subset], output)


if __name__ == '__main__':
    main()
