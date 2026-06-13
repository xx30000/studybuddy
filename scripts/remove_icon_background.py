from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit(
        "Pillow is not installed. Please run: pip install pillow"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = ROOT / "frontend" / "public" / "images" / "icons"
OUTPUT_DIR = ROOT / "frontend" / "public" / "images" / "icons-transparent"


def alpha_for_pixel(red, green, blue, alpha):
    if alpha == 0:
        return 0
    if red > 235 and green > 235 and blue > 235:
        return 0
    if red > 220 and green > 220 and blue > 220:
        return 0
    return alpha


def remove_background(source_path, output_path):
    image = Image.open(source_path).convert("RGBA")
    pixels = []

    for red, green, blue, alpha in image.getdata():
        pixels.append((red, green, blue, alpha_for_pixel(red, green, blue, alpha)))

    image.putdata(pixels)
    image.save(output_path, "PNG")


def main():
    if not INPUT_DIR.exists():
        raise SystemExit(f"Input folder not found: {INPUT_DIR}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    png_files = sorted(INPUT_DIR.glob("*.png"))
    if not png_files:
        raise SystemExit(f"No PNG files found in: {INPUT_DIR}")

    for source_path in png_files:
        output_path = OUTPUT_DIR / source_path.name
        remove_background(source_path, output_path)
        print(f"saved {output_path.relative_to(ROOT)}")

    print(f"Processed {len(png_files)} icon files.")


if __name__ == "__main__":
    main()
