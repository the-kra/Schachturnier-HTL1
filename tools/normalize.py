# Pokalbilder einheitlich aufbereiten (600x900, unten buendig, Gold gesaettigt).
# pip install pillow numpy
import numpy as np
from PIL import Image, ImageEnhance

def content_bbox(im, thr=16):
    g = np.asarray(im.convert("L")).astype(float)
    ys, xs = np.where(g > thr)
    return xs.min(), ys.min(), xs.max()+1, ys.max()+1

def normalize(src, dst, gold=False, cw=600, ch=900, q=92):
    im = Image.open(src).convert("RGB")
    if gold:
        im = ImageEnhance.Color(im).enhance(1.22)
        im = ImageEnhance.Brightness(im).enhance(1.05)
        im = ImageEnhance.Contrast(im).enhance(1.04)
    x0, y0, x1, y1 = content_bbox(im)
    c = im.crop((x0, y0, x1, y1)); w, h = c.size
    s = min((ch*0.99)/h, (cw*0.96)/w)
    c = c.resize((int(w*s), int(h*s)), Image.LANCZOS)
    cv = Image.new("RGB", (cw, ch), (0, 0, 0))
    cv.paste(c, ((cw-c.size[0])//2, ch-c.size[1]-2))
    cv.save(dst, "JPEG", quality=q, optimize=True)

if __name__ == "__main__":
    normalize("roh/gold.png",   "../assets/pokal-gold.jpg",   gold=True)
    normalize("roh/silber.png", "../assets/pokal-silber.jpg")
    normalize("roh/bronze.png", "../assets/pokal-bronze.jpg")
    print("fertig")
