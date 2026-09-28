"""把网页文件部署到 GitHub Pages（gh-pages 分支）。

前提：本目录已经 git init 并配置了 GitHub 远程仓库（remote origin）。
用法：
    ./runtime/python.exe deploy_pages.py
或系统 Python：
    python deploy_pages.py

原理：把手机版需要的网页文件（index.html、static/、manifest.json、sw.js）
复制到一个临时工作区，以 orphan 分支方式提交并强推到远程的 gh-pages 分支。
GitHub 仓库设置里开启 Pages（Source: gh-pages 分支）后，几分钟内
https://<用户名>.github.io/<仓库名>/ 即可访问，手机浏览器打开一次并
"添加到主屏幕"就装好了。

不想跑脚本的话，也可以在 GitHub 网页端手动上传这几个文件到 gh-pages 分支，
文件清单见下面的 DEPLOY_FILES。
"""
import os
import shutil
import subprocess
import sys
import tempfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 部署到 gh-pages 的文件清单（手机版全部所需，别把 data/、runtime/ 发上去）
DEPLOY_FILES = [
    "index.html",
    "manifest.json",
    "sw.js",
    os.path.join("static", "style.css"),
    os.path.join("static", "main.js"),
    os.path.join("static", "api.js"),
    os.path.join("static", "icons", "icon-192.png"),
    os.path.join("static", "icons", "icon-512.png"),
    os.path.join("static", "local", "storage.js"),
    os.path.join("static", "local", "ai.js"),
]


def run(cmd, cwd):
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True)


def main():
    # 校验远程仓库已配置
    try:
        remote = subprocess.run(["git", "remote", "get-url", "origin"],
                                cwd=BASE_DIR, capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("错误：请先在本目录 git init 并添加 GitHub 远程仓库（git remote add origin ...）")
        sys.exit(1)
    print("远程仓库：", remote)

    work = tempfile.mkdtemp(prefix="sb-pages-")
    try:
        for f in DEPLOY_FILES:
            src = os.path.join(BASE_DIR, f)
            dst = os.path.join(work, f)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
        readme = os.path.join(work, "index.html")
        if not os.path.exists(readme):
            print("错误：index.html 不存在")
            sys.exit(1)

        run(["git", "init", "-b", "gh-pages"], cwd=work)
        run(["git", "remote", "add", "origin", remote], cwd=work)
        run(["git", "add", "-A"], cwd=work)
        # 临时仓库没有 git 身份配置（新机器常没配全局 user.name/email），用 -c 现场指定
        run(["git", "-c", "user.name=Schedule Buddy Deploy",
             "-c", "user.email=deploy@users.noreply.github.com",
             "commit", "-m", "deploy: schedule-buddy web app"], cwd=work)
        run(["git", "push", "-f", "origin", "gh-pages"], cwd=work)
        print("\n已推送到 gh-pages 分支。到 GitHub 仓库 Settings → Pages 选择 gh-pages 分支，")
        print("开启后手机访问 https://<用户名>.github.io/<仓库名>/ 即可使用。")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
