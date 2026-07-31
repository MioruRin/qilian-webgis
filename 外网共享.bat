@echo off
title 外网共享 - Cloudflare Tunnel

echo ============================================================
echo   外网共享 - 通过 Cloudflare Tunnel 暴露到公网
echo ============================================================
echo.

:: 检查本地服务是否在运行
echo [检查] 本地服务状态...
python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000', timeout=3)" >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 本地服务未启动! 请先运行 "启动服务.bat"
    pause
    exit /b 1
)
echo       本地服务运行中.
echo.

:: 检查 cloudflared
set CF_PATH=%~dp0cloudflared.exe
if not exist "%CF_PATH%" (
    echo [提示] 未找到 cloudflared.exe, 正在下载...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CF_PATH%' -UseBasicParsing"
    if not exist "%CF_PATH%" (
        echo [错误] cloudflared 下载失败, 请手动下载放置到项目根目录
        pause
        exit /b 1
    )
    echo       下载完成.
)
echo.

echo ============================================================
echo   正在创建公网访问链接...
echo   链接生成后请复制到浏览器或分享给他人
echo   按 Ctrl+C 可停止外网共享
echo ============================================================
echo.

"%CF_PATH%" tunnel --url http://localhost:5000

pause
