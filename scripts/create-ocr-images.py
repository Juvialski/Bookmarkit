"""Generate synthetic cover images for native OCR acceptance, not publisher art.

Requires Pillow, installed only for local validation. Normal CI uses TS fixtures.
Outputs are ignored and do not expand the bundled book catalog or app assets.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
import textwrap

fixtures = [
    ('hobbit', 'THE HOBBIT', 'J.R.R. TOLKIEN'),
    ('atomic', 'ATOMIC HABITS', 'JAMES CLEAR'),
    ('way-of-kings', 'THE WAY OF KINGS', 'BRANDON SANDERSON'),
    ('harry-potter', "HARRY POTTER AND THE PHILOSOPHER'S STONE", 'J.K. ROWLING'),
    ('alchemist', 'THE ALCHEMIST', 'PAULO COELHO'),
    ('1984', '1984', 'GEORGE ORWELL'),
    ('pride', 'PRIDE AND PREJUDICE', 'JANE AUSTEN'),
    ('silent-patient', 'THE SILENT PATIENT', 'ALEX MICHAELIDES'),
    ('fourth-wing', 'FOURTH WING', 'REBECCA YARROS'),
    ('hail-mary', 'PROJECT HAIL MARY', 'ANDY WEIR'),
    ('unknown', 'UNMAPPED GALACTIC HANDBOOK', 'JANE EXAMPLE'),
]
out = Path('dist/ocr-images')
out.mkdir(parents=True, exist_ok=True)
font_dir = Path('C:/Windows/Fonts')
def font(size, bold=False):
    path = font_dir / ('arialbd.ttf' if bold else 'arial.ttf')
    if not path.is_file():
        path = Path('/usr/share/fonts/truetype/dejavu') / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')
    return ImageFont.truetype(str(path), size)
for index, (slug, title, author) in enumerate(fixtures):
    image = Image.new('RGB', (900, 1400), ['#f5efdc', '#dce9e2', '#e7e1f4'][index % 3])
    draw = ImageDraw.Draw(image)
    draw.text((450, 65), 'NEW YORK TIMES BESTSELLER', font=font(26), fill='#333333', anchor='mt')
    draw.multiline_text((450, 360), ('THE WAY\nOF KINGS' if slug == 'way-of-kings' else '\n'.join(textwrap.wrap(title, width=17))), font=font(68, True), fill='#132b26', anchor='ma', align='center', spacing=24)
    if slug == 'atomic':
        draw.text((450, 820), 'Tiny Changes, Remarkable Results', font=font(32), fill='#333333', anchor='mt')
    draw.multiline_text((450, 180 if slug in ('1984', 'alchemist') else 1060), '\n'.join(textwrap.wrap(author, width=22)), font=font(42), fill='#132b26', anchor='ma', align='center', spacing=16)
    draw.text((450, 1290), 'PENGUIN BOOKS', font=font(25), fill='#555555', anchor='mt')
    image.save(out / f'{slug}.jpg', quality=95)
(out / 'fixtures.json').write_text(json.dumps(fixtures, indent=2), encoding='utf-8')
print(f'Created {len(fixtures)} synthetic OCR images in {out}')
