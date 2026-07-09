"""Wordmark 'loopy' with the full brand symbol (figure-8 + arrow, magenta gradient)
replacing the 'oo'. Letters in a chosen colour."""
import math, importlib, os
import loopy; importlib.reload(loopy)
import cairosvg

GRAD_DEF = ('<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{loopy.GRAD[0]}"/>'
            f'<stop offset="1" stop-color="{loopy.GRAD[1]}"/></linearGradient></defs>')

# ---- symbol tight bbox (ribbon + arrow) in 200-space ----
p = loopy._ribbon_pts()
hw = loopy.SW/2
xs = [x for x, y in p]; ys = [y for x, y in p]
# arrow points (mirror of loopy.arrow_d logic)
x2, y2 = p[-1]; x1, y1 = p[-8]
dx, dy = x2-x1, y2-y1; L = math.hypot(dx, dy); dx/=L; dy/=L
px, py = -dy, dx; f = loopy.SW*1.05
axpts = [(x2+dx*f, y2+dy*f), (x2+px*f, y2+py*f), (x2-px*f, y2-py*f)]
axx = [a for a, b in axpts]; ayy = [b for a, b in axpts]
minx = min(min(xs)-hw, min(axx)); maxx = max(max(xs)+hw, max(axx))
miny = min(min(ys)-hw, min(ayy)); maxy = max(max(ys)+hw, max(ayy))
loop_top = min(ys)-hw; loop_bot = max(ys)+hw
loop_h = loop_bot - loop_top
loop_cy = (loop_top + loop_bot)/2
sym_w = maxx - minx

# ---- font glyphs ----
s = 100.0/loopy._upm
def glyph(ch):
    from fontTools.pens.svgPathPen import SVGPathPen
    name = loopy._cmap[ord(ch)]
    pen = SVGPathPen(loopy._gs); loopy._gs[name].draw(pen)
    return pen.getCommands(), loopy._gs[name].width

xh = loopy._font['OS/2'].sxHeight * s     # x-height
cap = loopy._font['OS/2'].sCapHeight * s

def build(letter_fill):
    parts = [GRAD_DEF]
    x = 0.0; tracking = 2.0
    def place(ch, xp):
        d, adv = glyph(ch)
        parts.append(f'<g transform="translate({xp:.3f},0) scale({s:.5f},{-s:.5f})">'
                     f'<path d="{d}" fill="{letter_fill}"/></g>')
        return adv*s
    # l
    x += place('l', x) + tracking
    # symbol slot: loops ~ x-height*1.04, arrow dips slightly below baseline
    loop_target = xh*1.04
    sc = loop_target/loop_h
    sym_render_w = sym_w*sc
    slot_pad = 3.0
    x += slot_pad
    # place symbol: map (minx,miny) so loop centre sits at y = -xh*0.52
    tx = x - minx*sc
    ty = -xh*0.52 - loop_cy*sc
    parts.append(f'<g transform="translate({tx:.3f},{ty:.3f}) scale({sc:.5f})">'
                 f'{loopy.symbol_group("url(#lg)")}</g>')
    x += sym_render_w + slot_pad + tracking
    # p, y
    x += place('p', x) + tracking
    x += place('y', x)
    return "".join(parts), x

def svg(letter_fill):
    mk, w = build(letter_fill)
    pad = 12; asc = 78; desc = 30; H = asc+desc
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w+2*pad:.2f} {H}">'
            f'<g transform="translate({pad},{asc})">{mk}</g></svg>')

OUT = "/sessions/relaxed-vibrant-planck/mnt/logo/loopy-brand/svg/wordmark"
os.makedirs(OUT, exist_ok=True)
for name, fill in [('loopy-wordmark-pink-dark.svg', loopy.DARK),
                   ('loopy-wordmark-pink-white.svg', loopy.WHITE)]:
    open(os.path.join(OUT, name), 'w').write(svg(fill))
    print('wrote', name)

# previews
cairosvg.svg2png(url=os.path.join(OUT,'loopy-wordmark-pink-dark.svg'),
                 write_to='/sessions/relaxed-vibrant-planck/mnt/outputs/wm_pink_dark.png',
                 output_width=900, background_color='#ffffff')
cairosvg.svg2png(url=os.path.join(OUT,'loopy-wordmark-pink-white.svg'),
                 write_to='/sessions/relaxed-vibrant-planck/mnt/outputs/wm_pink_white.png',
                 output_width=900, background_color='#1b1b20')
print('previews done')
