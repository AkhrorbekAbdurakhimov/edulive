"""
EduLive ikonkalari: ochiq kitob (ta'lim) + yashil "live" nuqta (jonli xabarlar)
indigo fonda. Kitob konturi Feather `book-open` yo'li asosida (24x24 viewBox),
uslub ilova ikonkalari bilan bir xil: oq stroke, round cap/join.

Ranglar tokens.css / theme.ts bilan bir xil (`brand`, `good`). Qayta yaratish:
    python scripts/make-icons.py
Chiqadi: assets/icon.png, assets/adaptive-icon.png, assets/splash.png
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

BRAND = (0x4F, 0x46, 0xE5, 255)
GOOD = (0x0C, 0xA3, 0x0C, 255)
WHITE = (255, 255, 255, 255)
SS = 4  # supersampling — silliq qirralar uchun
OUT = Path(__file__).resolve().parent.parent / "assets"

STROKE = 2.1
# "live" nuqta — kitobning yuqori o'ng burchagida, bildirishnoma nishoni kabi
DOT = (20.5, 4.0)
DOT_R = 2.5
RING = 1.2  # nuqta atrofidagi oq halqa — indigo va kitob chizig'idan ajratadi


def arc(cx: float, cy: float, r: float, a0: float, a1: float, n: int = 12):
    """Yoy nuqtalari (gradusda, ekran koordinatasi: y pastga)."""
    return [
        (cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
         cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n)))
        for i in range(n + 1)
    ]


def left_page():
    # M2 3 H8 a4 4 0 0 1 4 4 V21 a3 3 0 0 0 -3 -3 H2 Z
    pts = [(2, 3), (8, 3)]
    pts += arc(8, 7, 4, -90, 0)          # (8,3) → (12,7)
    pts += [(12, 21)]
    pts += arc(9, 21, 3, 0, -90)         # (12,21) → (9,18)
    pts += [(2, 18), (2, 3)]
    return pts


def mirror(pts):
    return [(24 - x, y) for x, y in pts]


def draw_polyline(d: ImageDraw.ImageDraw, pts, k: float, cx: float, cy: float, w: float, fill) -> None:
    sc = [((x - 12) * k + cx, (y - 12) * k + cy) for x, y in pts]
    d.line(sc, fill=fill, width=round(w), joint="curve")
    r = w / 2
    for x, y in sc:  # round cap/join
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def draw_mark(img: Image.Image, cx: float, cy: float, size: float) -> None:
    """Belgini markazi (cx, cy), 24 birlik = `size` px bo'lib chizadi."""
    d = ImageDraw.Draw(img)
    k = size / 24
    w = STROKE * k

    draw_polyline(d, left_page(), k, cx, cy, w, WHITE)
    draw_polyline(d, mirror(left_page()), k, cx, cy, w, WHITE)

    # "live" nuqta: oq halqa ustiga yashil doira
    x, y = (DOT[0] - 12) * k + cx, (DOT[1] - 12) * k + cy
    R = (DOT_R + RING) * k
    d.ellipse([x - R, y - R, x + R, y + R], fill=WHITE)
    r = DOT_R * k
    d.ellipse([x - r, y - r, x + r, y + r], fill=GOOD)


def canvas(px: int, bg) -> Image.Image:
    return Image.new("RGBA", (px * SS, px * SS), bg)


def save(img: Image.Image, name: str, px: int) -> None:
    OUT.mkdir(exist_ok=True)
    img.resize((px, px), Image.LANCZOS).save(OUT / name, optimize=True)
    print("ok", name)


def main() -> None:
    px = 1024
    c = px * SS / 2

    # Legacy ikonka: to'liq indigo kvadrat (Android o'zi shaklga kesadi)
    img = canvas(px, BRAND)
    draw_mark(img, c, c, 0.56 * px * SS)
    save(img, "icon.png", px)

    # Adaptive foreground: shaffof fon, belgi xavfsiz zonada (markaziy 66%)
    img = canvas(px, (0, 0, 0, 0))
    draw_mark(img, c, c, 0.42 * px * SS)
    save(img, "adaptive-icon.png", px)

    # Splash: shaffof fon (backgroundColor app.json'da), belgi kichikroq
    img = canvas(px, (0, 0, 0, 0))
    draw_mark(img, c, c, 0.28 * px * SS)
    save(img, "splash.png", px)


if __name__ == "__main__":
    main()
