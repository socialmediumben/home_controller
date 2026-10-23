@echo off
title The Wizard's Grimoire - D&D Room Controller v1.3.8
color 06
cls
echo ===============================================================================
echo            THE WIZARD'S GRIMOIRE - D^&D ROOM CONTROLLER [v1.3.8]
echo ===============================================================================
echo.
echo  Detecting local Wi-Fi / LAN IP address for your tablet...

rem Detect local IP using Python
set LOCAL_IP=
for /f "tokens=*" %%a in ('python -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('8.8.8.8', 80)); print(s.getsockname()[0]); s.close()" 2^>nul') do set LOCAL_IP=%%a
if "%LOCAL_IP%"=="" (
    for /f "tokens=4" %%a in ('route print 0.0.0.0 ^| findstr 0.0.0.0 ^| findstr /v "Persistent"') do set LOCAL_IP=%%a
)

rem Attempt to ensure port 8088 is unblocked in Windows Firewall
netsh advfirewall firewall add rule name="The Wizards Grimoire (Port 8088)" dir=in action=allow protocol=TCP localport=8088 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="The Wizards Grimoire (Port 80)" dir=in action=allow protocol=TCP localport=80 profile=any >nul 2>&1

REM Free port 8088 if a previous instance is lingering
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :8088 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1

echo.
echo  [+] Local Secure HTTPS Server starting on Dedicated Port 8088!
echo.
echo  -----------------------------------------------------------------------------
echo  TABLET / LAPTOP CONTROLLER URL (Open in your browser):
echo  ^> https://%LOCAL_IP%:8088/spellbook
echo.
echo  * IMPORTANT: You MUST include "https://" (with the 's') before the IP!
echo  * Alternate Quick URL: http://%LOCAL_IP% (auto-redirects to HTTPS)
echo  * If your browser shows "Your connection is not private":
echo    Click "Advanced" and then click "Proceed" to continue.
echo.
echo  AUTO-LAUNCHING FULLSCREEN DISPLAYS:
echo  - Display 1: Picture Frame Monitor (/display/frame)
echo  - Display 2: Overhead Table Projector (/display/table)
echo  - Display 3: Window 53" TV (/display/window)
echo.
echo  MINI PC MONITOR LAUNCHER:
echo  - Auto-opened and minimized to your taskbar!
echo  -----------------------------------------------------------------------------
echo.
echo  Press Ctrl+C to stop the server at any time.
echo.

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
