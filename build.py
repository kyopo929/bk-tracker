"""Combines src/ into index.html, the one file that gets served. Run: python3 build.py"""
import pathlib
s = pathlib.Path('src/shell.html').read_text(encoding='utf-8')
js = pathlib.Path('src/app.js').read_text(encoding='utf-8') + '\n' + pathlib.Path('src/compare.js').read_text(encoding='utf-8')
for k, v in [('/*CSS*/', pathlib.Path('src/app.css').read_text(encoding='utf-8')), ('/*APP*/', js)]:
    s = s.replace(k, v)
pathlib.Path('index.html').write_text(s, encoding='utf-8')
print(len(s))
