@echo off
title The Wizard's Grimoire - Sync with GitHub
color 0b
cls
echo ===============================================================================
echo            THE WIZARD'S GRIMOIRE - GITHUB SYNCHRONIZER
echo ===============================================================================
echo.
echo  [+] Staging all changes and atmospheric presets...
git add .
set /p commit_msg="Enter commit note (or press Enter for 'Auto-sync'): "
if "%commit_msg%"=="" set commit_msg=Auto-sync Grimoire updates
echo.
echo  [+] Committing: "%commit_msg%"...
git commit -m "%commit_msg%"
echo.
echo  [+] Pushing to GitHub (https://github.com/socialmediumben/home_controller)...
git push origin main
echo.
echo ===============================================================================
echo  Synchronization complete! All changes are now live on GitHub.
echo ===============================================================================
echo.
pause
