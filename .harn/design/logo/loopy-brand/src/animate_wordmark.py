"""Animated wordmark 'loopy' — the subtle continuous-flow symbol as the 'oo'.
Outputs animated SVG (CSS) + GIF, in dark-letter and white-letter colour treatments."""
import math, importlib, os, io
import loopy; importlib.reload(loopy)
import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from PIL import Image

OUT = "/sessions/relaxed-vibrant-planck/mnt/logo/loopy-brand/animation"
os.makedirs(OUT, exist_ok=True)

SW = loopy.SW
pts = loopy._ribbon_pts()
TOTAL = sum(math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]) for i in range(len(pts)-1))
LIT = TOTAL*0.13
DUR = 2.4
RD = loopy.ribbon_d(); AD = loopy.arrow_d()

# ---- symbol bbox in local (200) space (ribbon + arrow) ----
hw = SW/2
xs = [x for x, y in pts]; ys = [y for x, y in pts]
x2, y2 = pts[-1]; x1, y1 = pts[-7]
dx, dy = x2-x1, y2-y1; L = math.hypot(dx, dy) or 1; dx/=L; dy/=L
px, py = -dy, dx; f = SW*loopy.ARROW_F
apts = [(x2+dx*f, y2+dy*f), (x2+px*f, y2+py*f), (x2-px*f, y2-py*f)]
minx = min(min(xs)-hw, *[a for a, b in apts]); maxx = max(max(xs)+hw, *[a for a, b in apts])
loop_top = min(ys)-hw; loop_bot = max(ys)+hw
loop_h = loop_bot-loop_top; loop_cy = (loop_top+loop_bot)/2; sym_w = maxx-minx

# ---- font glyphs ----
s = 100.0/loopy._upm
def glyph(ch):
    name = loopy._cmap[ord(ch)]
    pen = SVGPathPen(loopy._gs); loopy._gs[name].draw(pen)
    return pen.getCommands(), loopy._gs[name].width
xh = loopy._font['OS/2'].sxHeight * s

GRAD = (f'<linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{loopy.GRAD[0]}"/>'
        f'<stop offset="1" stop-color="{loopy.GRAD[1]}"/></linearGradient>')

def highlight(offset=None, animated=False):
    dash = f'{LIT:.2f} {TOTAL-LIT:.2f}'
    if animated:
        off = ''
    else:
        off = f'stroke-dashoffset="{offset:.2f}"'
    glow = (f'<path class="g" d="{RD}" fill="none" stroke="#F7A9D0" stroke-width="{SW*1.05:.2f}" '
            f'stroke-linecap="round" stroke-dasharray="{dash}" {off} opacity="0.28" filter="url(#glow)"/>')
    core = (f'<path class="c" d="{RD}" fill="none" stroke="#FDB6D8" stroke-width="{SW*0.46:.2f}" '
            f'stroke-linecap="round" stroke-dasharray="{dash}" {off} opacity="0.5"/>')
    return glow + core

def symbol_slot(offset=None, animated=False):
    return loopy.symbol_group('url(#lg)') + highlight(offset, animated)

def build(letter_fill, offset=None, animated=False):
    parts = []; x = 0.0; tracking = 2.0
    def place(ch, xp):
        d, adv = glyph(ch)
        parts.append(f'<g transform="translate({xp:.3f},0) scale({s:.5f},{-s:.5f})">'
                     f'<path d="{d}" fill="{letter_fill}"/></g>')
        return adv*s
    x += place('l', x) + tracking
    loop_target = xh*1.04; sc = loop_target/loop_h; sym_render_w = sym_w*sc
    x += 3.0
    tx = x - minx*sc; ty = -xh*0.52 - loop_cy*sc
    parts.append(f'<g transform="translate({tx:.3f},{ty:.3f}) scale({sc:.5f})">'
                 f'{symbol_slot(offset, animated)}</g>')
    x += sym_render_w + 3.0 + tracking
    x += place('p', x) + tracking
    x += place('y', x)
    return "".join(parts), x

def defs(animated):
    style = ''
    if animated:
        style = ('<style>@keyframes flow{to{stroke-dashoffset:%.2f}}'
                 '.g,.c{animation:flow %.2fs linear infinite}</style>') % (-TOTAL, DUR)
    return (f'<defs>{GRAD}<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">'
            f'<feGaussianBlur stdDeviation="3.2"/></filter>{style}</defs>')

def svg(letter_fill, offset=None, animated=False, bg=None):
    mk, w = build(letter_fill, offset, animated)
    pad = 12; asc = 78; desc = 30; H = asc+desc
    rect = f'<rect width="{w+2*pad:.2f}" height="{H}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w+2*pad:.2f} {H}">'
            f'{defs(animated)}{rect}<g transform="translate({pad},{asc})">{mk}</g></svg>')

# ---- animated SVGs (transparent) ----
open(os.path.join(OUT, 'loopy-wordmark-flow-dark.svg'), 'w').write(svg(loopy.DARK, animated=True))
open(os.path.join(OUT, 'loopy-wordmark-flow-white.svg'), 'w').write(svg(loopy.WHITE, animated=True))
print("animated wordmark SVGs written")

# ---- GIFs ----
def make_gif(path, letter_fill, bg, h=170, N=36):
    # size from first frame aspect
    first = svg(letter_fill, offset=0, bg=bg)
    import re
    _,_,vw,vh = map(float, re.search(r'viewBox="([\d.\- ]+)"', first).group(1).split())
    w = int(round(h*vw/vh))
    frames = []
    for i in range(N):
        png = cairosvg.svg2png(bytestring=svg(letter_fill, offset=-TOTAL*i/N, bg=bg).encode(),
                               output_width=w, output_height=h)
        frames.append(Image.open(io.BytesIO(png)).convert('RGB').quantize(colors=128, method=Image.MEDIANCUT))
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=int(DUR*1000/N), loop=0, optimize=True)

make_gif(os.path.join(OUT, 'loopy-wordmark-flow-dark.gif'),  loopy.DARK,  '#FFFFFF')
make_gif(os.path.join(OUT, 'loopy-wordmark-flow-white.gif'), loopy.WHITE, loopy.ICON_BG)
print("wordmark GIFs written")
