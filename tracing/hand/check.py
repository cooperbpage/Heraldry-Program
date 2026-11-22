"""Render hand-drawn leaf outlines (JSON list of {id, d}) over a reference crop for checking, and as a clean trace.
usage: check.py <image> <shapes.json> <x0> <y0> <w> <h> <scale> <out-prefix>"""
import sys, json, base64, io, subprocess
from PIL import Image
img, shp, x0, y0, w, h, sc, outp = sys.argv[1], sys.argv[2], *map(float, sys.argv[3:8]), sys.argv[8]
shapes = json.load(open(shp))
im = Image.open(img).convert('RGB')
buf = io.BytesIO(); im.save(buf, 'PNG'); b64 = base64.b64encode(buf.getvalue()).decode()
W, H = im.size
paths = ''.join(f'<path d="{s["d"]}" fill="#d42b2b" stroke="#111" stroke-width="{0.9 if w < 300 else 1.4}" stroke-linejoin="round"/>' for s in shapes)
ov = ''.join(f'<path d="{s["d"]}" fill="#00e0ff" fill-opacity="0.18" stroke="#00e0ff" stroke-width="{0.5 if w < 300 else 1}"/>' for s in shapes)
vb = f'{x0} {y0} {w} {h}'
open(outp + '-overlay.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{int(w*sc)}" height="{int(h*sc)}"><image href="data:image/png;base64,{b64}" width="{W}" height="{H}"/>{ov}</svg>')
open(outp + '-trace.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{int(w*sc)}" height="{int(h*sc)}"><rect x="{x0}" y="{y0}" width="{w}" height="{h}" fill="#f1ebdd"/>{paths}</svg>')
