@echo off
title The Wizard's Grimoire - D&D Room Controller v1.3.0
color 06
cls
echo ===============================================================================
echo            THE WIZARD'S GRIMOIRE - D^&D ROOM CONTROLLER [v1.3.0]
echo ===============================================================================
echo.
echo  Detecting local Wi-Fi / LAN IP address for your tablet...
for /f "tokens=4" %%a in ('route print 0.0.0.0 ^| findstr 0.0.0.0 ^| findstr /v "Persistent"') do set LOCAL_IP=%%a

REM Free port 8088 if a previous instance is lingering
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :8088 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1

echo.
echo  [+] Local Secure HTTPS Server starting on Dedicated Port 8088!
echo.
echo  -----------------------------------------------------------------------------
echo  TABLET CONNECTION URL (Open on your iPad / Tablet / Laptop):
echo  ^> https://%LOCAL_IP%:8088/spellbook
echo.
echo  MINI PC MONITOR LAUNCHER:
echo  ^> https://localhost:8088/launcher
echo  -----------------------------------------------------------------------------
echo.
echo  Press Ctrl+C to stop the server at any time.
echo.

start "" "https://localhost:8088/launcher"

rem Try python first, then py launcher
python -V >nul 2>&1
if %ERRORLEVEL% equ 0 (
    python server.py
) else (
    py -V >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        py server.py
    ) else (
        python server.py
    )
)
pause

