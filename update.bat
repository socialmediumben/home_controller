@echo off
title The Wizard's Grimoire - Pull Updates from GitHub
color 0a
cls
echo ===============================================================================
echo            THE WIZARD'S GRIMOIRE - PULL LATEST UPDATES
echo ===============================================================================
echo.
echo  [+] Fetching latest updates from GitHub...
git pull origin main
echo.
echo  [+] Checking Python dependencies...
pip install -r requirements.txt --quiet
echo.
echo ===============================================================================
echo  Grimoire is up to date!
echo ===============================================================================
echo.
pause
