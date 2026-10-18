# 📜 The Wizard's Grimoire: D&D Game Room & Display Controller (v1.3.0)

A unified local controller for a Dungeons & Dragons game room decorated as a wizard's study. Controls **three independent thematic displays** and **smart lighting (Home Depot Hubspace & Google Home)** from a tablet disguised as a magical spellbook.

---

## 🏛️ System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Tablet / "Spellbook"                 │
│       (Ancient parchment & gold illuminated UI)        │
│   • One-touch atmospheric scenes                       │
│   • Manual lighting & candle/lightning FX              │
│   • Screen overrides (maps, portraits, weather)        │
│   • Arcane Screen & Window Mirroring Controller        │
│   • Developer Mode: Live preset editor & art uploader  │
└───────────────────────────┬────────────────────────────┘
                            │ WebSocket (LAN Wi-Fi)
                            ▼
┌────────────────────────────────────────────────────────┐
│           Dell OptiPlex Mini PC (Local Hub)            │
│   • FastAPI + WebSockets real-time server              │
│   • WebRTC LAN low-latency screen/window streamer      │
│   • Hubspace Cloud API / Simulator module              │
│   • Local media server & canvas weather engine         │
└────────────┬──────────────┬──────────────┬─────────────┘
             │              │              │
             ▼              ▼              ▼
       [Window TV]    [Frame Monitor] [Table Projector]
         53" TV       Framed Portrait    Overhead Table
      Gothic glass     Moving artwork    Battlemaps, live
     ambient weather    & NPC clues       window mirror, or
     or window cast   or handout cast       Roll20 embed
```

---

## ⚡ Quick Start

1. **Double-click `run.bat`** (or open a terminal and run `python server.py`).
2. The server will start on clean dedicated port **8088** and automatically open the **Display Launcher**:
   * `http://localhost:8088/launcher`
3. On the launcher page, click the buttons to open the 3 display windows and drag them to each monitor:
   * **Window TV (53"):** `http://localhost:8088/display/window`
   * **Picture Frame:** `http://localhost:8088/display/frame`
   * **Table Projector:** `http://localhost:8088/display/table`
   * *(Press `F` or double-click any display window to toggle borderless fullscreen!)*
4. **Connect your Tablet ("Spellbook"):**
   * Make sure your tablet is on the same home Wi-Fi network.
   * Open the URL shown in `run.bat` (e.g. `http://192.168.86.250:8088/spellbook`).
   * Verify that the top header shows `v1.3.0 ● Synced`!

---

## 🖥️ Screen & Window Mirroring

In addition to pre-built atmospheric scenes and media, you can mirror **any application window or monitor** directly onto any of the 3 displays right from the **Spellbook**:

* **How to Mirror:** In the Spellbook on your tablet or PC, tap **Screen Overrides** and click **🖥️ Mirror Window / Screen** under the display you want to cast to (Window TV, Picture Frame, or Table Projector).
* **Window vs. Full Screen:** Choose whether to stream an entire monitor or just a specific application window (Foundry VTT, Owlbear Rodeo, Discord, VLC, Spotify, or a PDF reader).
* **Display Fit Options:** Choose between **Fit Screen (No Crop)** to ensure battlemaps and window text are fully visible without cropping, or **Fill Screen (Cover)** for cinematic visuals.
* **Thematic Overlays:** Keep or toggle thematic overlays (gothic window mullions, gilded portrait frame, or tactical 1-inch tabletop grid) over your mirrored stream.
* **Ultra-Low Latency:** Uses native browser WebRTC over your local network (< 50ms latency, 60 FPS, hardware accelerated).

---

## ✨ Atmospheric Presets Included

| Scene Preset | Chamber Lighting | 53" Window TV | Picture Frame | Table Projector |
| :--- | :--- | :--- | :--- | :--- |
| **The Archmage's Study** | Warm amber (Candle flicker) | Rain on castle glass | Archmage Ignis (Wise wizard) | The Arcane Library map |
| **Thunderstorm at Midnight** | Cold blue (Strobe lightning) | Midnight tempest & gale | Lord Malakor (Lich) | Flooded Crypt map |
| **The Hearthside Tavern** | Fire orange (Warm hearth) | Tavern village sunset | Barnaby the Barkeep | Tavern Main Hall map |
| **Sunken Dungeon Crypt** | Sickly green (Dim torchlight) | Dungeon iron bars | Crypt Guardian (Skeleton) | Tomb of the Kings map |
| **Dragon's Wrath / Combat** | Crimson red (Pulse alert) | Inferno skies & embers | Vermithrax the Red Dragon | Volcanic Caldera arena |
| **Feywild Twilight** | Mystical violet/cyan | Enchanted wisp forest | Queen Titania (Fey Queen) | Fey Crossroads map |
| **Blackout / Stealth** | Pitch black (Lights off) | Void of night | Shadows / Unseen Stalker | Shroud of Mystery fog |

---

## 💡 Smart Lighting (Hubspace & Simulator Mode)

* **Virtual Simulator (Default):** Works out of the box with zero setup! The spellbook displays a real-time virtual glowing orb that reflects all color, brightness, candle flicker, and lightning effects.
* **Home Depot Hubspace Cloud:**
  1. In the Spellbook UI on your tablet, tap **⚙️ Settings** in the top-right corner.
  2. Enter your Hubspace account email and password.
  3. Tap **Save & Connect**. The server connects directly to the Hubspace platform to control your smart lights in real-time.
* **Home Assistant Relay:** If you already run Home Assistant with Hubspace or Google Home, configure your HA URL and access token in `config.json`.

---

## 🗺️ Adding Your Own Battlemaps & Media

* **Images & Maps:** Drop your `.jpg`, `.png`, or `.svg` files into `static/media/tables/`, `static/media/frames/`, or `static/media/windows/`.
* **Video Loops:** You can also drop animated `.mp4` or `.webm` battlemaps directly into the media folders—the displays support seamless looping video.
* **Roll20 Support:** On the tablet spellbook, tap **Screen Overrides ➔ Table Projector ➔ Launch Roll20 Web Embed** and enter your campaign link to project Roll20 directly onto the tabletop.

