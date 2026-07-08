#!/usr/bin/env python3
"""Render the `loopy` wordmark + horizontal lockup using SF Pro (SFNS variable).

The symbol is rasterized from gen_symbol; the wordmark is set in San Francisco
semibold, lowercase, tight tracking — matching the app's -apple-system voice.
"""
import io, sys, os
import cairosvg
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, ".")
import gen_symbol as g

SF = "/System/Library/Fonts/SFNS.ttf"
INK = (25, 27, 29, 255)      # #191B1D
MAGENTA = (196, 32, 126, 255)  # #C4207E
WHITE = (252, 252, 252, 255)   # #FCFCFC

def load_sf(px, weight=600):
    f = ImageFont.truetype(SF, px)
    try:
        f.set_variation_by_axes([weight])  # wght axis
    except Exception as e:
        print("  (variation not set:", e, ")")
    return f

def sym_img(color_hex, px):
    png = cairosvg.svg2png(bytestring=g.svg(color_hex).encode(),
                           output_width=px, output_height=px)
    return Image.open(io.BytesIO(png)).convert("RGBA")

def measure(font, text, tracking):
    """Return (width, per-glyph x offsets) applying tracking (px between glyphs)."""
    xs = []
    x = 0
    tmp = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(tmp)
    for ch in text:
        xs.append(x)
        w = d.textlength(ch, font=font)
        x += w + tracking
    return x - tracking, xs

def draw_wordmark(color, px, tracking, text="loopy"):
    font = load_sf(px, 600)
    # bbox for vertical extents
    tmp = Image.new("RGBA", (10, 10)); d = ImageDraw.Draw(tmp)
    asc, desc = font.getmetrics()
    total_w, xs = measure(font, text, tracking)
    W = int(total_w) + px  # margin
    H = asc + desc
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    for ch, xo in zip(text, xs):
        dr.text((xo, 0), ch, font=font, fill=color)
    return img.crop(img.getbbox()), font

def lockup(sym_hex, word_color, out, bg=None, scale=1024):
    # design proportions on a nominal grid
    px = int(scale * 0.62)              # wordmark cap size driver
    tracking = -px * 0.015             # tight tracking
    word, font = draw_wordmark(word_color, px, tracking)
    ww, wh = word.size
    # cap height ~ the height of 'l'; symbol sized to ~ cap height * 1.18
    tmp = Image.new("RGBA", (10, 10)); d = ImageDraw.Draw(tmp)
    cap_bbox = d.textbbox((0, 0), "l", font=font)
    cap_h = cap_bbox[3] - cap_bbox[1]
    sym_px = int(cap_h * 1.46)
    sym = sym_img(sym_hex, sym_px)
    # trim symbol to its ink bbox for precise placement
    sym = sym.crop(sym.getbbox())
    sw, sh = sym.size
    gap = int(sym_px * 0.30)
    pad = int(sym_px * 0.30)
    # vertical: align symbol optical centre to the wordmark's lowercase body centre.
    # Use the 'o' vertical centre of the wordmark as anchor.
    ob = d.textbbox((0, 0), "o", font=font)
    x_body_top = ob[1]; x_body_bot = ob[3]
    # In the cropped word image, baseline geometry shifted; approximate body centre
    # as vertical centre of the wordmark bbox biased up slightly for descenders.
    word_body_centre = wh * 0.44
    H = int(max(sh, wh) + pad * 2)
    W = int(sw + gap + ww + pad * 2)
    canvas = Image.new("RGBA", (W, H), bg if bg else (0, 0, 0, 0))
    sym_y = int(pad + word_body_centre - sh / 2)
    word_y = pad
    canvas.alpha_composite(sym, (pad, max(pad, sym_y)))
    canvas.alpha_composite(word, (pad + sw + gap, word_y))
    canvas.save(out)
    print("wrote", out, canvas.size)
    return canvas

if __name__ == "__main__":
    os.makedirs("png", exist_ok=True)
    # wordmark alone
    w_ink, _ = draw_wordmark(INK, 620, -620*0.015)
    w_ink.save("png/wordmark-ink.png")
    w_white, _ = draw_wordmark(WHITE, 620, -620*0.015)
    w_white.save("png/wordmark-white.png")
    print("wrote wordmark-ink / wordmark-white")
    # lockups
    lockup("#C4207E", INK, "png/_lockup-light.png", bg=(255,255,255,255))
    lockup("#CB2984", WHITE, "png/_lockup-dark.png", bg=(25,27,29,255))
