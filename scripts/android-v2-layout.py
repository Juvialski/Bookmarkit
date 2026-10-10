"""Small-screen, large-text and long-title checks on the disposable emulator."""
import json, sqlite3
from pathlib import Path
exec(compile(Path('scripts/android-cover-smoke.py').read_text('utf-8').split('apk = Path(args.apk)')[0], 'android-cover-smoke-helpers', 'exec'))
original_font=shell('settings','get','system','font_scale').strip()
report={}
try:
    shell('wm','size','1080x1920');shell('wm','density','480')
    shell('settings','put','system','font_scale','1.3')
    network(False);launch();screen('small-scanner')
    with sqlite3.connect('assets/catalog-v3.db') as db:
        isbn,title=db.execute('SELECT isbn13,title FROM books ORDER BY length(title) DESC LIMIT 1').fetchone()
    root=lookup(isbn,title,'long-title-large-text')
    assert title in texts(root)
    tap('View on Goodreads')
    report={'small_screen_dp':'360x640','font_scale':1.3,'long_title':title,'result':'passed'}
finally:
    shell('settings','put','system','font_scale',original_font if original_font not in ('null','') else '1.0')
    shell('wm','size','reset');shell('wm','density','reset');network(True)
    (out/'layout-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
