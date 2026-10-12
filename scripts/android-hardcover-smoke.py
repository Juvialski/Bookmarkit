"""Live Hardcover acceptance in the enabled standalone APK, disposable emulator only."""
import urllib.request
from pathlib import Path
exec(compile(Path('scripts/android-result-smoke.py').read_text('utf-8').split('original_font =')[0], 'result-helpers','exec'))
out=Path('dist/android-hardcover');out.mkdir(parents=True,exist_ok=True)
report={'result':'running','provider':'live authenticated Hardcover through Supabase; no fixture injection'}

def expected(isbn):
    request=urllib.request.Request('https://xxijxuekfsxuzhnujqem.supabase.co/functions/v1/hardcover',
        data=json.dumps({'isbn':isbn}).encode(),headers={'apikey':'sb_publishable_wzIGwfmaZRYy8GmHZIq41Q_MNjHxhtX','Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=8) as response: record=json.load(response)
    assert record.get('found') and record.get('verified') and record.get('ratingScope')=='work'
    return f"{record['rating']:.2f} out of 5 stars, {record['ratingsCount']:,} ratings, Hardcover.",record

try:
    network(True);time.sleep(3);launch()
    label,record=expected('9780765326355')
    start=time.monotonic();lookup('9780765326355','The Way of Kings','isbn-initial')
    initial=time.monotonic()-start
    root=description(label,name='isbn-hardcover')
    report['isbn']={'initial_ui_seconds':round(initial,3),'rating':rating_evidence(root),'source_record':record}
    assert any('Stormlight' in t for t in texts(root)),texts(root)
    shell('am','force-stop','com.android.chrome');tap('Read Goodreads Reviews');time.sleep(2)
    assert expected_reviews('9780765326355') in shell('dumpsys','activity','activities')
    report['reviews_isbn']='passed'
    launch();lookup('The Way of Kings Brandon Sanderson','The Way of Kings','title-initial')
    root=description(label,name='title-hardcover');report['without_barcode']=rating_evidence(root)
    launch();pick('warbreaker-real.jpg');book_result('Warbreaker','cover-initial')
    label,record=expected('9780765320308')
    root=description(label,name='cover-hardcover');report['cover_ocr']=rating_evidence(root)
    reviewed=json.loads(Path('catalog/goodreads.json').read_text())[0]
    launch();lookup(reviewed['isbn13'],'The Hunger Games','goodreads-priority')
    goodreads=f"{reviewed['average']:.2f} out of 5 stars, {reviewed['rating_count']:,} ratings, Goodreads."
    description(goodreads,name='goodreads-priority');report['goodreads_priority']='passed'
    network(False);launch();lookup('9780765326355','The Way of Kings','offline-fallback')
    root=description('ratings, Hardcover',name='offline-fallback');report['offline']=rating_evidence(root)
    errors=shell('logcat','-d','-s','AndroidRuntime:E','ReactNativeJS:E')
    (out/'errors.log').write_text(errors,encoding='utf-8');assert 'FATAL EXCEPTION' not in errors
    report['result']='passed'
except Exception as error:
    report['result']='failed';report['failure']=str(error);raise
finally:
    network(True);(out/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
