@echo off
title The Wizard's Grimoire - D&D Room Controller v1.2.5
color 06
cls
echo ===============================================================================
echo            THE WIZARD'S GRIMOIRE - D^&D ROOM CONTROLLER [v1.2.5]
echo ===============================================================================
echo.
echo  Detecting local Wi-Fi / LAN IP address for your tablet...
for /f "tokens=4" %%a in ('route print 0.0.0.0 ^| findstr 0.0.0.0 ^| findstr /v "Persistent"') do set LOCAL_IP=%%a

REM Free port 8088 if a previous instance is lingering
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :8088 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1

echo.
echo  [+] Local Server starting on Dedicated Port 8088!
echo.
echo  -----------------------------------------------------------------------------
echo  TABLET CONNECTION URL (Open on your iPad / Tablet):
echo  ^> http://%LOCAL_IP%:8088/spellbook
echo.
echo  MINI PC MONITOR LAUNCHER:
echo  ^> http://localhost:8088/launcher
echo  -----------------------------------------------------------------------------
echo.
echo  Press Ctrl+C to stop the server at any time.
echo.

start "" "http://localhost:8088/launcher"

python server.py
pause
