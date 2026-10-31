@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8765/' -TimeoutSec 2; Start-Process 'http://localhost:8765/'; exit 0 } catch { exit 1 }"
if not errorlevel 1 exit /b 0
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0centro-control-local.ps1"
