"""在桌面创建带应用图标的「日程助手」快捷方式。

首次安装、或把本文件夹移动到新位置后，双击运行本脚本即可。
（直接右键 vbs 创建的快捷方式只有默认脚本图标，请用本脚本）
"""
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
VBS = os.path.join(BASE, "start_schedule_buddy.vbs")
ICON = os.path.join(BASE, "icon.ico")

if not os.path.exists(VBS):
    print(f"找不到 {VBS}")
    print("请确认本脚本放在 schedule-buddy 文件夹里再运行")
    input("按回车退出...")
    sys.exit(1)

ps = rf"""
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut((Join-Path $desktop '日程助手.lnk'))
$lnk.TargetPath = 'C:\Windows\System32\wscript.exe'
$lnk.Arguments = '"{VBS}"'
$lnk.WorkingDirectory = '{BASE}'
$lnk.IconLocation = '{ICON},0'
$lnk.WindowStyle = 1
$lnk.Description = '我的日程助手'
$lnk.Save()
"""
r = subprocess.run(
    ["powershell", "-NoProfile", "-Command", ps], capture_output=True
)
if r.returncode == 0:
    print("桌面快捷方式已创建，双击它就能用了！")
else:
    print("出错了：" + r.stderr.decode("utf-8", "ignore"))
input("按回车关闭...")
