"""
FastAPI Server for D&D Wizard's Study Game Room Controller (v1.2.5)
Manages 3 connected displays (Window, Frame, Table Projector) and Hubspace/Smart Lighting.
Features: Explicit client handshakes, developer/user modes, preset editing, room/scene filtering, live peer discovery.
"""

import asyncio
import copy
import json
import logging
import os
import re
import socket
import uuid
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from hubspace import LightController
import display_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("GrimoireServer")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
SECRETS_PATH = os.path.join(BASE_DIR, "secrets.json")
CUSTOM_PRESETS_PATH = os.path.join(BASE_DIR, "custom_presets.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOADS_DIR = os.path.join(STATIC_DIR, "media", "uploads")
FAVICON_PATH = os.path.join(STATIC_DIR, "grimoire.ico")
if not os.path.exists(FAVICON_PATH):
    FAVICON_PATH = os.path.join(STATIC_DIR, "favicon.svg")
os.makedirs(UPLOADS_DIR, exist_ok=True)

APP_VERSION = "1.3.8"

# Helper to get local LAN IP address
def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# De-anonymize WebRTC ICE candidates & SDP (replace mDNS .local, 127.0.0.1, and 169.254 with real LAN IP)
def rewrite_webrtc_ip(text: str, real_ip: str) -> str:
    if not text or not real_ip:
        return text
    # 1. Replace any .local mDNS hostnames with real_ip
    fixed = re.sub(r'[a-zA-Z0-9\-\._]+\.local', real_ip, text)
    # 2. If real_ip is a LAN IP (not localhost), also replace 127.0.0.1 and 169.254 link-local
    if real_ip not in ("127.0.0.1", "::1", "localhost"):
        fixed = re.sub(r'\b127\.0\.0\.1\b', real_ip, fixed)
        fixed = re.sub(r'\b169\.254\.\d{1,3}\.\d{1,3}\b', real_ip, fixed)
    return fixed

def ensure_ssl_certificates(local_ip: str) -> tuple[str, str]:
    cert_path = os.path.join(BASE_DIR, "cert.pem")
    key_path = os.path.join(BASE_DIR, "key.pem")

    if os.path.exists(cert_path) and os.path.exists(key_path):
        return cert_path, key_path

    logger.info("Generating self-signed SSL certificate for HTTPS (Secure Context for screen sharing)...")
    import datetime
    import ipaddress
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, u"The Wizard's Grimoire"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"Grimoire Game Room")
    ])

    san_list = [
        x509.DNSName(u"localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1"))
    ]
    if local_ip and local_ip != "127.0.0.1":
        try:
            san_list.append(x509.IPAddress(ipaddress.IPv4Address(local_ip)))
        except Exception:
            pass

    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.datetime.now(datetime.timezone.utc)
    ).not_valid_after(
        datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650)
    ).add_extension(
        x509.SubjectAlternativeName(san_list),
        critical=False
    ).sign(key, hashes.SHA256())

    with open(key_path, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))

    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    logger.info(f"SSL certificate generated successfully at: {cert_path}")
    return cert_path, key_path

def load_secrets() -> Dict[str, Any]:
    if os.path.exists(SECRETS_PATH):
        try:
            with open(SECRETS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error reading secrets: {e}")
    return {}

def save_secrets(sec: Dict[str, Any]):
    try:
        with open(SECRETS_PATH, "w", encoding="utf-8") as f:
            json.dump(sec, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving secrets: {e}")

def load_custom_presets() -> List[Dict[str, Any]]:
    if os.path.exists(CUSTOM_PRESETS_PATH):
        try:
            with open(CUSTOM_PRESETS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception as e:
            logger.error(f"Error reading custom_presets.json: {e}")
    return []

def save_custom_presets(presets: List[Dict[str, Any]]):
    try:
        with open(CUSTOM_PRESETS_PATH, "w", encoding="utf-8") as f:
            json.dump(presets, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving custom_presets.json: {e}")

def load_config() -> Dict[str, Any]:
    cfg: Dict[str, Any] = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception as e:
            logger.error(f"Error reading config: {e}")

    # Load and merge custom presets so user creations/modifications persist across updates
    custom_presets = load_custom_presets()
    if custom_presets:
        cfg.setdefault("presets", [])
        preset_map = {p["id"]: p for p in cfg["presets"]}
        for cp in custom_presets:
            preset_map[cp["id"]] = cp
        cfg["presets"] = list(preset_map.values())

    secrets = load_secrets()
    # Merge secrets into runtime config for LightController
    if "hubspace" in secrets:
        cfg.setdefault("hubspace", {})
        if secrets["hubspace"].get("username"):
            cfg["hubspace"]["username"] = secrets["hubspace"]["username"]
        if secrets["hubspace"].get("password"):
            cfg["hubspace"]["password"] = secrets["hubspace"]["password"]
    if "home_assistant" in secrets:
        cfg.setdefault("home_assistant", {})
        if secrets["home_assistant"].get("token"):
            cfg["home_assistant"]["token"] = secrets["home_assistant"]["token"]

    # Restore user-selected devices, rooms, and grid calibration across updates
    if "selected_devices" in secrets:
        cfg.setdefault("hubspace", {})["selected_devices"] = secrets["selected_devices"]
    if "selected_rooms" in secrets:
        cfg.setdefault("hubspace", {})["selected_rooms"] = secrets["selected_rooms"]
    if "table_grid_size" in secrets:
        cfg["table_grid_size"] = secrets["table_grid_size"]
    if "table_grid_shape" in secrets:
        cfg["table_grid_shape"] = secrets["table_grid_shape"]
    else:
        cfg.setdefault("table_grid_shape", "square")
    if "display_mapping" in secrets:
        cfg["display_mapping"] = secrets["display_mapping"]
    else:
        cfg.setdefault("display_mapping", {"auto_launch": True, "frame": 2, "window": 3, "table": 1})

    return cfg

def save_config(cfg: Dict[str, Any]):
    # Persist credentials into secrets.json
    secrets = load_secrets()
    hub_pw = cfg.get("hubspace", {}).get("password")
    hub_un = cfg.get("hubspace", {}).get("username")
    ha_tok = cfg.get("home_assistant", {}).get("token")

    if hub_pw:
        secrets.setdefault("hubspace", {})["password"] = hub_pw
    if hub_un:
        secrets.setdefault("hubspace", {})["username"] = hub_un
    if ha_tok:
        secrets.setdefault("home_assistant", {})["token"] = ha_tok

    # Persist user selections into secrets.json so git pulls/updates never wipe them
    secrets["selected_devices"] = cfg.get("hubspace", {}).get("selected_devices", [])
    secrets["selected_rooms"] = cfg.get("hubspace", {}).get("selected_rooms", [])
    if "table_grid_size" in cfg:
        secrets["table_grid_size"] = cfg["table_grid_size"]
    if "table_grid_shape" in cfg:
        secrets["table_grid_shape"] = cfg["table_grid_shape"]
    if "display_mapping" in cfg:
        secrets["display_mapping"] = cfg["display_mapping"]

    save_secrets(secrets)

    # Clone cfg and redact secrets before writing config.json
    clean_cfg = copy.deepcopy(cfg)
    if "hubspace" in clean_cfg:
        clean_cfg["hubspace"]["password"] = ""
    if "home_assistant" in clean_cfg:
        clean_cfg["home_assistant"]["token"] = ""

    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(clean_cfg, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving config: {e}")

config = load_config()
light_controller = LightController(config)

app = FastAPI(title="Grimoire Game Room Controller", version=APP_VERSION)

# Cache-Busting Middleware
@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["X-Grimoire-Version"] = APP_VERSION
    return response

# WebSocket Connection & Peer Manager
class ConnectionManager:
    def __init__(self):
        # Maps websocket -> client_info dict
        self.clients: Dict[WebSocket, Dict[str, Any]] = {}
        # Maps screen ("window" | "frame" | "table") -> sender client_id
        self.active_mirrors: Dict[str, str] = {}

    async def connect(self, websocket: WebSocket) -> str:
        await websocket.accept()
        client_id = f"client_{uuid.uuid4().hex[:8]}"
        self.clients[websocket] = {"client_id": client_id, "type": "unknown", "version": "unknown"}
        return client_id

    def set_client_type(self, websocket: WebSocket, client_type: str, version: str):
        if websocket in self.clients:
            self.clients[websocket]["type"] = client_type
            self.clients[websocket]["version"] = version
        logger.info(f"Handshake registered: {client_type} (v{version}). Total peers: {len(self.clients)}")

    def get_client_id(self, websocket: WebSocket) -> str:
        return self.clients.get(websocket, {}).get("client_id", "")

    def disconnect(self, websocket: WebSocket) -> List[str]:
        client_info = self.clients.pop(websocket, None)
        c_type = client_info.get("type", "unknown") if client_info else "unknown"
        cid = client_info.get("client_id", "") if client_info else ""
        logger.info(f"Client disconnected: {c_type} ({cid}). Remaining peers: {len(self.clients)}")
        orphaned_screens = []
        if cid:
            for screen, owner_id in list(self.active_mirrors.items()):
                if owner_id == cid:
                    self.active_mirrors.pop(screen, None)
                    orphaned_screens.append(screen)
        return orphaned_screens

    async def send_to_id(self, client_id: str, message: dict) -> bool:
        for ws, info in list(self.clients.items()):
            if info.get("client_id") == client_id:
                try:
                    await ws.send_json(message)
                    return True
                except Exception:
                    pass
        return False

    async def send_to_type(self, client_type: str, message: dict) -> int:
        count = 0
        for ws, info in list(self.clients.items()):
            if info.get("type") == client_type:
                try:
                    await ws.send_json(message)
                    count += 1
                except Exception:
                    pass
        return count

    async def send_bytes_to_type(self, client_type: str, data: bytes) -> int:
        count = 0
        for ws, info in list(self.clients.items()):
            if info.get("type") == client_type:
                try:
                    await ws.send_bytes(data)
                    count += 1
                except Exception:
                    pass
        return count

    def get_peer_status(self) -> Dict[str, Any]:
        screens = {"window": False, "frame": False, "table": False}
        spellbooks = 0
        launchers = 0
        for info in self.clients.values():
            t = info.get("type", "")
            if t == "display_window": screens["window"] = True
            elif t == "display_frame": screens["frame"] = True
            elif t == "display_table": screens["table"] = True
            elif t == "spellbook": spellbooks += 1
            elif t == "launcher": launchers += 1
        return {
            "screens": screens,
            "spellbooks_count": spellbooks,
            "launchers_count": launchers,
            "total_clients": len(self.clients)
        }

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in list(self.clients.keys()):
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        for dc in dead_connections:
            self.disconnect(dc)

manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    await light_controller.initialize()
    initial_light = config.get("current_state", {}).get("lighting", {})
    await light_controller.apply_state(
        power=initial_light.get("power", True),
        brightness=initial_light.get("brightness", 70),
        color=initial_light.get("color", "#FF9E3B"),
        effect=initial_light.get("effect", "candle_flicker")
    )
    port = config.get("server", {}).get("port", 8088)
    ssl_enabled = config.get("server", {}).get("ssl", True)
    proto = "https" if ssl_enabled else "http"
    logger.info(f"Grimoire Server v{APP_VERSION} ready! Tablet URL: {proto}://{get_local_ip()}:{port}/spellbook")

    # Automatic Multi-Monitor Display Placement on Startup
    if config.get("display_mapping", {}).get("auto_launch", True):
        async def delayed_display_launch():
            await asyncio.sleep(2.5)
            base_url = f"{proto}://localhost:{port}"
            logger.info(f"Auto-launching displays fullscreen at {base_url}...")
            display_manager.launch_all_displays(config, base_url=base_url)
        asyncio.create_task(delayed_display_launch())

# Request Models
class SceneSelectRequest(BaseModel):
    id: str

class DisplayUpdateRequest(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    type: Optional[str] = None
    effect_type: Optional[str] = None
    src: Optional[str] = None
    caption: Optional[str] = None
    show_mullions: Optional[bool] = None
    show_ornate_border: Optional[bool] = None
    grid_enabled: Optional[bool] = None
    grid_size: Optional[int] = None
    grid_shape: Optional[str] = None
    grid_color: Optional[str] = None
    roll20_url: Optional[str] = None

class LightingUpdateRequest(BaseModel):
    power: Optional[bool] = None
    brightness: Optional[int] = None
    color: Optional[str] = None
    effect: Optional[str] = None

class DeviceControlRequest(BaseModel):
    power: Optional[bool] = None
    brightness: Optional[int] = None
    color: Optional[str] = None

class HubspaceConfigRequest(BaseModel):
    enabled: bool
    username: str
    password: str

class HomeAssistantConfigRequest(BaseModel):
    enabled: bool
    url: str
    token: str
    entity_id: str

class FilterSettingsRequest(BaseModel):
    selected_rooms: Optional[List[str]] = None
    selected_devices: Optional[List[str]] = None
    selected_scenes: Optional[List[str]] = None

class PresetUpsertRequest(BaseModel):
    id: str
    name: str
    description: Optional[str] = ""
    lighting: Dict[str, Any]
    displays: Dict[str, Any]

# Endpoints
@app.get("/favicon.ico")
async def get_favicon():
    return FileResponse(FAVICON_PATH, media_type="image/svg+xml")

@app.get("/api/state")
async def get_state():
    state = config.get("current_state", {})
    state["lighting"] = light_controller.get_state()
    port = config.get("server", {}).get("port", 8088)

    all_presets = config.get("presets", [])
    selected_scenes = config.get("selected_scenes") or []
    if selected_scenes:
        filtered_presets = [p for p in all_presets if p["id"] in selected_scenes]
    else:
        filtered_presets = all_presets

    return {
        "version": APP_VERSION,
        "current_state": state,
        "presets": filtered_presets,
        "all_presets": all_presets,
        "available_rooms": light_controller.get_available_rooms(),
        "available_devices": light_controller.get_all_controllable_devices(),
        "selected_rooms": config.get("hubspace", {}).get("selected_rooms") or [],
        "selected_devices": config.get("hubspace", {}).get("selected_devices") or [],
        "selected_scenes": selected_scenes,
        "table_grid_size": config.get("table_grid_size", 22),
        "table_grid_shape": config.get("table_grid_shape", "square"),
        "hubspace": {
            "enabled": config.get("hubspace", {}).get("enabled", False),
            "username": config.get("hubspace", {}).get("username", "")
        },
        "home_assistant": {
            "enabled": config.get("home_assistant", {}).get("enabled", False),
            "url": config.get("home_assistant", {}).get("url", ""),
            "entity_id": config.get("home_assistant", {}).get("entity_id", "")
        },
        "network": {
            "local_ip": get_local_ip(),
            "port": port,
            "ssl": config.get("server", {}).get("ssl", True),
            "protocol": "https" if config.get("server", {}).get("ssl", True) else "http",
            "connected_clients": len(manager.clients)
        },
        "peers": manager.get_peer_status()
    }

scene_lock = asyncio.Lock()

@app.post("/api/scene")
async def activate_scene(req: SceneSelectRequest):
    async with scene_lock:
        presets = config.get("presets", [])
        selected = next((p for p in presets if p["id"] == req.id), None)
        if not selected:
            raise HTTPException(status_code=404, detail="Scene preset not found")

        logger.info(f"--> [SCENE ACTIVATED] '{selected['name']}' (id: {selected['id']})")

        # Update state
        config["current_state"]["scene_id"] = selected["id"]
        config["current_state"]["scene_name"] = selected["name"]
        
        displays = copy.deepcopy(selected["displays"])
        calibrated_grid_size = config.get("table_grid_size")
        calibrated_grid_shape = config.get("table_grid_shape", "square")
        if "table" in displays:
            if calibrated_grid_size:
                displays["table"]["grid_size"] = calibrated_grid_size
            displays["table"]["grid_shape"] = calibrated_grid_shape

        config["current_state"]["displays"] = displays
        config["current_state"]["lighting"] = selected["lighting"]
        save_config(config)

        # 1. Broadcast to all connected screens and tablets IMMEDIATELY
        payload = {
            "event": "SCENE_CHANGED",
            "version": APP_VERSION,
            "state": config["current_state"],
            "scene": selected
        }
        await manager.broadcast(payload)

        # 2. Dispatch lighting to physical smart bulbs / Hubspace
        light_cfg = selected["lighting"]
        try:
            await light_controller.apply_state(
                power=light_cfg.get("power", True),
                brightness=light_cfg.get("brightness", 70),
                color=light_cfg.get("color", "#FF9E3B"),
                effect=light_cfg.get("effect", "none")
            )
        except Exception as e:
            logger.error(f"Error applying lighting for scene {selected['id']}: {e}")

        # 3. Broadcast verified lighting state
        await manager.broadcast({
            "event": "LIGHTING_UPDATED",
            "version": APP_VERSION,
            "lighting": light_controller.get_state()
        })

        return {"status": "ok", "scene": selected}

@app.post("/api/preset")
async def upsert_preset(req: PresetUpsertRequest):
    presets = config.setdefault("presets", [])
    preset_data = req.dict()

    idx = next((i for i, p in enumerate(presets) if p["id"] == req.id), None)
    if idx is not None:
        presets[idx] = preset_data
        logger.info(f"Updated preset '{req.name}' ({req.id})")
    else:
        presets.append(preset_data)
        logger.info(f"Created new preset '{req.name}' ({req.id})")

    # Persist in custom_presets.json so git pulls/updates never wipe it
    custom_presets = load_custom_presets()
    c_idx = next((i for i, p in enumerate(custom_presets) if p["id"] == req.id), None)
    if c_idx is not None:
        custom_presets[c_idx] = preset_data
    else:
        custom_presets.append(preset_data)
    save_custom_presets(custom_presets)

    # If selected_scenes filter is active, automatically include the preset so it's not hidden
    selected_scenes = config.get("selected_scenes")
    if isinstance(selected_scenes, list) and len(selected_scenes) > 0:
        if req.id not in selected_scenes:
            selected_scenes.append(req.id)
            config["selected_scenes"] = selected_scenes

    save_config(config)

    full_state = await get_state()
    await manager.broadcast({
        "event": "PRESETS_UPDATED",
        "version": APP_VERSION,
        "presets": full_state["presets"],
        "all_presets": full_state["all_presets"],
        "selected_scenes": full_state["selected_scenes"]
    })
    return {"status": "ok", "preset": preset_data}

@app.delete("/api/preset/{preset_id}")
async def delete_preset(preset_id: str):
    presets = config.get("presets", [])
    config["presets"] = [p for p in presets if p["id"] != preset_id]

    custom_presets = load_custom_presets()
    custom_presets = [p for p in custom_presets if p["id"] != preset_id]
    save_custom_presets(custom_presets)

    selected_scenes = config.get("selected_scenes")
    if isinstance(selected_scenes, list) and preset_id in selected_scenes:
        selected_scenes.remove(preset_id)
        config["selected_scenes"] = selected_scenes

    save_config(config)
    full_state = await get_state()
    await manager.broadcast({
        "event": "PRESETS_UPDATED",
        "version": APP_VERSION,
        "presets": full_state["presets"],
        "all_presets": full_state["all_presets"],
        "selected_scenes": full_state["selected_scenes"]
    })
    return {"status": "ok", "deleted": preset_id}

@app.post("/api/display/{screen}")
async def update_display(screen: str, req: DisplayUpdateRequest):
    if screen not in ("window", "frame", "table"):
        raise HTTPException(status_code=400, detail="Invalid screen identifier.")

    logger.info(f"--> [DISPLAY OVERRIDE] {screen}: {req.title or req.src or (f'grid_size={req.grid_size}' if req.grid_size else '')}")
    cur_display = config["current_state"]["displays"].get(screen, {})
    update_data = req.dict(exclude_unset=True)
    cur_display.update(update_data)
    config["current_state"]["displays"][screen] = cur_display

    if screen == "table" and req.grid_size is not None:
        config["table_grid_size"] = req.grid_size
        for p in config.get("presets", []):
            if "table" in p.get("displays", {}):
                p["displays"]["table"]["grid_size"] = req.grid_size

    if screen == "table" and req.grid_shape is not None:
        config["table_grid_shape"] = req.grid_shape
        for p in config.get("presets", []):
            if "table" in p.get("displays", {}):
                p["displays"]["table"]["grid_shape"] = req.grid_shape

    save_config(config)

    payload = {
        "event": "DISPLAY_UPDATED",
        "version": APP_VERSION,
        "screen": screen,
        "display": cur_display,
        "table_grid_size": config.get("table_grid_size", 22),
        "table_grid_shape": config.get("table_grid_shape", "square")
    }
    await manager.broadcast(payload)
    return {"status": "ok", "screen": screen, "display": cur_display}

@app.post("/api/lighting")
async def update_lighting(req: LightingUpdateRequest):
    cur_light = config["current_state"]["lighting"]
    if req.power is not None: cur_light["power"] = req.power
    if req.brightness is not None: cur_light["brightness"] = req.brightness
    if req.color is not None: cur_light["color"] = req.color
    if req.effect is not None: cur_light["effect"] = req.effect
    save_config(config)

    await light_controller.apply_state(
        power=req.power, brightness=req.brightness,
        color=req.color, effect=req.effect
    )

    payload = {
        "event": "LIGHTING_UPDATED",
        "version": APP_VERSION,
        "lighting": light_controller.get_state()
    }
    await manager.broadcast(payload)
    return {"status": "ok", "lighting": light_controller.get_state()}

@app.post("/api/hubspace/device/{device_id}")
async def control_single_device(device_id: str, req: DeviceControlRequest):
    logger.info(f"--> [DEVICE CONTROL] ID {device_id}: power={req.power}, bright={req.brightness}")
    success = await light_controller.set_individual_device(
        device_id=device_id,
        power=req.power,
        brightness=req.brightness,
        color=req.color
    )
    # Broadcast updated lighting state
    payload = {
        "event": "LIGHTING_UPDATED",
        "version": APP_VERSION,
        "lighting": light_controller.get_state()
    }
    await manager.broadcast(payload)
    return {"status": "ok" if success else "failed", "device_id": device_id}

@app.post("/api/settings/hubspace")
async def configure_hubspace(req: HubspaceConfigRequest):
    config["hubspace"]["enabled"] = req.enabled
    config["hubspace"]["username"] = req.username
    config["hubspace"]["password"] = req.password
    save_config(config)
    light_controller.hubspace_config = config["hubspace"]
    if req.enabled:
        success = await light_controller.connect_hubspace()
        full_state = await get_state()
        return {
            "status": "ok" if success else "failed",
            "message": light_controller.status_message,
            "available_rooms": full_state["available_rooms"],
            "available_devices": full_state["available_devices"],
            "selected_rooms": full_state["selected_rooms"],
            "selected_devices": full_state["selected_devices"],
            "selected_scenes": full_state["selected_scenes"]
        }
    else:
        light_controller.status_message = "Simulator Mode Active"
        return {"status": "ok", "message": "Hubspace disabled. Simulator active."}

@app.post("/api/settings/filters")
async def save_filter_settings(req: FilterSettingsRequest):
    if req.selected_rooms is not None:
        config.setdefault("hubspace", {})["selected_rooms"] = req.selected_rooms
    if req.selected_devices is not None:
        config.setdefault("hubspace", {})["selected_devices"] = req.selected_devices
    if req.selected_scenes is not None:
        config["selected_scenes"] = req.selected_scenes
    save_config(config)
    light_controller.hubspace_config = config["hubspace"]

    full_state = await get_state()
    payload = {
        "event": "FILTERS_UPDATED",
        "version": APP_VERSION,
        "state": full_state["current_state"],
        "presets": full_state["presets"],
        "all_presets": full_state["all_presets"],
        "available_rooms": full_state["available_rooms"],
        "available_devices": full_state["available_devices"],
        "selected_rooms": full_state["selected_rooms"],
        "selected_devices": full_state["selected_devices"],
        "selected_scenes": full_state["selected_scenes"]
    }
    await manager.broadcast(payload)
    return {"status": "ok", "state": full_state}

@app.post("/api/settings/home_assistant")
async def configure_home_assistant(req: HomeAssistantConfigRequest):
    config["home_assistant"]["enabled"] = req.enabled
    config["home_assistant"]["url"] = req.url
    config["home_assistant"]["token"] = req.token
    config["home_assistant"]["entity_id"] = req.entity_id
    save_config(config)
    light_controller.ha_config = config["home_assistant"]
    return {"status": "ok", "message": "Home Assistant configuration saved."}

@app.post("/api/media/upload")
async def upload_media(file: UploadFile = File(...)):
    filename = file.filename
    clean_filename = "".join(c for c in filename if c.isalnum() or c in (".", "_", "-")).strip()
    target_path = os.path.join(UPLOADS_DIR, clean_filename)
    with open(target_path, "wb") as f:
        content = await file.read()
        f.write(content)
    file_url = f"/static/media/uploads/{clean_filename}"
    return {"status": "ok", "url": file_url, "filename": clean_filename}

@app.get("/api/media/list")
async def list_uploaded_media():
    files = []
    if os.path.exists(UPLOADS_DIR):
        for f in os.listdir(UPLOADS_DIR):
            file_path = os.path.join(UPLOADS_DIR, f)
            if os.path.isfile(file_path):
                stat = os.stat(file_path)
                files.append({
                    "name": f,
                    "url": f"/static/media/uploads/{f}",
                    "size": stat.st_size,
                    "modified": stat.st_mtime
                })
    # Sort newest first
    files.sort(key=lambda x: x["modified"], reverse=True)
    return {"status": "ok", "files": files}

@app.delete("/api/media/{filename}")
async def delete_uploaded_media(filename: str):
    clean_filename = "".join(c for c in filename if c.isalnum() or c in (".", "_", "-")).strip()
    target_path = os.path.join(UPLOADS_DIR, clean_filename)
    if os.path.isfile(target_path):
        try:
            os.remove(target_path)
            return {"status": "ok", "deleted": clean_filename}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"status": "not_found", "filename": clean_filename}

@app.post("/api/mirror/stop-all")
async def stop_all_mirrors_endpoint():
    manager.active_mirrors.clear()
    for s in ("window", "frame", "table"):
        await manager.send_to_type(f"display_{s}", {"event": "STOP_MIRROR", "screen": s})
        await manager.broadcast({"event": "MIRROR_STATUS", "screen": s, "active": False})
    return {"status": "ok", "message": "All mirrors stopped and displays restored."}

@app.post("/api/mirror/stop/{screen}")
async def stop_screen_mirror_endpoint(screen: str):
    if screen in ("window", "frame", "table"):
        manager.active_mirrors.pop(screen, None)
        await manager.send_to_type(f"display_{screen}", {"event": "STOP_MIRROR", "screen": screen})
        await manager.broadcast({"event": "MIRROR_STATUS", "screen": screen, "active": False})
    return {"status": "ok", "screen": screen}

@app.post("/api/launcher/identify-displays")
async def identify_displays():
    mapping = config.get("display_mapping", {"auto_launch": True, "frame": 2, "window": 3, "table": 1})
    logger.info("--> [IDENTIFY DISPLAYS] Broadcasting 12s ID banner to all displays")
    await manager.broadcast({
        "event": "IDENTIFY_DISPLAYS",
        "seconds": 12,
        "mapping": mapping
    })
    return {"status": "ok", "message": "Display identification triggered for 12 seconds."}

# Multi-Monitor Display Launch Endpoints
@app.post("/api/launcher/open-displays")
async def open_all_displays():
    port = config.get("server", {}).get("port", 8088)
    ssl_enabled = config.get("server", {}).get("ssl", True)
    proto = "https" if ssl_enabled else "http"
    base_url = f"{proto}://localhost:{port}"
    logger.info(f"--> [LAUNCH DISPLAYS TRIGGERED] via API from base URL: {base_url}")
    res = display_manager.launch_all_displays(config, base_url=base_url)
    return res

@app.get("/api/launcher/monitors")
async def get_monitors():
    monitors = display_manager.get_windows_monitors()
    mapping = config.get("display_mapping", {"auto_launch": True, "frame": 2, "window": 3, "table": 1})
    return {
        "status": "ok",
        "monitors": monitors,
        "display_mapping": mapping
    }

@app.post("/api/launcher/display-mapping")
async def save_display_mapping(payload: Dict[str, Any]):
    current_mapping = config.setdefault("display_mapping", {})
    if "auto_launch" in payload:
        current_mapping["auto_launch"] = bool(payload["auto_launch"])
    if "frame" in payload:
        current_mapping["frame"] = int(payload["frame"])
    if "table" in payload:
        current_mapping["table"] = int(payload["table"])
    if "window" in payload:
        current_mapping["window"] = int(payload["window"])
    save_config(config)
    return {"status": "ok", "display_mapping": current_mapping}

@app.post("/api/launcher/window-restore")
async def restore_display_window(screen: str = "window"):
    display_manager.restore_window(screen)
    return {"status": "ok", "screen": screen}

@app.post("/api/launcher/window-toggle")
async def toggle_display_window(screen: str = "window"):
    display_manager.toggle_window(screen)
    return {"status": "ok", "screen": screen}

# WebSocket Endpoint with Explicit Handshake & Peer Status Broadcast
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = await manager.connect(websocket)
    port = config.get("server", {}).get("port", 8088)

    try:
        while True:
            ws_msg = await websocket.receive()
            if ws_msg.get("type") == "websocket.disconnect":
                orphaned = manager.disconnect(websocket)
                for s in orphaned:
                    logger.info(f"--> [AUTO-STOP MIRROR] Disconnect event; stopping mirror on display_{s}")
                    await manager.send_to_type(f"display_{s}", {"event": "STOP_MIRROR", "screen": s})
                    await manager.broadcast({"event": "MIRROR_STATUS", "screen": s, "active": False})
                await manager.broadcast({
                    "event": "PEER_STATUS",
                    "peers": manager.get_peer_status()
                })
                break

            if "bytes" in ws_msg and ws_msg["bytes"]:
                raw_bytes = ws_msg["bytes"]
                # Packet format: b"MIR" + 1 byte screen_code (0=window, 1=frame, 2=table) + payload
                if len(raw_bytes) > 4 and raw_bytes[:3] == b"MIR":
                    screen_code = raw_bytes[3]
                    screen_name = "window" if screen_code == 0 else "frame" if screen_code == 1 else "table"
                    forward_count = await manager.send_bytes_to_type(f"display_{screen_name}", raw_bytes)
                    if not hasattr(manager, "_mirror_count"):
                        manager._mirror_count = 0
                    manager._mirror_count += 1
                    if manager._mirror_count == 1 or manager._mirror_count % 300 == 0:
                        logger.info(f"--> [MIRROR STREAM] Forwarded frame #{manager._mirror_count} ({len(raw_bytes)} bytes) to display_{screen_name} (destinations: {forward_count})")
                continue

            if "text" not in ws_msg or not ws_msg["text"]:
                continue

            data = ws_msg["text"]
            try:
                msg = json.loads(data)
                action = msg.get("action")

                if action == "HANDSHAKE":
                    client_type = msg.get("client_type", "unknown")
                    client_ver = msg.get("version", "unknown")
                    manager.set_client_type(websocket, client_type, client_ver)

                    # Reply with HANDSHAKE_ACK
                    full_state = await get_state()
                    await websocket.send_json({
                        "event": "HANDSHAKE_ACK",
                        "server_version": APP_VERSION,
                        "client_type": client_type,
                        "client_id": client_id,
                        "state": full_state["current_state"],
                        "presets": full_state["presets"],
                        "all_presets": full_state["all_presets"],
                        "available_rooms": full_state["available_rooms"],
                        "available_devices": full_state["available_devices"],
                        "selected_rooms": full_state["selected_rooms"],
                        "selected_devices": full_state["selected_devices"],
                        "selected_scenes": full_state["selected_scenes"],
                        "peers": manager.get_peer_status(),
                        "active_mirrors": dict(manager.active_mirrors),
                        "network": {
                            "local_ip": get_local_ip(),
                            "port": port
                        }
                    })

                    # Notify all peers about updated peer counts
                    await manager.broadcast({
                        "event": "PEER_STATUS",
                        "peers": manager.get_peer_status()
                    })

                elif action == "SELECT_SCENE":
                    scene_id = msg.get("id")
                    if scene_id:
                        await activate_scene(SceneSelectRequest(id=scene_id))

                elif action == "SET_LIGHTS":
                    req = LightingUpdateRequest(**msg.get("lighting", {}))
                    await update_lighting(req)

                elif action == "SET_DEVICE":
                    dev_id = msg.get("device_id")
                    dev_req = DeviceControlRequest(**msg.get("data", {}))
                    if dev_id:
                        await control_single_device(dev_id, dev_req)

                elif action == "SET_FILTERS":
                    filter_req = FilterSettingsRequest(**msg.get("data", {}))
                    await save_filter_settings(filter_req)

                elif action == "UPSERT_PRESET":
                    preset_req = PresetUpsertRequest(**msg.get("data", {}))
                    await upsert_preset(preset_req)

                elif action == "DELETE_PRESET":
                    pid = msg.get("id")
                    if pid:
                        await delete_preset(pid)

                elif action == "SET_DISPLAY":
                    screen = msg.get("screen")
                    req = DisplayUpdateRequest(**msg.get("display", {}))
                    await update_display(screen, req)

                elif action == "WEBRTC_SIGNAL":
                    target_screen = msg.get("target_screen")
                    target_id = msg.get("target_id")
                    sender_id = msg.get("sender_id") or client_id
                    signal_type = msg.get("signal_type")

                    # Determine sender IP on the LAN
                    client_host = websocket.client.host if (websocket.client and websocket.client.host) else ""
                    if client_host in ("127.0.0.1", "::1", "localhost", ""):
                        sender_ip = get_local_ip()
                    else:
                        sender_ip = client_host

                    # Rewrite candidates and SDP to eliminate unresolvable mDNS .local and 127.0.0.1/169.254 on LAN
                    sdp_data = msg.get("sdp")
                    if isinstance(sdp_data, dict):
                        raw_sdp = sdp_data.get("sdp", "")
                        if raw_sdp:
                            sdp_data["sdp"] = rewrite_webrtc_ip(raw_sdp, sender_ip)

                    cand_data = msg.get("candidate")
                    if isinstance(cand_data, dict):
                        raw_cand = cand_data.get("candidate", "")
                        if raw_cand:
                            cand_data["candidate"] = rewrite_webrtc_ip(raw_cand, sender_ip)

                    forward_msg = {
                        "event": "WEBRTC_SIGNAL",
                        "sender_id": sender_id,
                        "sender_ip": sender_ip,
                        "target_screen": target_screen,
                        "signal_type": signal_type,
                        "sdp": sdp_data,
                        "candidate": cand_data,
                        "options": msg.get("options", {})
                    }

                    if signal_type == "offer":
                        logger.info(f"--> [WEBRTC OFFER] From {sender_id} ({sender_ip}) to display_{target_screen}")
                        if target_screen:
                            manager.active_mirrors[target_screen] = sender_id
                        sent_count = await manager.send_to_type(f"display_{target_screen}", forward_msg)
                        logger.info(f"--> [WEBRTC OFFER] Delivered to {sent_count} display_{target_screen} client(s)")
                        await manager.broadcast({
                            "event": "MIRROR_STATUS",
                            "screen": target_screen,
                            "active": True,
                            "sender_id": sender_id
                        })
                    elif target_id:
                        sent = await manager.send_to_id(target_id, forward_msg)
                        if not sent:
                            logger.warning(f"--> [WEBRTC SIGNAL {signal_type}] target_id {target_id} not found, falling back to all spellbook clients")
                            await manager.send_to_type("spellbook", forward_msg)
                    elif target_screen:
                        await manager.send_to_type(f"display_{target_screen}", forward_msg)

                elif action == "START_MIRROR_STREAM":
                    screen = msg.get("screen")
                    options = msg.get("options", {})
                    logger.info(f"--> [MIRROR STREAM START] Screen: {screen}, Options: {options}")
                    if screen:
                        manager.active_mirrors[screen] = client_id
                        await manager.send_to_type(f"display_{screen}", {
                            "event": "START_MIRROR_STREAM",
                            "screen": screen,
                            "options": options
                        })
                        await manager.broadcast({
                            "event": "MIRROR_STATUS",
                            "screen": screen,
                            "active": True
                        })

                elif action == "STOP_MIRROR":
                    screen = msg.get("screen")
                    logger.info(f"--> [STOP MIRROR] Screen: {screen}")
                    if screen:
                        manager.active_mirrors.pop(screen, None)
                        await manager.send_to_type(f"display_{screen}", {
                            "event": "STOP_MIRROR",
                            "screen": screen
                        })
                        await manager.broadcast({
                            "event": "MIRROR_STATUS",
                            "screen": screen,
                            "active": False
                        })

                elif action == "LAUNCH_DISPLAYS":
                    port = config.get("server", {}).get("port", 8088)
                    ssl_enabled = config.get("server", {}).get("ssl", True)
                    proto = "https" if ssl_enabled else "http"
                    base_url = f"{proto}://localhost:{port}"
                    res = display_manager.launch_all_displays(config, base_url=base_url)
                    await websocket.send_json({"event": "LAUNCH_DISPLAYS_ACK", "result": res})

                elif action == "PING":
                    await websocket.send_json({"event": "PONG", "version": APP_VERSION})

            except Exception as e:
                logger.error(f"WebSocket processing error: {e}")

    except WebSocketDisconnect:
        orphaned = manager.disconnect(websocket)
        for s in orphaned:
            logger.info(f"--> [AUTO-STOP MIRROR] WebSocket disconnected; stopping mirror on display_{s}")
            await manager.send_to_type(f"display_{s}", {"event": "STOP_MIRROR", "screen": s})
            await manager.broadcast({"event": "MIRROR_STATUS", "screen": s, "active": False})
        # Notify remaining peers
        await manager.broadcast({
            "event": "PEER_STATUS",
            "peers": manager.get_peer_status()
        })

# HTML Page Routes
@app.get("/", response_class=HTMLResponse)
@app.get("/spellbook", response_class=HTMLResponse)
async def get_spellbook_page():
    return FileResponse(os.path.join(STATIC_DIR, "spellbook.html"))

@app.get("/display", response_class=HTMLResponse)
@app.get("/display/window", response_class=HTMLResponse)
async def get_window_display():
    return FileResponse(os.path.join(STATIC_DIR, "display.html"))

@app.get("/display/frame", response_class=HTMLResponse)
async def get_frame_display():
    return FileResponse(os.path.join(STATIC_DIR, "display.html"))

@app.get("/display/table", response_class=HTMLResponse)
async def get_table_display():
    return FileResponse(os.path.join(STATIC_DIR, "display.html"))

@app.get("/launcher", response_class=HTMLResponse)
async def get_launcher_page():
    return FileResponse(os.path.join(STATIC_DIR, "launcher.html"))

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    import uvicorn
    import http.server
    import threading

    port = config.get("server", {}).get("port", 8088)
    ssl_enabled = config.get("server", {}).get("ssl", True)
    local_ip = get_local_ip()

    def start_http_redirectors(target_https_port: int, ip_addr: str):
        class RedirectHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                raw_host = self.headers.get("Host", "").split(":")[0]
                host = raw_host if raw_host and raw_host != "0.0.0.0" else ip_addr
                path = self.path if self.path and self.path != "/" else "/spellbook"
                target = f"https://{host}:{target_https_port}{path}"
                self.send_response(307)
                self.send_header("Location", target)
                self.send_header("Connection", "close")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_POST(self):
                self.do_GET()

            def do_HEAD(self):
                self.do_GET()

            def log_message(self, format, *args):
                pass

        for redirect_port in (80, 8080):
            try:
                srv = http.server.HTTPServer(("0.0.0.0", redirect_port), RedirectHandler)
                t = threading.Thread(target=srv.serve_forever, daemon=True)
                t.start()
                logger.info(f"  -> HTTP Auto-Redirector active on port {redirect_port} -> https://{ip_addr}:{target_https_port}")
            except Exception as e:
                logger.debug(f"Port {redirect_port} redirector skipped: {e}")

    if ssl_enabled:
        try:
            cert_path, key_path = ensure_ssl_certificates(local_ip)
            start_http_redirectors(port, local_ip)
            logger.info("=" * 64)
            logger.info(f"  GRIMOIRE SECURE HTTPS SERVER ACTIVE (v{APP_VERSION})")
            logger.info(f"  -> Tablet:   https://{local_ip}:{port}/spellbook")
            logger.info(f"  -> Launcher: https://localhost:{port}/launcher")
            logger.info(f"  -> Quick Web Link: http://{local_ip} (auto-redirects to HTTPS)")
            logger.info("=" * 64)
            uvicorn.run(
                app,
                host="0.0.0.0",
                port=port,
                ssl_keyfile=key_path,
                ssl_certfile=cert_path
            )
        except Exception as e:
            logger.error(f"Failed to start with SSL: {e}. Falling back to standard HTTP...")
            uvicorn.run(app, host="0.0.0.0", port=port)
    else:
        logger.info(f"Grimoire HTTP Server running on http://{local_ip}:{port}/spellbook")
        uvicorn.run(app, host="0.0.0.0", port=port)

