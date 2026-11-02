@echo off
setlocal
chcp 65001 >nul
title Markdown Writer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 18+ and retry.
  pause
  exit /b 1
)

echo Starting writer at http://127.0.0.1:8787/ ...
node server.js --open

echo.
echo Server stopped.
pause
