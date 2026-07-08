"""loopy brand asset generator — shared geometry module."""
import math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

FONT = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"

# ---------- colours ----------
GRAD = ('#E62A88', '#A5145F')   # magenta gradient (top-left -> bottom-right)
BRAND = '#BD2172'
DARK = '#17171A'
WHITE = '#FFFFFF'
ICON_BG = '#26262B'

# ================= SYMBOL (figure-8 + arrow) =================
CX, CY = 100.0, 100.0
AX = AY = 84.0
SW = 21.0
ARROW_T = 44.0
GAP_DEG = 26.0

def _pt(t):
    return CX + AX*math.cos(t), CY + AY*math.sin(t)*math.cos(t)

def _ribbon_pts():
    t_end = math.radians(ARROW_T) + 2*math.pi
    t_start = t_end - (2*math.pi - math.radians(GAP_DEG))
    N = 600
    return [_pt(t_start + (t_end-t_start)*i/N) for i in range(N+1)]

def ribbon_d():
    p = _ribbon_pts()
    return "M " + " L ".join(f"{x:.3f} {y:.3f}" for x, y in p)

def arrow_d():
    p = _ribbon_pts()
    x2, y2 = p[-1]; x1, y1 = p[-8]
    dx, dy = x2-x1, y2-y1
    L = math.hypot(dx, dy); dx/=L; dy/=L
    px, py = -dy, dx
    f = SW*1.05
    tip = (x2+dx*f, y2+dy*f)
    b1 = (x2+px*f, y2+py*f); b2 = (x2-px*f, y2-py*f)
    return f"M {tip[0]:.3f} {tip[1]:.3f} L {b1[0]:.3f} {b1[1]:.3f} L {b2[0]:.3f} {b2[1]:.3f} Z"

def symbol_group(fill):
    """Return <g> markup for the symbol using given fill (gradient url or colour)."""
    return (f'<path d="{ribbon_d()}" fill="none" stroke="{fill}" stroke-width="{SW}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{arrow_d()}" fill="{fill}"/>')

# symbol tight bbox (approx) for layout in lockups
SYM_X0, SYM_Y0, SYM_X1, SYM_Y1 = 5.0, 30.0, 195.0, 170.0  # padded box in 200 space

# ================= closed infinity (for wordmark 'oo') =================
def infinity_d(cx, cy, ax, ay):
    N = 400
    pts = [(cx+ax*math.cos(t), cy+ay*math.sin(t)*math.cos(t))
           for t in (2*math.pi*i/N for i in range(N+1))]
    return "M " + " L ".join(f"{x:.3f} {y:.3f}" for x, y in pts)

# ================= wordmark (Poppins Bold, letters -> paths) =================
_font = TTFont(FONT)
_upm = _font['head'].unitsPerEm
_gs = _font.getGlyphSet()
_cmap = _font.getBestCmap()

def _glyph(ch):
    name = _cmap[ord(ch)]
    pen = SVGPathPen(_gs)
    _gs[name].draw(pen)
    return pen.getCommands(), _gs[name].width

def wordmark_group(fill, stroke_for_oo):
    """Build 'loopy' with the 'oo' as a linked-loop infinity.
    Returns (markup, total_width, cap_height) in a 100-unit em coordinate space
    where y increases downward and baseline sits at y=0. Letters scaled so em=100.
    """
    s = 100.0/_upm            # scale font units -> 100 em
    # We flip y (font y-up -> svg y-down) via transform on each glyph.
    parts = []
    x = 0.0
    tracking = 2.0            # extra spacing between clusters (em units /100)
    def place_glyph(ch, xpos):
        d, adv = _glyph(ch)
        # transform: translate(xpos,0) scale(s,-s)
        parts.append(f'<g transform="translate({xpos:.3f},0) scale({s:.5f},{-s:.5f})">'
                     f'<path d="{d}" fill="{fill}"/></g>')
        return adv*s
    # l
    x += place_glyph('l', x) + tracking
    # oo -> infinity glyph. size: width ~ two lowercase o advances; height ~ x-height
    ow = _glyph('o')[1]*s
    xh = (_font['OS/2'].sxHeight * s) if hasattr(_font['OS/2'],'sxHeight') else 52.0
    inf_w = ow*1.60
    icx = x + inf_w/2
    icy = -xh/2          # centre on x-height (y-down space, baseline 0)
    isw = 17.0           # match bold stem weight
    ax = inf_w/2 - isw/2
    ay = xh/2 - isw/2    # fit within x-height
    parts.append(f'<path d="{infinity_d(icx, icy, ax, ay)}" fill="none" '
                 f'stroke="{stroke_for_oo}" stroke-width="{isw:.3f}" '
                 f'stroke-linecap="round" stroke-linejoin="round"/>')
    x = icx + inf_w/2 + tracking
    # p
    x += place_glyph('p', x) + tracking
    # y
    x += place_glyph('y', x)
    total_w = x
    cap = _font['OS/2'].sCapHeight*s if hasattr(_font['OS/2'],'sCapHeight') else 70.0
    return "".join(parts), total_w, cap
