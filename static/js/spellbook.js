/**
 * Spellbook Tablet Controller JavaScript (v1.2.5)
 * Features: Developer Mode, Arcane Preset Editor, Custom Media Uploader, Room & Scene Isolation.
 */

const CLIENT_VERSION = "1.2.5";
console.log(`%c[Grimoire Spellbook] Loaded v${CLIENT_VERSION}`, "background: #312e81; color: #fbbf24; font-size: 14px; font-weight: bold; padding: 4px 8px; border-radius: 4px;");

let appState = null;
let presetsList = [];
let allPresets = [];
let availableRooms = [];
let availableDevices = [];
let selectedRooms = [];
let selectedDevices = [];
let selectedScenes = [];
let ws = null;

// Audio Chimes
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playChime(freq = 520, type = 'sine', duration = 0.15) {
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

// Elements
const versionBadge = document.getElementById('versionBadge');
const statusGem = document.getElementById('statusGem');
const activeSceneName = document.getElementById('activeSceneName');
const scenesContainer = document.getElementById('scenesContainer');
const blackoutBtn = document.getElementById('blackoutBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const roll20Modal = document.getElementById('roll20Modal');
const presetEditorModal = document.getElementById('presetEditorModal');
const mediaUploadModal = document.getElementById('mediaUploadModal');
const modeToggleBtn = document.getElementById('modeToggleBtn');

// Developer Mode State (stored in localStorage)
let isDevMode = localStorage.getItem('grimoire_dev_mode') === 'true';

function applyDevMode() {
  if (isDevMode) {
    document.body.classList.add('dev-mode');
    if (modeToggleBtn) {
      modeToggleBtn.innerHTML = '👑 Dev Mode';
      modeToggleBtn.classList.add('dev-badge-mode');
      modeToggleBtn.title = 'Developer Mode Active: Full Control & Editing Enabled (Click to switch to User Mode)';
    }
  } else {
    document.body.classList.remove('dev-mode');
    if (modeToggleBtn) {
      modeToggleBtn.innerHTML = '🗝️ User Mode';
      modeToggleBtn.classList.remove('dev-badge-mode');
      modeToggleBtn.title = 'User Mode Active: Preset & Settings editing locked (Click to switch to Dev Mode)';
    }
  }
}

function toggleDevMode() {
  isDevMode = !isDevMode;
  localStorage.setItem('grimoire_dev_mode', isDevMode ? 'true' : 'false');
  applyDevMode();
  playChime(isDevMode ? 659 : 440, 'triangle', 0.12);
}

// Peer Status Indicators
const peerWindowStatus = document.getElementById('peerWindowStatus');
const peerFrameStatus = document.getElementById('peerFrameStatus');
const peerTableStatus = document.getElementById('peerTableStatus');

// Screen Previews
const windowPreviewText = document.getElementById('windowPreviewText');
const framePreviewImg = document.getElementById('framePreviewImg');
const framePreviewPlaceholder = document.getElementById('framePreviewPlaceholder');
const tablePreviewImg = document.getElementById('tablePreviewImg');
const tablePreviewPlaceholder = document.getElementById('tablePreviewPlaceholder');
const windowMullionsCheck = document.getElementById('windowMullionsCheck');
const frameOrnateCheck = document.getElementById('frameOrnateCheck');
const tableGridCheck = document.getElementById('tableGridCheck');

// Lighting Elements
const virtualOrb = document.getElementById('virtualOrb');
const lightToggleBtn = document.getElementById('lightToggleBtn');
const brightSlider = document.getElementById('brightSlider');
const brightVal = document.getElementById('brightVal');
const customColorPicker = document.getElementById('customColorPicker');
const hubspaceStatusBadge = document.getElementById('hubspaceStatusBadge');
const devicesGrid = document.getElementById('devicesGrid');
const devicesCountLabel = document.getElementById('devicesCountLabel');

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.tab);
    if (target) target.classList.add('active');
    playChime(440, 'triangle', 0.08);
  });
});

// Update Peer Status Bar
function updatePeerBar(peers) {
  if (!peers || !peers.screens) return;
  const s = peers.screens;

  if (peerWindowStatus) {
    peerWindowStatus.textContent = s.window ? '● Online' : 'Offline';
    peerWindowStatus.className = s.window ? 'online' : 'offline';
  }
  if (peerFrameStatus) {
    peerFrameStatus.textContent = s.frame ? '● Online' : 'Offline';
    peerFrameStatus.className = s.frame ? 'online' : 'offline';
  }
  if (peerTableStatus) {
    peerTableStatus.textContent = s.table ? '● Online' : 'Offline';
    peerTableStatus.className = s.table ? 'online' : 'offline';
  }

  console.log(`%c[Grimoire Peers] Window: ${s.window ? 'Online' : 'Offline'} | Frame: ${s.frame ? 'Online' : 'Offline'} | Table: ${s.table ? 'Online' : 'Offline'} (Total clients: ${peers.total_clients || '?'})`, "color: #38bdf8;");
}

// Immediate HTTP State Fetch
function fetchInitialState() {
  console.log('[Grimoire Spellbook] Fetching current server state via HTTP...');
  fetch('/api/state')
    .then(r => r.json())
    .then(data => {
      console.log('%c[Grimoire Spellbook] HTTP Initial State Received:', "color: #10b981; font-weight: bold;", data);
      appState = data.current_state;
      presetsList = data.presets || [];
      allPresets = data.all_presets || presetsList;
      availableRooms = data.available_rooms || [];
      availableDevices = data.available_devices || [];
      selectedRooms = data.selected_rooms || [];
      selectedDevices = data.selected_devices || [];
      selectedScenes = data.selected_scenes || [];

      if (data.version && versionBadge) {
        versionBadge.textContent = `v${CLIENT_VERSION} (Server v${data.version})`;
      }
      if (document.getElementById('hubspaceEnableCheck') && data.hubspace) {
        document.getElementById('hubspaceEnableCheck').checked = !!data.hubspace.enabled;
        document.getElementById('hubspaceUser').value = data.hubspace.username || '';
      }
      renderScenes(presetsList);
      updateUI();
      if (data.peers) updatePeerBar(data.peers);
      renderSettingsFilterLists();
    })
    .catch(err => console.error('[Grimoire Spellbook] Error fetching initial state:', err));
}

// WebSocket Connection with Handshake
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  console.log(`[Grimoire Spellbook] Connecting WebSocket to ${wsUrl}...`);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log(`%c[Grimoire Spellbook] WebSocket connected! Sending HANDSHAKE...`, "color: #10b981; font-weight: bold;");
    if (statusGem) statusGem.classList.remove('disconnected');
    
    // Explicit Handshake
    ws.send(JSON.stringify({
      action: "HANDSHAKE",
      client_type: "spellbook",
      version: CLIENT_VERSION
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.event === 'HANDSHAKE_ACK') {
        console.log(`%c[Grimoire Handshake] Handshake acknowledged by Server v${msg.server_version}!`, "background: #065f46; color: #a7f3d0; font-weight: bold; padding: 2px 6px; border-radius: 3px;");
        appState = msg.state;
        presetsList = msg.presets || [];
        allPresets = msg.all_presets || presetsList;
        availableRooms = msg.available_rooms || [];
        availableDevices = msg.available_devices || [];
        selectedRooms = msg.selected_rooms || [];
        selectedDevices = msg.selected_devices || [];
        selectedScenes = msg.selected_scenes || [];

        if (versionBadge) {
          versionBadge.textContent = `v${CLIENT_VERSION} ● Synced`;
          versionBadge.style.color = '#10b981';
          versionBadge.style.borderColor = '#10b981';
        }
        renderScenes(presetsList);
        updateUI();
        if (msg.peers) updatePeerBar(msg.peers);
        renderSettingsFilterLists();

      } else if (msg.event === 'PEER_STATUS') {
        updatePeerBar(msg.peers);

      } else if (msg.event === 'SCENE_CHANGED') {
        console.log(`%c[Grimoire Sync] Active Scene Changed to: '${msg.scene ? msg.scene.name : msg.state.scene_name}'`, "color: #f59e0b; font-weight: bold; font-size: 13px;");
        appState = msg.state;
        updateUI();

      } else if (msg.event === 'DISPLAY_UPDATED') {
        console.log(`%c[Grimoire Sync] Display '${msg.screen}' updated:`, "color: #a855f7;", msg.display);
        if (appState && appState.displays) {
          appState.displays[msg.screen] = msg.display;
          updateUI();
        }

      } else if (msg.event === 'LIGHTING_UPDATED') {
        if (appState) {
          appState.lighting = msg.lighting;
          updateLightingUI();
        }

      } else if (msg.event === 'FILTERS_UPDATED') {
        console.log(`%c[Grimoire Sync] Filters Updated:`, "color: #10b981;", msg);
        if (msg.available_rooms) availableRooms = msg.available_rooms;
        if (msg.available_devices) availableDevices = msg.available_devices;
        if (msg.all_presets) allPresets = msg.all_presets;
        if (msg.selected_rooms) selectedRooms = msg.selected_rooms;
        if (msg.selected_devices) selectedDevices = msg.selected_devices;
        if (msg.selected_scenes) selectedScenes = msg.selected_scenes;
        if (msg.presets) {
          presetsList = msg.presets;
          renderScenes(presetsList);
        }
        if (msg.state) {
          appState = msg.state;
          updateUI();
        }
        renderSettingsFilterLists();

      } else if (msg.event === 'PRESETS_UPDATED') {
        console.log(`%c[Grimoire Sync] Presets Updated:`, "color: #10b981;", msg);
        if (msg.presets) {
          presetsList = msg.presets;
          renderScenes(presetsList);
        }
        if (msg.all_presets) {
          allPresets = msg.all_presets;
        }
        renderSettingsFilterLists();
      }
    } catch (e) {
      console.error('[Grimoire Spellbook] Error parsing WS message:', e);
    }
  };

  ws.onclose = () => {
    console.warn(`%c[Grimoire Spellbook] WebSocket disconnected! Reconnecting in 2.5s...`, "color: #ef4444; font-weight: bold;");
    if (statusGem) statusGem.classList.add('disconnected');
    if (versionBadge) {
      versionBadge.textContent = `v${CLIENT_VERSION} (Reconnecting...)`;
      versionBadge.style.color = '#ef4444';
      versionBadge.style.borderColor = '#ef4444';
    }
    setTimeout(initWebSocket, 2500);
  };
}

// Render Presets
const sceneIcons = {
  study: '🕯️',
  storm: '⚡',
  tavern: '🍺',
  dungeon: '💀',
  combat: '🐉',
  feywild: '🌸',
  blackout: '🌑'
};

function renderScenes(presets) {
  if (!scenesContainer) return;
  scenesContainer.innerHTML = '';

  presets.forEach(preset => {
    const isSelected = appState && appState.scene_id === preset.id;
    const card = document.createElement('div');
    card.className = `scene-card ${isSelected ? 'selected' : ''}`;
    card.id = `preset-${preset.id}`;
    card.onclick = () => activateScene(preset.id, preset.name);

    const icon = sceneIcons[preset.id] || '✨';

    const winTitle = (preset.displays && preset.displays.window) ? preset.displays.window.title : 'Window';
    const frameTitle = (preset.displays && preset.displays.frame) ? preset.displays.frame.title : 'Frame';
    const tableTitle = (preset.displays && preset.displays.table) ? preset.displays.table.title : 'Table';
    const lightColor = (preset.lighting && preset.lighting.color) ? preset.lighting.color : '#ffd700';
    const lightEffect = (preset.lighting && preset.lighting.effect && preset.lighting.effect !== 'none') ? preset.lighting.effect.replace('_', ' ') : lightColor;

    card.innerHTML = `
      <div class="scene-card-actions dev-only">
        <button class="scene-action-btn" title="Edit Arcane Preset" onclick="event.stopPropagation(); openPresetEditorModal('${preset.id}')">✏️</button>
        <button class="scene-action-btn danger" title="Delete Preset" onclick="event.stopPropagation(); deletePreset('${preset.id}')">🗑️</button>
      </div>
      <div class="scene-card-header">
        <div class="scene-icon">${icon}</div>
        <div>
          <div class="scene-name">${preset.name}</div>
          <div class="scene-desc">${preset.description || ''}</div>
        </div>
      </div>
      <div class="scene-badges">
        <span class="mini-badge" style="border-color: ${lightColor}; color: ${lightColor};">
          ● ${lightEffect}
        </span>
        <span class="mini-badge">📺 ${winTitle}</span>
        <span class="mini-badge">🖼️ ${frameTitle}</span>
        <span class="mini-badge">🗺️ ${tableTitle}</span>
      </div>
    `;
    scenesContainer.appendChild(card);
  });
}

function updateUI() {
  if (!appState) return;

  // Active Scene Header Badge
  if (activeSceneName) {
    activeSceneName.textContent = appState.scene_name || 'Custom Scene';
  }

  // Highlight Active Preset Card
  document.querySelectorAll('.scene-card').forEach(card => card.classList.remove('selected'));
  if (appState.scene_id) {
    const activeCard = document.getElementById(`preset-${appState.scene_id}`);
    if (activeCard) activeCard.classList.add('selected');
  }

  // Screen Previews
  const displays = appState.displays || {};
  if (displays.window) {
    if (windowPreviewText) windowPreviewText.textContent = displays.window.title || 'Window Scene';
    if (windowMullionsCheck) windowMullionsCheck.checked = displays.window.show_mullions !== false;
  }
  if (displays.frame) {
    if (displays.frame.src && framePreviewImg) {
      framePreviewImg.src = displays.frame.src;
      framePreviewImg.style.display = 'block';
      if (framePreviewPlaceholder) framePreviewPlaceholder.style.display = 'none';
    }
    if (frameOrnateCheck) frameOrnateCheck.checked = displays.frame.show_ornate_border !== false;
  }
  if (displays.table) {
    if (displays.table.src && tablePreviewImg) {
      tablePreviewImg.src = displays.table.src;
      tablePreviewImg.style.display = 'block';
      if (tablePreviewPlaceholder) tablePreviewPlaceholder.style.display = 'none';
    }
    if (tableGridCheck) tableGridCheck.checked = displays.table.grid_enabled !== false;
  }

  updateLightingUI();
}

// Render Discovered Hubspace Devices
let localDeviceStates = {};

function renderHubspaceDevices(devices) {
  if (!devicesGrid) return;
  if (devicesCountLabel) devicesCountLabel.textContent = devices ? devices.length : 0;

  if (!devices || devices.length === 0) {
    devicesGrid.innerHTML = `
      <div style="grid-column: 1 / -1; color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center; background: rgba(0,0,0,0.3); border-radius: 8px;">
        No Hubspace devices discovered yet. Connect your account in ⚙️ Settings above.
      </div>
    `;
    return;
  }

  devicesGrid.innerHTML = '';
  devices.forEach(dev => {
    localDeviceStates[dev.id] = dev;

    const card = document.createElement('div');
    card.className = `device-card ${dev.power ? 'powered-on' : ''}`;
    card.id = `dev-card-${dev.id}`;

    let icon = '💡';
    if (dev.is_lock) icon = '🔒';
    else if (dev.model && dev.model.includes('Switch')) icon = '⚡';
    else if (dev.has_color) icon = '✨';

    const toggleText = dev.is_lock ? (dev.power ? 'LOCKED' : 'UNLOCKED') : (dev.power ? 'ON' : 'OFF');

    let controlsHtml = '';
    if (dev.has_brightness) {
      controlsHtml += `
        <div class="slider-group" style="margin-top: 6px;">
          <div class="slider-label" style="font-size: 11px;">
            <span>Brightness</span>
            <span id="label-bright-${dev.id}">${dev.brightness || 85}%</span>
          </div>
          <input type="range" min="0" max="100" value="${dev.brightness || 85}" 
                 oninput="onSingleDeviceBrightnessChange('${dev.id}', this.value)" style="height: 6px;">
        </div>
      `;
    }

    if (dev.has_color) {
      controlsHtml += `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--text-muted);">
          <span>Hue</span>
          <div style="display: flex; gap: 6px; align-items: center;">
            <input type="color" value="${dev.color || '#ff9e3b'}" onchange="onSingleDeviceColorChange('${dev.id}', this.value)" 
                   style="width: 24px; height: 20px; border: 1px solid rgba(217,119,6,0.4); border-radius: 4px; cursor: pointer; background: transparent; padding: 0;">
            <span id="label-color-${dev.id}" style="font-family: monospace; font-size: 10px; color: ${dev.color || '#ff9e3b'};">${dev.color || ''}</span>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="device-card-top">
        <div class="device-info">
          <div class="device-icon">${icon}</div>
          <div>
            <div class="device-name" title="${dev.name}">${dev.name}</div>
            <div class="device-model">${dev.model}</div>
          </div>
        </div>
        <button class="device-toggle-btn ${dev.power ? 'active' : ''}" id="btn-power-${dev.id}" onclick="toggleSingleDevice('${dev.id}')">
          ${toggleText}
        </button>
      </div>
      ${controlsHtml}
    `;
    devicesGrid.appendChild(card);
  });
}

function updateLightingUI() {
  if (!appState || !appState.lighting) return;
  const l = appState.lighting;

  // Power Button
  if (lightToggleBtn) {
    lightToggleBtn.textContent = l.power ? '💡 Toggle Power (ON)' : '🌑 Toggle Power (OFF)';
    lightToggleBtn.style.borderColor = l.power ? 'var(--gold-accent)' : '#ef4444';
  }

  // Virtual Orb
  if (virtualOrb) {
    if (l.power) {
      virtualOrb.style.backgroundColor = l.color || '#FF9E3B';
      virtualOrb.style.boxShadow = `0 0 35px ${l.color || '#FF9E3B'}`;
      virtualOrb.textContent = l.effect === 'candle_flicker' ? '🕯️' : l.effect === 'fire' ? '🔥' : l.effect === 'lightning' ? '⚡' : '✨';
      virtualOrb.style.opacity = Math.max(0.2, (l.brightness || 50) / 100);
    } else {
      virtualOrb.style.backgroundColor = '#18181b';
      virtualOrb.style.boxShadow = 'none';
      virtualOrb.textContent = '🌑';
      virtualOrb.style.opacity = 0.3;
    }
  }

  if (brightSlider && l.brightness !== undefined) brightSlider.value = l.brightness;
  if (brightVal) brightVal.textContent = `${l.brightness || 0}%`;
  if (customColorPicker && l.color) customColorPicker.value = l.color;

  // FX Buttons
  document.querySelectorAll('.fx-btn').forEach(btn => btn.classList.remove('active'));
  const activeFxBtn = {
    candle_flicker: 'fxCandle',
    lightning: 'fxLightning',
    fire: 'fxFire',
    pulsing: 'fxPulse',
    none: 'fxNone'
  }[l.effect || 'none'];
  if (activeFxBtn) {
    const el = document.getElementById(activeFxBtn);
    if (el) el.classList.add('active');
  }

  if (hubspaceStatusBadge && l.status_message) {
    hubspaceStatusBadge.textContent = `Status: ${l.status_message}`;
  }

  // Render Discovered Hubspace Devices
  renderHubspaceDevices(l.devices || []);
}

// Control Single Device
function toggleSingleDevice(devId) {
  playChime(500, 'sine', 0.1);
  const dev = localDeviceStates[devId] || {};
  const currentPower = !!dev.power;
  const newPower = !currentPower;
  dev.power = newPower; // Track state immediately

  console.log(`[Hubspace Action] Toggling device ${devId} (${dev.name || ''}) -> ${newPower}`);

  // Optimistic UI update
  const btn = document.getElementById(`btn-power-${devId}`);
  const card = document.getElementById(`dev-card-${devId}`);
  if (btn) {
    btn.textContent = dev.is_lock ? (newPower ? 'LOCKED' : 'UNLOCKED') : (newPower ? 'ON' : 'OFF');
    btn.className = `device-toggle-btn ${newPower ? 'active' : ''}`;
  }
  if (card) {
    if (newPower) card.classList.add('powered-on');
    else card.classList.remove('powered-on');
  }

  const req = { power: newPower };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "SET_DEVICE", device_id: devId, data: req }));
  } else {
    fetch(`/api/hubspace/device/${devId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
  }
}

let deviceBrightTimeouts = {};
function onSingleDeviceBrightnessChange(devId, val) {
  const lbl = document.getElementById(`label-bright-${devId}`);
  if (lbl) lbl.textContent = `${val}%`;
  if (localDeviceStates[devId]) localDeviceStates[devId].brightness = parseInt(val);

  clearTimeout(deviceBrightTimeouts[devId]);
  deviceBrightTimeouts[devId] = setTimeout(() => {
    console.log(`[Hubspace Action] Setting device ${devId} brightness -> ${val}`);
    const req = { brightness: parseInt(val) };
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "SET_DEVICE", device_id: devId, data: req }));
    } else {
      fetch(`/api/hubspace/device/${devId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req)
      });
    }
  }, 200);
}

function onSingleDeviceColorChange(devId, hexColor) {
  if (localDeviceStates[devId]) localDeviceStates[devId].color = hexColor;
  const lbl = document.getElementById(`label-color-${devId}`);
  if (lbl) {
    lbl.textContent = hexColor;
    lbl.style.color = hexColor;
  }

  console.log(`[Hubspace Action] Setting device ${devId} color -> ${hexColor}`);
  const req = { color: hexColor };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "SET_DEVICE", device_id: devId, data: req }));
  } else {
    fetch(`/api/hubspace/device/${devId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
  }
}

function toggleAllDevices(power) {
  playChime(power ? 660 : 330, 'sine', 0.15);
  sendLightingUpdate({ power: power });
}

// User Actions (Sends BOTH via WebSocket AND HTTP)
function activateScene(sceneId, sceneName = '') {
  console.log(`%c[Grimoire Action] User tapped preset: '${sceneName || sceneId}' (id: ${sceneId})`, "background: #78350f; color: #fde68a; font-weight: bold; padding: 4px 8px; border-radius: 4px;");
  playChime(660, 'sine', 0.25);

  document.querySelectorAll('.scene-card').forEach(card => card.classList.remove('selected'));
  const card = document.getElementById(`preset-${sceneId}`);
  if (card) card.classList.add('selected');
  if (activeSceneName) activeSceneName.textContent = sceneName || sceneId;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "SELECT_SCENE",
      id: sceneId
    }));
  }

  fetch('/api/scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sceneId })
  });
}

function setWindowEffect(effectType, title) {
  console.log(`[Grimoire Action] Override Window: ${effectType} (${title})`);
  playChime(500, 'triangle', 0.1);
  const data = {
    type: 'canvas_effect',
    effect_type: effectType,
    title: title,
    src: '',
    show_mullions: windowMullionsCheck ? windowMullionsCheck.checked : true
  };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "SET_DISPLAY", screen: "window", display: data }));
  }
  fetch('/api/display/window', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

function setFramePortrait(src, title, caption) {
  console.log(`[Grimoire Action] Override Frame: ${title}`);
  playChime(580, 'sine', 0.1);
  const data = {
    type: 'portrait',
    title: title,
    src: src,
    caption: caption,
    show_ornate_border: frameOrnateCheck ? frameOrnateCheck.checked : true
  };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "SET_DISPLAY", screen: "frame", display: data }));
  }
  fetch('/api/display/frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

function setTableMap(src, title) {
  console.log(`[Grimoire Action] Override Table Map: ${title}`);
  playChime(420, 'sine', 0.1);
  const data = {
    type: 'map',
    title: title,
    src: src,
    roll20_url: '',
    grid_enabled: tableGridCheck ? tableGridCheck.checked : true
  };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "SET_DISPLAY", screen: "table", display: data }));
  }
  fetch('/api/display/table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

// Lighting Controls
if (lightToggleBtn) {
  lightToggleBtn.addEventListener('click', () => {
    const curPower = appState && appState.lighting ? appState.lighting.power : true;
    sendLightingUpdate({ power: !curPower });
  });
}

if (brightSlider) {
  let brightTimeout;
  brightSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    if (brightVal) brightVal.textContent = `${val}%`;
    clearTimeout(brightTimeout);
    brightTimeout = setTimeout(() => {
      sendLightingUpdate({ brightness: val });
    }, 120);
  });
}

function setColor(hex) {
  playChime(550, 'sine', 0.1);
  sendLightingUpdate({ color: hex });
}

if (customColorPicker) {
  customColorPicker.addEventListener('change', (e) => {
    sendLightingUpdate({ color: e.target.value });
  });
}

function setEffect(effectName) {
  playChime(600, 'triangle', 0.1);
  sendLightingUpdate({ effect: effectName });
}

function sendLightingUpdate(update) {
  console.log(`[Grimoire Lighting] Sending update:`, update);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "SET_LIGHTS", lighting: update }));
  }
  fetch('/api/lighting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update)
  });
}

// Checkboxes
if (windowMullionsCheck) {
  windowMullionsCheck.addEventListener('change', (e) => {
    fetch('/api/display/window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_mullions: e.target.checked })
    });
  });
}

if (frameOrnateCheck) {
  frameOrnateCheck.addEventListener('change', (e) => {
    fetch('/api/display/frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_ornate_border: e.target.checked })
    });
  });
}

if (tableGridCheck) {
  tableGridCheck.addEventListener('change', (e) => {
    fetch('/api/display/table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid_enabled: e.target.checked })
    });
  });
}

// Blackout
if (blackoutBtn) {
  blackoutBtn.addEventListener('click', () => {
    activateScene('blackout', 'Total Darkness / Stealth');
  });
}

// Settings Modal & Filter Selection
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    openSettingsModal();
  });
}

function openSettingsModal() {
  if (settingsModal) settingsModal.classList.add('open');
  renderSettingsFilterLists();
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.remove('open');
}

function renderSettingsFilterLists() {
  const roomsGrid = document.getElementById('roomsSelectorGrid');
  const devicesGrid = document.getElementById('devicesSelectorGrid');
  const scenesGrid = document.getElementById('scenesSelectorGrid');
  const statusBadge = document.getElementById('hubspaceConnectStatus');

  if (statusBadge && appState && appState.lighting) {
    statusBadge.textContent = appState.lighting.status_message || 'Ready';
  }

  // 1. Rooms Selector
  if (roomsGrid) {
    roomsGrid.innerHTML = '';
    if (!availableRooms || availableRooms.length === 0) {
      roomsGrid.innerHTML = '<span style="color: var(--text-muted); font-size: 11px;">Connect account to scan rooms.</span>';
    } else {
      availableRooms.forEach(room => {
        const isChecked = selectedRooms.includes(room.id);
        const chip = document.createElement('label');
        chip.className = `filter-chip ${isChecked ? 'active' : ''}`;
        chip.id = `room-chip-${room.id}`;
        chip.innerHTML = `
          <input type="checkbox" data-room-id="${room.id}" ${isChecked ? 'checked' : ''} onchange="onRoomCheckboxToggle('${room.id}', this.checked)">
          <span>🚪 ${room.name} (${room.device_count || 0})</span>
        `;
        roomsGrid.appendChild(chip);
      });
    }
  }

  // 2. Individual Fixtures Checkboxes
  if (devicesGrid) {
    devicesGrid.innerHTML = '';
    if (!availableDevices || availableDevices.length === 0) {
      devicesGrid.innerHTML = '<span style="grid-column: 1/-1; color: var(--text-muted); font-size: 11px;">Connect account to scan fixtures.</span>';
    } else {
      availableDevices.forEach(dev => {
        const icon = dev.is_lock ? '🔒' : dev.has_color ? '✨' : '💡';
        let isChecked = false;
        if (selectedDevices && selectedDevices.length > 0) {
          isChecked = selectedDevices.includes(dev.id);
        } else if (selectedRooms && selectedRooms.length > 0) {
          isChecked = availableRooms.some(r => selectedRooms.includes(r.id) && r.device_ids && r.device_ids.includes(dev.id));
        } else {
          isChecked = true; // default all included if no filter set
        }

        const label = document.createElement('label');
        label.className = 'filter-check-item';
        label.innerHTML = `
          <input type="checkbox" data-dev-id="${dev.id}" ${isChecked ? 'checked' : ''}>
          <span style="font-size: 13px;">${icon}</span>
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2;">
            <div style="font-weight: 500; font-size: 11px;">${dev.name}</div>
            <div style="font-size: 9px; color: var(--text-muted);">${dev.model}</div>
          </div>
        `;
        devicesGrid.appendChild(label);
      });
    }
  }

  // 3. Scenes Checkboxes
  if (scenesGrid) {
    scenesGrid.innerHTML = '';
    const scenesToRender = allPresets.length > 0 ? allPresets : presetsList;
    scenesToRender.forEach(preset => {
      const isChecked = selectedScenes.length === 0 || selectedScenes.includes(preset.id);
      const icon = sceneIcons[preset.id] || '✨';
      const label = document.createElement('label');
      label.className = 'filter-check-item';
      label.innerHTML = `
        <input type="checkbox" data-scene-id="${preset.id}" ${isChecked ? 'checked' : ''}>
        <span style="font-size: 13px;">${icon}</span>
        <span style="font-size: 11px; font-weight: 500;">${preset.name}</span>
      `;
      scenesGrid.appendChild(label);
    });
  }
}

function onRoomCheckboxToggle(roomId, isChecked) {
  const chip = document.getElementById(`room-chip-${roomId}`);
  if (chip) {
    if (isChecked) chip.classList.add('active');
    else chip.classList.remove('active');
  }

  // When room is checked/unchecked, update matching device checkboxes
  const room = availableRooms.find(r => r.id === roomId);
  if (room && room.device_ids) {
    room.device_ids.forEach(devId => {
      const devInput = document.querySelector(`input[data-dev-id="${devId}"]`);
      if (devInput) devInput.checked = isChecked;
    });
  }
}

function selectAllDevicesFilter(checked) {
  document.querySelectorAll('#devicesSelectorGrid input[type="checkbox"]').forEach(cb => cb.checked = checked);
  document.querySelectorAll('#roomsSelectorGrid input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
    const chip = cb.closest('.filter-chip');
    if (chip) {
      if (checked) chip.classList.add('active');
      else chip.classList.remove('active');
    }
  });
}

function selectAllScenesFilter(checked) {
  document.querySelectorAll('#scenesSelectorGrid input[type="checkbox"]').forEach(cb => cb.checked = checked);
}

function saveHubspaceSettings() {
  const enabled = document.getElementById('hubspaceEnableCheck').checked;
  const username = document.getElementById('hubspaceUser').value;
  const password = document.getElementById('hubspacePass').value;
  const statusBadge = document.getElementById('hubspaceConnectStatus');
  if (statusBadge) statusBadge.textContent = 'Connecting & discovering lights...';

  fetch('/api/settings/hubspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, username, password })
  }).then(r => r.json()).then(data => {
    if (statusBadge) statusBadge.textContent = data.message || 'Connected!';
    if (data.available_rooms) availableRooms = data.available_rooms;
    if (data.available_devices) availableDevices = data.available_devices;
    if (data.selected_rooms) selectedRooms = data.selected_rooms;
    if (data.selected_devices) selectedDevices = data.selected_devices;
    renderSettingsFilterLists();
    playChime(660, 'sine', 0.2);
  }).catch(e => {
    if (statusBadge) statusBadge.textContent = 'Connection failed';
  });
}

function saveAllSettingsAndFilters() {
  playChime(700, 'sine', 0.2);

  // Gather selected rooms
  const checkedRooms = [];
  document.querySelectorAll('#roomsSelectorGrid input[type="checkbox"]:checked').forEach(cb => {
    const rid = cb.getAttribute('data-room-id');
    if (rid) checkedRooms.push(rid);
  });

  // Gather selected devices
  const checkedDevices = [];
  document.querySelectorAll('#devicesSelectorGrid input[type="checkbox"]:checked').forEach(cb => {
    const did = cb.getAttribute('data-dev-id');
    if (did) checkedDevices.push(did);
  });

  // Gather selected scenes
  const checkedScenes = [];
  document.querySelectorAll('#scenesSelectorGrid input[type="checkbox"]:checked').forEach(cb => {
    const sid = cb.getAttribute('data-scene-id');
    if (sid) checkedScenes.push(sid);
  });

  console.log(`[Grimoire Settings] Saving Game Room filters:`, {
    selected_rooms: checkedRooms,
    selected_devices: checkedDevices,
    selected_scenes: checkedScenes
  });

  const filterPayload = {
    selected_rooms: checkedRooms,
    selected_devices: checkedDevices,
    selected_scenes: checkedScenes
  };

  // Dispatch over WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "SET_FILTERS", data: filterPayload }));
  }

  // Dispatch over HTTP
  fetch('/api/settings/filters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filterPayload)
  }).then(r => r.json()).then(res => {
    selectedRooms = checkedRooms;
    selectedDevices = checkedDevices;
    selectedScenes = checkedScenes;
    closeSettingsModal();
    fetchInitialState();
  });
}

// Roll20 Modal
function openRoll20Modal() {
  if (roll20Modal) roll20Modal.classList.add('open');
}
function closeRoll20Modal() {
  if (roll20Modal) roll20Modal.classList.remove('open');
}
function confirmRoll20() {
  const url = document.getElementById('roll20UrlInput').value;
  if (!url) return;
  fetch('/api/display/table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'roll20',
      title: 'Roll20 VTT',
      roll20_url: url
    })
  });
  closeRoll20Modal();
}

// ==========================================
// Preset Editor Modal (Developer Mode)
// ==========================================
function openPresetEditorModal(presetId = null) {
  if (!presetEditorModal) return;
  const isEdit = !!presetId;
  document.getElementById('presetEditorTitle').textContent = isEdit ? '✨ Edit Arcane Preset' : '✨ Create Arcane Preset';
  document.getElementById('editPresetId').value = presetId || '';

  const keyInput = document.getElementById('presetKeyInput');
  keyInput.disabled = isEdit;

  let preset = null;
  if (isEdit) {
    preset = (allPresets || presetsList).find(p => p.id === presetId);
  }

  if (preset) {
    keyInput.value = preset.id;
    document.getElementById('presetNameInput').value = preset.name || '';
    document.getElementById('presetDescInput').value = preset.description || '';
    
    // Lighting
    const l = preset.lighting || {};
    document.getElementById('presetLightColor').value = l.color || '#ff9a3c';
    document.getElementById('presetBrightSlider').value = l.brightness !== undefined ? l.brightness : 70;
    document.getElementById('presetBrightVal').textContent = l.brightness !== undefined ? l.brightness : 70;
    document.getElementById('presetLightEffect').value = l.effect || 'none';

    // Window
    const w = (preset.displays && preset.displays.window) || {};
    document.getElementById('presetWindowEffect').value = w.effect_type || 'rain_storm';
    document.getElementById('presetWindowMullions').checked = w.mullions_enabled !== false;
    document.getElementById('presetWindowTitle').value = w.title || 'Window Atmospheric Scene';

    // Frame
    const f = (preset.displays && preset.displays.frame) || {};
    document.getElementById('presetFrameTitle').value = f.title || 'Portrait';
    document.getElementById('presetFrameCaption').value = f.caption || '';
    document.getElementById('presetFrameSrc').value = f.src || '/static/media/frames/archmage.svg';
    document.getElementById('presetFrameOrnate').checked = f.ornate_frame !== false;

    // Table
    const t = (preset.displays && preset.displays.table) || {};
    document.getElementById('presetTableTitle').value = t.title || 'Tabletop Battlemap';
    document.getElementById('presetTableCaption').value = t.caption || '';
    document.getElementById('presetTableSrc').value = t.src || '/static/media/tables/library.svg';
    document.getElementById('presetTableGrid').checked = t.grid_enabled !== false;
    document.getElementById('presetTableGridSize').value = t.grid_size || 50;

  } else {
    // Defaults for new preset
    keyInput.value = 'scene_' + Math.random().toString(36).substr(2, 5);
    document.getElementById('presetNameInput').value = 'New Arcane Chamber';
    document.getElementById('presetDescInput').value = 'Custom atmospheric environment created in Developer Mode.';
    document.getElementById('presetLightColor').value = '#d4a34b';
    document.getElementById('presetBrightSlider').value = 75;
    document.getElementById('presetBrightVal').textContent = '75';
    document.getElementById('presetLightEffect').value = 'candle_flicker';
    document.getElementById('presetWindowEffect').value = 'rain_storm';
    document.getElementById('presetWindowMullions').checked = true;
    document.getElementById('presetWindowTitle').value = 'Rain on Castle Glass';
    document.getElementById('presetFrameTitle').value = 'Crypt Guardian';
    document.getElementById('presetFrameCaption').value = 'A sentinel in the deep';
    document.getElementById('presetFrameSrc').value = '/static/media/frames/skeleton.svg';
    document.getElementById('presetFrameOrnate').checked = true;
    document.getElementById('presetTableTitle').value = 'The Tomb of Kings';
    document.getElementById('presetTableCaption').value = 'Deep catacombs map';
    document.getElementById('presetTableSrc').value = '/static/media/tables/crypt.svg';
    document.getElementById('presetTableGrid').checked = true;
    document.getElementById('presetTableGridSize').value = 50;
  }

  presetEditorModal.classList.add('open');
}

function closePresetEditorModal() {
  if (presetEditorModal) presetEditorModal.classList.remove('open');
}

function savePresetForm() {
  const id = document.getElementById('presetKeyInput').value.trim().toLowerCase().replace(/\s+/g, '_');
  const name = document.getElementById('presetNameInput').value.trim();
  const description = document.getElementById('presetDescInput').value.trim();

  if (!id || !name) {
    alert("Please enter both a Preset ID and Name.");
    return;
  }

  const payload = {
    id: id,
    name: name,
    description: description,
    lighting: {
      power: true,
      brightness: parseInt(document.getElementById('presetBrightSlider').value, 10),
      color: document.getElementById('presetLightColor').value,
      effect: document.getElementById('presetLightEffect').value
    },
    displays: {
      window: {
        id: `${id}_window`,
        title: document.getElementById('presetWindowTitle').value.trim() || name,
        type: "canvas_effect",
        effect_type: document.getElementById('presetWindowEffect').value,
        src: "",
        mullions_enabled: document.getElementById('presetWindowMullions').checked
      },
      frame: {
        id: `${id}_frame`,
        title: document.getElementById('presetFrameTitle').value.trim() || 'Portrait',
        type: "portrait",
        src: document.getElementById('presetFrameSrc').value.trim(),
        caption: document.getElementById('presetFrameCaption').value.trim(),
        ornate_frame: document.getElementById('presetFrameOrnate').checked
      },
      table: {
        id: `${id}_table`,
        title: document.getElementById('presetTableTitle').value.trim() || 'Battlemap',
        type: "map",
        src: document.getElementById('presetTableSrc').value.trim(),
        grid_enabled: document.getElementById('presetTableGrid').checked,
        grid_size: parseInt(document.getElementById('presetTableGridSize').value, 10) || 50,
        caption: document.getElementById('presetTableCaption').value.trim()
      }
    }
  };

  fetch('/api/preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(res => {
    closePresetEditorModal();
    playChime(660, 'triangle', 0.15);
    fetchInitialState();
  })
  .catch(err => alert("Error saving preset: " + err));
}

function deletePreset(presetId) {
  if (!confirm(`Are you sure you wish to extinguish the preset '${presetId}' from the Grimoire?`)) return;

  fetch(`/api/preset/${presetId}`, {
    method: 'DELETE'
  })
  .then(r => r.json())
  .then(res => {
    playChime(330, 'sawtooth', 0.15);
    fetchInitialState();
  })
  .catch(err => alert("Error deleting preset: " + err));
}

// ==========================================
// Media Uploader Modal (Developer Mode)
// ==========================================
function openMediaUploadModal() {
  if (!mediaUploadModal) return;
  const statusEl = document.getElementById('uploadStatusMessage');
  const resultEl = document.getElementById('uploadResultUrlContainer');
  if (statusEl) statusEl.style.display = 'none';
  if (resultEl) resultEl.style.display = 'none';
  document.getElementById('mediaUploadFileInput').value = '';
  mediaUploadModal.classList.add('open');
}

function closeMediaUploadModal() {
  if (mediaUploadModal) mediaUploadModal.classList.remove('open');
}

function submitMediaUpload() {
  const fileInput = document.getElementById('mediaUploadFileInput');
  const statusEl = document.getElementById('uploadStatusMessage');
  const resultEl = document.getElementById('uploadResultUrlContainer');
  const urlDisplay = document.getElementById('uploadResultUrl');
  const submitBtn = document.getElementById('uploadSubmitBtn');

  if (!fileInput.files || fileInput.files.length === 0) {
    alert("Please select a file to upload.");
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading...';
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#38bdf8';
    statusEl.textContent = `Enchanting and uploading ${file.name}...`;
  }

  fetch('/api/media/upload', {
    method: 'POST',
    body: formData
  })
  .then(r => r.json())
  .then(data => {
    submitBtn.disabled = false;
    submitBtn.textContent = '🚀 Upload File';
    if (data.status === 'ok') {
      playChime(700, 'sine', 0.2);
      if (statusEl) statusEl.style.display = 'none';
      if (resultEl) {
        resultEl.style.display = 'block';
        urlDisplay.textContent = data.url;
      }
    } else {
      if (statusEl) {
        statusEl.style.color = '#ef4444';
        statusEl.textContent = 'Upload failed.';
      }
    }
  })
  .catch(err => {
    submitBtn.disabled = false;
    submitBtn.textContent = '🚀 Upload File';
    if (statusEl) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = 'Upload error: ' + err;
    }
  });
}

function copyUploadedUrl() {
  const urlText = document.getElementById('uploadResultUrl').textContent;
  if (!urlText) return;
  navigator.clipboard.writeText(urlText).then(() => {
    alert("Copied media path to clipboard: " + urlText + "\nYou can paste this directly into any Frame or Table image source field!");
  });
}

// Apply Saved Developer Mode state
applyDevMode();

// Start: 1. Instant HTTP fetch, 2. Connect WebSocket
fetchInitialState();
initWebSocket();

