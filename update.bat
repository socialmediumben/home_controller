@echo off
title The Wizard's Grimoire - Pull Updates from GitHub
color 0a
cls

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0update.ps1"

pause
