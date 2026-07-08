#!/usr/bin/env python3
"""Zoom the favicon at true 16/20/24/32 px (nearest-neighbour) to inspect pixels."""
import io, sys
import cairosvg
from PIL import Image
sys.path.insert(0, ".")
import gen_symbol as g

def raster(svg_str, px, bg):
    png = cairosvg.svg2png(bytestring=svg_str.encode(), output_width=px, output_height=px)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    base = Image.new("RGBA",(px,px),bg)
    base.alpha_composite(im)
    return base.convert("RGB")

def run(out):
    sizes=[16,20,24,32]
    Z=14
    magenta=g.svg("#C4207E"); white=g.svg("#FCFCFC")
    rows=[("mag/white",magenta,(255,255,255,255)),
          ("mag/dark",magenta,(25,27,29,255)),
          ("white/dark",white,(25,27,29,255))]
    pad=16
    cellw=max(sizes)*Z+pad*2
    cellh=cellw
    W=cellw*len(sizes); H=cellh*len(rows)
    canvas=Image.new("RGB",(W,H),(230,230,232))
    for ri,(_,svgstr,bg) in enumerate(rows):
        for ci,px in enumerate(sizes):
            im=raster(svgstr,px,bg).resize((px*Z,px*Z),Image.NEAREST)
            ox=ci*cellw+(cellw-px*Z)//2
            oy=ri*cellh+(cellh-px*Z)//2
            canvas.paste(im,(ox,oy))
    canvas.save(out); print("wrote",out,canvas.size)

if __name__=="__main__":
    run(sys.argv[1] if len(sys.argv)>1 else "zoom.png")
