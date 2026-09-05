@echo off
rem ChainVault demo launcher (double-click this file; opens the app in browser automatically)
chcp 65001 >nul
echo Starting ChainVault static server, browser will open automatically ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8123 -Open
pause
