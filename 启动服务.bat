@echo off
title 祁连山国家公园WebGIS监控系统

echo ============================================================
echo   祁连山国家公园全过程监控系统 - 启动程序
echo ============================================================
echo.

:: 检查 Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    echo        下载地址: https://www.python.org/downloads/
    echo        安装时请勾选 "Add Python to PATH"
    pause
    exit /b 1
)

:: 显示 Python 版本
echo [1/3] Python 环境检查...
python --version
echo.

:: 安装依赖
echo [2/3] 检查依赖包...
python -c "import flask" >nul 2>&1
if %errorlevel% neq 0 (
    echo       正在安装依赖包 (flask, flask-cors)...
    pip install flask flask-cors -q
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请手动执行: pip install flask flask-cors
        pause
        exit /b 1
    )
    echo       依赖安装完成.
) else (
    echo       依赖包已就绪.
)
echo.

:: 启动服务
echo [3/3] 启动 WebGIS 服务...
echo.
echo ============================================================
echo   服务地址: http://localhost:5000
echo   浏览器会自动打开, 如未打开请手动访问上方地址
echo   按 Ctrl+C 可停止服务
echo ============================================================
echo.

:: 延迟2秒后打开浏览器
start /b "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5000"

:: 启动 Flask
cd /d "%~dp0backend"
python app.py

pause
