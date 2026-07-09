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

# ================= SYMBOL (two-circle rounded figure-8 + arrow) =================
# The infinity is built from two real circles joined by the crossing (X) at the
# centre, giving genuinely round loops (not the pointed lemniscate lobes).
CX, CY = 100.0, 100.0
R_ = 41.0          # loop radius  (round loops)
D_ = 49.0          # half-distance between the two loop centres (must be > R_)
SW = 25.5          # stroke width
GAP_PTS = 62       # opening between the arrow tip and the other strand end
ARROW_EOFF = 13    # how far before the lobe bottom the ribbon terminates
ARROW_F = 1.08     # arrowhead size factor (× stroke width)
_N = 200

def _full_pts():
    r, D = R_, D_
    L = math.sqrt(D*D - r*r); ax = (D*D - r*r)/D; ay = r*L/D
    Tru = (ax, -ay); Trl = (ax, ay); Tlu = (-ax, -ay); Tll = (-ax, ay)
    CRc = (D, 0.0); CLc = (-D, 0.0)
    tr = lambda p: (CX + p[0], CY + p[1])
    ang = lambda c, p: math.atan2(p[1]-c[1], p[0]-c[0])
    def arc(c, a0, a1, d):
        da = (a1 - a0) % (2*math.pi)
        if d < 0: da -= 2*math.pi
        m = max(2, int(abs(da)/(2*math.pi)*_N*2))
        return [(CX+c[0]+r*math.cos(a0+da*i/m), CY+c[1]+r*math.sin(a0+da*i/m)) for i in range(m+1)]
    def line(p, q, m=30):
        return [tr((p[0]+(q[0]-p[0])*i/m, p[1]+(q[1]-p[1])*i/m)) for i in range(m+1)]
    return (line(Tru, Tll)                                  # crossing strand 1
            + arc(CLc, ang(CLc, Tll), ang(CLc, Tlu), +1)    # left loop (outer/major)
            + line(Tlu, Trl)                                # crossing strand 2
            + arc(CRc, ang(CRc, Trl), ang(CRc, Tru), -1))   # right loop (outer/major)

def _ribbon_pts():
    pts = _full_pts()
    bi = max(range(len(pts)), key=lambda i: pts[i][1] if pts[i][0] > CX else -1e9)
    end = bi - ARROW_EOFF; start = end + GAP_PTS
    return pts[start:] + pts[:end]     # open ribbon, ends at the arrow

def ribbon_d():
    p = _ribbon_pts()
    return "M " + " L ".join(f"{x:.3f} {y:.3f}" for x, y in p)

def arrow_d():
    p = _ribbon_pts()
    x2, y2 = p[-1]; x1, y1 = p[-7]
    dx, dy = x2-x1, y2-y1
    L = math.hypot(dx, dy) or 1.0; dx/=L; dy/=L
    px, py = -dy, dx
    f = SW*ARROW_F
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
