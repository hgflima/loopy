#!/usr/bin/env python3
"""Compose a brand sheet showing the full loopy logo system."""
import io
from PIL import Image, ImageDraw, ImageFont
import cairosvg, sys
sys.path.insert(0,".")
import gen_symbol as g

SF = "/System/Library/Fonts/SFNS.ttf"
def sf(px,w=500):
    f=ImageFont.truetype(SF,px)
    try:f.set_variation_by_axes([w])
    except:pass
    return f

def sym(color,px):
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=g.svg(color).encode(),output_width=px,output_height=px))).convert("RGBA")

def rounded(size,radius,fill):
    im=Image.new("RGBA",(size,size),(0,0,0,0))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle([0,0,size-1,size-1],radius=radius,fill=fill)
    return im

W,H=1800,1500
c=Image.new("RGBA",(W,H),(247,247,249,255))
d=ImageDraw.Draw(c)
lab=sf(26,500); big=sf(40,600); small=sf(20,400)
INK=(25,27,29,255); GREY=(120,124,130,255)

def title(x,y,t): d.text((x,y),t,font=lab,fill=INK)
def cap(x,y,t): d.text((x,y),t,font=small,fill=GREY)

# --- Row 1: symbol color variants -----------------------------------------
title(60,40,"Symbol — 3 variants")
tiles=[("magenta / light",(255,255,255,255),"#C4207E"),
       ("magenta / dark",(25,27,29,255),"#CB2984"),
       ("white / dark",(25,27,29,255),"#FCFCFC"),
       ("ink / light",(255,255,255,255),"#191B1D")]
tx0,ty0,ts=60,90,280
for i,(nm,bg,col) in enumerate(tiles):
    x=tx0+i*(ts+30)
    tile=Image.new("RGBA",(ts,ts),bg)
    s=sym(col,int(ts*0.66)); tile.alpha_composite(s,((ts-s.width)//2,(ts-s.height)//2))
    c.alpha_composite(tile,(x,ty0))
    cap(x,ty0+ts+8,nm)

# --- Row 2: app icon + favicon zoom + tray --------------------------------
ry=470
title(60,ry,"App icon")
appbg=rounded(280,62,(255,255,255,255))
s=sym("#C4207E",int(280*0.60)); appbg.alpha_composite(s,((280-s.width)//2,(280-s.height)//2))
c.alpha_composite(appbg,(60,ry+40))
cap(60,ry+40+286,"1024 · .icns / .ico source")

# favicon zoom
title(420,ry,"Favicon @16 / 32 px")
for j,px in enumerate([16,32]):
    for k,(bg) in enumerate([(255,255,255,255),(25,27,29,255)]):
        f=sym("#C4207E" if k==0 else "#CB2984",px)
        base=Image.new("RGBA",(px,px),bg); base.alpha_composite(f)
        z=6 if px==16 else 4
        zi=base.resize((px*z*2,px*z*2),Image.NEAREST)
        x=420+j*260; y=ry+40+k*150
        c.alpha_composite(zi,(x,y))
        cap(x,y+px*z*2+4,f"{px}px")

# tray template on faux menubar
title(980,ry,"macOS tray template")
bar=Image.new("RGBA",(360,90),(236,236,238,255))
t=sym("#191B1D",36); bar.alpha_composite(t,(24,(90-36)//2))
d2=ImageDraw.Draw(bar); d2.text((80,32),"loopy",font=sf(28,500),fill=(40,42,46,255))
c.alpha_composite(bar,(980,ry+40))
bard=Image.new("RGBA",(360,90),(38,40,44,255))
t=sym("#FCFCFC",36); bard.alpha_composite(t,(24,(90-36)//2))
d3=ImageDraw.Draw(bard); d3.text((80,32),"loopy",font=sf(28,500),fill=(230,230,232,255))
c.alpha_composite(bard,(980,ry+40+110))
cap(980,ry+40+220,"pure-black template · auto-tints")

# --- Row 3: lockups --------------------------------------------------------
ly=930
title(60,ly,"Horizontal lockup")
def lock(bg,symcol,txtcol,y):
    band=Image.new("RGBA",(1680,220),bg)
    s=sym(symcol,150); band.alpha_composite(s,(40,(220-150)//2))
    fnt=sf(132,600)
    dd=ImageDraw.Draw(band)
    # baseline align to body
    dd.text((40+150+40,28),"loopy",font=fnt,fill=txtcol)
    c.alpha_composite(band,(60,y))
lock((255,255,255,255),"#C4207E",INK,ly+40)
lock((25,27,29,255),"#CB2984",(252,252,252,255),ly+40+240)

# footer swatches
fy=1440
for i,(hexv,nm) in enumerate([("#C4207E","magenta"),("#CB2984","dark-mirror"),("#191B1D","ink"),("#FCFCFC","reversed")]):
    x=60+i*220
    sw=hexv.lstrip("#"); rgb=tuple(int(sw[j:j+2],16) for j in (0,2,4))+(255,)
    c.alpha_composite(rounded(40,10,rgb),(x,fy))
    d.text((x+52,fy+2),hexv,font=small,fill=INK)
    d.text((x+52,fy+22),nm,font=small,fill=GREY)

c.convert("RGB").save("png/_brand-sheet.png")
print("wrote png/_brand-sheet.png",c.size)
