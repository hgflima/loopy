"""Intro animation: vertical '8' -> letters open -> '8' lies down into the loopy logo,
then holds and the subtle flow runs. Renders key-frame builder used for GIF + preview."""
import math, importlib, os, io
import loopy; importlib.reload(loopy)
import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from PIL import Image

SW = loopy.SW
pts = loopy._ribbon_pts()
TOTAL = sum(math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]) for i in range(len(pts)-1))
LIT = TOTAL*0.13
RD = loopy.ribbon_d(); AD = loopy.arrow_d()

# symbol bbox (ribbon + arrow) in local 200-space
hw = SW/2
xs = [x for x, y in pts]; ys = [y for x, y in pts]
x2, y2 = pts[-1]; x1, y1 = pts[-7]
dxx, dyy = x2-x1, y2-y1; L = math.hypot(dxx, dyy) or 1; dxx/=L; dyy/=L
pxx, pyy = -dyy, dxx; af = SW*loopy.ARROW_F
apts = [(x2+dxx*af, y2+dyy*af), (x2+pxx*af, y2+pyy*af), (x2-pxx*af, y2-pyy*af)]
minx = min(min(xs)-hw, *[a for a, b in apts]); maxx = max(max(xs)+hw, *[a for a, b in apts])
miny = min(min(ys)-hw, *[b for a, b in apts]); maxy = max(max(ys)+hw, *[b for a, b in apts])
loop_top = min(ys)-hw; loop_bot = max(ys)+hw; loop_h = loop_bot-loop_top; loop_cy = (loop_top+loop_bot)/2
sym_w = maxx-minx; sym_h = maxy-miny
cx = (minx+maxx)/2; cy = (miny+maxy)/2

# fonts
s = 100.0/loopy._upm
def glyph(ch):
    n = loopy._cmap[ord(ch)]; pen = SVGPathPen(loopy._gs); loopy._gs[n].draw(pen)
    return pen.getCommands(), loopy._gs[n].width
xh = loopy._font['OS/2'].sxHeight * s
gl = {c: glyph(c) for c in 'lpy'}

# final layout (mirror animate_wordmark)
tracking = 2.0; slot_pad = 3.0
adv_l = gl['l'][1]*s; adv_p = gl['p'][1]*s; adv_y = gl['y'][1]*s
x_after_l = adv_l + tracking
loop_target = xh*1.04; sc = loop_target/loop_h; sym_render_w = sym_w*sc
slot_start = x_after_l + slot_pad
tx = slot_start - minx*sc
ty = -xh*0.52 - loop_cy*sc
x_p = slot_start + sym_render_w + slot_pad + tracking
x_y = x_p + adv_p + tracking
W = x_y + adv_y
PAD = 14; ASC = 78; H = ASC + 30

vert8_w = sc*sym_h                         # horizontal footprint when rotated 90°
DELTA = (sym_render_w - vert8_w)/2 + 2     # how far letters close inward

GRAD = (f'<linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{loopy.GRAD[0]}"/>'
        f'<stop offset="1" stop-color="{loopy.GRAD[1]}"/></linearGradient>')

def _letter(ch, xp, fill):
    d = gl[ch][0]
    return (f'<g transform="translate({xp:.3f},0) scale({s:.5f},{-s:.5f})">'
            f'<path d="{d}" fill="{fill}"/></g>')

def _highlight(dash_off):
    dash = f'{LIT:.2f} {TOTAL-LIT:.2f}'
    glow = (f'<path d="{RD}" fill="none" stroke="#F7A9D0" stroke-width="{SW*1.05:.2f}" '
            f'stroke-linecap="round" stroke-dasharray="{dash}" stroke-dashoffset="{dash_off:.2f}" '
            f'opacity="0.28" filter="url(#glow)"/>')
    core = (f'<path d="{RD}" fill="none" stroke="#FDB6D8" stroke-width="{SW*0.46:.2f}" '
            f'stroke-linecap="round" stroke-dasharray="{dash}" stroke-dashoffset="{dash_off:.2f}" '
            f'opacity="0.5"/>')
    return glow + core

def frame(letter_fill, theta, delta, hi_op, dash_off, bg=None):
    l = _letter('l', 0 + delta, letter_fill)
    p = _letter('p', x_p - delta, letter_fill)
    y = _letter('y', x_y - delta, letter_fill)
    sym = (f'<g transform="translate({tx:.3f},{ty:.3f}) scale({sc:.5f}) rotate({theta:.3f} {cx:.3f} {cy:.3f})">'
           f'{loopy.symbol_group("url(#lg)")}'
           f'<g opacity="{hi_op:.3f}">{_highlight(dash_off)}</g></g>')
    defs = (f'<defs>{GRAD}<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">'
            f'<feGaussianBlur stdDeviation="3.2"/></filter></defs>')
    rect = f'<rect width="{W+2*PAD:.2f}" height="{H}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W+2*PAD:.2f} {H}">'
            f'{defs}{rect}<g transform="translate({PAD},{ASC})">{l}{sym}{p}{y}</g></svg>')

def smooth(a, b, p):
    p = max(0.0, min(1.0, p)); e = p*p*(3-2*p); return a+(b-a)*e

def intro_state(t):
    # t in [0,1] over the intro
    fade = smooth(0, 1, t/0.12)
    delta = smooth(DELTA, 0, (t-0.14)/0.34)          # letters open  ~0.14..0.48
    theta = smooth(90, 0, (t-0.46)/0.40)             # 8 lies down   ~0.46..0.86
    hi = smooth(0, 1, (t-0.86)/0.14)                 # flow fades in at the end
    return theta, delta, fade, hi

OUT = "/sessions/relaxed-vibrant-planck/mnt/logo/loopy-brand/animation"
DUR_INTRO = 2.5
DUR_FLOW = 2.4

def _letter_g(ch, xp, fill):
    d = gl[ch][0]
    return (f'<g transform="translate({xp:.3f},0) scale({s:.5f},{-s:.5f})"><path d="{d}" fill="{fill}"/></g>')

def svg_css(letter_fill):
    dash = f'{LIT:.2f} {TOTAL-LIT:.2f}'
    style = (
        '<style>'
        f'@keyframes lopen{{from{{transform:translateX({DELTA:.2f}px)}}to{{transform:translateX(0)}}}}'
        f'@keyframes ropen{{from{{transform:translateX(-{DELTA:.2f}px)}}to{{transform:translateX(0)}}}}'
        '@keyframes liedown{from{transform:rotate(90deg)}to{transform:rotate(0deg)}}'
        '@keyframes showhl{from{opacity:0}to{opacity:1}}'
        f'@keyframes flow{{to{{stroke-dashoffset:{-TOTAL:.2f}}}}}'
        '.lopen{animation:lopen .9s cubic-bezier(.5,0,.25,1) .35s both}'
        '.ropen{animation:ropen .9s cubic-bezier(.5,0,.25,1) .35s both}'
        '.rot{transform-box:fill-box;transform-origin:center;'
        'animation:liedown 1.05s cubic-bezier(.5,0,.25,1) 1.2s both}'
        '.hl{opacity:0;animation:showhl .45s linear 2.25s both}'
        f'.flow{{animation:flow {DUR_FLOW}s linear 2.7s infinite}}'
        '</style>')
    defs = (f'<defs>{GRAD}<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">'
            f'<feGaussianBlur stdDeviation="3.2"/></filter>{style}</defs>')
    hl = (f'<g class="hl">'
          f'<path class="flow" d="{RD}" fill="none" stroke="#F7A9D0" stroke-width="{SW*1.05:.2f}" '
          f'stroke-linecap="round" stroke-dasharray="{dash}" opacity="0.28" filter="url(#glow)"/>'
          f'<path class="flow" d="{RD}" fill="none" stroke="#FDB6D8" stroke-width="{SW*0.46:.2f}" '
          f'stroke-linecap="round" stroke-dasharray="{dash}" opacity="0.5"/></g>')
    sym = (f'<g transform="translate({tx:.3f},{ty:.3f}) scale({sc:.5f})">'
           f'<g class="rot">{loopy.symbol_group("url(#lg)")}{hl}</g></g>')
    body = (f'<g transform="translate({PAD},{ASC})">'
            f'<g class="lopen">{_letter_g("l",0,letter_fill)}</g>'
            f'{sym}'
            f'<g class="ropen">{_letter_g("p",x_p,letter_fill)}{_letter_g("y",x_y,letter_fill)}</g>'
            f'</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W+2*PAD:.2f} {H}">{defs}{body}</svg>')

def make_gif(path, letter_fill, bg, h=150, ni=40, nf=44):
    import re
    v = svg_css(letter_fill)
    _,_,vw,vh = map(float, re.search(r'viewBox="([\d.\- ]+)"', v).group(1).split())
    w = int(round(h*vw/vh))
    frames, durs = [], []
    for i in range(ni):                       # intro
        th, dl, fade, hi = intro_state(i/(ni-1))
        png = cairosvg.svg2png(bytestring=frame(letter_fill, th, dl, hi, 0, bg=bg).encode(),
                               output_width=w, output_height=h)
        frames.append(Image.open(io.BytesIO(png)).convert('RGB').quantize(colors=96, method=Image.MEDIANCUT))
        durs.append(int(DUR_INTRO*1000/ni))
    for j in range(nf):                       # hold + flow (one seamless cycle)
        png = cairosvg.svg2png(bytestring=frame(letter_fill, 0, 0, 1, -TOTAL*j/nf, bg=bg).encode(),
                               output_width=w, output_height=h)
        frames.append(Image.open(io.BytesIO(png)).convert('RGB').quantize(colors=96, method=Image.MEDIANCUT))
        durs.append(int(DUR_FLOW*1000/nf))
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durs, loop=0, optimize=True)

def generate_all():
    open(os.path.join(OUT, 'loopy-intro-dark.svg'), 'w').write(svg_css(loopy.DARK))
    open(os.path.join(OUT, 'loopy-intro-white.svg'), 'w').write(svg_css(loopy.WHITE))
    make_gif(os.path.join(OUT, 'loopy-intro-dark.gif'),  loopy.DARK,  '#FFFFFF')
    make_gif(os.path.join(OUT, 'loopy-intro-white.gif'), loopy.WHITE, loopy.ICON_BG)
    print("intro assets written")

if __name__ == '__main__':
    O = '/sessions/relaxed-vibrant-planck/mnt/outputs/'
    fr = [0.0, 0.20, 0.42, 0.60, 0.78, 1.0]
    ims = []
    for t in fr:
        th, dl, fade, hi = intro_state(t)
        svg = frame(loopy.DARK, th, dl, hi, 0, bg='#FFFFFF')
        import re
        _,_,vw,vh = map(float, re.search(r'viewBox="([\d.\- ]+)"', svg).group(1).split())
        h = 150; w = int(h*vw/vh)
        # apply global fade by compositing onto white
        png = cairosvg.svg2png(bytestring=svg.encode(), output_width=w, output_height=h)
        ims.append((t, Image.open(io.BytesIO(png)).convert('RGB')))
    from PIL import ImageDraw, ImageFont
    F = ImageFont.truetype('/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf', 16)
    Wc = max(i.width for _, i in ims)
    c = Image.new('RGB', (Wc+20, len(ims)*(150+30)+10), '#f4f4f6'); d = ImageDraw.Draw(c)
    yy = 8
    for t, im in ims:
        c.paste(im, (10, yy)); d.text((12, yy+152), 'intro t=%d%%' % int(t*100), font=F, fill='#888'); yy += 180
    c.save(O+'intro_storyboard.png'); print('storyboard saved; DELTA=%.1f vert8_w=%.1f sym_render_w=%.1f' % (DELTA, vert8_w, sym_render_w))
