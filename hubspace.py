"""
Hubspace & Smart Light Controller for D&D Wizard's Study (v1.2.5)
Connects directly to The Home Depot Hubspace Keycloak Auth & Afero IoT Semantics Cloud.
Supports room/scene filtering, individual device management, master room presets, dynamic effects, and simulation.
"""

import asyncio
import base64
import json
import logging
import math
import random
import time
from typing import Any, Dict, List, Optional
import aiohttp

logger = logging.getLogger("LightController")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

HUBSPACE_TOKEN_URL = "https://accounts.hubspaceconnect.com/auth/realms/thd/protocol/openid-connect/token"
AFERO_API_URL = "https://api2.afero.net/v1"
AFERO_SEMANTICS_URL = "https://semantics2.afero.net/v1"


def decode_jwt_payload(token: str) -> Dict[str, Any]:
    """Safely decodes JWT payload without requiring third-party libraries."""
    try:
        parts = token.split(".")
        if len(parts) >= 2:
            payload_b64 = parts[1]
            payload_b64 += "=" * (-len(payload_b64) % 4)
            return json.loads(base64.urlsafe_b64decode(payload_b64.encode("utf-8")))
    except Exception as e:
        logger.warning(f"Failed to decode JWT payload: {e}")
    return {}


class LightController:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.hubspace_config = config.get("hubspace", {})
        self.ha_config = config.get("home_assistant", {})

        # Master Chamber State
        self.power: bool = True
        self.brightness: int = 70  # 0 - 100
        self.color_hex: str = "#FF9E3B"
        self.active_effect: str = "none"

        # Hubspace Session Data
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.account_id: Optional[str] = None
        self.devices: List[Dict[str, Any]] = []
        self.is_connected: bool = False
        self.status_message: str = "Virtual Simulator Mode Active (No credentials entered)"

        self._effect_task: Optional[asyncio.Task] = None
        self._keepalive_task: Optional[asyncio.Task] = None
        self._auth_lock = asyncio.Lock()

    @property
    def is_simulator(self) -> bool:
        return not (
            (self.hubspace_config.get("enabled") and self.hubspace_config.get("username") and self.hubspace_config.get("password")) or
            (self.ha_config.get("enabled") and self.ha_config.get("url"))
        )

    async def initialize(self):
        """Attempts connection if credentials are configured; otherwise starts simulator."""
        if self.hubspace_config.get("enabled") and self.hubspace_config.get("username") and self.hubspace_config.get("password"):
            await self.connect_hubspace()
        elif self.ha_config.get("enabled") and self.ha_config.get("url"):
            self.is_connected = True
            self.status_message = "Connected via Home Assistant REST Relay"
            logger.info("Using Home Assistant light relay")
        else:
            self.is_connected = True
            self.status_message = "Virtual Simulator Mode Active (No credentials entered)"
            logger.info("Starting in Simulator Mode (virtual lights)")

    async def connect_hubspace(self) -> bool:
        """Authenticate with The Home Depot Keycloak realm (thd) and discover metadevices."""
        username = self.hubspace_config.get("username")
        password = self.hubspace_config.get("password")

        if not username or not password:
            self.status_message = "Hubspace username and password required."
            return False

        logger.info(f"[Hubspace] Authenticating as {username}...")

        auth_payload = {
            "grant_type": "password",
            "client_id": "hubspace_android",
            "username": username,
            "password": password
        }

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Hubspace-Android/1.0"
        }

        try:
            async with aiohttp.ClientSession() as session:
                # 1. Exchange credentials for JWT Tokens
                async with session.post(HUBSPACE_TOKEN_URL, data=auth_payload, headers=headers, timeout=12) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        self.access_token = data.get("access_token")
                        self.refresh_token = data.get("refresh_token")

                        # 2. Fetch authoritative account_id from /users/me
                        await self._fetch_account_id_from_user(session)

                        # 3. Discover Hubspace lighting devices
                        if self.account_id:
                            await self.discover_devices(session)

                        self.is_connected = True
                        device_count = len(self.devices)
                        self.status_message = f"Connected to Hubspace ({device_count} device(s) found)"
                        logger.info(f"[Hubspace] {self.status_message}")
                        self._start_keepalive_if_needed()
                        return True

                    elif resp.status in (400, 401):
                        err_text = await resp.text()
                        logger.warning(f"[Hubspace] Invalid credentials (HTTP {resp.status}): {err_text}")
                        self.status_message = "Hubspace login failed: Invalid username or password."
                        return False
                    else:
                        err_text = await resp.text()
                        logger.error(f"[Hubspace] Auth HTTP {resp.status}: {err_text}")
                        self.status_message = f"Hubspace server returned HTTP {resp.status}."
                        return False

        except aiohttp.ClientConnectorError as e:
            logger.error(f"[Hubspace] Network connection error: {e}")
            self.status_message = f"Cannot reach Hubspace servers: {e}"
            return False
        except asyncio.TimeoutError:
            self.status_message = "Hubspace login timed out. Check your internet connection."
            return False
        except Exception as e:
            logger.error(f"[Hubspace] Unexpected auth error: {e}")
            self.status_message = f"Hubspace connection error: {str(e)}"
            return False

    def _start_keepalive_if_needed(self):
        """Starts background loop that keeps Hubspace access token alive continuously."""
        if self._keepalive_task is None or self._keepalive_task.done():
            self._keepalive_task = asyncio.create_task(self._token_keepalive_loop())

    async def _token_keepalive_loop(self):
        """Proactively checks and refreshes the Hubspace token every 60s so scene switches never hit an expired token."""
        while True:
            try:
                await asyncio.sleep(60)
                if self.hubspace_config.get("enabled") and (self.access_token or self.refresh_token):
                    await self.ensure_valid_token()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"[Hubspace Keepalive] Token check notice: {e}")

    async def ensure_valid_token(self, session: Optional[aiohttp.ClientSession] = None) -> bool:
        """Ensures the access token is valid and not expired (Hubspace tokens expire every 120s)."""
        async with self._auth_lock:
            if self.access_token:
                payload = decode_jwt_payload(self.access_token)
                exp = payload.get("exp", 0)
                # If token has more than 30 seconds of life remaining, it is valid
                if time.time() < (exp - 30):
                    return True

            # Token is expired or expiring within 30s -> Refresh immediately
            logger.info("[Hubspace] Access token expired or expiring soon; refreshing...")
            if self.refresh_token:
                success = await self._refresh_access_token(session)
                if success:
                    return True

            # If refresh failed, perform a full re-authentication
            logger.info("[Hubspace] Refresh token failed or missing; performing full authentication...")
            return await self.connect_hubspace()

    async def _refresh_access_token(self, session: Optional[aiohttp.ClientSession] = None) -> bool:
        """Exchange refresh_token for a new access_token without full re-login."""
        if not self.refresh_token:
            return False

        refresh_payload = {
            "grant_type": "refresh_token",
            "client_id": "hubspace_android",
            "refresh_token": self.refresh_token
        }
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Hubspace-Android/1.0"
        }

        should_close = False
        if session is None:
            session = aiohttp.ClientSession()
            should_close = True

        try:
            async with session.post(HUBSPACE_TOKEN_URL, data=refresh_payload, headers=headers, timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.access_token = data.get("access_token")
                    if data.get("refresh_token"):
                        self.refresh_token = data.get("refresh_token")
                    logger.info("[Hubspace] Access token refreshed successfully.")
                    return True
                else:
                    err_txt = await resp.text()
                    logger.warning(f"[Hubspace] Token refresh returned HTTP {resp.status}: {err_txt}")
                    return False
        except Exception as e:
            logger.warning(f"[Hubspace] Token refresh exception: {e}")
            return False
        finally:
            if should_close:
                await session.close()

    async def _fetch_account_id_from_user(self, session: aiohttp.ClientSession):
        """Query /users/me to find the account_id from the accountAccess structure."""
        try:
            url = f"{AFERO_API_URL}/users/me"
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "User-Agent": "Hubspace-Android/1.0",
                "Accept": "application/json"
            }
            async with session.get(url, headers=headers, timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    logger.info(f"[Hubspace] /users/me keys: {list(data.keys())}")

                    # 1. Parse accountAccess array (primary Afero structure)
                    account_access = data.get("accountAccess", [])
                    if isinstance(account_access, list) and len(account_access) > 0:
                        for entry in account_access:
                            acc = entry.get("account", {})
                            acc_id = acc.get("accountId") or entry.get("accountId")
                            if acc_id:
                                self.account_id = acc_id
                                break

                    # 2. Fallbacks
                    if not self.account_id:
                        self.account_id = (
                            data.get("account", {}).get("accountId") or
                            data.get("accountId") or
                            data.get("id")
                        )

                    logger.info(f"[Hubspace] Authoritative Account ID: {self.account_id}")
                else:
                    logger.warning(f"[Hubspace] /users/me returned HTTP {resp.status}")
        except Exception as e:
            logger.warning(f"[Hubspace] Could not fetch account ID from /users/me: {e}")

    async def discover_devices(self, session: aiohttp.ClientSession):
        """Query Afero Semantics to find all connected lights/devices under the account."""
        if not self.account_id or not self.access_token:
            return

        url = f"{AFERO_SEMANTICS_URL}/accounts/{self.account_id}/metadevices?expansions=state"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "User-Agent": "Hubspace-Android/1.0",
            "Accept": "application/json"
        }

        try:
            async with session.get(url, headers=headers, timeout=12) as resp:
                if resp.status == 200:
                    devices_data = await resp.json()
                    if isinstance(devices_data, list):
                        self.devices = devices_data
                    elif isinstance(devices_data, dict):
                        self.devices = devices_data.get("metadevices", [])
                    logger.info(f"[Hubspace] Discovered {len(self.devices)} metadevices under account {self.account_id}.")
                else:
                    logger.warning(f"[Hubspace] Device discovery returned HTTP {resp.status}")
        except Exception as e:
            logger.error(f"[Hubspace] Device discovery failed: {e}")

    def format_device(self, dev: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extract user-friendly fields for display on the Spellbook UI. Excludes rooms/homes."""
        type_id = dev.get("typeId", "")
        if type_id in ("metadevice.room", "metadevice.home"):
            return None

        dev_id = str(dev.get("id") or dev.get("deviceId") or "")
        name = (
            dev.get("friendlyName") or
            dev.get("friendlyDescription") or
            dev.get("description", {}).get("device", {}).get("description") or
            f"Hubspace Device {dev_id[:6]}"
        )

        funcs = [f.get("functionClass") for f in dev.get("description", {}).get("functions", [])]
        has_power = "power" in funcs
        has_lock = "lock-control" in funcs
        has_bright = "brightness" in funcs
        has_color = "color-rgb" in funcs

        model = "Switch / Outlet"
        if has_lock:
            model = "Door Lock"
        elif has_color:
            model = "RGB Light"
        elif has_bright:
            model = "Dimmable Light"
        elif has_power:
            model = "Smart Switch"

        state_obj = dev.get("state", {})
        values = state_obj.get("values", []) if isinstance(state_obj, dict) else []

        power = False
        brightness = 100 if has_bright else None
        color = "#FF9E3B"

        for v in values:
            fclass = v.get("functionClass")
            val = v.get("value")
            if fclass == "power":
                power = (val == "on" or val is True or val == 1 or val == "1")
            elif fclass == "lock-control":
                power = (val == "locked")
            elif fclass == "brightness":
                try: brightness = int(val)
                except Exception: pass
            elif fclass == "color-rgb":
                if isinstance(val, dict) and "color-rgb" in val:
                    rgb = val["color-rgb"]
                    r = rgb.get("r", 255)
                    g = rgb.get("g", 158)
                    b = rgb.get("b", 59)
                    color = f"#{r:02x}{g:02x}{b:02x}"

        return {
            "id": dev_id,
            "name": name,
            "model": model,
            "power": power,
            "brightness": brightness,
            "color": color,
            "has_brightness": has_bright,
            "has_color": has_color,
            "is_lock": has_lock
        }

    def get_all_controllable_devices(self) -> List[Dict[str, Any]]:
        """Returns all physical controllable devices discovered without filtering."""
        formatted = []
        for d in self.devices:
            item = self.format_device(d)
            if item:
                formatted.append(item)
        return formatted

    def get_available_rooms(self) -> List[Dict[str, Any]]:
        """Extract all Hubspace rooms and their associated member device items."""
        rooms = []
        all_dev_map = {d["id"]: self.format_device(d) for d in self.devices if self.format_device(d) is not None}
        for d in self.devices:
            if d.get("typeId") == "metadevice.room":
                room_id = d.get("id")
                children_ids = d.get("children", [])
                room_devices = [all_dev_map[cid] for cid in children_ids if cid in all_dev_map]
                rooms.append({
                    "id": room_id,
                    "name": d.get("friendlyName") or "Unnamed Room",
                    "device_ids": children_ids,
                    "devices": room_devices,
                    "device_count": len(room_devices)
                })
        return rooms

    def get_formatted_devices(self) -> List[Dict[str, Any]]:
        """Returns list of controllable devices filtered by the user's selected game room devices/rooms."""
        all_devices = self.get_all_controllable_devices()
        selected_devices = self.hubspace_config.get("selected_devices") or []
        selected_rooms = self.hubspace_config.get("selected_rooms") or []

        # 1. If explicit devices are selected, strictly use those
        if selected_devices:
            return [d for d in all_devices if d["id"] in selected_devices]

        # 2. If rooms are selected, include all devices belonging to those rooms
        if selected_rooms:
            allowed_ids = set()
            for d in self.devices:
                if d.get("typeId") == "metadevice.room" and d.get("id") in selected_rooms:
                    allowed_ids.update(d.get("children", []))
            return [d for d in all_devices if d["id"] in allowed_ids]

        # 3. Default: empty list (do not control whole house until user explicitly checks game room fixtures)
        return []

    async def set_individual_device(self, device_id: str, power: Optional[bool] = None, brightness: Optional[int] = None, color: Optional[str] = None):
        """Send command to a specific Hubspace device and immediately update local cache."""
        await self.ensure_valid_token()
        if not self.account_id or not self.access_token:
            return False

        # Find device in cache to check supported functions
        dev = next((d for d in self.devices if (d.get("id") == device_id or d.get("deviceId") == device_id)), None)
        if not dev:
            logger.warning(f"[Hubspace] Device {device_id} not found in discovered devices.")
            return False

        funcs = [f.get("functionClass") for f in dev.get("description", {}).get("functions", [])]
        values = []

        if power is not None:
            if "power" in funcs:
                values.append({"functionClass": "power", "value": "on" if power else "off"})
            elif "lock-control" in funcs:
                values.append({"functionClass": "lock-control", "value": "locked" if power else "unlocked"})

        if brightness is not None and "brightness" in funcs:
            values.append({"functionClass": "brightness", "value": int(brightness)})

        if color is not None and "color-rgb" in funcs:
            r, g, b = self.hex_to_rgb(color)
            values.append({"functionClass": "color-rgb", "value": {"color-rgb": {"r": r, "g": g, "b": b}}})
            if "color-mode" in funcs:
                values.append({"functionClass": "color-mode", "value": "color"})

        if not values:
            logger.warning(f"[Hubspace] No applicable attributes to send for device {device_id}")
            return False

        url = f"{AFERO_SEMANTICS_URL}/accounts/{self.account_id}/metadevices/{device_id}/state"
        payload = {
            "metadeviceId": device_id,
            "values": values
        }

        async with aiohttp.ClientSession() as session:
            for attempt in range(2):
                await self.ensure_valid_token(session)
                headers = {
                    "Authorization": f"Bearer {self.access_token}",
                    "Content-Type": "application/json",
                    "User-Agent": "Hubspace-Android/1.0",
                    "Accept": "application/json"
                }
                try:
                    async with session.put(url, json=payload, headers=headers, timeout=6) as resp:
                        logger.info(f"[Hubspace] Control device {device_id} HTTP {resp.status}")
                        if resp.status in (200, 204):
                            # Update local cached state immediately so get_state() reflects it instantly
                            state_obj = dev.setdefault("state", {})
                            cached_vals = state_obj.setdefault("values", [])
                            for val_item in values:
                                fclass = val_item["functionClass"]
                                val = val_item["value"]
                                existing = next((v for v in cached_vals if v.get("functionClass") == fclass), None)
                                if existing:
                                    existing["value"] = val
                                else:
                                    cached_vals.append({"functionClass": fclass, "value": val})
                            return True
                        elif resp.status == 401 and attempt == 0:
                            logger.warning(f"[Hubspace] 401 on device {device_id}; refreshing token...")
                            self.access_token = None
                            continue
                        else:
                            resp_txt = await resp.text()
                            logger.warning(f"[Hubspace] Device control error HTTP {resp.status}: {resp_txt}")
                            return False
                except Exception as e:
                    logger.error(f"[Hubspace] Failed to control device {device_id}: {e}")
                    return False
        return False

    def hex_to_rgb(self, hex_code: str) -> tuple[int, int, int]:
        hex_code = hex_code.lstrip("#")
        if len(hex_code) == 3:
            hex_code = "".join([c*2 for c in hex_code])
        if len(hex_code) != 6:
            return (255, 160, 60)
        return tuple(int(hex_code[i:i+2], 16) for i in (0, 2, 4))

    async def apply_state(self, power: Optional[bool] = None, brightness: Optional[int] = None, color: Optional[str] = None, effect: Optional[str] = None):
        """Update active chamber lighting state and dispatch commands to hardware."""
        if power is not None: self.power = power
        if brightness is not None: self.brightness = max(0, min(100, brightness))
        if color is not None: self.color_hex = color
        if effect is not None: self.active_effect = effect

        if self._effect_task and not self._effect_task.done():
            self._effect_task.cancel()
            try:
                await self._effect_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        if not self.power:
            await self._send_to_hardware(power=False, brightness=0, color=self.color_hex)
            return

        # Always apply the target preset lighting state immediately to hardware
        await self._send_to_hardware(power=True, brightness=self.brightness, color=self.color_hex)

        if self.active_effect in ["candle_flicker", "lightning", "pulsing", "fire"]:
            self._effect_task = asyncio.create_task(self._run_effect_loop(self.active_effect))

    async def _send_to_hardware(self, power: bool, brightness: int, color: str):
        r, g, b = self.hex_to_rgb(color)

        # 1. Home Assistant REST relay
        if self.ha_config.get("enabled") and self.ha_config.get("url"):
            await self._send_home_assistant(power, brightness, (r, g, b))

        # 2. Hubspace direct API
        elif self.hubspace_config.get("enabled") and (self.access_token or self.refresh_token):
            await self._send_hubspace_all_devices(power, brightness, (r, g, b))

        # 3. Simulator Mode (virtual orb)
        else:
            pass

    async def _send_hubspace_all_devices(self, power: bool, brightness: int, rgb: tuple[int, int, int]):
        """Send state commands to all allowed Hubspace game room lighting devices in parallel with auto-refresh."""
        if not self.devices:
            return

        await self.ensure_valid_token()
        if not self.access_token or not self.account_id:
            logger.warning("[Hubspace] Cannot dispatch lighting commands: no valid access token.")
            return

        active_devices = self.get_formatted_devices()
        allowed_ids = {d["id"] for d in active_devices}
        if not allowed_ids:
            logger.info("[Hubspace] No game room devices selected in filters. Skipping hardware dispatch.")
            return

        async def send_single_device(session: aiohttp.ClientSession, dev: Dict[str, Any]):
            dev_id = dev.get("id") or dev.get("deviceId")
            if not dev_id or dev_id not in allowed_ids:
                return False

            # Only operate on lighting and switch devices (never door locks or rooms)
            if dev.get("typeId") in ("metadevice.room", "metadevice.home"):
                return False

            funcs = [f.get("functionClass") for f in dev.get("description", {}).get("functions", [])]
            if "power" not in funcs:
                return False

            values = [{"functionClass": "power", "value": "on" if power else "off"}]
            if power:
                if "brightness" in funcs:
                    values.append({"functionClass": "brightness", "value": brightness})
                if "color-rgb" in funcs:
                    values.append({"functionClass": "color-rgb", "value": {"color-rgb": {"r": rgb[0], "g": rgb[1], "b": rgb[2]}}})
                if "color-mode" in funcs:
                    values.append({"functionClass": "color-mode", "value": "color"})

            url = f"{AFERO_SEMANTICS_URL}/accounts/{self.account_id}/metadevices/{dev_id}/state"
            payload = {
                "metadeviceId": dev_id,
                "values": values
            }

            for attempt in range(2):
                headers = {
                    "Authorization": f"Bearer {self.access_token}",
                    "Content-Type": "application/json",
                    "User-Agent": "Hubspace-Android/1.0",
                    "Accept": "application/json"
                }
                try:
                    async with session.put(url, json=payload, headers=headers, timeout=6) as resp:
                        if resp.status in (200, 204):
                            state_obj = dev.setdefault("state", {})
                            cached_vals = state_obj.setdefault("values", [])
                            for val_item in values:
                                fclass = val_item["functionClass"]
                                val = val_item["value"]
                                existing = next((v for v in cached_vals if v.get("functionClass") == fclass), None)
                                if existing:
                                    existing["value"] = val
                                else:
                                    cached_vals.append({"functionClass": fclass, "value": val})
                            return True
                        elif resp.status == 401 and attempt == 0:
                            logger.warning(f"[Hubspace] 401 on device {dev_id}; refreshing token...")
                            self.access_token = None
                            await self.ensure_valid_token(session)
                            continue
                        else:
                            resp_txt = await resp.text()
                            logger.warning(f"[Hubspace] Device {dev_id} returned HTTP {resp.status}: {resp_txt}")
                            return False
                except Exception as e:
                    logger.warning(f"[Hubspace] Error updating device {dev_id}: {e}")
                    return False
            return False

        async with aiohttp.ClientSession() as session:
            tasks = [send_single_device(session, dev) for dev in self.devices]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            success_count = sum(1 for r in results if r is True)
            logger.info(f"[Hubspace] Dispatched scene lighting to {success_count}/{len(allowed_ids)} game room devices.")

    async def _send_home_assistant(self, power: bool, brightness: int, rgb: tuple[int, int, int]):
        ha_url = self.ha_config.get("url", "").rstrip("/")
        token = self.ha_config.get("token", "")
        entity_id = self.ha_config.get("entity_id", "light.game_room")

        service = "turn_on" if power else "turn_off"
        url = f"{ha_url}/api/services/light/{service}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        payload = {"entity_id": entity_id}
        if power:
            payload["brightness_pct"] = brightness
            payload["rgb_color"] = list(rgb)

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers, timeout=3) as resp:
                    pass
        except Exception as e:
            logger.error(f"Home Assistant send failed: {e}")

    async def _run_effect_loop(self, effect_name: str):
        try:
            base_brightness = self.brightness
            base_color = self.color_hex

            if effect_name == "candle_flicker":
                while True:
                    await asyncio.sleep(random.uniform(3.5, 6.0))
                    jitter = random.randint(-10, 8)
                    cur_bright = max(15, min(100, base_brightness + jitter))
                    await self._send_to_hardware(power=True, brightness=cur_bright, color=base_color)

            elif effect_name == "fire":
                colors = ["#FF8C00", "#FF4500", "#FFA500", "#FF6700"]
                while True:
                    await asyncio.sleep(random.uniform(4.0, 7.0))
                    cur_bright = max(20, min(100, base_brightness + random.randint(-12, 12)))
                    cur_col = random.choice(colors)
                    await self._send_to_hardware(power=True, brightness=cur_bright, color=cur_col)

            elif effect_name == "lightning":
                while True:
                    await asyncio.sleep(random.uniform(6.0, 12.0))
                    await self._send_to_hardware(power=True, brightness=100, color="#FFFFFF")
                    await asyncio.sleep(0.4)
                    low_bright = max(10, int(base_brightness * 0.4))
                    await self._send_to_hardware(power=True, brightness=low_bright, color="#1E3A8A")

            elif effect_name == "pulsing":
                step = 0
                while True:
                    await asyncio.sleep(3.0)
                    pulse_bright = int(base_brightness * (0.4 + 0.6 * ((1 + math.sin(step)) / 2)))
                    await self._send_to_hardware(power=True, brightness=pulse_bright, color=base_color)
                    step += 0.8

        except asyncio.CancelledError:
            # Task was cancelled cleanly to transition to another scene/state - do not clobber new state
            pass
        except Exception as e:
            logger.error(f"Error in effect loop: {e}")

    def get_state(self) -> Dict[str, Any]:
        formatted_devices = self.get_formatted_devices()
        all_controllable = self.get_all_controllable_devices()
        return {
            "power": self.power,
            "brightness": self.brightness,
            "color": self.color_hex,
            "effect": self.active_effect,
            "is_simulator": self.is_simulator,
            "status_message": self.status_message,
            "devices_count": len(formatted_devices),
            "total_discovered_count": len(all_controllable),
            "devices": formatted_devices,
            "selected_rooms": self.hubspace_config.get("selected_rooms") or [],
            "selected_devices": self.hubspace_config.get("selected_devices") or []
        }
