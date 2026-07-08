#!/usr/bin/env python3
"""Render a contact sheet of the symbol at real sizes on light+dark tiles."""
import io, sys
import cairosvg
from PIL import Image
sys.path.insert(0, ".")
import gen_symbol as g

SIZES = [16, 24, 32, 64, 128]

def raster(svg_str, px):
    png = cairosvg.svg2png(bytestring=svg_str.encode(), output_width=px, output_height=px)
    return Image.open(io.BytesIO(png)).convert("RGBA")

def sheet(out):
    magenta = g.svg("#C4207E")
    white   = g.svg("#FCFCFC")
    ink     = g.svg("#191B1D")
    pad = 24
    cols = SIZES + [256]
    # rows: magenta-on-white, magenta-on-dark, white-on-dark, ink-on-white
    rows = [("magenta", magenta, (255,255,255,255)),
            ("magenta", magenta, (25,27,29,255)),
            ("white",   white,   (25,27,29,255)),
            ("ink",     ink,     (255,255,255,255))]
    rowh = 256 + pad*2
    colw = 256 + pad*2
    W = colw*len(cols)
    H = rowh*len(rows)
    canvas = Image.new("RGBA", (W, H), (245,245,247,255))
    for ri,(name,svgstr,bg) in enumerate(rows):
        for ci,px in enumerate(cols):
            cellbg = Image.new("RGBA",(colw,rowh),bg)
            im = raster(svgstr, px)
            ox = (colw-px)//2
            oy = (rowh-px)//2
            cellbg.alpha_composite(im,(ox,oy))
            canvas.alpha_composite(cellbg,(ci*colw, ri*rowh))
    canvas.convert("RGB").save(out)
    print("wrote", out, canvas.size)

if __name__ == "__main__":
    sheet(sys.argv[1] if len(sys.argv)>1 else "contact.png")
