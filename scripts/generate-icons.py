"""Regenerate Pocket's geometric app icon. Requires Pillow, only for regeneration."""
from pathlib import Path

from PIL import Image, ImageDraw


output = Path(__file__).resolve().parents[1] / "src" / "assets"
output.mkdir(parents=True, exist_ok=True)
scale = 2
canvas = Image.new("RGBA", (1024 * scale, 1024 * scale))
draw = ImageDraw.Draw(canvas)


def rounded(bounds, radius, fill):
    draw.rounded_rectangle(tuple(value * scale for value in bounds), radius=radius * scale, fill=fill)


rounded((48, 48, 976, 976), 224, "#17231d")
rounded((248, 368, 376, 656), 64, "#c8edaa")
rounded((448, 240, 576, 784), 64, "#c8edaa")
rounded((648, 320, 776, 704), 64, "#c8edaa")
icon = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
icon.save(output / "icon.png")
icon.save(output / "icon.ico", sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
icon.save(output / "icon.icns")

# Generate crisp thumbar media buttons and tray icon
thumbar_dir = output / "thumbar"
thumbar_dir.mkdir(parents=True, exist_ok=True)
s = 4

def render(size, draw_func):
    img = Image.new("RGBA", (size * s, size * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_func(d, s)
    return img.resize((size, size), Image.Resampling.LANCZOS)

render(24, lambda d, s: d.polygon([(8 * s, 5 * s), (19 * s, 12 * s), (8 * s, 19 * s)], fill="#ffffff")).save(thumbar_dir / "play.png")
render(24, lambda d, s: [d.rectangle([(7 * s, 5 * s), (10 * s, 19 * s)], fill="#ffffff"), d.rectangle([(14 * s, 5 * s), (17 * s, 19 * s)], fill="#ffffff")]).save(thumbar_dir / "pause.png")
render(24, lambda d, s: [d.rectangle([(5 * s, 5 * s), (7 * s, 19 * s)], fill="#ffffff"), d.polygon([(19 * s, 5 * s), (8 * s, 12 * s), (19 * s, 19 * s)], fill="#ffffff")]).save(thumbar_dir / "prev.png")
render(24, lambda d, s: [d.polygon([(5 * s, 5 * s), (16 * s, 12 * s), (5 * s, 19 * s)], fill="#ffffff"), d.rectangle([(17 * s, 5 * s), (19 * s, 19 * s)], fill="#ffffff")]).save(thumbar_dir / "next.png")
render(24, lambda d, s: [
    d.rounded_rectangle([(3 * s, 7 * s), (6 * s, 17 * s)], radius=1.5 * s, fill="#c8edaa"),
    d.rounded_rectangle([(9 * s, 4 * s), (12 * s, 20 * s)], radius=1.5 * s, fill="#c8edaa"),
    d.rounded_rectangle([(15 * s, 6 * s), (18 * s, 18 * s)], radius=1.5 * s, fill="#c8edaa"),
]).save(output / "tray.png")

print("Generated Pocket PNG, ICO, ICNS, tray, and thumbar icons.")
