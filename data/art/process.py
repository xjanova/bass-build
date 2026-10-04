"""Turns the ChatGPT originals in data/art/src/ into the web assets under apps/web/public/.

Run from the repo root:  python data/art/process.py
Originals are kept in data/art/src/ (see data/art/PROMPTS.md for how each was made).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'data' / 'art' / 'src'
PUB = ROOT / 'apps' / 'web' / 'public'
BG = (5, 7, 11)


def save_webp(img: Image.Image, path: Path, width: int, quality: int = 80) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    img.save(path, 'WEBP', quality=quality, method=6)
    print(f'{path.relative_to(ROOT)}  {img.width}x{img.height}  {path.stat().st_size // 1024} KB')


def logo() -> Image.Image:
    img = Image.open(SRC / 'logo.png').convert('RGBA')
    # Trim to the visible mark, then pad back to a square with ~6 % margin.
    box = img.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    mark = img.crop(box)
    side = round(max(mark.size) * 1.12)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2), mark)
    brand = PUB / 'brand'
    brand.mkdir(parents=True, exist_ok=True)
    for size in (512, 256, 128):
        out.resize((size, size), Image.LANCZOS).save(brand / f'logo-{size}.png', optimize=True)
    for size in (64, 32):
        out.resize((size, size), Image.LANCZOS).save(brand / f'favicon-{size}.png', optimize=True)
    # iOS ignores transparency: put the mark on the app background.
    touch = Image.new('RGBA', (180, 180), BG + (255,))
    small = out.resize((150, 150), Image.LANCZOS)
    touch.paste(small, (15, 15), small)
    touch.convert('RGB').save(brand / 'apple-touch-icon.png', optimize=True)
    for f in sorted(brand.iterdir()):
        print(f'{f.relative_to(ROOT)}  {f.stat().st_size // 1024} KB')
    return out


def og(mark: Image.Image) -> None:
    """1200×630 share card: splash art, mark, name and an English tagline (Pillow has no Thai shaping here)."""
    art = Image.open(SRC / 'splash.png').convert('RGB')
    art = art.resize((1200, round(art.height * 1200 / art.width)), Image.LANCZOS)
    top = (art.height - 630) // 2
    card = art.crop((0, top, 1200, top + 630)).convert('RGBA')
    shade = Image.new('RGBA', card.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(shade)
    for x in range(1200):  # dark on the left where the type sits
        a = max(0, min(235, int(235 * (1 - x / 760))))
        d.line([(x, 0), (x, 630)], fill=BG + (a,))
    card = Image.alpha_composite(card, shade)
    m = mark.resize((150, 150), Image.LANCZOS)
    glow = m.filter(ImageFilter.GaussianBlur(18))
    card.alpha_composite(glow, (70, 150))
    card.alpha_composite(m, (70, 150))
    draw = ImageDraw.Draw(card)
    fonts = Path('C:/Windows/Fonts')
    title = ImageFont.truetype(str(fonts / 'bahnschrift.ttf'), 84)
    title.set_variation_by_name('Bold')
    sub = ImageFont.truetype(str(fonts / 'bahnschrift.ttf'), 30)
    sub.set_variation_by_name('SemiLight')
    draw.text((70, 330), 'BASS BUILD', font=title, fill=(241, 245, 249))
    draw.text((74, 432), 'Speaker enclosure design lab', font=sub, fill=(165, 180, 200))
    draw.text((74, 474), 'Real-time 3D acoustics & airflow', font=sub, fill=(34, 211, 238))
    path = PUB / 'art' / 'og.jpg'
    path.parent.mkdir(parents=True, exist_ok=True)
    card.convert('RGB').save(path, 'JPEG', quality=86, optimize=True, progressive=True)
    print(f'{path.relative_to(ROOT)}  1200x630  {path.stat().st_size // 1024} KB')


def main() -> None:
    mark = logo()
    og(mark)
    save_webp(Image.open(SRC / 'splash.png').convert('RGB'), PUB / 'art' / 'splash.webp', 1672, 78)
    for name in ('ai', 'blueprint', 'library'):
        save_webp(Image.open(SRC / f'teaser-{name}.png').convert('RGB'), PUB / 'art' / f'teaser-{name}.webp', 1280, 80)
    for name in ('walnut', 'oak', 'teak'):
        save_webp(Image.open(SRC / f'{name}.png').convert('RGB'), PUB / 'tex' / f'{name}.webp', 1024, 86)


if __name__ == '__main__':
    main()
