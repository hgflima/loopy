"""Build the complete loopy brand asset set."""
import os, math, importlib
import loopy; importlib.reload(loopy)
import cairosvg
from PIL import Image

OUT = "/sessions/relaxed-vibrant-planck/mnt/outputs/loopy-brand"
def P(*a):
    p = os.path.join(OUT, *a); os.makedirs(os.path.dirname(p), exist_ok=True); return p

# ---------- symbol visual bbox (for lockup layout) ----------
_p = loopy._ribbon_pts()
xs = [x for x,y in _p]; ys = [y for x,y in _p]
hw = loopy.SW/2 + 1
SX0, SX1 = min(xs)-hw, max(xs)+loopy.SW  # arrow extends right/down a bit
SY0, SY1 = min(ys)-hw, max(ys)+loopy.SW
# use symmetric-ish real bbox
SX0, SY0, SX1, SY1 = 3.0, 27.0, 178.0, 175.0

GRAD_DEF = (f'<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{loopy.GRAD[0]}"/>'
            f'<stop offset="1" stop-color="{loopy.GRAD[1]}"/></linearGradient></defs>')

def svg_symbol(fill, grad=False):
    d = GRAD_DEF if grad else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">{d}'
            f'{loopy.symbol_group(fill)}</svg>')

def write(path, svg):
    open(path, 'w').write(svg)

# ================= 1. SYMBOL SVGs =================
write(P('svg','symbol','loopy-symbol-gradient.svg'), svg_symbol('url(#lg)', grad=True))
write(P('svg','symbol','loopy-symbol-black.svg'),     svg_symbol(loopy.DARK))
write(P('svg','symbol','loopy-symbol-white.svg'),     svg_symbol(loopy.WHITE))
write(P('svg','symbol','loopy-symbol-brand.svg'),     svg_symbol(loopy.BRAND))
write(P('svg','symbol','loopy-symbol-mono-black.svg'),svg_symbol('#000000'))

# ================= 2. ROUNDED-DARK ICON SVG =================
def svg_icon_rounded(size=200, bg=loopy.ICON_BG, fill='url(#lg)', grad=True, radius_ratio=0.2237, inset=0.60):
    d = GRAD_DEF if grad else ''
    r = size*radius_ratio
    # symbol currently drawn in 200-box; scale it to `inset` of icon, centre it
    # symbol visual bbox
    sw_ = SX1-SX0; sh_ = SY1-SY0
    target = size*inset
    sc = target/max(sw_, sh_)
    gx = (size - sw_*sc)/2 - SX0*sc
    gy = (size - sh_*sc)/2 - SY0*sc
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">{d}'
            f'<rect x="0" y="0" width="{size}" height="{size}" rx="{r:.2f}" ry="{r:.2f}" fill="{bg}"/>'
            f'<g transform="translate({gx:.3f},{gy:.3f}) scale({sc:.5f})">{loopy.symbol_group(fill)}</g>'
            f'</svg>')

write(P('svg','icon','loopy-icon-rounded-dark.svg'), svg_icon_rounded())

# ================= 3. WORDMARK SVGs =================
def svg_wordmark(fill):
    mk, w, cap = loopy.wordmark_group(fill, fill)
    pad = 12; asc = 78; desc = 26; H = asc+desc
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w+2*pad:.2f} {H}">'
            f'<g transform="translate({pad},{asc})">{mk}</g></svg>')
write(P('svg','wordmark','loopy-wordmark-black.svg'), svg_wordmark(loopy.DARK))
write(P('svg','wordmark','loopy-wordmark-white.svg'), svg_wordmark(loopy.WHITE))

# ================= 4. LOCKUPS =================
def lockup_horizontal(sym_fill, word_fill, grad=False):
    d = GRAD_DEF if grad else ''
    mk, w, cap = loopy.wordmark_group(word_fill, word_fill)
    # symbol height target = 116 units; wordmark cap ~70. scale symbol.
    SYMH = 118.0
    sw_ = SX1-SX0; sh_ = SY1-SY0
    sc = SYMH/sh_
    sym_w = sw_*sc
    gap = 26
    # wordmark drawn baseline at y=0, spans -cap..+desc(~22). Vertical centre of cap ~ -cap/2
    # Place everything on a canvas; align symbol vertical centre with wordmark x-centre(cap/2)
    pad = 16
    word_cx_top = -70; word_desc = 24
    # canvas height from symbol
    H = SYMH + 2*pad
    # symbol group placed at left
    sym_cy = H/2
    sgx = pad - SX0*sc
    sgy = sym_cy - (sh_*sc)/2 - SY0*sc
    # wordmark: baseline so that cap centre aligns with symbol centre
    wx = pad + sym_w + gap
    wy = sym_cy + 70*0.5*0.62   # nudge baseline; cap sits above baseline
    total_w = wx + w + pad
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.2f} {H:.2f}">{d}'
            f'<g transform="translate({sgx:.3f},{sgy:.3f}) scale({sc:.5f})">{loopy.symbol_group(sym_fill)}</g>'
            f'<g transform="translate({wx:.3f},{wy:.3f})">{mk}</g></svg>')

def lockup_stacked(sym_fill, word_fill, grad=False):
    d = GRAD_DEF if grad else ''
    mk, w, cap = loopy.wordmark_group(word_fill, word_fill)
    SYMH = 150.0
    sw_ = SX1-SX0; sh_ = SY1-SY0
    sc = SYMH/sh_
    sym_w = sw_*sc
    # wordmark scale up to match ~ symbol width feeling: keep em=100, width w
    pad = 18; gap = 30
    content_w = max(sym_w, w)
    total_w = content_w + 2*pad
    # symbol centred top
    sgx = (total_w - sw_*sc)/2 - SX0*sc
    sgy = pad - SY0*sc
    # wordmark centred below
    wbase = pad + SYMH + gap + 70   # baseline
    wx = (total_w - w)/2
    H = wbase + 26 + pad
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.2f} {H:.2f}">{d}'
            f'<g transform="translate({sgx:.3f},{sgy:.3f}) scale({sc:.5f})">{loopy.symbol_group(sym_fill)}</g>'
            f'<g transform="translate({wx:.3f},{wbase:.3f})">{mk}</g></svg>')

write(P('svg','lockup','loopy-lockup-horizontal-gradient.svg'), lockup_horizontal('url(#lg)', loopy.DARK, grad=True))
write(P('svg','lockup','loopy-lockup-horizontal-black.svg'),    lockup_horizontal(loopy.DARK, loopy.DARK))
write(P('svg','lockup','loopy-lockup-horizontal-white.svg'),    lockup_horizontal(loopy.WHITE, loopy.WHITE))
write(P('svg','lockup','loopy-lockup-stacked-gradient.svg'),    lockup_stacked('url(#lg)', loopy.DARK, grad=True))
write(P('svg','lockup','loopy-lockup-stacked-black.svg'),       lockup_stacked(loopy.DARK, loopy.DARK))
write(P('svg','lockup','loopy-lockup-stacked-white.svg'),       lockup_stacked(loopy.WHITE, loopy.WHITE))

print("SVGs written")

# ================= 5. PNG RENDERS =================
def rp(svg, path, size):
    cairosvg.svg2png(bytestring=svg.encode(), write_to=path,
                     output_width=size, output_height=size, background_color=None)

sym_grad_svg = svg_symbol('url(#lg)', grad=True)
icon_svg     = svg_icon_rounded()
for s in (1024,512,256,128):
    rp(sym_grad_svg, P('png','symbol-transparent', f'loopy-symbol-{s}.png'), s)
    rp(icon_svg,     P('png','icon-rounded-dark',  f'loopy-icon-{s}.png'), s)
print("core PNGs written")

# ================= 6. FAVICONS =================
for s in (16,32,48):
    rp(sym_grad_svg, P('favicon', f'favicon-{s}x{s}.png'), s)
rp(icon_svg, P('favicon','apple-touch-icon.png'), 180)
rp(icon_svg, P('favicon','android-chrome-192x192.png'), 192)
rp(icon_svg, P('favicon','android-chrome-512x512.png'), 512)
# favicon.ico multi-res from symbol
ims = [Image.open(P('favicon',f'favicon-{s}x{s}.png')).convert('RGBA') for s in (16,32,48)]
ims[0].save(P('favicon','favicon.ico'), format='ICO',
            sizes=[(16,16),(32,32),(48,48)], append_images=ims[1:])
print("favicons written")

# ================= 7. WINDOWS ICO (app, up to 256) =================
tmp = {}
for s in (16,32,48,64,128,256):
    fp = f'/tmp/ico_{s}.png'; rp(icon_svg, fp, s); tmp[s]=Image.open(fp).convert('RGBA')
tmp[256].save(P('windows','loopy.ico'), format='ICO',
              sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)],
              append_images=[tmp[s] for s in (16,32,48,64,128)])
# also copy web favicon.ico into windows
import shutil; shutil.copy(P('favicon','favicon.ico'), P('windows','favicon.ico'))
print("windows ico written")

# ================= 8. macOS ICNS + iconset =================
iconset = P('macos','AppIcon.iconset','_'); iconset = os.path.dirname(iconset)
specs = [('icon_16x16',16),('icon_16x16@2x',32),('icon_32x32',32),('icon_32x32@2x',64),
         ('icon_128x128',128),('icon_128x128@2x',256),('icon_256x256',256),
         ('icon_256x256@2x',512),('icon_512x512',512),('icon_512x512@2x',1024)]
for name,px in specs:
    rp(icon_svg, os.path.join(iconset, f'{name}.png'), px)
# build icns with Pillow from 1024 master
master = Image.open(os.path.join(iconset,'icon_512x512@2x.png')).convert('RGBA')
master.save(P('macos','AppIcon.icns'), format='ICNS')
print("icns written")

# ================= 9. TRAY TEMPLATE (monochrome, transparent) =================
tray_svg = svg_symbol('#000000')  # pure black; macOS template recolours
def rp_tray(path, size):
    cairosvg.svg2png(bytestring=tray_svg.encode(), write_to=path,
                     output_width=size, output_height=size, background_color=None)
rp_tray(P('macos','tray','loopy-trayTemplate.png'), 18)
rp_tray(P('macos','tray','loopy-trayTemplate@2x.png'), 36)
rp_tray(P('macos','tray','loopy-tray-22Template.png'), 22)
rp_tray(P('macos','tray','loopy-tray-22Template@2x.png'), 44)
print("tray written")
print("DONE")
