"""打一个"解压即用"的 Windows 便携 zip（含自带运行环境 runtime/）。

用法：
    ./runtime/python.exe make_zip.py

产物：dist/ScheduleBuddy-v<版本>-windows-portable.zip
排除：用户数据(data/)、缓存、构建产物、安卓工程等与使用无关的内容。
GitHub Release 建议同时挂上 make_apk.py 产出的安卓 APK。
"""
import os
import re
import zipfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE_DIR, "dist")

EXCLUDE_DIRS = {".git", ".idea", "__pycache__", "data", "dist",
                "%TEMP%", "android", "node_modules"}
EXCLUDE_FILES = {"icon_preview.png", "icon_source.png", "make_zip.py"}
ROOT_NAME = "schedule-buddy"


def main():
    gradle_text = open(os.path.join(BASE_DIR, "android", "app", "build.gradle"),
                       encoding="utf-8").read()
    version = re.search(r'versionName\s+"([^"]+)"', gradle_text).group(1)
    out = os.path.join(OUT_DIR, f"ScheduleBuddy-v{version}-windows-portable.zip")
    os.makedirs(OUT_DIR, exist_ok=True)

    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, dirs, files in os.walk(BASE_DIR):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for f in files:
                if f in EXCLUDE_FILES or f.endswith(".pyc"):
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, BASE_DIR)
                z.write(full, os.path.join(ROOT_NAME, rel))
                n += 1
    size_mb = os.path.getsize(out) / 1024 / 1024
    print(f"✓ 便携包完成：{out}（{size_mb:.1f} MB，{n} 个文件）")
    print("  解压后双击 start_schedule_buddy.vbs 即用，无需安装 Python")


if __name__ == "__main__":
    main()
