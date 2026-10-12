"""Build directions.html from directions.src.html.

Inlines the Line Shader tube engine and the official VARA mark (as a data URI),
because the published page can't load scripts or images from other hosts.

    python3 build.py [--preview]

--preview also writes _preview.html with a doctype, for opening the file locally.
"""
import base64, pathlib, re, sys

HERE = pathlib.Path(__file__).parent
LINE_SHADER = pathlib.Path('/Users/muf/Repos/line-shader')
MARK = pathlib.Path('/Users/muf/Repos/vara-expo/app/assets/design/assets/hero-static@2x.webp')

engine = (LINE_SHADER / 'system/tube.js').read_text() + '\n' + (LINE_SHADER / 'pages/home/data/strokes.js').read_text()
engine = re.sub(r'^export ', '', engine, flags=re.M)
mark = 'data:image/webp;base64,' + base64.b64encode(MARK.read_bytes()).decode()

src = (HERE / 'directions.src.html').read_text()
out = src.replace('/*__ENGINE__*/', engine).replace('__MARK__', mark)
(HERE / 'directions.html').write_text(out)
if '--preview' in sys.argv:
    (HERE / '_preview.html').write_text('<!doctype html><meta charset="utf-8">' + out)
print('built', len(out) // 1024, 'KB')
