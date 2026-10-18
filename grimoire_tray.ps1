# ==============================================================================
# The Wizard's Grimoire - System Tray & Background Service Manager
# Runs FastAPI/Uvicorn completely hidden with zero console windows.
# Shows a native Windows System Tray icon with right-click controls (Open, Restart, Exit).
# ==============================================================================

param(
    [switch]$OpenBrowser
)

# Mutex to ensure only ONE instance of the tray manager runs
$MutexName = "Global\GrimoireTrayApp_Mutex"
$CreatedNew = $false
$Mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$CreatedNew)

if (-not $CreatedNew) {
    # Tray manager is already running. If -OpenBrowser was requested, open browser.
    if ($OpenBrowser) {
        Start-Process "http://localhost:8088/launcher"
    }
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Function to find Python executable (py launcher or python)
function Get-PythonPath {
    if (Get-Command py -ErrorAction SilentlyContinue) { return "py" }
    if (Get-Command python -ErrorAction SilentlyContinue) { return "python" }
    return "python"
}

# Function to start the FastAPI server process hidden
function Start-GrimoireServer {
    $socket = Get-NetTCPConnection -LocalPort 8088 -State Listen -ErrorAction SilentlyContinue
    if ($socket) {
        return $socket.OwningProcess
    }

    $pythonExe = Get-PythonPath
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $pythonExe
    $psi.Arguments = "server.py"
    $psi.WorkingDirectory = $ScriptDir
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false

    $proc = [System.Diagnostics.Process]::Start($psi)
    return $proc.Id
}

# Function to stop the server on port 8088
function Stop-GrimoireServer {
    $sockets = Get-NetTCPConnection -LocalPort 8088 -State Listen -ErrorAction SilentlyContinue
    foreach ($s in $sockets) {
        Stop-Process -Id $s.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

# Start server in background
$global:ServerPid = Start-GrimoireServer

# Load or generate icon
$iconPath = Join-Path $ScriptDir "static\grimoire.ico"
if (Test-Path $iconPath) {
    $trayIcon = New-Object System.Drawing.Icon($iconPath)
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

# Build Context Menu
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$headerItem = New-Object System.Windows.Forms.ToolStripMenuItem
$headerItem.Text = "📜 The Wizard's Grimoire (Active)"
$headerItem.Enabled = $false
$contextMenu.Items.Add($headerItem) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$launcherItem = New-Object System.Windows.Forms.ToolStripMenuItem
$launcherItem.Text = "🖥️ Open Display Launcher"
$launcherItem.Font = New-Object System.Drawing.Font($launcherItem.Font, [System.Drawing.FontStyle]::Bold)
$launcherItem.Add_Click({
    Start-Process "http://localhost:8088/launcher"
})
$contextMenu.Items.Add($launcherItem) | Out-Null

$spellbookItem = New-Object System.Windows.Forms.ToolStripMenuItem
$spellbookItem.Text = "📖 Open Tablet Spellbook"
$spellbookItem.Add_Click({
    Start-Process "http://localhost:8088/spellbook"
})
$contextMenu.Items.Add($spellbookItem) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
$restartItem.Text = "🔄 Restart Server"
$restartItem.Add_Click({
    Stop-GrimoireServer
    Start-Sleep -Milliseconds 800
    $global:ServerPid = Start-GrimoireServer
    $notifyIcon.ShowBalloonTip(2000, "The Wizard's Grimoire", "Server restarted on port 8088.", [System.Windows.Forms.ToolTipIcon]::Info)
})
$contextMenu.Items.Add($restartItem) | Out-Null

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "⏹️ Exit & Stop Grimoire"
$exitItem.Add_Click({
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

# Double-click tray icon to open Display Launcher
$notifyIcon.Add_DoubleClick({
    Start-Process "http://localhost:8088/launcher"
})

# Balloon Notification
$notifyIcon.ShowBalloonTip(2500, "The Wizard's Grimoire", "D&D Room Controller is running in the system tray.", [System.Windows.Forms.ToolTipIcon]::Info)

if ($OpenBrowser) {
    Start-Process "http://localhost:8088/launcher"
}

# Run Windows Forms application loop
[System.Windows.Forms.Application]::Run()

# Cleanup on exit
$notifyIcon.Visible = $false
$notifyIcon.Dispose()
try { $Mutex.ReleaseMutex() } catch {}
