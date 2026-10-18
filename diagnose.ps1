# ==============================================================================
# The Wizard's Grimoire - Diagnostic & Health Check Tool
# Pure ASCII - No Unicode / Emojis to guarantee compatibility with all PowerShell encodings.
# ==============================================================================

param(
    [switch]$Fix
)

$ErrorActionPreference = "Continue"
$AppDir = $PSScriptRoot
if (-not $AppDir) { $AppDir = Get-Location }
Set-Location $AppDir

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  THE WIZARD'S GRIMOIRE - SYSTEM DIAGNOSTICS & HEALTH CHECK" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

$IssueCount = 0

# ------------------------------------------------------------------------------
# 1. Environment & User Context
# ------------------------------------------------------------------------------
Write-Host "[1/8] Checking User and Directory Context..." -ForegroundColor Yellow
$currentUser = $env:USERNAME
$computerName = $env:COMPUTERNAME
$desktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)

Write-Host "      User: $currentUser on $computerName" -ForegroundColor White
Write-Host "      App Directory: $AppDir" -ForegroundColor White
Write-Host "      Desktop: $desktopPath" -ForegroundColor White

if (Test-Path $AppDir) {
    Write-Host "      [PASS] App directory exists." -ForegroundColor Green
} else {
    Write-Host "      [FAIL] App directory not found!" -ForegroundColor Red
    $IssueCount++
}

# ------------------------------------------------------------------------------
# 2. Python Detection & Version
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[2/8] Checking Python Environment..." -ForegroundColor Yellow

function Find-Python {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        try {
            $resolved = & py -c "import sys; print(sys.executable)" 2>$null
            if ($resolved -and (Test-Path $resolved.Trim())) { return $resolved.Trim() }
        } catch {}
    }
    $pyCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pyCmd) {
        $src = $pyCmd.Source
        try {
            $ver = & $src -c "import sys; print(sys.version)" 2>$null
            if ($ver) { return $src }
        } catch {}
    }
    $searchPaths = @(
        "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
        "$env:ProgramFiles\Python3*\python.exe",
        "${env:ProgramFiles(x86)}\Python3*\python.exe",
        "C:\Python3*\python.exe",
        "C:\Users\*\AppData\Local\Programs\Python\Python3*\python.exe"
    )
    foreach ($pattern in $searchPaths) {
        $found = Get-Item $pattern -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
        if ($found -and (Test-Path $found.FullName)) {
            try {
                $ver = & $found.FullName -c "import sys; print(sys.version)" 2>$null
                if ($ver) { return $found.FullName }
            } catch {}
        }
    }
    return $null
}

$PythonExe = Find-Python
if ($PythonExe) {
    $pyVersion = & $PythonExe --version 2>&1
    Write-Host "      [PASS] Python found: $PythonExe ($pyVersion)" -ForegroundColor Green
} else {
    Write-Host "      [FAIL] Python not detected on system or in PATH!" -ForegroundColor Red
    $IssueCount++
}

# ------------------------------------------------------------------------------
# 3. Python Package Dependencies
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[3/8] Checking Required Python Packages..." -ForegroundColor Yellow
$missingPackages = @()

if ($PythonExe) {
    $packagesToCheck = @("fastapi", "uvicorn", "websockets", "aiohttp", "requests", "pydantic")
    foreach ($pkg in $packagesToCheck) {
        $check = & $PythonExe -c "import $pkg" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "      [PASS] $pkg installed" -ForegroundColor Green
        } else {
            Write-Host "      [FAIL] $pkg is MISSING" -ForegroundColor Red
            $missingPackages += $pkg
            $IssueCount++
        }
    }

    if ($missingPackages.Count -gt 0 -and $Fix) {
        Write-Host "      [+] Auto-fixing: Installing missing packages..." -ForegroundColor Cyan
        & $PythonExe -m pip install -r (Join-Path $AppDir "requirements.txt") --quiet
    }
}

# ------------------------------------------------------------------------------
# 4. Git & Repository Tracking
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[4/8] Checking Git & Repository Tracking..." -ForegroundColor Yellow

function Find-Git {
    $cmd = Get-Command git -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $paths = @(
        "C:\Program Files\Git\cmd\git.exe",
        "C:\Program Files\Git\bin\git.exe",
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
        "$env:APPDATA\Git\cmd\git.exe"
    )
    foreach ($p in $paths) {
        $found = Get-Item $p -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($found -and (Test-Path $found.FullName)) { return $found.FullName }
    }
    return $null
}

$GitExe = Find-Git
$HasGit = Test-Path (Join-Path $AppDir ".git")

if ($GitExe) {
    $gitVer = & $GitExe --version 2>&1
    Write-Host "      [PASS] Git found: $GitExe ($gitVer)" -ForegroundColor Green
} else {
    Write-Host "      [WARN] Git executable not found in PATH or standard directories." -ForegroundColor Yellow
}

if ($HasGit) {
    Write-Host "      [PASS] .git directory exists." -ForegroundColor Green
    if ($GitExe) {
        $remoteUrl = & $GitExe remote get-url origin 2>$null
        Write-Host "      Remote URL: $remoteUrl" -ForegroundColor White
        if ($remoteUrl -and ($remoteUrl -notlike "https://github.com/*")) {
            Write-Host "      [WARN] Remote URL is not standard HTTPS ($remoteUrl)" -ForegroundColor Yellow
            if ($Fix) {
                & $GitExe remote set-url origin https://github.com/socialmediumben/home_controller.git
                Write-Host "      [FIX] Reset remote to https://github.com/socialmediumben/home_controller.git" -ForegroundColor Green
            }
        }
    }
} else {
    Write-Host "      [WARN] No .git directory in $AppDir (manual copy/zip distribution)." -ForegroundColor Yellow
}

# ------------------------------------------------------------------------------
# 5. Port 8088 & Firewall
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[5/8] Checking Port 8088 & Windows Firewall..." -ForegroundColor Yellow
$socket = Get-NetTCPConnection -LocalPort 8088 -State Listen -ErrorAction SilentlyContinue
if ($socket) {
    Write-Host "      [PASS] Port 8088 is currently active (PID: $($socket.OwningProcess))" -ForegroundColor Green
} else {
    Write-Host "      [INFO] Port 8088 is not currently active (Server is stopped)." -ForegroundColor White
}

$fwRule = Get-NetFirewallRule -DisplayName "*8088*" -ErrorAction SilentlyContinue
if (-not $fwRule) {
    $fwRule = Get-NetFirewallRule -Name "Grimoire-8088-Inbound" -ErrorAction SilentlyContinue
}

if ($fwRule) {
    Write-Host "      [PASS] Firewall rule exists: $($fwRule.DisplayName) (Enabled=$($fwRule.Enabled))" -ForegroundColor Green
} else {
    Write-Host "      [WARN] No inbound firewall rule found for port 8088." -ForegroundColor Yellow
    if ($Fix) {
        Write-Host "      [+] Auto-fixing: Creating firewall rule..." -ForegroundColor Cyan
        try {
            New-NetFirewallRule -Name "Grimoire-8088-Inbound" -DisplayName "The Wizard's Grimoire (Port 8088)" -Direction Inbound -Protocol TCP -LocalPort 8088 -Action Allow -Profile Any | Out-Null
            Write-Host "      [FIX] Firewall rule created!" -ForegroundColor Green
        } catch {
            Write-Warning "Could not create firewall rule (requires administrator privileges): $_"
        }
    }
}

# ------------------------------------------------------------------------------
# 6. Desktop Shortcut Inspection
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[6/8] Inspecting Desktop Shortcut..." -ForegroundColor Yellow
$shortcutPath = Join-Path $desktopPath "The Wizard's Grimoire.lnk"

if (Test-Path $shortcutPath) {
    Write-Host "      [PASS] Shortcut file exists: $shortcutPath" -ForegroundColor Green
    try {
        $wsh = New-Object -ComObject WScript.Shell
        $sc = $wsh.CreateShortcut($shortcutPath)
        Write-Host "      Target: $($sc.TargetPath)" -ForegroundColor White
        Write-Host "      Arguments: $($sc.Arguments)" -ForegroundColor White
        Write-Host "      Working Dir: $($sc.WorkingDirectory)" -ForegroundColor White

        $trayScript = Join-Path $AppDir "grimoire_tray.ps1"
        if (-not (Test-Path $trayScript)) {
            Write-Host "      [FAIL] grimoire_tray.ps1 not found in $AppDir!" -ForegroundColor Red
            $IssueCount++
        }
    } catch {
        Write-Warning "Could not inspect shortcut: $_"
    }
} else {
    Write-Host "      [FAIL] Shortcut does not exist on Desktop!" -ForegroundColor Red
    $IssueCount++
    if ($Fix) {
        Write-Host "      [+] Auto-fixing: Running setup_autostart.ps1..." -ForegroundColor Cyan
        & (Join-Path $AppDir "setup_autostart.ps1")
    }
}

# ------------------------------------------------------------------------------
# 7. Scheduled Task Inspection
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[7/8] Inspecting Scheduled Task..." -ForegroundColor Yellow
$task = Get-ScheduledTask -TaskName "Grimoire-AutoStart" -ErrorAction SilentlyContinue

if ($task) {
    Write-Host "      [PASS] Scheduled Task 'Grimoire-AutoStart' registered (State: $($task.State))" -ForegroundColor Green
    $taskInfo = Get-ScheduledTaskInfo -TaskName "Grimoire-AutoStart" -ErrorAction SilentlyContinue
    if ($taskInfo) {
        Write-Host "      Last Run: $($taskInfo.LastRunTime)" -ForegroundColor White
        Write-Host "      Last Result: $($taskInfo.LastTaskResult)" -ForegroundColor White
    }
} else {
    Write-Host "      [WARN] Scheduled Task 'Grimoire-AutoStart' is not registered." -ForegroundColor Yellow
    if ($Fix) {
        Write-Host "      [+] Auto-fixing: Registering scheduled task..." -ForegroundColor Cyan
        & (Join-Path $AppDir "setup_autostart.ps1")
    }
}

# ------------------------------------------------------------------------------
# 8. Log Files Inspection
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[8/8] Checking Execution Logs..." -ForegroundColor Yellow
$trayLogPath = Join-Path $AppDir "tray_log.txt"
$serverLogPath = Join-Path $AppDir "server_log.txt"

if (Test-Path $trayLogPath) {
    Write-Host "      --- Recent tray_log.txt (Last 5 lines) ---" -ForegroundColor White
    Get-Content $trayLogPath -Tail 5 | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }
} else {
    Write-Host "      [INFO] tray_log.txt has not been created yet." -ForegroundColor White
}

if (Test-Path $serverLogPath) {
    Write-Host "      --- Recent server_log.txt (Last 5 lines) ---" -ForegroundColor White
    Get-Content $serverLogPath -Tail 5 | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }
} else {
    Write-Host "      [INFO] server_log.txt has not been created yet." -ForegroundColor White
}

# ------------------------------------------------------------------------------
# Summary & Next Steps
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
if ($IssueCount -eq 0) {
    Write-Host "  DIAGNOSTIC RESULT: ALL CHECKS PASSED!" -ForegroundColor Green
    Write-Host "  The system is healthy and ready to run The Wizard's Grimoire." -ForegroundColor Green
} else {
    Write-Host "  DIAGNOSTIC RESULT: $IssueCount ISSUE(S) DETECTED." -ForegroundColor Red
    Write-Host "  To automatically resolve detected issues, run:" -ForegroundColor Yellow
    Write-Host "  .\diagnose.ps1 -Fix" -ForegroundColor White
}
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""
