@echo off
chcp 65001 >nul
title Schedule Buddy - 安装依赖
cd /d "%~dp0"

if exist "runtime\python.exe" (
    echo ============================================
    echo   本文件夹已自带运行环境（runtime 目录），
    echo   双击 start_schedule_buddy.vbs 即可直接使用，
    echo   无需安装 Python，也无需运行本脚本。
    echo ============================================
    pause
    exit /b 0
)

echo ============================================
echo   日程助手 - 首次安装依赖（只需运行一次）
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 没有找到 python 命令。
    echo.
    echo 请先安装 Python：去 https://www.python.org/downloads/ 下载，
    echo 安装时务必勾选 "Add Python to PATH"，装完后重新运行本脚本。
    echo.
    pause
    exit /b 1
)

echo 正在安装依赖（flask / pywebview / pystray 等），可能需要 1-3 分钟...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [错误] 安装失败，请检查网络后重试。
    pause
    exit /b 1
)

echo.
echo ============================================
echo   安装完成！双击 start_schedule_buddy.vbs 即可使用
echo ============================================
echo.
pause
