@echo off
title The Wizard's Grimoire - Windows Firewall Unblocker
color 0b
cls
echo ===============================================================================
echo        THE WIZARD'S GRIMOIRE - FIREWALL PORT UNBLOCKER (PORTS 8088 & 80)
echo ===============================================================================
echo.
echo Unblocking inbound network traffic for the Grimoire Controller so your
echo tablet, laptop, and iPad can connect freely over your home Wi-Fi network...
echo.

net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [!] Administrator privileges required. Requesting UAC elevation...
    powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c netsh advfirewall firewall add rule name=\"The Wizards Grimoire (Port 8088)\" dir=in action=allow protocol=TCP localport=8088 profile=any && netsh advfirewall firewall add rule name=\"The Wizards Grimoire (Port 80)\" dir=in action=allow protocol=TCP localport=80 profile=any && echo. && echo [+] Ports 8088 and 80 successfully unblocked in Windows Firewall! && pause' -Verb RunAs"
    exit /b
)

netsh advfirewall firewall add rule name="The Wizards Grimoire (Port 8088)" dir=in action=allow protocol=TCP localport=8088 profile=any
netsh advfirewall firewall add rule name="The Wizards Grimoire (Port 80)" dir=in action=allow protocol=TCP localport=80 profile=any
echo.
echo [+] Ports 8088 and 80 successfully unblocked in Windows Firewall!
echo.
pause
