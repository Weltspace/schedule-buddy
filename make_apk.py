"""把手机版前端打成一个真正的安卓 APK（纯离线壳）。

用法：
    ./runtime/python.exe make_apk.py

前置（一次性）：
    - JDK 17 / Android SDK / Gradle 装在 E:\\android-build（本机约定，
      可用环境变量 SB_ANDROID_HOME 覆盖，下面三个子目录 jdk / sdk / gradle）
    - android/signing.properties 写好签名信息（不入库，格式见 make_signing_template）

产物：
    dist/ScheduleBuddy-<版本>.apk   签好名的安装包，微信传到手机直接装

原理：把 deploy_pages.DEPLOY_FILES 里那份纯前端文件拷进
android/app/src/main/assets/www/，再用 Gradle 打 release 包，
zipalign 后用 apksigner + 本地密钥签名。数据全存 APP 私有空间。
"""
import os
import shutil
import struct
import subprocess
import sys
import zlib
import tempfile

from PIL import Image

from deploy_pages import DEPLOY_FILES

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(BASE_DIR, "android", "app")
ASSETS_WWW = os.path.join(APP_DIR, "src", "main", "assets", "www")
RES_DIR = os.path.join(APP_DIR, "src", "main", "res")

ANDROID_HOME = os.environ.get("SB_ANDROID_HOME", "E:\\android-build")
JAVA_HOME = os.path.join(ANDROID_HOME, "jdk")
SDK_DIR = os.path.join(ANDROID_HOME, "sdk")
GRADLE_BIN = os.path.join(ANDROID_HOME, "gradle", "bin")
# gradle 拉依赖走本机代理（无代理环境删掉这两行即可）
PROXY_PROPS = [
    "-Dhttp.proxyHost=127.0.0.1", "-Dhttp.proxyPort=7892",
    "-Dhttps.proxyHost=127.0.0.1", "-Dhttps.proxyPort=7892",
]

SIGNING_FILE = os.path.join(BASE_DIR, "android", "signing.properties")


def run(cmd, env=None):
    print("+", " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, env=env or os.environ.copy())


def read_signing():
    if not os.path.exists(SIGNING_FILE):
        sys.exit(f"缺少 {SIGNING_FILE}，内容四行：\n"
                 "store-file=E:\\android-build\\keystore\\schedule-buddy.jks\n"
                 "store-pass=...\nkey-alias=schedulebuddy\nkey-pass=...")
    props = {}
    for line in open(SIGNING_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            props[k.strip()] = v.strip()
    return props


def copy_frontend():
    """网页文件 → assets/www（与 deploy_pages.py 同一份清单，保证两端一致）"""
    if os.path.exists(ASSETS_WWW):
        shutil.rmtree(ASSETS_WWW)
    for f in DEPLOY_FILES:
        src = os.path.join(BASE_DIR, f)
        dst = os.path.join(ASSETS_WWW, f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
    print(f"已拷贝 {len(DEPLOY_FILES)} 个前端文件 → assets/www")


def make_icons():
    """static/icons/icon-512.png → 各密度 mipmap/ic_launcher.png"""
    src = Image.open(os.path.join(BASE_DIR, "static", "icons", "icon-512.png")).convert("RGBA")
    for dpi, size in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
        out_dir = os.path.join(RES_DIR, f"mipmap-{dpi}")
        os.makedirs(out_dir, exist_ok=True)
        src.resize((size, size), Image.LANCZOS).save(os.path.join(out_dir, "ic_launcher.png"))
    print("已生成 mipmap 图标（48–192px）")


def write_local_properties():
    lp = os.path.join(BASE_DIR, "android", "local.properties")
    with open(lp, "w", encoding="utf-8") as f:
        # Java properties 里反斜杠是转义符，sdk.dir 必须用正斜杠
        f.write(f"sdk.dir={SDK_DIR.replace(chr(92), '/')}\n")


def gradle_build():
    """AGP 拒绝含中文的工程路径，把 android/ 拷到 E 盘 ASCII 路径下构建。
    保留 scratch 目录做增量构建，但先停掉 Gradle 守护进程（它锁 build 目录）。"""
    scratch = os.path.join(ANDROID_HOME, "build", "schedule-buddy")
    env = os.environ.copy()
    env["JAVA_HOME"] = JAVA_HOME
    env["PATH"] = os.path.join(JAVA_HOME, "bin") + os.pathsep + env.get("PATH", "")
    # Git Bash 会把 TMP/TEMP 设成 /tmp，JVM 在 Windows 上无法解析
    win_tmp = os.path.join(env.get("USERPROFILE", r"C:\Users\Public"), "AppData", "Local", "Temp")
    os.makedirs(win_tmp, exist_ok=True)
    for k in ("TMP", "TEMP", "TMPDIR"):
        env.pop(k, None)
    env["TMP"] = env["TEMP"] = win_tmp
    env["GRADLE_USER_HOME"] = os.path.join(ANDROID_HOME, "gradle-home")

    run([os.path.join(GRADLE_BIN, "gradle.bat"), "--stop"], env=env)
    os.makedirs(scratch, exist_ok=True)
    shutil.rmtree(os.path.join(scratch, "app", "src", "main", "assets", "www"),
                  ignore_errors=True)
    shutil.copytree(os.path.join(BASE_DIR, "android"), scratch, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns(".gradle", "build", "signing.properties"))
    lp = os.path.join(scratch, "local.properties")
    with open(lp, "w", encoding="utf-8") as f:
        # Java properties 里反斜杠是转义符，sdk.dir 必须用正斜杠
        f.write(f"sdk.dir={SDK_DIR.replace(chr(92), '/')}\n")
    run([os.path.join(GRADLE_BIN, "gradle.bat"), "-p", scratch,
         *PROXY_PROPS, "assembleRelease"], env=env)
    return scratch


def sign(scratch):
    props = read_signing()
    env = os.environ.copy()
    env["JAVA_HOME"] = JAVA_HOME
    env["PATH"] = os.path.join(JAVA_HOME, "bin") + os.pathsep + env.get("PATH", "")
    for k in ("TMPDIR",):
        env.pop(k, None)
    unsigned = os.path.join(scratch, "app", "build", "outputs", "apk", "release",
                            "app-release-unsigned.apk")
    build_tools = os.path.join(SDK_DIR, "build-tools", "34.0.0")
    aligned = unsigned.replace(".apk", "-aligned.apk")
    run([os.path.join(build_tools, "zipalign.exe"), "-f", "4", unsigned, aligned], env=env)
    out_dir = os.path.join(BASE_DIR, "dist")
    os.makedirs(out_dir, exist_ok=True)
    import re
    gradle_text = open(os.path.join(BASE_DIR, "android", "app", "build.gradle"), encoding="utf-8").read()
    version = re.search(r'versionName\s+"([^"]+)"', gradle_text).group(1)
    final = os.path.join(out_dir, f"ScheduleBuddy-v{version}.apk")
    run([os.path.join(build_tools, "apksigner.bat"), "sign",
         "--ks", props["store-file"],
         "--ks-key-alias", props["key-alias"],
         "--ks-pass", f"pass:{props['store-pass']}",
         "--key-pass", f"pass:{props['key-pass']}",
         "--out", final, aligned], env=env)
    size_mb = os.path.getsize(final) / 1024 / 1024
    print(f"\n✓ 打包完成：{final}（{size_mb:.1f} MB）")
    print("  微信把 APK 发到手机 → 点开安装（覆盖升级数据不丢）")


def main():
    copy_frontend()
    make_icons()
    write_local_properties()
    scratch = gradle_build()
    sign(scratch)


if __name__ == "__main__":
    main()
