@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动日程助手，窗口将自动打开...（关闭此窗口即退出程序）
if exist "runtime\python.exe" (
    "runtime\python.exe" app.py
) else (
    python app.py
)
