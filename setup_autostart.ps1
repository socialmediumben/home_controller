# ==============================================================================
# The Wizard's Grimoire - Autostart & Desktop Shortcut Setup Script
# Run in an elevated PowerShell session to configure Logon/Unlock tasks & desktop shortcut.
# ==============================================================================

param(
    [string]$TargetUser = "socia",
    [string]$AppDir = "C:\Users\socia\Desktop\home_controller"
)

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  THE WIZARD'S GRIMOIRE - TRAY & AUTOSTART INSTALLER" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $AppDir)) {
    Write-Warning "Target directory '$AppDir' does not exist yet. Please verify path."
}

# 1. Create Desktop Shortcut for one-click manual launch
$DesktopPath = "C:\Users\$TargetUser\Desktop"
if (-not (Test-Path $DesktopPath)) {
    $DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
}
$ShortcutPath = Join-Path $DesktopPath "The Wizard's Grimoire.lnk"
$TrayScriptPath = Join-Path $AppDir "grimoire_tray.ps1"
$IconPath = Join-Path $AppDir "static\grimoire.ico"

Write-Host "[+] Creating Desktop Shortcut: $ShortcutPath" -ForegroundColor Yellow
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$TrayScriptPath`" -OpenBrowser"
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.Description = "Launch The Wizard's Grimoire D&D Room Controller"
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = "$IconPath,0"
}
$Shortcut.Save()
Write-Host "    [OK] Desktop shortcut created!" -ForegroundColor Green

# 2. Register Scheduled Task for Logon and Session Unlock
$TaskName = "Grimoire-AutoStart"
Write-Host "[+] Registering Scheduled Task: $TaskName" -ForegroundColor Yellow

$TaskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Runs The Wizard's Grimoire system tray service on logon and workstation unlock.</Description>
    <Author>$env:COMPUTERNAME\$TargetUser</Author>
  </RegistrationInfo>
  <Triggers>
    <!-- Trigger 1: User Logon -->
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$TargetUser</UserId>
    </LogonTrigger>
    <!-- Trigger 2: Workstation Unlock -->
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <StateChange>SessionUnlock</StateChange>
      <UserId>$TargetUser</UserId>
    </SessionStateChangeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$TargetUser</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "$TrayScriptPath"</Arguments>
      <WorkingDirectory>$AppDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

Register-ScheduledTask -TaskName $TaskName -Xml $TaskXml -Force | Out-Null
Write-Host "    [OK] Scheduled Task registered for user '$TargetUser'!" -ForegroundColor Green
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "  • Logon: Starts silently to the System Tray" -ForegroundColor White
Write-Host "  • Unlock: Verifies service is running (idempotent)" -ForegroundColor White
Write-Host "  • Tray Icon: Right-click to Open Launcher/Spellbook, Restart, or Exit" -ForegroundColor White
Write-Host "  • Desktop Shortcut: 1-click launch that opens both service & browser" -ForegroundColor White
Write-Host "=================================================================" -ForegroundColor Cyan
