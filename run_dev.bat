@echo off
title PDF Creator - Node.js Server (Dev Mode)
cd /d "%~dp0"
echo ===================================================
echo   Starting PDF Creator in Developer Mode (Nodemon)
echo   URL: http://localhost:5000
echo ===================================================
echo.
npm run dev
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Nodemon failed or not found, falling back to node server.js...
    node server.js
)
pause
