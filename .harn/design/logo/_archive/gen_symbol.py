#!/usr/bin/env python3
"""Parametric generator for the loopy loop-symbol.

Design intent (from .harn/design/LOGO-SPEC.md):
  A single continuous geometric loop — a clean recirculation / return arrow
  that closes on itself. One uniform stroke weight, optically-corrected,
  ONE arrowhead marking the cycle direction. Must survive at 16x16.

Built on a 24x24 SF-Symbols-style grid; scaled up by the viewBox.
"""
import math

# ---- Tunables (24-grid) ---------------------------------------------------
CX = CY = 12.0
R = 7.7            # centerline radius of the ring
W = 2.9            # uniform stroke weight
LEAD = 270.0       # leading tip (arrowhead) at TOP, pointing right (clockwise)
SWEEP = 322.0      # clockwise arc span; gap = 360 - SWEEP
HEAD_LEN = 5.6     # arrowhead length (tip to base), along tangent
HEAD_W = 6.6       # arrowhead full width, across normal

# Angle convention: SVG y is DOWN. t in degrees, point = (cx+R cos t, cy+R sin t)
#   t=270 -> top(N), t=0 -> right(E), t=90 -> bottom(S), t=180 -> left(W)
# Increasing t = clockwise on screen.


def pt(t_deg, r=R):
    t = math.radians(t_deg)
    return (CX + r * math.cos(t), CY + r * math.sin(t))


def tangent(t_deg):
    """Unit tangent for INCREASING t (clockwise on screen)."""
    t = math.radians(t_deg)
    return (-math.sin(t), math.cos(t))


def build_symbol(color, stroke_w=W, head_len=HEAD_LEN, head_w=HEAD_W,
                 sweep=SWEEP):
    t_lead = LEAD              # arrowhead tip lands here (top), points right
    t_tail = t_lead - sweep    # trailing round cap; arc sweeps cw up to the tip

    # Pull the stroke's leading end back so the arrowhead base meets it cleanly.
    # The arc ends a little before the tip; the triangle bridges the rest.
    t_arc_end = t_lead - math.degrees(head_len * 0.5 / R)

    p_start = pt(t_tail)
    p_arc_end = pt(t_arc_end)

    large = 1 if (t_arc_end - t_tail) > 180 else 0

    # Arrowhead: isosceles triangle centered on the ring centerline at t_lead,
    # pointing along the clockwise tangent (chasing its own tail into the gap).
    tip_ang = t_lead
    P = pt(tip_ang)
    tx, ty = tangent(tip_ang)
    nx, ny = -ty, tx  # normal
    tip = (P[0] + tx * head_len * 0.5, P[1] + ty * head_len * 0.5)
    baseC = (P[0] - tx * head_len * 0.5, P[1] - ty * head_len * 0.5)
    bl = (baseC[0] + nx * head_w * 0.5, baseC[1] + ny * head_w * 0.5)
    br = (baseC[0] - nx * head_w * 0.5, baseC[1] - ny * head_w * 0.5)

    d_arc = (f"M {p_start[0]:.3f} {p_start[1]:.3f} "
             f"A {R:.3f} {R:.3f} 0 {large} 1 {p_arc_end[0]:.3f} {p_arc_end[1]:.3f}")
    d_head = (f"M {tip[0]:.3f} {tip[1]:.3f} "
              f"L {bl[0]:.3f} {bl[1]:.3f} L {br[0]:.3f} {br[1]:.3f} Z")

    return f'''<path d="{d_arc}" fill="none" stroke="{color}" stroke-width="{stroke_w}" stroke-linecap="round"/>
  <path d="{d_head}" fill="{color}" stroke="{color}" stroke-width="{stroke_w*0.0:.2f}" stroke-linejoin="round"/>'''


def svg(color, pad=0.0, bg=None):
    body = build_symbol(color)
    bgrect = f'<rect width="24" height="24" fill="{bg}"/>\n  ' if bg else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1024" height="1024">
  {bgrect}{body}
</svg>'''


if __name__ == "__main__":
    import sys, os
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    variants = {
        "symbol-magenta.svg": "#C4207E",
        "symbol-ink.svg": "#191B1D",
        "symbol-white.svg": "#FCFCFC",
    }
    for fn, col in variants.items():
        with open(os.path.join(out, fn), "w") as f:
            f.write(svg(col))
        print("wrote", fn)
