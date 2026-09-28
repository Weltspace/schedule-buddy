"""生成应用图标 icon.ico。想换配色/样式就改这里的颜色值再运行：python make_icon.py"""
from PIL import Image, ImageDraw

S = 512
R = 110  # 圆角半径
PRIMARY_TOP = (79, 110, 247)    # 顶栏蓝（也是网页主题色）
PRIMARY_BOTTOM = (55, 78, 200)  # 底部深蓝
RED = (239, 68, 68)
WHITE = (255, 255, 255)
GREEN = (16, 185, 129)
NUM_COLOR = (31, 41, 55)


def rounded_gradient():
    """带圆角的竖直渐变底板。"""
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / S
        c = tuple(round(a + (b - a) * t) for a, b in zip(PRIMARY_TOP, PRIMARY_BOTTOM))
        gd.line([(0, y), (S, y)], fill=c + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=R, fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    return img


img = rounded_gradient()
d = ImageDraw.Draw(img)

# 白色日历纸
d.rounded_rectangle([76, 120, 436, 430], radius=36, fill=WHITE)
# 红色顶栏
d.rounded_rectangle([76, 120, 436, 226], radius=36, fill=RED)
d.rectangle([76, 180, 436, 226], fill=RED)  # 补齐顶栏下沿的直角

# 两个装订环
d.rounded_rectangle([146, 76, 186, 176], radius=20, fill=(180, 190, 205))
d.rounded_rectangle([326, 76, 366, 176], radius=20, fill=(180, 190, 205))

# 日期数字 30
try:
    from PIL import ImageFont
    font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 170)
except OSError:
    font = ImageFont.load_default()
bbox = d.textbbox((0, 0), "30", font=font)
w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((S - w) / 2 - bbox[0], 330 - h / 2 - bbox[1] + 30), "30", font=font, fill=NUM_COLOR)

# 右下角绿色对勾圆点
d.ellipse([330, 330, 456, 456], fill=GREEN)
d.line([(358, 396), (384, 424), (432, 366)], fill=WHITE, width=22, joint="curve")

img.save("icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
img.save("icon_preview.png")
print("已生成 icon.ico 和 icon_preview.png")
