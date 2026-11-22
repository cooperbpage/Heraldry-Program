"""Overlay hand-placed component annotations on a trace and add a legend.
usage: annotate.py <trace-dir> <annotations.json> <out.svg>"""
import sys, json, html
d, ann, outp = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]
reg = json.load(open(f'{d}/regions.json'))
W, H = reg['size']
x0, y0, cw, ch = ann['crop']
fill = {'red': ann.get('red_fill', '#d42b2b'), 'lining': '#ffffff'}
sw = ann.get('stroke', 0.9)
body = ''.join(f'<path d="{r["d"]}" fill="{fill[r["face"]]}" fill-rule="evenodd" stroke="#111" stroke-width="{sw}" stroke-linejoin="round"/>' for r in reg['regions'] if r['face'] in fill)
k = ann.get('scale', 1.0)  # annotation size unit
col = {'stem': '#0a58d6', 'feature': '#0a58d6'}
marks = ''
for i, c in enumerate(ann['components']):
    n = c['n']
    if 'path' in c:
        marks += f'<path d="{c["path"]}" fill="none" stroke="#0a58d6" stroke-width="{1.6 * k}" stroke-dasharray="{4 * k} {2.5 * k}" stroke-linecap="round" marker-end="url(#arr)"/>'
    for t in c.get('tags', []):
        x, y, s = t
        marks += f'<g><circle cx="{x}" cy="{y}" r="{4.2 * k}" fill="#fff" stroke="#0a58d6" stroke-width="{1 * k}"/><text x="{x}" y="{y + 1.5 * k}" font-size="{4.6 * k}" text-anchor="middle" font-family="Georgia" font-weight="bold" fill="#0a58d6">{s}</text></g>'
    x, y = c['at']
    marks += f'<g><circle cx="{x}" cy="{y}" r="{6 * k}" fill="#0a58d6" stroke="#fff" stroke-width="{1 * k}"/><text x="{x}" y="{y + 2.4 * k}" font-size="{7 * k}" text-anchor="middle" font-family="Georgia" font-weight="bold" fill="#fff">{n}</text></g>'
LW = ann.get('legend_w', 260) * k / k
lx = x0 + cw + 8 * k
fs = 6.2 * k
lines = []
lines.append((ann['title'], 'title'))
for c in ann['components']:
    lines.append((f'{c["n"]}  {c["name"]}', 'head'))
    lines.append((c['desc'], 'desc'))
lines.append(('', 'gap'))
for key, txt in ann.get('key', []):
    lines.append((f'{key}  {txt}', 'key'))
for nt in ann.get('notes', []):
    lines.append((nt, 'note'))
# wrap text
def wrap(t, n):
    out, cur = [], ''
    for w in t.split():
        if len(cur) + len(w) + 1 > n:
            out.append(cur); cur = w
        else:
            cur = (cur + ' ' + w).strip()
    if cur: out.append(cur)
    return out or ['']
legend = ''
ty = y0 + 10 * k
chars = int(ann.get('legend_chars', 52))
for t, kind in lines:
    if kind == 'gap':
        ty += fs; continue
    size = {'title': fs * 1.35, 'head': fs * 1.05, 'desc': fs * 0.92, 'key': fs * 0.92, 'note': fs * 0.9}[kind]
    weight = 'bold' if kind in ('title', 'head') else 'normal'
    style = 'italic' if kind in ('title', 'note') else 'normal'
    colr = '#0a58d6' if kind == 'head' else '#2a241f'
    for ln in wrap(t, chars if kind != 'title' else int(chars * 0.8)):
        legend += f'<text x="{lx}" y="{ty}" font-size="{size}" font-family="Georgia" font-weight="{weight}" font-style="{style}" fill="{colr}">{html.escape(ln)}</text>'
        ty += size * 1.3
    if kind == 'desc': ty += fs * 0.35
legW = ann.get('legend_w', 230) * k
total_h = max(ch, ty - y0 + 6 * k)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {cw + legW + 16 * k} {total_h}" width="100%" height="100%">
<defs><marker id="arr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="{3.2}" markerHeight="{3.2}" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#0a58d6"/></marker></defs>
<rect x="{x0}" y="{y0}" width="{cw + legW + 16 * k}" height="{total_h}" fill="#f1ebdd"/>
<rect x="{lx - 4 * k}" y="{y0}" width="{legW + 12 * k}" height="{total_h}" fill="#fbf8f1"/>
{body}{marks}{legend}</svg>'''
open(outp, 'w').write(svg)
print('viewBox', x0, y0, cw + legW + 16 * k, total_h)
