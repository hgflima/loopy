"""Continuous-flow animation of the loopy symbol — animated SVG (CSS) + GIF."""
import math, importlib, os, io
import loopy; importlib.reload(loopy)
import cairosvg
from PIL import Image

OUT = "/sessions/relaxed-vibrant-planck/mnt/logo/loopy-brand/animation"
os.makedirs(OUT, exist_ok=True)

pts = loopy._ribbon_pts()
# total geometric length of the ribbon centreline
TOTAL = sum(math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]) for i in range(len(pts)-1))
LIT = TOTAL*0.13                      # length of the travelling light segment
DUR = 2.4                             # seconds per full loop
SW = loopy.SW

GRAD = (f'<linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{loopy.GRAD[0]}"/>'
        f'<stop offset="1" stop-color="{loopy.GRAD[1]}"/></linearGradient>')
RD = loopy.ribbon_d()
AD = loopy.arrow_d()

def base_defs():
    return (f'<defs>{GRAD}'
            f'<filter id="glow" x="-30%" y="-30%" width="160%" height="160%">'
            f'<feGaussianBlur stdDeviation="3.2"/></filter></defs>')

def static_layers():
    # solid gradient ribbon + arrow (the logo itself)
    return (f'<path d="{RD}" fill="none" stroke="url(#lg)" stroke-width="{SW}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{AD}" fill="url(#lg)"/>')

def highlight_layers(offset=None, animated=False):
    dash = f'{LIT:.2f} {TOTAL-LIT:.2f}'
    if animated:
        style = ('<style>@keyframes flow{to{stroke-dashoffset:%.2f;}}'
                 '.g,.c{animation:flow %.2fs linear infinite;}</style>') % (-TOTAL, DUR)
        off = ''
    else:
        style = ''
        off = f'stroke-dashoffset="{offset:.2f}"'
    # subtle: light magenta highlight (brand tone), low opacity, soft glow
    glow = (f'<path class="g" d="{RD}" fill="none" stroke="#F7A9D0" stroke-width="{SW*1.05:.2f}" '
            f'stroke-linecap="round" stroke-dasharray="{dash}" {off} opacity="0.28" filter="url(#glow)"/>')
    core = (f'<path class="c" d="{RD}" fill="none" stroke="#FDB6D8" stroke-width="{SW*0.46:.2f}" '
            f'stroke-linecap="round" stroke-dasharray="{dash}" {off} opacity="0.5"/>')
    return style + glow + core

# ---------- animated SVG (CSS) ----------
def animated_svg(bg=None):
    rect = f'<rect width="200" height="200" rx="0" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
            f'{base_defs()}{rect}{static_layers()}{highlight_layers(animated=True)}</svg>')

open(os.path.join(OUT, 'loopy-symbol-flow.svg'), 'w').write(animated_svg())
print("animated SVG written; TOTAL=%.1f LIT=%.1f" % (TOTAL, LIT))

# ---------- GIF ----------
def frame_svg(offset, bg):
    rect = f'<rect width="200" height="200" fill="{bg}"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
            f'{base_defs()}{rect}{static_layers()}{highlight_layers(offset=offset)}</svg>')

def make_gif(path, bg, size=360, N=36):
    frames = []
    for i in range(N):
        off = -TOTAL*i/N
        png = cairosvg.svg2png(bytestring=frame_svg(off, bg).encode(),
                               output_width=size, output_height=size)
        im = Image.open(io.BytesIO(png)).convert('RGB').quantize(colors=128, method=Image.MEDIANCUT)
        frames.append(im)
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=int(DUR*1000/N), loop=0, optimize=True)

make_gif(os.path.join(OUT, 'loopy-symbol-flow-dark.gif'), loopy.ICON_BG)
make_gif(os.path.join(OUT, 'loopy-symbol-flow-light.gif'), '#FFFFFF')
print("GIFs written")
