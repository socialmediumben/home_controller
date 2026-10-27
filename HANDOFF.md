# 🧙‍♂️ The Wizard's Grimoire: Technical Architecture & Developer Hand-off Document

> **Version:** 1.3.8  
> **Target Audience:** AI Agents, Software Engineers, and Game Masters incorporating, extending, or automating this project.  
> **Last Updated:** October 2026

---

## 1. Executive Summary & Purpose

**The Wizard's Grimoire (Home Controller)** is a unified, real-time smart room and multi-display orchestration engine tailored for immersive tabletop role-playing games (D&D) and themed physical spaces.

### Core Capabilities:
1. **Triple-Display Coordinated Output:**
   * **Display 1 (Picture Frame Monitor):** NPC portraits, player handouts, animated creature loops, gilded parchment aesthetic.
   * **Display 2 (Overhead Table Projector):** High-resolution battlemaps, customizable 1-inch tactical grids (toggle between square and hex patterns), WebRTC/WebSocket window mirroring (e.g. Foundry VTT / Owlbear Rodeo), or live Roll20 web embeds.
   * **Display 3 (Window 53" TV):** Thematic procedural outdoor views (gothic window arches with live HTML5 Canvas rain, midnight thunderstorm with strobe flashes, blizzard, volcanic embers, and tavern sunsets).
2. **Synchronized Smart Lighting:**
   * Direct reverse-engineered cloud integration with **Home Depot Hubspace** smart lights.
   * Atmospheric lighting effects: candle flicker algorithms, lightning bolt strobes tied to audio/visuals, combat pulse alerts, and total blackout.
   * Embedded real-time **Virtual Orb Simulator** when physical smart lights are offline or unconfigured.
3. **Low-Latency Screen & Window Mirroring:**
   * Built-in browser-based screen and single-window casting from any laptop or tablet directly to any room display over local Wi-Fi.
   * Dual streaming pipeline: WebRTC Data/MediaStreams with automatic LAN IP translation + fallback high-throughput WebSocket binary streaming (`ArrayBuffer` JPEG/WebP @ 30 FPS).
4. **Automated Multi-Monitor Kiosk Launcher:**
   * Windows Win32 API (`ctypes.windll.user32`) multi-monitor detection and positioning.
   * Launches isolated Google Chrome kiosk profiles snapped to the exact coordinate bounds of each physical display.
5. **Mobile "Spellbook" Tablet UI:**
   * Ancient gold-illuminated parchment interface for the Dungeon Master to execute one-touch atmospheric scenes, trigger lightning strikes, customize lighting, and override any display in real-time.

---

## 2. System Architecture

```
                               ┌────────────────────────────────────────────────────────┐
                               │                 Tablet / Laptop DM UI                  │
                               │                ("/spellbook" Interface)                │
                               │   - Scene Presets (Tavern, Dungeon, Storm, etc.)       │
                               │   - Live Lighting Color Picker & Flicker FX            │
                               │   - Screen & Window Mirroring Capture (getDisplayMedia)│
                               │   - Battlemap / Portrait / Weather Overrides           │
                               └───────────────────────────┬────────────────────────────┘
                                                           │ HTTPS / WSS (Port 8088)
                                                           │ JSON Actions & Binary Video Frames
                                                           ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       Mini PC Local Hub (FastAPI Server)                                              │
│                                                                                                                       │
│  ┌───────────────────────────┐  ┌─────────────────────────────┐  ┌───────────────────────────┐  ┌──────────────────┐  │
│  │     FastAPI & Uvicorn     │  │      WebSocket Manager      │  │      Display Manager      │  │  Hubspace Client │  │
│  │  - REST API Routes        │  │  - Peer tracking & types    │  │  - Win32 API monitor enum │  │  - OAuth auth    │  │
│  │  - State serialization    │  │  - JSON event broadcasts    │  │  - Chrome kiosk profiles  │  │  - 60s keepalive │  │
│  │  - Auto self-signed SSL   │  │  - Binary frame forwarding  │  │  - Fullscreen positioning │  │  - RGB / flicker │  │
│  └───────────────────────────┘  └─────────────────────────────┘  └───────────────────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────┘
                                                           │
                    ┌──────────────────────────────────────┼──────────────────────────────────────┐
                    │ Chrome Kiosk Profile 1               │ Chrome Kiosk Profile 2               │ Chrome Kiosk Profile 3
                    ▼                                      ▼                                      ▼
     ┌─────────────────────────────┐        ┌─────────────────────────────┐        ┌─────────────────────────────┐
     │      Display 1: Frame       │        │      Display 2: Table       │        │      Display 3: Window      │
     │      (/display/frame)       │        │      (/display/table)       │        │      (/display/window)      │
     │ - Moving portrait video/img │        │ - Battlemaps & video loops  │        │ - 53" Gothic Castle TV      │
     │ - Handout viewer            │        │ - 1" Grid: Square or Hex    │        │ - Procedural Canvas Weather │
     │ - Gilded frame border       │        │ - Roll20 embed or Mirror    │        │ - Rain, Thunder, Snow, Fire │
     └─────────────────────────────┘        └─────────────────────────────┘        └─────────────────────────────┘
```

---

## 3. Repository Directory Structure

```
home_controller/
├── server.py                  # Core backend: FastAPI, WebSocket hub, SSL generator, REST routes
├── display_manager.py         # Win32 monitor detection, Chrome profile launcher, window snapping
├── hubspace.py                # Standalone Hubspace cloud API driver (reverse-engineered Afero client)
├── config.json                # Master defaults: scenes, presets, display defaults, sound paths
├── secrets.json               # (GIT-IGNORED) Sensitive credentials: Hubspace login, monitor mapping
├── custom_presets.json        # (GIT-IGNORED) User-created scene presets saved via the UI
├── requirements.txt           # Python dependencies (fastapi, uvicorn, websockets, cryptography, etc.)
├── cert.pem / key.pem         # (GIT-IGNORED) Self-signed SSL certificate auto-generated on first boot
│
├── static/                    # Frontend client assets served directly by FastAPI
│   ├── spellbook.html         # DM controller web app (Parchment & gold illuminated manuscript theme)
│   ├── spellbook.js           # Controller state management, WebSocket client, screen capture streamer
│   ├── spellbook.css          # Thematic responsive styling
│   ├── window.html            # Display 3 frontend: Gothic mullions & HTML5 procedural weather engine
│   ├── table.html             # Display 2 frontend: Projector battlemaps, square/hex grid, mirror receiver
│   ├── frame.html             # Display 1 frontend: Picture frame portraits, handouts, mirror receiver
│   ├── launcher.html          # Mini PC dashboard: Display monitor status, identify cards, snap windows
│   ├── launcher.js            # Launcher status polling and display re-launch buttons
│   └── media/                 # Ambient assets, audio, maps, portraits, and user uploads
│       ├── frames/            # Portraits & NPC art
│       ├── tables/            # Tactical battlemaps (JPG, PNG, MP4 video loops)
│       ├── windows/           # Castle window background visuals
│       └── uploads/           # User-uploaded files from the spellbook UI
│
├── run.bat                    # Production boot script: cleans ports, discovers LAN IP, starts server
├── allow_firewall.bat         # Windows Defender Firewall rule helper for port 8088 & port 80
├── diagnose.ps1               # Automated diagnostic script for network, ports, and display setup
└── setup_autostart.ps1        # Configures Windows startup registry/task to auto-boot on PC power-up
```

---

## 4. Key Subsystems & Implementation Details

### A. The Display Manager (`display_manager.py`)
* **Physical Monitor Enumeration:** Uses `ctypes.windll.user32.EnumDisplayMonitors` and `GetMonitorInfoW` to retrieve exact pixel coordinate bounds `(left, top, right, bottom)` for each physical screen connected to Windows.
* **Chrome Automation:**
  * Uses the user's installed Google Chrome binary (detects standard 64-bit and 32-bit install paths).
  * Launches each display with an isolated `--user-data-dir` (e.g. `chrome_profile_frame`, `chrome_profile_table`, `chrome_profile_window`) so separate windows do not merge into a single browser tab bar.
  * Command-line flags used:
    ```bash
    --app=https://localhost:8088/display/{screen}
    --window-position={left},{top}
    --window-size={width},{height}
    --kiosk
    --disable-pinch
    --overscroll-history-navigation=0
    --ignore-certificate-errors
    ```
* **Fullscreen & Hotkeys:**
  * Displays feature an integrated event listener for `Esc` or `F` keys to enter or exit fullscreen mode for troubleshooting without closing the app.
* **Monitor Mapping Persistence:**
  * Users can reassign which physical monitor corresponds to which display in the Settings UI without touching code. The mapping is stored in `secrets.json` under `display_mapping`.

### B. Hubspace Smart Lighting Driver (`hubspace.py`)
* **Protocol:** Reverse-engineered REST communication with Afero/Hubspace mobile API endpoints (`https://api2.afero.net/v1`).
* **Authentication:** Exchanging account credentials for OAuth Bearer tokens, with automatic 60-second background keep-alive refresh loops.
* **Device Control:** Modifies device attribute states (power `bool`, brightness `0-100`, RGB color hex/temperature).
* **Standalone Portability:** `hubspace.py` has no dependency on FastAPI and can be imported directly into other Python applications:
  ```python
  from hubspace import HubspaceClient
  client = HubspaceClient("email@example.com", "password")
  await client.authenticate()
  devices = await client.get_devices()
  await client.set_device_color(device_id, "#ff8800", brightness=80)
  ```

### C. Screen & Window Mirroring Engine
* **Why HTTPS is Mandatory:** Modern browsers refuse access to `navigator.mediaDevices.getDisplayMedia` (the screen capture API) unless running in a **Secure Context** (`https://` or `localhost`).
* **SSL Certificate Generation:** `server.py` checks for `cert.pem` and `key.pem`. If missing, it uses Python's `cryptography` library to automatically generate a self-signed X.509 certificate with Subject Alternative Names (SAN) matching the host machine's LAN IP address.
* **Transmission Pipelines:**
  1. **WebRTC:** Used for peer-to-peer streaming. `server.py` contains a specialized IP rewrite helper (`rewrite_webrtc_ip`) that strips unresolvable `.local` mDNS domains and loopback IPs from SDP offers/candidates, ensuring clean LAN communication.
  2. **WebSocket Binary Fallback:** If WebRTC is blocked by a restrictive browser policy or firewall, the Spellbook captures frames via HTML5 Canvas, encodes them into JPEG/WebP blobs, prepends a 4-byte header (`b"MIR" + 1 byte screen_code`), and sends them across the existing WebSocket. The server forwards these binary chunks directly to the target display in sub-30ms latency.

### D. Procedural Weather & Battlemap Grid Canvas Engines
* **Weather Canvas (`window.html`):** Custom high-efficiency 60 FPS HTML5 canvas engine. Simulates particles, wind vector physics, mist layers, lightning flashes, and rain ripples. Weather types: `rain`, `heavy_rain`, `thunderstorm`, `snow`, `blizzard`, `embers`, `fog`, `clear_sun`.
* **Tactical Grid Canvas (`table.html`):** Renders over battlemaps or live screen mirror streams.
  * **Square Grid:** Configurable pitch (default 22-25px, calibrated for 1-inch physical tabletop grid).
  * **Hexagonal Grid:** Mathematically accurate pointy-top/flat-top hexagon tessellation matching the exact cell area of the square grid.
  * **Toggles:** DM can toggle the grid on/off or switch grid modes directly from the Spellbook UI.

---

## 5. REST API Reference

The server runs on port **8088** by default (e.g. `https://<HOST_IP>:8088`).

| Method | Endpoint | Description | Sample Payload |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/state` | Retrieves full system state: active scene, display states, light states, peers, available presets. | *None* |
| `POST` | `/api/scene` | Activates an atmospheric scene preset by ID. | `{"id": "tavern"}` |
| `POST` | `/api/preset` | Creates or updates a custom preset. | `{"data": { "id": "boss_fight", "name": "Dragon Fight", ... }}` |
| `DELETE` | `/api/preset/{id}` | Deletes a custom preset. | *None* |
| `POST` | `/api/display/{screen}` | Overrides a specific display (`window`, `frame`, `table`). | `{"media": "dungeon_map.jpg", "fit": "contain", "grid": true}` |
| `POST` | `/api/lighting` | Controls master lighting state (color, brightness, flicker effect). | `{"power": true, "color": "#ff4400", "brightness": 90, "effect": "candle"}` |
| `POST` | `/api/hubspace/device/{id}`| Directly controls an individual smart bulb or outlet. | `{"power": true, "color": "#00ffcc", "brightness": 100}` |
| `POST` | `/api/settings/hubspace` | Updates Hubspace credentials and triggers immediate re-login. | `{"username": "user@gmail.com", "password": "..."}` |
| `POST` | `/api/mirror/stop-all` | Immediately stops all active screen/window mirrors across all displays. | *None* |
| `POST` | `/api/mirror/stop/{screen}` | Stops mirroring on an individual display. | *None* |
| `POST` | `/api/launcher/open-displays`| Closes lingering browser kiosks and re-opens all 3 displays snapped to screens. | *None* |
| `GET` | `/api/launcher/monitors` | Returns list of all detected physical Windows monitors and their resolutions. | *None* |
| `POST` | `/api/launcher/display-mapping` | Saves monitor ID mapping for frame, table, and window. | `{"frame": 1, "table": 2, "window": 3}` |
| `POST` | `/api/media/upload` | Multipart file upload for battlemaps, portraits, and music. | Form Data: `file` |
| `GET` | `/api/media/list` | Returns JSON catalog of all local and uploaded images and videos. | *None* |

---

## 6. Real-Time WebSocket Protocol (`wss://<HOST_IP>:8088/ws`)

### Connection Handshake
When any client connects, it must transmit a `HANDSHAKE` message:
```json
{
  "action": "HANDSHAKE",
  "client_type": "spellbook", // Options: "spellbook", "display_window", "display_frame", "display_table", "launcher"
  "version": "1.3.8"
}
```
The server responds with `HANDSHAKE_ACK`, returning the complete synchronized state, list of connected peers, network configuration, and active mirrors.

### Real-Time Inbound Actions (Client ➔ Server)
* `SELECT_SCENE`: `{"action": "SELECT_SCENE", "id": "archmage_study"}`
* `SET_LIGHTS`: `{"action": "SET_LIGHTS", "lighting": {"color": "#ffaa00", "brightness": 75, "effect": "candle"}}`
* `SET_DISPLAY`: `{"action": "SET_DISPLAY", "screen": "table", "display": {"media": "cave.png", "grid_type": "hex"}}`
* `START_MIRROR_STREAM`: `{"action": "START_MIRROR_STREAM", "screen": "table", "options": {"fit": "contain"}}`
* `STOP_MIRROR`: `{"action": "STOP_MIRROR", "screen": "table"}`
* `WEBRTC_SIGNAL`: Passes SDP offers, answers, and ICE candidate objects between clients.

### Broadcast Outbound Events (Server ➔ All Clients)
* `STATE_UPDATE`: Broadcasts full or delta state update when any parameter changes.
* `LIGHTNING_FLASH`: Triggers instantaneous white flash on the window and strobe on the lights.
* `MIRROR_STATUS`: Broadcasts when a screen begins or ends receiving a screen mirror stream.
* `PEER_STATUS`: Updates all connected clients with the live count of active DM tablets and displays.

---

## 7. Configuration Files & State Persistence

| File | Purpose | Version Controlled? |
| :--- | :--- | :--- |
| `config.json` | Master system defaults (presets, fallback devices, audio cues, default display geometries). | **Yes** |
| `secrets.json` | Sensitive user data: Hubspace login credentials, selected device IDs, saved physical monitor indices. | **No** (`.gitignore`) |
| `custom_presets.json` | Custom scenes created or customized by the user in the Spellbook UI. Preserved across Git pulls. | **No** (`.gitignore`) |
| `cert.pem` & `key.pem` | Local self-signed SSL certificate and private key. Generated on-the-fly. | **No** (`.gitignore`) |

> **Pro-Tip for Downstream Projects:** Always read configuration using the merged pattern implemented in `server.py`: load defaults from `config.json`, then overlay values from `secrets.json` if the file exists. This prevents software updates from ever wiping user configuration.

---

## 8. Integration Recipes for Future Projects

### Recipe 1: Triggering Atmospheric Scenes from Discord, Twitch, or StreamDeck
You can trigger any scene or lighting effect with a single HTTP POST request from another bot, automation script, or Elgato StreamDeck:
```python
import requests

# Disable verify if using self-signed cert on local network
SERVER_URL = "https://192.168.1.150:8088"

# Trigger "Dragon Combat" preset
requests.post(f"{SERVER_URL}/api/scene", json={"id": "dragon_wrath"}, verify=False)

# Trigger a lightning strike
requests.post(f"{SERVER_URL}/api/lighting", json={
    "power": True,
    "color": "#ffffff",
    "brightness": 100,
    "effect": "lightning"
}, verify=False)
```

### Recipe 2: Integrating with Home Assistant
If your smart home runs Home Assistant:
1. Configure Home Assistant REST Commands in your `configuration.yaml`:
   ```yaml
   rest_command:
     grimoire_scene_tavern:
       url: "https://<MINI_PC_IP>:8088/api/scene"
       method: POST
       payload: '{"id": "hearthside_tavern"}'
       content_type: "application/json"
       verify_ssl: false
   ```
2. You can now trigger game room scenes directly from physical Zigbee wall switches, motion sensors, or automation routines.

### Recipe 3: Integrating Foundry VTT or Owlbear Rodeo
* **Direct Battlemap Casting:** Open Foundry VTT or Owlbear Rodeo on the DM laptop.
* Open the Spellbook (`https://<MINI_PC_IP>:8088/spellbook`), tap **Screen Overrides ➔ Table Projector ➔ Mirror Window / Screen**, and select your Foundry player view window.
* Foundry will now stream to the projector with sub-second latency and zero complex HDMI cable runs.

### Recipe 4: Embedding The Wizard's Grimoire into a Master Web App
All displays are regular responsive web pages that can be loaded into iframes or WebViews:
* Picture Frame: `https://<HOST>:8088/display/frame`
* Overhead Table: `https://<HOST>:8088/display/table`
* Gothic Window: `https://<HOST>:8088/display/window`
* Tablet Spellbook: `https://<HOST>:8088/spellbook`
* Display Launcher Admin: `https://<HOST>:8088/launcher`

---

## 9. Troubleshooting & Maintenance Quick Reference

* **Firewall Blocking Connections:**
  Run `allow_firewall.bat` as Administrator on the host machine to permit incoming connections on ports 8088 and 80.
* **Port 8088 Already in Use:**
  `run.bat` automatically checks for and terminates lingering processes on port 8088 before starting. To manually free it:
  ```powershell
  Get-Process -Id (Get-NetTCPConnection -LocalPort 8088).OwningProcess | Stop-Process -Force
  ```
* **Displays Snapping to the Wrong Monitor:**
  Open the Spellbook on the tablet, go to **⚙️ Settings ➔ Display Mapping**, or open `https://<HOST>:8088/launcher`. Click **Identify Displays** to see big screen numbers appear on each monitor, then match them to Frame, Table, and Window.
* **Certificate Warning on Tablet ("Connection Not Private"):**
  This is expected for self-signed certificates on local IP addresses. Tap **Advanced ➔ Proceed to [IP]** once.

---

*Authored by the Google DeepMind Antigravity Team for The Wizard's Grimoire.*
