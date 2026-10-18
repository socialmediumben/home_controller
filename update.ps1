# ==============================================================================
# The Wizard's Grimoire - Updater Script
# Pure ASCII - No Unicode / Emojis to guarantee compatibility with all PowerShell encodings.
# ==============================================================================

param(
    [switch]$ForceZip
)

$ErrorActionPreference = "Continue"
$AppDir = $PSScriptRoot
if (-not $AppDir) { $AppDir = Get-Location }
Set-Location $AppDir

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  THE WIZARD'S GRIMOIRE - PULL LATEST UPDATES" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[+] Working Directory: $AppDir" -ForegroundColor White

# 1. Locate Git executable if available
function Get-GitPath {
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd) { return $gitCmd.Source }

    $commonGitPaths = @(
        "C:\Program Files\Git\cmd\git.exe",
        "C:\Program Files\Git\bin\git.exe",
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
        "$env:APPDATA\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe"
    )
    foreach ($p in $commonGitPaths) {
        $found = Get-Item $p -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($found -and (Test-Path $found.FullName)) { return $found.FullName }
    }
    return $null
}

$GitExe = Get-GitPath
$HasGitRepo = Test-Path (Join-Path $AppDir ".git")
$RepoUrl = "https://github.com/socialmediumben/home_controller.git"
$ZipUrl = "https://github.com/socialmediumben/home_controller/archive/refs/heads/main.zip"

$UpdatedViaGit = $false

if ($GitExe -and $HasGitRepo -and (-not $ForceZip)) {
    Write-Host "[+] Git executable found at: $GitExe" -ForegroundColor Cyan
    Write-Host "[+] Git repository detected. Checking remote URL..." -ForegroundColor White

    # Ensure remote uses public HTTPS URL to prevent SSH / credential prompts
    try {
        & $GitExe remote set-url origin $RepoUrl 2>$null
    } catch {}

    Write-Host "[+] Pulling latest changes from branch 'main'..." -ForegroundColor Yellow
    try {
        $pullOutput = & $GitExe pull origin main 2>&1
        Write-Host $pullOutput
        if ($LASTEXITCODE -eq 0) {
            $UpdatedViaGit = $true
            Write-Host "    [OK] Git pull completed successfully!" -ForegroundColor Green
        } else {
            Write-Warning "Git pull returned non-zero exit code ($LASTEXITCODE). Falling back to direct GitHub download..."
        }
    } catch {
        Write-Warning "Git pull encountered an exception: $_. Falling back to direct GitHub download..."
    }
}

# Fallback: Direct GitHub ZIP archive download
if (-not $UpdatedViaGit) {
    Write-Host "[+] Fetching latest release directly from GitHub: $ZipUrl" -ForegroundColor Yellow
    $tempZip = Join-Path $env:TEMP "grimoire_update_$([System.Guid]::NewGuid().ToString('N')).zip"
    $tempExtract = Join-Path $env:TEMP "grimoire_extract_$([System.Guid]::NewGuid().ToString('N'))"

    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $ZipUrl -OutFile $tempZip -UseBasicParsing
        Write-Host "    [OK] Downloaded latest repository archive." -ForegroundColor Green

        Write-Host "[+] Extracting update package..." -ForegroundColor White
        Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force

        $extractedRoot = Join-Path $tempExtract "home_controller-main"
        if (-not (Test-Path $extractedRoot)) {
            $extractedRoot = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1 | Select-Object -ExpandProperty FullName
        }

        Write-Host "[+] Applying updated files to $AppDir..." -ForegroundColor White
        $items = Get-ChildItem -Path $extractedRoot -Recurse
        foreach ($item in $items) {
            $relative = $item.FullName.Substring($extractedRoot.Length).TrimStart("\", "/")
            # Never overwrite secrets.json
            if ($relative -ieq "secrets.json") { continue }

            $targetPath = Join-Path $AppDir $relative
            if ($item.PSIsContainer) {
                if (-not (Test-Path $targetPath)) { New-Item -ItemType Directory -Path $targetPath -Force | Out-Null }
            } else {
                Copy-Item -Path $item.FullName -Destination $targetPath -Force
            }
        }

        Write-Host "    [OK] Repository updated to latest version directly from GitHub!" -ForegroundColor Green
    } catch {
        Write-Error "Failed to download update: $_"
    } finally {
        Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 2. Locate Python executable and update dependencies
function Get-PythonPath {
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
    return "python"
}

$PythonExe = Get-PythonPath
Write-Host ""
Write-Host "[+] Python Interpreter: $PythonExe" -ForegroundColor Cyan
Write-Host "[+] Updating Python dependencies from requirements.txt..." -ForegroundColor White

try {
    & $PythonExe -m pip install -r (Join-Path $AppDir "requirements.txt") --quiet
    Write-Host "    [OK] Python dependencies verified!" -ForegroundColor Green
} catch {
    Write-Warning "Could not run pip automatically: $_"
}

# 3. Check if server is currently running and notify
$socket = Get-NetTCPConnection -LocalPort 8088 -State Listen -ErrorAction SilentlyContinue
if ($socket) {
    Write-Host ""
    Write-Host "[i] Grimoire server is currently running (PID: $($socket.OwningProcess))." -ForegroundColor Yellow
    Write-Host "    Right-click the tray icon and select 'Restart Server' to apply changes." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Update Process Complete!" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""
