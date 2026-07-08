#!/usr/bin/env python3
"""Full export pipeline for the loopy logo system.

Produces, from the parametric symbol + SF Pro wordmark:
  src/            clean SVG deliverables (symbol variants, padded icon, wordmark, lockup)
  png/            raster masters (symbol 1024/512/256/128, lockups)
  favicon/        favicon-16/32/48, apple-touch-icon, android-chrome-192/512, favicon.ico
  tray/           macOS monochrome template (18 + 36 @2x)
"""
import io, os, sys
import cairosvg
from PIL import Image
sys.path.insert(0, ".")
import gen_symbol as g
import wordmark as wm

MAGENTA = "#C4207E"
MAGENTA_DARK = "#CB2984"
INK = "#191B1D"
WHITE = "#FCFCFC"

# ---------- helpers --------------------------------------------------------

def raster_symbol(color, px, supersample=4):
    """Rasterize the 24-grid symbol at hi-res for measuring / compositing."""
    s = cairosvg.svg2png(bytestring=g.svg(color).encode(),
                         output_width=px*supersample, output_height=px*supersample)
    im = Image.open(io.BytesIO(s)).convert("RGBA")
    return im

def ink_bbox_24():
    """Ink bbox of the symbol in 24-grid units (measured via hi-res raster)."""
    N = 2400
    im = raster_symbol(MAGENTA, N, supersample=1)
    bbox = im.getbbox()  # pixels
    scale = 24.0 / N
    return (bbox[0]*scale, bbox[1]*scale, bbox[2]*scale, bbox[3]*scale)

def padded_symbol_png(color, size, safe=0.14):
    """Optically-centred symbol filling (1-2*safe) of a square, transparent bg."""
    bx0, by0, bx1, by1 = ink_bbox_24()
    iw, ih = bx1 - bx0, by1 - by0
    span = max(iw, ih)
    target = size * (1 - 2*safe)
    scale = target / span
    render_px = 24 * scale                       # px for full 24-grid render
    ss = 4
    s = cairosvg.svg2png(bytestring=g.svg(color).encode(),
                         output_width=int(render_px*ss), output_height=int(render_px*ss))
    full = Image.open(io.BytesIO(s)).convert("RGBA")
    # crop to ink bbox in this render
    cb = (int(bx0*scale*ss), int(by0*scale*ss), int(bx1*scale*ss), int(by1*scale*ss))
    ink = full.crop(cb)
    ink = ink.resize((int(iw*scale), int(ih*scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0,0,0,0))
    ox = (size - ink.width)//2
    oy = (size - ink.height)//2
    canvas.alpha_composite(ink, (ox, oy))
    return canvas

# ---------- clean SVG deliverables ----------------------------------------

def write_svgs(outdir):
    bx0, by0, bx1, by1 = ink_bbox_24()
    # tight symbol: viewBox snug to ink + 1u margin
    m = 1.0
    vb = f"{bx0-m:.2f} {by0-m:.2f} {(bx1-bx0)+2*m:.2f} {(by1-by0)+2*m:.2f}"
    for name, col in [("symbol-magenta", MAGENTA), ("symbol-ink", INK), ("symbol-white", WHITE)]:
        body = g.build_symbol(col)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" '
               f'width="512" height="512" role="img" aria-label="loopy">\n  {body}\n</svg>\n')
        open(os.path.join(outdir, name+".svg"), "w").write(svg)
    # padded icon SVG (magenta), 12% safe area, centred in 24 box
    iw, ih = bx1-bx0, by1-by0; span=max(iw,ih); safe=0.12
    scale=(24*(1-2*safe))/span
    cx=(bx0+bx1)/2; cy=(by0+by1)/2
    tx=12-cx*scale; ty=12-cy*scale
    body = g.build_symbol(MAGENTA)
    svg=(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1024" height="1024" role="img" aria-label="loopy app icon">\n'
         f'  <g transform="translate({tx:.3f} {ty:.3f}) scale({scale:.4f})">{body}</g>\n</svg>\n')
    open(os.path.join(outdir,"icon-magenta.svg"),"w").write(svg)
    print("wrote SVGs -> src/")

# ---------- wordmark & lockup as live-text SVG ----------------------------

def write_text_svgs(outdir):
    font_stack = "-apple-system, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif"
    # wordmark
    for name, col in [("wordmark-ink", INK), ("wordmark-white", WHITE)]:
        svg=(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 128" width="400" height="128">\n'
             f'  <text x="0" y="98" font-family="{font_stack}" font-size="120" '
             f'font-weight="600" letter-spacing="-1.8" fill="{col}">loopy</text>\n</svg>\n')
        open(os.path.join(outdir,name+".svg"),"w").write(svg)
    # lockup (symbol + text), symbol scaled into a 128-tall band
    bx0,by0,bx1,by1=ink_bbox_24(); iw,ih=bx1-bx0,by1-by0; span=max(iw,ih)
    sym_h=96.0; scale=sym_h/span; cy=(by0+by1)/2; cx=(bx0+bx1)/2
    sym_w=iw*scale
    ty=64-cy*scale; tx=16-bx0*scale
    for name,symcol,txtcol in [("lockup-light",MAGENTA,INK),("lockup-dark",MAGENTA_DARK,WHITE)]:
        body=g.build_symbol(symcol)
        text_x=16+sym_w+34
        svg=(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 128" width="520" height="128">\n'
             f'  <g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.4f})">{body}</g>\n'
             f'  <text x="{text_x:.1f}" y="92" font-family="{font_stack}" font-size="104" '
             f'font-weight="600" letter-spacing="-1.6" fill="{txtcol}">loopy</text>\n</svg>\n')
        open(os.path.join(outdir,name+".svg"),"w").write(svg)
    print("wrote text SVGs -> src/")

# ---------- raster masters, favicons, tray --------------------------------

def export_rasters():
    os.makedirs("png", exist_ok=True)
    os.makedirs("favicon", exist_ok=True)
    os.makedirs("tray", exist_ok=True)

    # symbol masters (12% safe area)
    for size in [1024,512,256,128]:
        padded_symbol_png(MAGENTA, size, safe=0.12).save(f"png/symbol-magenta-{size}.png")
    padded_symbol_png(INK,1024,safe=0.12).save("png/symbol-ink-1024.png")
    padded_symbol_png(WHITE,1024,safe=0.12).save("png/symbol-white-1024.png")

    # app icon master (rounded-square friendly, transparent) — the .icns/.ico source
    padded_symbol_png(MAGENTA,1024,safe=0.14).save("png/appicon-1024.png")

    # favicons: tighter safe area so small sizes stay legible
    fav = {"favicon-16x16.png":16,"favicon-32x32.png":32,"favicon-48x48.png":48,
           "apple-touch-icon.png":180,"android-chrome-192x192.png":192,
           "android-chrome-512x512.png":512}
    for fn,px in fav.items():
        safe = 0.08 if px<=48 else 0.12
        padded_symbol_png(MAGENTA,px,safe=safe).save(os.path.join("favicon",fn))
    # favicon.ico (multi-res)
    ico_imgs=[padded_symbol_png(MAGENTA,s,safe=0.08 if s<=48 else 0.12) for s in (16,32,48)]
    ico_imgs[0].save("favicon/favicon.ico", sizes=[(16,16),(32,32),(48,48)],
                     append_images=ico_imgs[1:])

    # macOS tray template — PURE BLACK, transparent, so macOS auto-tints it
    for fn,px,safe in [("loopyTemplate.png",18,0.06),("loopyTemplate@2x.png",36,0.06)]:
        padded_symbol_png("#000000",px,safe=safe).save(os.path.join("tray",fn))

    print("wrote rasters -> png/ favicon/ tray/")

def export_lockups():
    # final lockups on transparent + light + dark (PNG), plus SVG already written
    wm.lockup(MAGENTA, wm.INK, "png/lockup-light.png", bg=(255,255,255,255))
    wm.lockup(MAGENTA_DARK, wm.WHITE, "png/lockup-dark.png", bg=(25,27,29,255))
    wm.lockup(MAGENTA, wm.INK, "png/lockup-transparent-ink.png", bg=None)
    wm.lockup(MAGENTA_DARK, wm.WHITE, "png/lockup-transparent-white.png", bg=None)
    print("wrote lockups -> png/")

if __name__ == "__main__":
    write_svgs("src")
    write_text_svgs("src")
    export_rasters()
    export_lockups()
    print("DONE")
