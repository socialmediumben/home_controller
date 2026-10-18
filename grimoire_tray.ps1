# ==============================================================================
# The Wizard's Grimoire - System Tray & Background Service Manager
# Pure ASCII - No Unicode / Emojis to guarantee compatibility with all PowerShell encodings.
# ==============================================================================

param(
    [switch]$OpenBrowser
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) { $ScriptDir = $PSScriptRoot }
if (-not $ScriptDir) { $ScriptDir = Get-Location }
Set-Location $ScriptDir

$LogFile = Join-Path $ScriptDir "tray_log.txt"

function Write-TrayLog([string]$msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$timestamp] $msg" | Out-File -FilePath $LogFile -Append -Encoding ascii
}

Write-TrayLog "Starting grimoire_tray.ps1 (OpenBrowser=$OpenBrowser)..."

# Single-instance mutex check
$MutexName = "Global\GrimoireTrayApp_Mutex"
$CreatedNew = $false
try {
    $Mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$CreatedNew)
} catch {
    Write-TrayLog "Mutex creation exception: $_"
    $CreatedNew = $true
}

if (-not $CreatedNew) {
    Write-TrayLog "Grimoire tray app is already running."
    if ($OpenBrowser) {
        Start-Process "http://localhost:8088/launcher"
    }
    exit 0
}

try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
} catch {
    Write-TrayLog "Failed to load Windows Forms / Drawing assemblies: $_"
    exit 1
}

# Find Python executable
function Get-PythonPath {
    if (Get-Command py -ErrorAction SilentlyContinue) { return "py" }
    if (Get-Command python -ErrorAction SilentlyContinue) { return "python" }
    return "python"
}

# Start FastAPI server process
function Start-GrimoireServer {
    try {
        $socket = Get-NetTCPConnection -LocalPort 8088 -State Listen -ErrorAction SilentlyContinue
        if ($socket) {
            Write-TrayLog "Server already listening on port 8088 (PID: $($socket.OwningProcess))"
            return $socket.OwningProcess
        }

        $pythonExe = Get-PythonPath
        Write-TrayLog "Launching server using: $pythonExe server.py"

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $pythonExe
        $psi.Arguments = "server.py"
        $psi.WorkingDirectory = $ScriptDir
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.CreateNoWindow = $true
        $psi.UseShellExecute = $false

        $proc = [System.Diagnostics.Process]::Start($psi)
        Write-TrayLog "Server process spawned with PID: $($proc.Id)"
        return $proc.Id
    } catch {
        Write-TrayLog "Error starting server: $_"
        return $null
    }
}

# Stop server process
function Stop-GrimoireServer {
    try {
        $sockets = Get-NetTCPConnection -LocalPort 8088 -State Listen -ErrorAction SilentlyContinue
        foreach ($s in $sockets) {
            Write-TrayLog "Stopping process on port 8088 (PID: $($s.OwningProcess))"
            Stop-Process -Id $s.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-TrayLog "Error stopping server: $_"
    }
}

# Spawn server
$global:ServerPid = Start-GrimoireServer

# Load or generate icon
$iconPath = Join-Path $ScriptDir "static\grimoire.ico"
if (Test-Path $iconPath) {
    try {
        $trayIcon = New-Object System.Drawing.Icon($iconPath)
    } catch {
        $trayIcon = [System.Drawing.SystemIcons]::Application
    }
} else {
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(28, 21, 12))
    $goldBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(212, 163, 75))
    $g.FillEllipse($bgBrush, 1, 1, 30, 30)
    $font = New-Object System.Drawing.Font("Georgia", 14, [System.Drawing.FontStyle]::Bold)
    $g.DrawString("G", $font, $goldBrush, 6, 4)
    $hIcon = $bmp.GetHicon()
    $trayIcon = [System.Drawing.Icon]::FromHandle($hIcon)
}

# Build Context Menu (100% standard ASCII)
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$headerItem = New-Object System.Windows.Forms.ToolStripMenuItem
$headerItem.Text = "The Wizard's Grimoire (Active)"
$headerItem.Enabled = $false
$contextMenu.Items.Add($headerItem) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$launcherItem = New-Object System.Windows.Forms.ToolStripMenuItem
$launcherItem.Text = "Open Display Launcher"
$launcherItem.Font = New-Object System.Drawing.Font($launcherItem.Font, [System.Drawing.FontStyle]::Bold)
$launcherItem.Add_Click({
    Start-Process "http://localhost:8088/launcher"
})
$contextMenu.Items.Add($launcherItem) | Out-Null

$spellbookItem = New-Object System.Windows.Forms.ToolStripMenuItem
$spellbookItem.Text = "Open Tablet Spellbook"
$spellbookItem.Add_Click({
    Start-Process "http://localhost:8088/spellbook"
})
$contextMenu.Items.Add($spellbookItem) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
$restartItem.Text = "Restart Server"
$restartItem.Add_Click({
    Stop-GrimoireServer
    Start-Sleep -Milliseconds 800
    $global:ServerPid = Start-GrimoireServer
    $notifyIcon.ShowBalloonTip(2000, "The Wizard's Grimoire", "Server restarted on port 8088.", [System.Windows.Forms.ToolTipIcon]::Info)
})
$contextMenu.Items.Add($restartItem) | Out-Null

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "Exit and Stop Grimoire"
$exitItem.Add_Click({
    Write-TrayLog "Exit requested by user."
    Stop-GrimoireServer
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    try { $Mutex.ReleaseMutex() } catch {}
    [System.Windows.Forms.Application]::Exit()
})
$contextMenu.Items.Add($exitItem) | Out-Null

# Setup NotifyIcon
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $trayIcon
$notifyIcon.ContextMenuStrip = $contextMenu
$notifyIcon.Text = "The Wizard's Grimoire (Port 8088)"
$notifyIcon.Visible = $true

# Double click to open Display Launcher
$notifyIcon.Add_DoubleClick({
    Start-Process "http://localhost:8088/launcher"
})

Write-TrayLog "System tray icon initialized."

# Optional browser popup
if ($OpenBrowser) {
    Start-Process "http://localhost:8088/launcher"
}

# Run Windows message loop
try {
    [System.Windows.Forms.Application]::Run()
} catch {
    Write-TrayLog "Application.Run exception: $_"
} finally {
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    try { $Mutex.ReleaseMutex() } catch {}
    Write-TrayLog "Grimoire tray app terminated."
}
