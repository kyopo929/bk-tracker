"""Combines src/ into index.html, the one file that gets served. Run: python3 build.py"""
import pathlib
s = pathlib.Path('src/shell.html').read_text(encoding='utf-8')
for k, f in [('/*CSS*/', 'src/app.css'), ('/*APP*/', 'src/app.js')]:
    s = s.replace(k, pathlib.Path(f).read_text(encoding='utf-8'))
pathlib.Path('index.html').write_text(s, encoding='utf-8')
print(len(s))
