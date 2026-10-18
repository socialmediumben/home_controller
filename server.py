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
import socket
import uuid
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from hubspace import LightController

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("GrimoireServer")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
SECRETS_PATH = os.path.join(BASE_DIR, "secrets.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOADS_DIR = os.path.join(STATIC_DIR, "media", "uploads")
FAVICON_PATH = os.path.join(STATIC_DIR, "grimoire.ico")
if not os.path.exists(FAVICON_PATH):
    FAVICON_PATH = os.path.join(STATIC_DIR, "favicon.svg")
os.makedirs(UPLOADS_DIR, exist_ok=True)

APP_VERSION = "1.3.1"

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

def load_config() -> Dict[str, Any]:
    cfg: Dict[str, Any] = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception as e:
            logger.error(f"Error reading config: {e}")

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

    def disconnect(self, websocket: WebSocket):
        client_info = self.clients.pop(websocket, None)
        c_type = client_info.get("type", "unknown") if client_info else "unknown"
        logger.info(f"Client disconnected: {c_type}. Remaining peers: {len(self.clients)}")

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

@app.post("/api/scene")
async def activate_scene(req: SceneSelectRequest):
    presets = config.get("presets", [])
    selected = next((p for p in presets if p["id"] == req.id), None)
    if not selected:
        raise HTTPException(status_code=404, detail="Scene preset not found")

    logger.info(f"--> [SCENE ACTIVATED] '{selected['name']}' (id: {selected['id']})")

    # Update state
    config["current_state"]["scene_id"] = selected["id"]
    config["current_state"]["scene_name"] = selected["name"]
    config["current_state"]["displays"] = selected["displays"]
    config["current_state"]["lighting"] = selected["lighting"]
    save_config(config)

    # Apply lighting
    light_cfg = selected["lighting"]
    await light_controller.apply_state(
        power=light_cfg.get("power", True),
        brightness=light_cfg.get("brightness", 70),
        color=light_cfg.get("color", "#FF9E3B"),
        effect=light_cfg.get("effect", "none")
    )

    # Broadcast to all connected screens and tablets
    payload = {
        "event": "SCENE_CHANGED",
        "version": APP_VERSION,
        "state": config["current_state"],
        "scene": selected
    }
    await manager.broadcast(payload)
    return {"status": "ok", "scene": selected}

@app.post("/api/preset")
async def upsert_preset(req: PresetUpsertRequest):
    presets = config.setdefault("presets", [])
    existing = next((p for p in presets if p["id"] == req.id), None)
    preset_data = req.dict()
    if existing:
        existing.update(preset_data)
        logger.info(f"Updated preset '{req.name}' ({req.id})")
    else:
        presets.append(preset_data)
        logger.info(f"Created new preset '{req.name}' ({req.id})")
    save_config(config)

    full_state = await get_state()
    await manager.broadcast({
        "event": "PRESETS_UPDATED",
        "version": APP_VERSION,
        "presets": full_state["presets"],
        "all_presets": full_state["all_presets"]
    })
    return {"status": "ok", "preset": preset_data}

@app.delete("/api/preset/{preset_id}")
async def delete_preset(preset_id: str):
    presets = config.get("presets", [])
    config["presets"] = [p for p in presets if p["id"] != preset_id]
    save_config(config)
    full_state = await get_state()
    await manager.broadcast({
        "event": "PRESETS_UPDATED",
        "version": APP_VERSION,
        "presets": full_state["presets"],
        "all_presets": full_state["all_presets"]
    })
    return {"status": "ok", "deleted": preset_id}

@app.post("/api/display/{screen}")
async def update_display(screen: str, req: DisplayUpdateRequest):
    if screen not in ("window", "frame", "table"):
        raise HTTPException(status_code=400, detail="Invalid screen identifier.")

    logger.info(f"--> [DISPLAY OVERRIDE] {screen}: {req.title or req.src}")
    cur_display = config["current_state"]["displays"].get(screen, {})
    update_data = req.dict(exclude_unset=True)
    cur_display.update(update_data)
    config["current_state"]["displays"][screen] = cur_display
    save_config(config)

    payload = {
        "event": "DISPLAY_UPDATED",
        "version": APP_VERSION,
        "screen": screen,
        "display": cur_display
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

# WebSocket Endpoint with Explicit Handshake & Peer Status Broadcast
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = await manager.connect(websocket)
    port = config.get("server", {}).get("port", 8088)

    try:
        while True:
            data = await websocket.receive_text()
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

                    forward_msg = {
                        "event": "WEBRTC_SIGNAL",
                        "sender_id": sender_id,
                        "target_screen": target_screen,
                        "signal_type": signal_type,
                        "sdp": msg.get("sdp"),
                        "candidate": msg.get("candidate"),
                        "options": msg.get("options", {})
                    }

                    if signal_type == "offer":
                        logger.info(f"--> [WEBRTC OFFER] From {sender_id} to display_{target_screen}")
                        await manager.send_to_type(f"display_{target_screen}", forward_msg)
                        await manager.broadcast({
                            "event": "MIRROR_STATUS",
                            "screen": target_screen,
                            "active": True,
                            "sender_id": sender_id
                        })
                    elif target_id:
                        await manager.send_to_id(target_id, forward_msg)
                    elif target_screen:
                        await manager.send_to_type(f"display_{target_screen}", forward_msg)

                elif action == "STOP_MIRROR":
                    screen = msg.get("screen")
                    logger.info(f"--> [STOP MIRROR] Screen: {screen}")
                    if screen:
                        await manager.send_to_type(f"display_{screen}", {
                            "event": "STOP_MIRROR",
                            "screen": screen
                        })
                        await manager.broadcast({
                            "event": "MIRROR_STATUS",
                            "screen": screen,
                            "active": False
                        })

                elif action == "PING":
                    await websocket.send_json({"event": "PONG", "version": APP_VERSION})

            except Exception as e:
                logger.error(f"WebSocket processing error: {e}")

    except WebSocketDisconnect:
        manager.disconnect(websocket)
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
    port = config.get("server", {}).get("port", 8088)
    ssl_enabled = config.get("server", {}).get("ssl", True)
    local_ip = get_local_ip()

    if ssl_enabled:
        try:
            cert_path, key_path = ensure_ssl_certificates(local_ip)
            logger.info("=" * 64)
            logger.info(f"  GRIMOIRE SECURE HTTPS SERVER ACTIVE (v{APP_VERSION})")
            logger.info(f"  -> Tablet:   https://{local_ip}:{port}/spellbook")
            logger.info(f"  -> Launcher: https://localhost:{port}/launcher")
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

