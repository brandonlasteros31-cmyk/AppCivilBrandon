@echo off
setlocal
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8765 .*LISTENING"') do (
    tasklist /FI "PID eq %%P" /FO CSV /NH | findstr /I "powershell.exe" >NUL
    if not errorlevel 1 taskkill /PID %%P /F >NUL 2>&1
)
timeout /t 1 /nobreak >NUL
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0centro-control-local.ps1"
pause
