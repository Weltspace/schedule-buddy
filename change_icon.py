"""换应用图标：把一张图片转成 icon.ico（Windows 快捷方式只认 .ico，不认 png）。

用法：
  1. 推荐：把图片文件直接拖到本脚本上（支持 png/jpg，推荐正方形、256x256 以上）
  2. 或命令行：python change_icon.py 图片路径
"""
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))

if len(sys.argv) > 1:
    img_path = sys.argv[1]
else:
    img_path = input("把图片拖到这个窗口里，然后按回车：").strip().strip('"')

if not os.path.exists(img_path):
    print("找不到这个文件：" + img_path)
    input("按回车退出...")
    sys.exit(1)

from PIL import Image

img = Image.open(img_path).convert("RGBA")

# 居中裁成正方形（非正方形图会自动裁掉两边）
w, h = img.size
side = min(w, h)
if w != h:
    img = img.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    print(f"图片不是正方形，已居中裁成 {side}x{side}")
if side < 256:
    print(f"提示：图片只有 {side}x{side}，放大会有些糊，建议 256x256 以上")
img = img.resize((256, 256), Image.LANCZOS)

ico = os.path.join(BASE, "icon.ico")
# 一个 ico 里塞 6 种尺寸，任务栏/桌面/资源管理器各取所需
img.save(ico, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print("已生成新的 icon.ico")

# 刷新系统图标缓存，让桌面快捷方式立刻换脸（失败也无妨，F5 刷新桌面即可）
try:
    subprocess.run(["ie4uinit.exe", "-show"], capture_output=True)
except OSError:
    pass
print("完成！如果桌面图标没变，右键桌面按 F5 刷新一下")
input("按回车关闭...")
