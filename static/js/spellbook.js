/**
 * Spellbook Tablet Controller JavaScript (v1.3.8)
 * Features: Developer Mode, Arcane Preset Editor, Custom Media Uploader, Room & Scene Isolation, Arcane Screen Mirroring.
 */

const CLIENT_VERSION = "1.3.8";
let currentTableGridSize = 22;
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
      if (data.table_grid_size) {
        currentTableGridSize = data.table_grid_size;
        const label = document.getElementById('tableGridSizeVal');
        const slider = document.getElementById('tableGridSizeSlider');
        if (label) label.textContent = `${currentTableGridSize} px`;
        if (slider) slider.value = currentTableGridSize;
      }
      if (data.table_grid_shape) {
        currentTableGridShape = data.table_grid_shape;
        updateGridShapeUI(currentTableGridShape);
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

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.event === 'HANDSHAKE_ACK') {
        console.log(`%c[Grimoire Handshake] Handshake acknowledged by Server v${msg.server_version}!`, "background: #065f46; color: #a7f3d0; font-weight: bold; padding: 2px 6px; border-radius: 3px;");
        myClientId = msg.client_id;
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
        if (msg.selected_scenes) {
          selectedScenes = msg.selected_scenes;
        }
        renderSettingsFilterLists();

      } else if (msg.event === 'WEBRTC_SIGNAL') {
        const screen = msg.target_screen;
        const session = activeMirrorSessions[screen];
        if (session) {
          if (msg.signal_type === 'answer') {
            session.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).then(async () => {
              if (session.pendingCandidates) {
                while (session.pendingCandidates.length > 0) {
                  const cand = session.pendingCandidates.shift();
                  try {
                    if (!cand || !cand.candidate || cand.candidate.trim() === '') {
                      await session.pc.addIceCandidate(null);
                    } else {
                      await session.pc.addIceCandidate(new RTCIceCandidate(cand));
                    }
                  } catch(e) {}
                }
              }
            }).catch(e => console.warn('[Grimoire Spellbook] Answer SDP error:', e));
          } else if (msg.signal_type === 'candidate' && msg.candidate) {
            let cand = msg.candidate;
            if (cand && cand.candidate && msg.sender_ip) {
              cand.candidate = cand.candidate.replace(/[a-zA-Z0-9\-\._]+\.local/g, msg.sender_ip);
              if (msg.sender_ip !== '127.0.0.1') {
                cand.candidate = cand.candidate.replace(/\b127\.0\.0\.1\b/g, msg.sender_ip);
                cand.candidate = cand.candidate.replace(/\b169\.254\.\d{1,3}\.\d{1,3}\b/g, msg.sender_ip);
              }
            }
            const isEndOfCandidates = !cand.candidate || cand.candidate.trim() === '';
            if (session.pc.remoteDescription && session.pc.remoteDescription.type) {
              try {
                const candidateObj = isEndOfCandidates ? null : new RTCIceCandidate(cand);
                session.pc.addIceCandidate(candidateObj).catch(e => console.warn('[Grimoire Spellbook] Candidate add error:', e));
              } catch(e) {}
            } else {
              session.pendingCandidates = session.pendingCandidates || [];
              session.pendingCandidates.push(cand);
            }
          }
        }

      } else if (msg.event === 'MIRROR_STATUS') {
        handleMirrorStatusUpdate(msg.screen, msg.active);
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

// Heartbeat PING every 15s to keep WebSocket connection alive
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "PING" }));
  }
}, 15000);

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
    if (displays.table.grid_size) {
      currentTableGridSize = displays.table.grid_size;
      const label = document.getElementById('tableGridSizeVal');
      const slider = document.getElementById('tableGridSizeSlider');
      if (label) label.textContent = `${currentTableGridSize} px`;
      if (slider) slider.value = currentTableGridSize;
    }
    if (displays.table.grid_shape) {
      currentTableGridShape = displays.table.grid_shape;
      updateGridShapeUI(currentTableGridShape);
    }
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

// User Actions (Clean WebSocket dispatch with HTTP fallback)
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
  } else {
    fetch('/api/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sceneId })
    });
  }
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
  } else {
    fetch('/api/display/window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }
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
  } else {
    fetch('/api/display/frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }
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
  } else {
    fetch('/api/display/table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }
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
  } else {
    fetch('/api/lighting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update)
    });
  }
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

function onTableGridSizeChange(val) {
  const size = parseInt(val, 10) || 22;
  currentTableGridSize = size;
  const label = document.getElementById('tableGridSizeVal');
  if (label) label.textContent = `${size} px`;
  const slider = document.getElementById('tableGridSizeSlider');
  if (slider) slider.value = size;

  fetch('/api/display/table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grid_size: size })
  }).catch(() => {});
}

function resetGridTo1Inch() {
  onTableGridSizeChange(22);
}

let currentTableGridShape = 'square';

function setGridShape(shape) {
  currentTableGridShape = shape;
  updateGridShapeUI(shape);
  fetch('/api/display/table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grid_shape: shape })
  }).catch(() => {});
}

function updateGridShapeUI(shape) {
  const btnSq = document.getElementById('btnGridSquare');
  const btnHex = document.getElementById('btnGridHex');
  if (btnSq && btnHex) {
    if (shape === 'hex') {
      btnHex.classList.add('active');
      btnSq.classList.remove('active');
    } else {
      btnSq.classList.add('active');
      btnHex.classList.remove('active');
    }
  }
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
          isChecked = false; // default every light unchecked so user only adds the ones they want!
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
let presetNameInputBound = false;
function bindPresetNameKeySync() {
  if (presetNameInputBound) return;
  const nameInp = document.getElementById('presetNameInput');
  const keyInp = document.getElementById('presetKeyInput');
  if (nameInp && keyInp) {
    nameInp.addEventListener('input', () => {
      const isEdit = !!document.getElementById('editPresetId').value;
      if (!isEdit && keyInp.dataset.manual !== 'true') {
        const slug = nameInp.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        keyInp.value = slug;
      }
    });
    keyInp.addEventListener('input', () => {
      keyInp.dataset.manual = 'true';
    });
    presetNameInputBound = true;
  }
}

function openPresetEditorModal(presetId = null) {
  if (!presetEditorModal) return;
  bindPresetNameKeySync();

  const isEdit = !!presetId;
  document.getElementById('presetEditorTitle').textContent = isEdit ? '✨ Edit Arcane Preset' : '✨ Create Arcane Preset';
  document.getElementById('editPresetId').value = presetId || '';

  const keyInput = document.getElementById('presetKeyInput');
  keyInput.disabled = isEdit;
  keyInput.dataset.manual = isEdit ? 'true' : 'false';

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
    document.getElementById('presetTableGridSize').value = t.grid_size || currentTableGridSize || 22;
    if (document.getElementById('presetTableGridShape')) {
      document.getElementById('presetTableGridShape').value = t.grid_shape || currentTableGridShape || 'square';
    }

  } else {
    // Defaults for new preset
    keyInput.value = '';
    document.getElementById('presetNameInput').value = '';
    document.getElementById('presetDescInput').value = 'Custom atmospheric environment created in Developer Mode.';
    document.getElementById('presetLightColor').value = '#d4a34b';
    document.getElementById('presetBrightSlider').value = 75;
    document.getElementById('presetBrightVal').textContent = '75';
    document.getElementById('presetLightEffect').value = 'candle_flicker';
    document.getElementById('presetWindowEffect').value = 'sunny_meadow';
    document.getElementById('presetWindowMullions').checked = true;
    document.getElementById('presetWindowTitle').value = 'Morning Horizon';
    document.getElementById('presetFrameTitle').value = 'Archmage Portrait';
    document.getElementById('presetFrameCaption').value = 'Master of the Sanctum';
    document.getElementById('presetFrameSrc').value = '/static/media/frames/archmage.svg';
    document.getElementById('presetFrameOrnate').checked = true;
    document.getElementById('presetTableTitle').value = 'High Sun Citadel';
    document.getElementById('presetTableCaption').value = 'Battlemap courtyard';
    document.getElementById('presetTableSrc').value = '/static/media/tables/library.svg';
    document.getElementById('presetTableGrid').checked = true;
    document.getElementById('presetTableGridSize').value = currentTableGridSize || 22;
    if (document.getElementById('presetTableGridShape')) {
      document.getElementById('presetTableGridShape').value = currentTableGridShape || 'square';
    }
  }

  presetEditorModal.classList.add('open');
}

function closePresetEditorModal() {
  if (presetEditorModal) presetEditorModal.classList.remove('open');
}

function savePresetForm() {
  const name = document.getElementById('presetNameInput').value.trim();
  if (!name) {
    alert("Please enter a Title / Name for this preset (e.g. Daylight).");
    return;
  }

  let id = document.getElementById('presetKeyInput').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  if (!id) {
    id = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  }
  if (!id) {
    id = 'scene_' + Math.random().toString(36).substr(2, 6);
  }

  const description = document.getElementById('presetDescInput').value.trim();

  const payload = {
    id: id,
    name: name,
    description: description,
    lighting: {
      power: true,
      brightness: parseInt(document.getElementById('presetBrightSlider').value, 10) || 75,
      color: document.getElementById('presetLightColor').value || '#d4a34b',
      effect: document.getElementById('presetLightEffect').value || 'none'
    },
    displays: {
      window: {
        id: `${id}_window`,
        title: document.getElementById('presetWindowTitle').value.trim() || name,
        type: "canvas_effect",
        effect_type: document.getElementById('presetWindowEffect').value || 'sunny_meadow',
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
        grid_shape: document.getElementById('presetTableGridShape') ? document.getElementById('presetTableGridShape').value : 'square',
        grid_size: parseInt(document.getElementById('presetTableGridSize').value, 10) || currentTableGridSize || 22,
        caption: document.getElementById('presetTableCaption').value.trim()
      }
    }
  };

  fetch('/api/preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(async r => {
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || r.statusText);
    }
    return r.json();
  })
  .then(res => {
    closePresetEditorModal();
    playChime(660, 'triangle', 0.15);
    fetchInitialState();
  })
  .catch(err => alert("Error saving preset: " + err.message));
}

function deletePreset(presetId) {
  if (!confirm(`Are you sure you wish to extinguish the preset '${presetId}' from the Grimoire?`)) return;

  fetch(`/api/preset/${presetId}`, {
    method: 'DELETE'
  })
  .then(async r => {
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || r.statusText);
    }
    return r.json();
  })
  .then(res => {
    playChime(330, 'sawtooth', 0.15);
    fetchInitialState();
  })
  .catch(err => alert("Error deleting preset: " + err.message));
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

function castUploadedToTable() {
  const urlText = document.getElementById('uploadResultUrl').textContent;
  if (!urlText) return;
  const fileName = urlText.split('/').pop().replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
  setTableMap(urlText, fileName);
  closeMediaUploadModal();
  playChime(650, 'sine', 0.2);
  alert(`Casting '${fileName}' to Table Projector!`);
}

function castUploadedToFrame() {
  const urlText = document.getElementById('uploadResultUrl').textContent;
  if (!urlText) return;
  const fileName = urlText.split('/').pop().replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
  setFramePortrait(urlText, fileName, "Custom Artwork");
  closeMediaUploadModal();
  playChime(650, 'sine', 0.2);
  alert(`Casting '${fileName}' to Picture Frame!`);
}

// ==========================================
// Custom Battlemaps & Uploads Library Modal
// ==========================================
let _customMapPickerMode = false;

function openCustomMapsModal(forPresetEditor = false) {
  _customMapPickerMode = forPresetEditor;
  const modal = document.getElementById('customMapsModal');
  if (!modal) return;
  modal.classList.add('open');
  loadCustomMapsLibrary();
}

function closeCustomMapsModal() {
  const modal = document.getElementById('customMapsModal');
  if (modal) modal.classList.remove('open');
}

async function loadCustomMapsLibrary() {
  const grid = document.getElementById('customMapsGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">Loading battlemap library...</div>';

  try {
    const res = await fetch('/api/media/list');
    const data = await res.json();
    if (!data.files || data.files.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 30px; border: 1px dashed rgba(212, 160, 23, 0.2); border-radius: 8px;">
          <div style="font-size: 32px; margin-bottom: 8px;">🗺️</div>
          <div>No custom maps uploaded yet.</div>
          <div style="font-size: 12px; margin-top: 4px; color: #64748b;">Click "Upload New Battlemap Image" above to add your first map!</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';
    data.files.forEach(file => {
      const card = document.createElement('div');
      card.style.cssText = 'background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(212, 160, 23, 0.25); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s;';
      card.onmouseenter = () => card.style.borderColor = '#34d399';
      card.onmouseleave = () => card.style.borderColor = 'rgba(212, 160, 23, 0.25)';

      const isVideo = file.name.match(/\\.(mp4|webm)$/i);
      const mediaPreview = isVideo
        ? `<div style="height: 110px; background: #000; display: flex; align-items: center; justify-content: center; font-size: 28px;">🎬</div>`
        : `<img src="${file.url}" style="width: 100%; height: 110px; object-fit: cover; background: #000;" onerror="this.src='/static/media/tables/tavern.svg'">`;

      const cleanTitle = file.name.replace(/\\.[^/.]+$/, "").replace(/[-_]/g, " ");

      card.innerHTML = `
        ${mediaPreview}
        <div style="padding: 10px; display: flex; flex-direction: column; gap: 6px; flex: 1;">
          <div style="font-size: 13px; font-weight: bold; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${file.name}">
            ${cleanTitle}
          </div>
          <div style="font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between;">
            <span>${(file.size / 1024).toFixed(0)} KB</span>
            <button style="background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer;" title="Delete" onclick="deleteCustomMap('${file.name}', event)">✕ Delete</button>
          </div>
          <button class="grimoire-btn" style="margin-top: auto; padding: 5px 8px; font-size: 11px; font-weight: bold; width: 100%; border-color: ${_customMapPickerMode ? '#38bdf8' : '#34d399'}; color: ${_customMapPickerMode ? '#38bdf8' : '#34d399'}; background: rgba(5, 150, 105, 0.15);" onclick="selectCustomMap('${file.url}', '${cleanTitle.replace(/'/g, "\\\\'")}')">
            ${_customMapPickerMode ? '✓ Select for Preset' : '🗺️ Cast to Table'}
          </button>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<div style="color: #ef4444; font-size: 13px;">Error loading map library: ${err.message}</div>`;
  }
}

function selectCustomMap(url, title) {
  if (_customMapPickerMode) {
    const input = document.getElementById('presetTableSrc');
    if (input) input.value = url;
    const titleInput = document.getElementById('presetTableTitle');
    if (titleInput && (!titleInput.value || titleInput.value.trim() === '')) {
      titleInput.value = title;
    }
    closeCustomMapsModal();
  } else {
    setTableMap(url, title);
    closeCustomMapsModal();
    playChime(650, 'sine', 0.2);
    alert(`Casting '${title}' onto the Overhead Table Projector!`);
  }
}

async function handleCustomMapUpload(event) {
  const file = event.target.files ? event.target.files[0] : null;
  if (!file) return;

  const statusEl = document.getElementById('customMapUploadStatus');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.textContent = `Enchanting and uploading ${file.name}...`;
    statusEl.style.color = '#38bdf8';
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const resp = await fetch('/api/media/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (data.status === 'ok') {
      playChime(750, 'sine', 0.2);
      if (statusEl) {
        statusEl.textContent = `✓ '${file.name}' uploaded successfully!`;
        statusEl.style.color = '#34d399';
      }
      setTimeout(() => {
        if (statusEl) statusEl.style.display = 'none';
      }, 3000);
      loadCustomMapsLibrary();
    } else {
      if (statusEl) {
        statusEl.textContent = 'Upload failed.';
        statusEl.style.color = '#ef4444';
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Upload error: ' + err.message;
      statusEl.style.color = '#ef4444';
    }
  } finally {
    event.target.value = '';
  }
}

async function deleteCustomMap(filename, event) {
  event.stopPropagation();
  if (!confirm(`Are you sure you want to delete '${filename}'?`)) return;

  try {
    const res = await fetch(`/api/media/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.status === 'ok') {
      loadCustomMapsLibrary();
    }
  } catch (err) {
    alert("Could not delete file: " + err.message);
  }
}

async function stopAllMirrors() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "STOP_MIRROR", screen: "table" }));
    ws.send(JSON.stringify({ action: "STOP_MIRROR", screen: "window" }));
    ws.send(JSON.stringify({ action: "STOP_MIRROR", screen: "frame" }));
  }
  try {
    await fetch('/api/mirror/stop-all', { method: 'POST' });
    playChime(600, 'sine', 0.2);
    alert("All screen mirroring stopped! Table and room displays restored to current preset.");
  } catch (e) {
    console.error("Error stopping mirrors:", e);
  }
}

// ==========================================
// Arcane Screen & Window Mirroring Functions
// ==========================================
const mirrorModal = document.getElementById('mirrorModal');
let myClientId = null;
const activeMirrorSessions = {
  window: null,
  frame: null,
  table: null
};

function openMirrorModal(screen = null) {
  if (screen) {
    const sel = document.getElementById('modalMirrorScreenSelect');
    if (sel) sel.value = screen;
  }
  updateMirrorModalState();
  if (mirrorModal) mirrorModal.classList.add('open');
  playChime(560, 'sine', 0.1);
}

function closeMirrorModal() {
  if (mirrorModal) mirrorModal.classList.remove('open');
}

function updateMirrorModalState() {
  const sel = document.getElementById('modalMirrorScreenSelect');
  const targetScreen = sel ? sel.value : 'table';
  const isCasting = !!activeMirrorSessions[targetScreen];

  const startBtn = document.getElementById('modalMirrorStartBtn');
  const stopBtn = document.getElementById('modalMirrorStopBtn');
  const activeStatus = document.getElementById('modalMirrorActiveStatus');
  const activeScreenName = document.getElementById('modalMirrorActiveScreenName');

  const screenNames = {
    window: '53" Window TV',
    frame: 'Picture Frame Monitor',
    table: 'Tabletop Projector'
  };

  if (isCasting) {
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-block';
    if (activeStatus) {
      activeStatus.style.display = 'block';
      if (activeScreenName) activeScreenName.textContent = screenNames[targetScreen] || targetScreen;
    }
  } else {
    if (startBtn) startBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
    if (activeStatus) activeStatus.style.display = 'none';
  }
}

if (document.getElementById('modalMirrorScreenSelect')) {
  document.getElementById('modalMirrorScreenSelect').addEventListener('change', updateMirrorModalState);
}

async function startModalMirror() {
  const screen = document.getElementById('modalMirrorScreenSelect')?.value || 'table';
  const fitMode = document.getElementById('modalMirrorFitSelect')?.value || 'contain';
  const audioEnabled = document.getElementById('modalMirrorAudioCheck')?.checked || false;
  const showOverlay = document.getElementById('modalMirrorOverlayCheck')?.checked ?? true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert("Screen sharing is not supported by this browser, or requires a Secure Context (localhost or HTTPS).");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always", frameRate: { ideal: 30, max: 30 } },
      audio: audioEnabled
    });

    const screenCode = screen === 'window' ? 0 : screen === 'frame' ? 1 : 2;

    // Send START_MIRROR_STREAM action to server so displays prepare mirror layer immediately
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: "START_MIRROR_STREAM",
        screen: screen,
        options: {
          fit: fitMode,
          hide_overlays: !showOverlay
        }
      }));
    }

    // Set up video element in DOM so Chromium actively decodes stream frames without culling
    let video = document.getElementById('hiddenMirrorVideo');
    if (!video) {
      video = document.createElement('video');
      video.id = 'hiddenMirrorVideo';
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      video.style.left = '-9999px';
      video.style.width = '32px';
      video.style.height = '32px';
      video.style.opacity = '0.01';
      video.style.pointerEvents = 'none';
      video.style.zIndex = '-999';
      document.body.appendChild(video);
    }
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;

    // Wait until video metadata is loaded so dimensions are available
    await new Promise((resolve) => {
      if (video.videoWidth > 0) return resolve();
      video.onloadedmetadata = () => resolve();
      setTimeout(resolve, 800);
    });
    await video.play().catch(e => console.warn('[Grimoire Spellbook] Hidden video play:', e));

    console.log(`[Grimoire Spellbook] Mirror stream source ready: ${video.videoWidth}x${video.videoHeight}`);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let isStreaming = true;
    let isSending = false;
    let framesSent = 0;

    // Web Worker ticker: guarantees steady ~30 FPS even when the Spellbook tab is in the background
    const workerScript = `
      let timer = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (!timer) timer = setInterval(function() { self.postMessage('tick'); }, 33);
        } else if (e.data === 'stop') {
          if (timer) { clearInterval(timer); timer = null; }
        }
      };
    `;
    const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);
    const tickerWorker = new Worker(workerUrl);

    tickerWorker.onmessage = () => {
      if (!isStreaming) return;
      if (isSending) return; // Drop frame if previous is still encoding/transmitting
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 128 * 1024) return; // Drop frame if network buffer is busy

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      isSending = true;

      // Scale to max 1920x1080 to maintain crisp text & high detail while ensuring ultra-fast throughput
      const maxW = 1920;
      const maxH = 1080;
      const scale = Math.min(1, maxW / vw, maxH / vh);
      const drawW = Math.round(vw * scale);
      const drawH = Math.round(vh * scale);

      if (canvas.width !== drawW || canvas.height !== drawH) {
        canvas.width = drawW;
        canvas.height = drawH;
      }

      ctx.drawImage(video, 0, 0, drawW, drawH);

      canvas.toBlob((blob) => {
        if (!blob || !isStreaming || !ws || ws.readyState !== WebSocket.OPEN) {
          isSending = false;
          return;
        }

        blob.arrayBuffer().then((buf) => {
          if (!isStreaming || !ws || ws.readyState !== WebSocket.OPEN) {
            isSending = false;
            return;
          }
          const uint8 = new Uint8Array(buf);
          const packet = new Uint8Array(4 + uint8.length);
          packet[0] = 0x4D; // 'M'
          packet[1] = 0x49; // 'I'
          packet[2] = 0x52; // 'R'
          packet[3] = screenCode;
          packet.set(uint8, 4);

          try {
            ws.send(packet.buffer);
            framesSent++;
            if (framesSent === 1 || framesSent % 150 === 0) {
              console.log(`[Grimoire Spellbook] Mirror streaming active: sent ${framesSent} frames to ${screen} (${drawW}x${drawH})`);
            }
          } catch (e) {
            console.warn('[Grimoire Spellbook] Mirror frame send error:', e);
          }
          isSending = false;
        }).catch(() => { isSending = false; });
      }, 'image/jpeg', 0.82);
    };

    tickerWorker.postMessage('start');

    const cleanup = () => {
      isStreaming = false;
      if (tickerWorker) {
        try {
          tickerWorker.postMessage('stop');
          tickerWorker.terminate();
          URL.revokeObjectURL(workerUrl);
        } catch (e) {}
      }
      try {
        stream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      try {
        video.pause();
        video.srcObject = null;
        if (video.parentNode) video.parentNode.removeChild(video);
      } catch (e) {}
    };

    stream.getTracks().forEach(track => {
      track.onended = () => {
        stopModalMirror(screen);
      };
    });

    activeMirrorSessions[screen] = {
      stream,
      stop: cleanup
    };

    playChime(660, 'triangle', 0.15);
    updateMirrorModalState();
    handleMirrorStatusUpdate(screen, true);
    closeMirrorModal();

  } catch (err) {
    if (err.name !== 'NotAllowedError') {
      alert(`Error starting screen mirror: ${err.message}`);
    }
  }
}

function stopModalMirror(specificScreen = null) {
  const screen = specificScreen || document.getElementById('modalMirrorScreenSelect')?.value || 'table';
  const session = activeMirrorSessions[screen];
  if (session) {
    if (typeof session.stop === 'function') {
      session.stop();
    } else {
      if (session.stream) try { session.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      if (session.pc) try { session.pc.close(); } catch (e) {}
    }
    delete activeMirrorSessions[screen];
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "STOP_MIRROR",
      screen: screen
    }));
  }

  updateMirrorModalState();
  handleMirrorStatusUpdate(screen, false);
}

function handleMirrorStatusUpdate(screen, isActive) {
  const badgeId = screen === 'window' ? 'badgeMirrorWindow' : screen === 'frame' ? 'badgeMirrorFrame' : 'badgeMirrorTable';
  const badge = document.getElementById(badgeId);
  if (badge) {
    if (isActive) {
      badge.textContent = '● LIVE';
      badge.style.color = '#ef4444';
      badge.style.borderColor = '#ef4444';
      badge.style.background = 'rgba(239, 68, 68, 0.2)';
    } else {
      badge.textContent = 'Cast';
      badge.style.color = '#38bdf8';
      badge.style.borderColor = '#38bdf8';
      badge.style.background = 'transparent';
    }
  }
}

// Apply Saved Developer Mode state
applyDevMode();

// Start: 1. Instant HTTP fetch, 2. Connect WebSocket
fetchInitialState();
initWebSocket();

