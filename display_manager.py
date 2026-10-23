"""
Display Manager for The Wizard's Grimoire (v1.3.8)
Handles multi-monitor enumeration on Windows, browser launching, and automatic fullscreen positioning.
Default Mapping:
  - Display 1: Picture Frame Monitor (/display/frame)
  - Display 2: Window Display (/display/window)
  - Display 3: Overhead Table Projector (/display/table)
"""

import asyncio
import ctypes
from ctypes import wintypes
import logging
import os
import re
import subprocess
import tempfile
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("DisplayManager")

class RECT(ctypes.Structure):
    _fields_ = [
        ('left', wintypes.LONG),
        ('top', wintypes.LONG),
        ('right', wintypes.LONG),
        ('bottom', wintypes.LONG)
    ]

class MONITORINFOEX(ctypes.Structure):
    _fields_ = [
        ('cbSize', wintypes.DWORD),
        ('rcMonitor', RECT),
        ('rcWork', RECT),
        ('dwFlags', wintypes.DWORD),
        ('szDevice', wintypes.WCHAR * 32)
    ]

# Win32 Constants
SWP_NOZORDER = 0x0004
SWP_SHOWWINDOW = 0x0040
SW_MAXIMIZE = 3
SW_MINIMIZE = 6
SW_RESTORE = 9
WM_CLOSE = 0x0010
HWND_TOP = 0

def get_windows_monitors() -> List[Dict[str, Any]]:
    """Enumerate all connected physical and virtual monitors in Windows."""
    monitors: List[Dict[str, Any]] = []

    def monitor_enum_proc(hMonitor, hdcMonitor, lprcMonitor, dwData):
        info = MONITORINFOEX()
        info.cbSize = ctypes.sizeof(MONITORINFOEX)
        if ctypes.windll.user32.GetMonitorInfoW(hMonitor, ctypes.byref(info)):
            dev_name = str(info.szDevice)
            # Extract monitor index number from string like \\.\DISPLAY1
            idx_match = re.search(r'\d+', dev_name)
            idx = int(idx_match.group(0)) if idx_match else len(monitors) + 1

            x = int(info.rcMonitor.left)
            y = int(info.rcMonitor.top)
            width = int(info.rcMonitor.right - info.rcMonitor.left)
            height = int(info.rcMonitor.bottom - info.rcMonitor.top)
            is_primary = bool(info.dwFlags & 1)

            monitors.append({
                "device": dev_name,
                "index": idx,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "is_primary": is_primary
            })
        return True

    try:
        EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(RECT), wintypes.LPARAM)
        ctypes.windll.user32.EnumDisplayMonitors(None, None, EnumProc(monitor_enum_proc), 0)
    except Exception as e:
        logger.error(f"Error enumerating Windows displays: {e}")

    # Sort primarily by monitor index (DISPLAY1, DISPLAY2, DISPLAY3...)
    monitors.sort(key=lambda m: m["index"])
    return monitors

def get_browser_executable() -> Optional[str]:
    """Find installed Google Chrome or Microsoft Edge browser executable."""
    candidate_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe")
    ]
    for path in candidate_paths:
        if os.path.isfile(path):
            return path
    return None

def find_windows_by_title_substring(title_sub: str) -> List[int]:
    """Finds all visible window handles matching a given title substring."""
    hwnds: List[int] = []

    def enum_cb(hwnd, lparam):
        if ctypes.windll.user32.IsWindowVisible(hwnd):
            length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                ctypes.windll.user32.GetWindowTextW(hwnd, buff, length + 1)
                if title_sub.lower() in buff.value.lower():
                    hwnds.append(hwnd)
        return True

    try:
        EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        ctypes.windll.user32.EnumWindows(EnumProc(enum_cb), 0)
    except Exception as e:
        logger.warning(f"Error enumerating window titles: {e}")

    return hwnds

def position_window_on_monitor(hwnd: int, monitor: Dict[str, Any]):
    """Force moves a window onto a monitor's coordinates, sets fullscreen, and brings to top."""
    try:
        x, y = monitor["x"], monitor["y"]
        w, h = monitor["width"], monitor["height"]
        # Restore first in case it was maximized on another monitor
        ctypes.windll.user32.ShowWindow(hwnd, SW_RESTORE)
        time.sleep(0.04)
        ctypes.windll.user32.SetWindowPos(hwnd, HWND_TOP, x, y, w, h, SWP_SHOWWINDOW)
        time.sleep(0.04)
        ctypes.windll.user32.ShowWindow(hwnd, SW_MAXIMIZE)
        ctypes.windll.user32.BringWindowToTop(hwnd)
        ctypes.windll.user32.SetForegroundWindow(hwnd)
        logger.info(f"Positioned window hwnd={hwnd} to {monitor['device']} ({x},{y} {w}x{h})")
    except Exception as e:
        logger.warning(f"Failed positioning window hwnd={hwnd}: {e}")

# Process tracking
_launched_display_processes: List[subprocess.Popen] = []

def close_all_displays() -> int:
    """Terminate any launched display kiosk processes and close existing display windows."""
    global _launched_display_processes
    count = 0
    pids_to_kill = set()

    # 1. Inspect any visible display windows and collect their owning process IDs
    hwnds = find_windows_by_title_substring("Display [v")
    for hwnd in hwnds:
        pid = wintypes.DWORD()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value:
            pids_to_kill.add(pid.value)
        try:
            ctypes.windll.user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
            count += 1
        except Exception:
            pass

    # 2. Add tracked subprocess PIDs
    while _launched_display_processes:
        proc = _launched_display_processes.pop()
        if proc.pid:
            pids_to_kill.add(proc.pid)

    # 3. Kill process trees with taskkill
    for pid in pids_to_kill:
        try:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
            count += 1
        except Exception:
            pass

    return count

def launch_all_displays(config: Dict[str, Any], base_url: str = "https://localhost:8088") -> Dict[str, Any]:
    """
    Cleanly terminates any previous display instances and launches Chrome/Edge
    for the 3 Grimoire displays positioned onto their assigned monitors.
    Mapping defaults:
      - Display 1: Picture Frame (/display/frame)
      - Display 2: Window Display (/display/window)
      - Display 3: Overhead Table Projector (/display/table)
    """
    # Clean up previous instances so Chromium profiles unlock and windows don't duplicate
    close_all_displays()
    time.sleep(0.6)

    browser_exe = get_browser_executable()
    if not browser_exe:
        logger.error("No compatible Chromium browser (Chrome or Edge) found on system!")
        return {"status": "error", "message": "Neither Chrome nor Edge was found."}

    monitors = get_windows_monitors()
    logger.info(f"Detected {len(monitors)} monitor(s) on Windows: {monitors}")

    display_mapping = config.get("display_mapping", {
        "frame": 2,
        "window": 3,
        "table": 1
    })

    # Base profile directory to keep displays independent from regular browsing
    base_profile_dir = os.path.join(tempfile.gettempdir(), "grimoire_kiosk_profiles")
    os.makedirs(base_profile_dir, exist_ok=True)

    results = {}
    screen_targets = [
        ("frame", "Picture Frame Monitor", display_mapping.get("frame", 2)),
        ("window", "53\" Window TV", display_mapping.get("window", 3)),
        ("table", "Overhead Table Projector", display_mapping.get("table", 1))
    ]

    for screen_name, friendly_title, target_display_num in screen_targets:
        # Find matching monitor by display index (e.g. DISPLAY1 -> 1)
        matched_mon = next((m for m in monitors if m["index"] == target_display_num), None)
        if not matched_mon and monitors:
            # Fallback gracefully if fewer monitors are connected
            fallback_idx = (target_display_num - 1) % len(monitors)
            matched_mon = monitors[fallback_idx]
            logger.info(f"Display {target_display_num} not detected; falling back to {matched_mon['device']}")

        if not matched_mon:
            matched_mon = {"device": f"DISPLAY{target_display_num}", "x": 0, "y": 0, "width": 1920, "height": 1080}

        profile_dir = os.path.join(base_profile_dir, f"profile_{screen_name}")
        url = f"{base_url.rstrip('/')}/display/{screen_name}"

        # Clean, banner-free kiosk arguments:
        # --test-type suppresses the "You are using an unsupported command-line flag: --ignore-certificate-errors" banner!
        cmd = [
            browser_exe,
            f"--app={url}",
            f"--window-position={matched_mon['x']},{matched_mon['y']}",
            f"--window-size={matched_mon['width']},{matched_mon['height']}",
            "--start-fullscreen",
            f"--user-data-dir={profile_dir}",
            "--test-type",
            "--no-first-run",
            "--no-default-browser-check",
            "--ignore-certificate-errors",
            "--allow-insecure-localhost",
            "--autoplay-policy=no-user-gesture-required",
            "--disable-features=Translate",
            "--disable-pinch",
            "--overscroll-history-navigation=0",
            "--disable-infobars",
            "--disable-notifications",
            "--disable-popup-blocking",
            "--disable-session-crashed-bubble",
            "--hide-scrollbars"
        ]

        logger.info(f"Launching {friendly_title} on {matched_mon['device']} (Display {target_display_num})...")
        try:
            proc = subprocess.Popen(cmd)
            _launched_display_processes.append(proc)
            results[screen_name] = {
                "status": "launched",
                "monitor": matched_mon,
                "url": url,
                "pid": proc.pid
            }
        except Exception as e:
            logger.error(f"Failed to launch {screen_name}: {e}")
            results[screen_name] = {"status": "error", "error": str(e)}

    # Also launch the Launcher window (minimized to taskbar for quick Mini PC access)
    launcher_profile = os.path.join(base_profile_dir, "profile_launcher")
    launcher_url = f"{base_url.rstrip('/')}/launcher"
    launcher_cmd = [
        browser_exe,
        f"--app={launcher_url}",
        f"--user-data-dir={launcher_profile}",
        "--test-type",
        "--no-first-run",
        "--no-default-browser-check",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
        "--disable-infobars"
    ]
    try:
        l_proc = subprocess.Popen(launcher_cmd)
        _launched_display_processes.append(l_proc)
        results["launcher"] = {"status": "launched", "pid": l_proc.pid}
        logger.info("Launched Launcher window (will minimize to taskbar)...")
    except Exception as e:
        logger.warning(f"Could not launch launcher window: {e}")

    # Schedule background verification to ensure Win32 coordinates are locked & in front
    def verify_and_nudge_windows():
        start_t = time.time()
        positioned_screens = set()
        display_hwnds = set()

        while time.time() - start_t < 12.0:
            time.sleep(0.6)
            for screen_name, friendly_name, target_display_num in screen_targets:
                if screen_name in positioned_screens:
                    continue

                matched_mon = next((m for m in monitors if m["index"] == target_display_num), None)
                if not matched_mon and monitors:
                    matched_mon = monitors[(target_display_num - 1) % len(monitors)]
                if not matched_mon:
                    continue

                # Search by standard display title format or fallback
                title_subs = [f"- {screen_name.upper()}", f"Display [v"]
                hwnds = []
                for sub in title_subs:
                    found = find_windows_by_title_substring(sub)
                    # Filter if sub is general
                    if sub == f"- {screen_name.upper()}":
                        hwnds = found
                        break
                    elif len(screen_targets) == 1:
                        hwnds = found
                        break

                if hwnds:
                    for hwnd in hwnds:
                        display_hwnds.add(hwnd)
                        position_window_on_monitor(hwnd, matched_mon)
                    positioned_screens.add(screen_name)
                    logger.info(f"[DisplayManager] Snapped {friendly_name} onto {matched_mon['device']} (Display {target_display_num})")

            # Check if all displays found
            if len(positioned_screens) >= len(screen_targets):
                logger.info("[DisplayManager] All display windows positioned successfully.")
                break

        # Minimize the launcher window so it remains in the taskbar ready for use without covering displays
        time.sleep(0.5)
        launcher_hwnds = find_windows_by_title_substring("Launcher") + find_windows_by_title_substring("launcher")
        for l_hwnd in set(launcher_hwnds):
            if l_hwnd not in display_hwnds:
                ctypes.windll.user32.ShowWindow(l_hwnd, SW_MINIMIZE)

    import threading
    t = threading.Thread(target=verify_and_nudge_windows, daemon=True)
    t.start()

    return {
        "status": "ok",
        "monitors_detected": len(monitors),
        "displays": results
    }

def restore_window(screen_name: str):
    """Restores a display window from fullscreen to normal windowed mode."""
    title_sub = f"- {screen_name.upper()}"
    hwnds = find_windows_by_title_substring(title_sub)
    for hwnd in hwnds:
        try:
            ctypes.windll.user32.ShowWindow(hwnd, SW_RESTORE)
            logger.info(f"Restored window hwnd={hwnd} ({screen_name})")
        except Exception as e:
            logger.warning(f"Error restoring window: {e}")

def toggle_window(screen_name: str):
    """Toggles window between restored and maximized/fullscreen mode."""
    title_sub = f"- {screen_name.upper()}"
    hwnds = find_windows_by_title_substring(title_sub)
    for hwnd in hwnds:
        try:
            if ctypes.windll.user32.IsZoomed(hwnd):
                ctypes.windll.user32.ShowWindow(hwnd, SW_RESTORE)
            else:
                ctypes.windll.user32.ShowWindow(hwnd, SW_MAXIMIZE)
        except Exception as e:
            logger.warning(f"Error toggling window: {e}")
