"""生成 PWA 用的 PNG 图标（从默认 icon.ico 转换，一次性脚本，可重复运行）。"""
import os

from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE_DIR, "static", "icons")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    ico = Image.open(os.path.join(BASE_DIR, "icon.ico"))
    for size in (192, 512):
        img = ico.convert("RGBA").resize((size, size), Image.LANCZOS)
        out = os.path.join(OUT_DIR, f"icon-{size}.png")
        img.save(out, "PNG")
        print("已生成", out)


if __name__ == "__main__":
    main()
