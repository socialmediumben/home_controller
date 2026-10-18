const DISPLAY_CLIENT_VERSION = "1.3.3";

// Determine screen type: query param takes precedence (?screen=window), then URL pathname
const urlParams = new URLSearchParams(window.location.search);
let currentScreen = urlParams.get('screen');

if (!currentScreen) {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('window')) currentScreen = 'window';
  else if (path.includes('frame')) currentScreen = 'frame';
  else if (path.includes('table')) currentScreen = 'table';
  else currentScreen = 'window';
}

console.log(`[Grimoire Display v${DISPLAY_CLIENT_VERSION}] Active screen mode: ${currentScreen}`);
document.title = `Display [v${DISPLAY_CLIENT_VERSION}] - ${currentScreen.toUpperCase()}`;
const screenLabelEl = document.getElementById('screenLabel');
if (screenLabelEl) screenLabelEl.textContent = `v${DISPLAY_CLIENT_VERSION} - ${currentScreen.toUpperCase()}`;

// Elements
const layerA = document.getElementById('layerA');
const layerB = document.getElementById('layerB');
const mirrorLayer = document.getElementById('mirrorLayer');
const mirrorVideo = document.getElementById('mirrorVideo');
const mirrorCanvas = document.getElementById('mirrorCanvas');
const mirrorCtx = mirrorCanvas ? mirrorCanvas.getContext('2d') : null;
const mirrorBadge = document.getElementById('mirrorBadge');
const weatherCanvas = document.getElementById('weatherCanvas');
const gothicMullions = document.getElementById('gothicMullions');
const ornateFrame = document.getElementById('ornateFrame');
const captionBanner = document.getElementById('captionBanner');
const captionText = document.getElementById('captionText');
const gridSvg = document.getElementById('gridSvg');
const gridPattern = document.getElementById('gridPattern');
const fsBtn = document.getElementById('fsBtn');

let activeLayer = layerA;
let inactiveLayer = layerB;
let currentDisplayState = null;
let animationFrameId = null;
let crossfadeTimeout = null;

// Screen & Window Mirroring State
let mirrorPc = null;
let isMirroring = false;
let pendingIceCandidates = [];
let disconnectTimer = null;
let mirrorWatchdogTimer = null;

// Weather Canvas Setup
let ctx = weatherCanvas ? weatherCanvas.getContext('2d') : null;
let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight;

function resizeCanvas() {
  if (!weatherCanvas) return;
  canvasWidth = window.innerWidth;
  canvasHeight = window.innerHeight;
  weatherCanvas.width = canvasWidth;
  weatherCanvas.height = canvasHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Particles for canvas
let particles = [];
let lightningFlash = 0;

function initParticles(effectType) {
  particles = [];
  resizeCanvas();

  if (effectType === 'rain_storm' || effectType === 'heavy_storm') {
    const count = effectType === 'heavy_storm' ? 350 : 180;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvasWidth,
        y: Math.random() * canvasHeight,
        len: 15 + Math.random() * 25,
        speed: 18 + Math.random() * 12,
        opacity: 0.3 + Math.random() * 0.4
      });
    }
  } else if (effectType === 'fairy_wisps') {
    for (let i = 0; i < 45; i++) {
      particles.push({
        x: Math.random() * canvasWidth,
        y: Math.random() * canvasHeight,
        r: 3 + Math.random() * 6,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        color: Math.random() > 0.5 ? '#A855F7' : '#38BDF8',
        pulse: Math.random() * Math.PI
      });
    }
  } else if (effectType === 'fire_sky') {
    for (let i = 0; i < 90; i++) {
      particles.push({
        x: Math.random() * canvasWidth,
        y: canvasHeight + Math.random() * 200,
        r: 2 + Math.random() * 5,
        vx: (Math.random() - 0.5) * 1.5,
        vy: - (1.5 + Math.random() * 3),
        opacity: 0.5 + Math.random() * 0.5,
        life: 1
      });
    }
  } else if (effectType === 'night_stars') {
    for (let i = 0; i < 120; i++) {
      particles.push({
        x: Math.random() * canvasWidth,
        y: Math.random() * canvasHeight,
        r: 0.8 + Math.random() * 2,
        alpha: Math.random(),
        speed: 0.01 + Math.random() * 0.03
      });
    }
  } else if (effectType === 'sunset_town') {
    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * canvasWidth,
        y: canvasHeight * 0.4 + Math.random() * canvasHeight * 0.6,
        r: 2 + Math.random() * 4,
        vy: - (0.4 + Math.random() * 1.2),
        vx: (Math.random() - 0.5) * 0.5,
        alpha: Math.random()
      });
    }
  } else if (effectType === 'dungeon_cell') {
    for (let i = 0; i < 20; i++) {
      particles.push({
        x: Math.random() * canvasWidth,
        y: Math.random() * canvasHeight,
        speed: 3 + Math.random() * 5,
        r: 2
      });
    }
  }
}

function renderWeatherLoop(effectType) {
  if (!ctx || !weatherCanvas) return;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (effectType === 'rain_storm' || effectType === 'heavy_storm') {
    const sky = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    sky.addColorStop(0, '#0a0f1d');
    sky.addColorStop(1, '#020408');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.strokeStyle = 'rgba(174, 194, 224, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    particles.forEach(p => {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 3, p.y + p.len);
      p.y += p.speed;
      p.x -= 1.2;
      if (p.y > canvasHeight) {
        p.y = -20;
        p.x = Math.random() * (canvasWidth + 100);
      }
    });
    ctx.stroke();

    if (effectType === 'heavy_storm' && Math.random() < 0.012) {
      lightningFlash = 1.0;
    } else if (effectType === 'rain_storm' && Math.random() < 0.004) {
      lightningFlash = 0.75;
    }

    if (lightningFlash > 0.02) {
      ctx.fillStyle = `rgba(255, 255, 255, ${lightningFlash * 0.8})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      lightningFlash *= 0.82;
    }
  } else if (effectType === 'fairy_wisps') {
    const sky = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    sky.addColorStop(0, '#1e0836');
    sky.addColorStop(1, '#090212');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += 0.03;
      if (p.x < 0) p.x = canvasWidth;
      if (p.x > canvasWidth) p.x = 0;
      if (p.y < 0) p.y = canvasHeight;
      if (p.y > canvasHeight) p.y = 0;

      const curR = Math.max(1, p.r + Math.sin(p.pulse) * 2);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, curR, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.restore();
    });
  } else if (effectType === 'fire_sky') {
    const sky = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    sky.addColorStop(0, '#2e0303');
    sky.addColorStop(1, '#0d0101');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.005;
      if (p.y < -20 || p.life <= 0) {
        p.y = canvasHeight + 10;
        p.x = Math.random() * canvasWidth;
        p.life = 1;
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245, 158, 11, ${p.opacity * p.life})`;
      ctx.shadowColor = '#EF4444';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();
    });
  } else if (effectType === 'night_stars') {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    particles.forEach(p => {
      p.alpha += p.speed;
      const currentAlpha = Math.abs(Math.sin(p.alpha));
      ctx.fillStyle = `rgba(224, 231, 255, ${currentAlpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (effectType === 'sunset_town') {
    const sky = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    sky.addColorStop(0, '#451a03');
    sky.addColorStop(0.5, '#78350f');
    sky.addColorStop(1, '#1c0a00');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    particles.forEach(p => {
      p.y += p.vy;
      p.x += p.vx;
      if (p.y < canvasHeight * 0.2) p.y = canvasHeight;
      ctx.fillStyle = `rgba(251, 191, 36, ${Math.abs(Math.sin(p.alpha += 0.02)) * 0.7})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (effectType === 'dungeon_cell') {
    const stone = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    stone.addColorStop(0, '#064e3b');
    stone.addColorStop(0.4, '#022c22');
    stone.addColorStop(1, '#01140f');
    ctx.fillStyle = stone;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    particles.forEach(p => {
      p.y += p.speed;
      if (p.y > canvasHeight) {
        p.y = 0;
        p.x = Math.random() * canvasWidth;
      }
      ctx.fillStyle = 'rgba(52, 211, 153, 0.4)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  animationFrameId = requestAnimationFrame(() => renderWeatherLoop(effectType));
}

// Media Render & Crossfade
function renderDisplay(displayData, immediate = false) {
  if (!displayData) return;
  console.log(`[Grimoire Display] Rendering ${currentScreen}:`, displayData);
  currentDisplayState = displayData;

  // Window Overlays
  if (currentScreen === 'window') {
    if (gothicMullions) {
      gothicMullions.style.display = displayData.show_mullions !== false ? 'grid' : 'none';
    }

    if (displayData.type === 'canvas_effect') {
      if (weatherCanvas) weatherCanvas.style.display = 'block';
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      initParticles(displayData.effect_type);
      renderWeatherLoop(displayData.effect_type);
      layerA.innerHTML = '';
      layerB.innerHTML = '';
      layerA.classList.remove('active', 'incoming');
      layerB.classList.remove('active', 'incoming');
      return;
    } else {
      if (weatherCanvas) weatherCanvas.style.display = 'none';
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    }
  } else {
    if (gothicMullions) gothicMullions.style.display = 'none';
    if (weatherCanvas) weatherCanvas.style.display = 'none';
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  }

  // Frame Overlays
  if (currentScreen === 'frame') {
    if (ornateFrame) {
      ornateFrame.style.display = displayData.show_ornate_border !== false ? 'block' : 'none';
    }
    if (captionBanner && captionText) {
      if (displayData.caption) {
        captionText.textContent = displayData.caption;
        captionBanner.style.display = 'block';
      } else {
        captionBanner.style.display = 'none';
      }
    }
  }

  // Table Overlays
  if (currentScreen === 'table') {
    updateGrid(displayData.grid_enabled, displayData.grid_size, displayData.grid_color);
  }

  // Generate Media HTML
  let contentHtml = '';
  if (displayData.roll20_url && displayData.roll20_url.trim() !== '') {
    contentHtml = `<iframe src="${displayData.roll20_url}" allowfullscreen></iframe>`;
  } else if (displayData.src) {
    const isVideo = displayData.src.endsWith('.mp4') || displayData.src.endsWith('.webm');
    if (isVideo) {
      contentHtml = `<video src="${displayData.src}" autoplay loop muted playsinline></video>`;
    } else {
      const kenBurnsClass = currentScreen === 'frame' ? 'ken-burns' : '';
      contentHtml = `<img src="${displayData.src}" alt="${displayData.title || ''}" class="${kenBurnsClass}">`;
    }
  }

  // Clear any existing transition in progress
  if (crossfadeTimeout) {
    clearTimeout(crossfadeTimeout);
    crossfadeTimeout = null;
  }

  // If immediate (initial load or empty layer), display instantly
  if (immediate || !activeLayer.innerHTML.trim()) {
    activeLayer.innerHTML = contentHtml;
    activeLayer.classList.remove('incoming');
    activeLayer.classList.add('active');
    inactiveLayer.classList.remove('active', 'incoming');
    inactiveLayer.innerHTML = '';
    return;
  }

  // Smooth Crossfade transition
  inactiveLayer.innerHTML = contentHtml;
  inactiveLayer.classList.add('incoming');
  activeLayer.classList.remove('active');

  crossfadeTimeout = setTimeout(() => {
    inactiveLayer.classList.remove('incoming');
    inactiveLayer.classList.add('active');
    // Swap layer pointers
    const temp = activeLayer;
    activeLayer = inactiveLayer;
    inactiveLayer = temp;
    inactiveLayer.innerHTML = '';
    crossfadeTimeout = null;
  }, 1200);
}

function updateGrid(enabled, size = 60, color = 'rgba(255, 215, 0, 0.35)') {
  if (!gridSvg) return;
  if (!enabled) {
    gridSvg.style.display = 'none';
    return;
  }
  gridSvg.style.display = 'block';
  if (gridPattern) {
    gridPattern.setAttribute('width', size);
    gridPattern.setAttribute('height', size);
    const path = gridPattern.querySelector('path');
    if (path) {
      path.setAttribute('d', `M ${size} 0 L 0 0 0 ${size}`);
      path.setAttribute('stroke', color);
    }
  }
}

// Initial HTTP Fetch (Guarantees instant display on load)
function fetchCurrentState() {
  fetch('/api/state')
    .then(r => r.json())
    .then(data => {
      if (data.current_state && data.current_state.displays) {
        const displayData = data.current_state.displays[currentScreen];
        if (displayData) {
          renderDisplay(displayData, true);
        }
      }
    })
    .catch(err => console.warn('Could not fetch initial state via HTTP:', err));
}

// WebRTC Mirror Stream Receiver Functions
async function handleMirrorOffer(msg) {
  console.log(`%c[Grimoire Display: ${currentScreen}] Received WebRTC screen mirror offer from ${msg.sender_id}`, "color: #38bdf8; font-weight: bold;");
  
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  pendingIceCandidates = [];

  if (mirrorPc) {
    try { mirrorPc.close(); } catch(e) {}
    mirrorPc = null;
  }

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  mirrorPc = new RTCPeerConnection(rtcConfig);

  mirrorPc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: "WEBRTC_SIGNAL",
        target_id: msg.sender_id,
        target_screen: currentScreen,
        signal_type: "candidate",
        candidate: event.candidate
      }));
    }
  };

  mirrorPc.ontrack = (event) => {
    console.log(`%c[Grimoire Display: ${currentScreen}] Remote media track attached:`, "color: #10b981; font-weight: bold;", event.track.kind);
    startMirroringDisplay(msg.options);

    if (mirrorVideo) {
      const stream = (event.streams && event.streams.length > 0) ? event.streams[0] : new MediaStream([event.track]);
      mirrorVideo.srcObject = stream;
      if (msg.options && msg.options.fit === 'cover') {
        mirrorVideo.classList.add('fit-cover');
      } else {
        mirrorVideo.classList.remove('fit-cover');
      }

      mirrorVideo.muted = true;
      mirrorVideo.onloadedmetadata = () => {
        mirrorVideo.play().catch(e => console.warn('Mirror video playback blocked:', e));
      };
      mirrorVideo.onplaying = () => {
        console.log(`%c[Grimoire Display: ${currentScreen}] Mirror video playback ACTIVE!`, "color: #10b981; font-weight: bold;");
        if (mirrorBadge) mirrorBadge.textContent = '● LIVE MIRROR';
      };
      mirrorVideo.play().catch(e => console.warn('Mirror video playback blocked:', e));
    }
  };

  mirrorPc.oniceconnectionstatechange = () => {
    console.log(`%c[Grimoire Display: ${currentScreen}] WebRTC ICE State: ${mirrorPc.iceConnectionState}`, "color: #f59e0b; font-weight: bold;");
    if (mirrorPc.iceConnectionState === 'connected' || mirrorPc.iceConnectionState === 'completed') {
      if (mirrorBadge) mirrorBadge.textContent = '● LIVE MIRROR';
    }
  };

  mirrorPc.onconnectionstatechange = () => {
    console.log(`[Grimoire Display: ${currentScreen}] WebRTC Peer Connection State: ${mirrorPc.connectionState}`);
    if (mirrorPc.connectionState === 'connected') {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      if (mirrorBadge) mirrorBadge.textContent = '● LIVE MIRROR';
    } else if (mirrorPc.connectionState === 'disconnected') {
      // Disconnected is often transient during Wi-Fi jitter. Give it 15 seconds to recover before terminating.
      if (!disconnectTimer) {
        disconnectTimer = setTimeout(() => {
          if (mirrorPc && mirrorPc.connectionState === 'disconnected') {
            console.warn(`[Grimoire Display: ${currentScreen}] WebRTC disconnect timed out. Stopping mirror.`);
            stopMirroringDisplay();
          }
        }, 15000);
      }
    } else if (mirrorPc.connectionState === 'failed' || mirrorPc.connectionState === 'closed') {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      console.warn(`[Grimoire Display: ${currentScreen}] WebRTC connection state: ${mirrorPc.connectionState}. Stopping mirror.`);
      stopMirroringDisplay();
    }
  };

  try {
    await mirrorPc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

    // Drain queued ICE candidates received before remoteDescription was set
    while (pendingIceCandidates.length > 0) {
      const cand = pendingIceCandidates.shift();
      try {
        if (!cand || !cand.candidate || cand.candidate.trim() === '') {
          await mirrorPc.addIceCandidate(null);
        } else {
          await mirrorPc.addIceCandidate(new RTCIceCandidate(cand));
        }
      } catch (err) {
        console.warn(`[Grimoire Display: ${currentScreen}] Error adding queued ICE candidate:`, err);
      }
    }

    const answer = await mirrorPc.createAnswer();
    await mirrorPc.setLocalDescription(answer);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: "WEBRTC_SIGNAL",
        target_id: msg.sender_id,
        target_screen: currentScreen,
        signal_type: "answer",
        sdp: mirrorPc.localDescription
      }));
    }
  } catch (err) {
    console.error(`[Grimoire Display: ${currentScreen}] WebRTC offer error:`, err);
  }
}

async function handleMirrorCandidate(msg) {
  if (!msg.candidate) return;
  let cand = msg.candidate;

  // Fallback client-side rewrite in case .local or 127.0.0.1 was sent
  if (cand && cand.candidate && msg.sender_ip) {
    cand.candidate = cand.candidate.replace(/[a-zA-Z0-9\-\._]+\.local/g, msg.sender_ip);
    if (msg.sender_ip !== '127.0.0.1') {
      cand.candidate = cand.candidate.replace(/\b127\.0\.0\.1\b/g, msg.sender_ip);
      cand.candidate = cand.candidate.replace(/\b169\.254\.\d{1,3}\.\d{1,3}\b/g, msg.sender_ip);
    }
  }

  const isEndOfCandidates = !cand.candidate || cand.candidate.trim() === '';

  if (mirrorPc && mirrorPc.remoteDescription && mirrorPc.remoteDescription.type) {
    try {
      if (isEndOfCandidates) {
        await mirrorPc.addIceCandidate(null);
      } else {
        await mirrorPc.addIceCandidate(new RTCIceCandidate(cand));
      }
    } catch (e) {
      console.warn(`[Grimoire Display: ${currentScreen}] Error adding ICE candidate:`, e);
    }
  } else {
    pendingIceCandidates.push(cand);
  }
}

function startMirroringDisplay(options = {}) {
  isMirroring = true;
  resetMirrorWatchdog();

  if (mirrorBadge) {
    mirrorBadge.textContent = '● LIVE MIRROR';
    mirrorBadge.style.display = 'inline-block';
  }

  // Stop and hide weather canvas loop so it never renders under/over the mirror
  if (weatherCanvas) weatherCanvas.style.display = 'none';
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  // Hide pre-existing media crossfade layers
  if (layerA) layerA.style.display = 'none';
  if (layerB) layerB.style.display = 'none';

  if (mirrorCanvas) {
    if (options && options.fit === 'cover') {
      mirrorCanvas.classList.add('fit-cover');
    } else {
      mirrorCanvas.classList.remove('fit-cover');
    }
  }

  if (mirrorLayer) {
    mirrorLayer.style.display = 'flex';
    mirrorLayer.style.opacity = '1';
  }

  // Overlay visibility option
  if (options && options.hide_overlays) {
    if (gothicMullions) gothicMullions.style.display = 'none';
    if (ornateFrame) ornateFrame.style.display = 'none';
    if (captionBanner) captionBanner.style.display = 'none';
    if (gridSvg) gridSvg.style.display = 'none';
  }
}

function resetMirrorWatchdog() {
  if (mirrorWatchdogTimer) clearTimeout(mirrorWatchdogTimer);
  mirrorWatchdogTimer = setTimeout(() => {
    if (isMirroring) {
      console.warn(`[Grimoire Display: ${currentScreen}] No mirror frames received for 12 seconds. Stopping mirror.`);
      stopMirroringDisplay();
    }
  }, 12000);
}

function handleBinaryMirrorFrame(arrayBuffer) {
  if (arrayBuffer.byteLength < 5) return;
  const header = new Uint8Array(arrayBuffer, 0, 4);
  // Header: 'M', 'I', 'R', screenCode (0=window, 1=frame, 2=table)
  if (header[0] !== 0x4D || header[1] !== 0x49 || header[2] !== 0x52) return;
  const screenCode = header[3];
  const targetName = screenCode === 0 ? 'window' : screenCode === 1 ? 'frame' : 'table';
  if (targetName !== currentScreen) return;

  if (!isMirroring) {
    startMirroringDisplay();
  }
  resetMirrorWatchdog();

  const imageBlob = new Blob([new Uint8Array(arrayBuffer, 4)], { type: 'image/jpeg' });
  createImageBitmap(imageBlob).then(bitmap => {
    if (!isMirroring || !mirrorCanvas || !mirrorCtx) {
      bitmap.close();
      return;
    }
    if (mirrorCanvas.width !== bitmap.width || mirrorCanvas.height !== bitmap.height) {
      mirrorCanvas.width = bitmap.width;
      mirrorCanvas.height = bitmap.height;
    }
    mirrorCtx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }).catch(() => {});
}

function stopMirroringDisplay() {
  if (!isMirroring && (!mirrorLayer || mirrorLayer.style.display === 'none')) return;
  console.log(`%c[Grimoire Display: ${currentScreen}] Stopping screen mirror...`, "color: #f97316; font-weight: bold;");
  isMirroring = false;
  if (mirrorWatchdogTimer) {
    clearTimeout(mirrorWatchdogTimer);
    mirrorWatchdogTimer = null;
  }
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  if (mirrorPc) {
    try { mirrorPc.close(); } catch(e) {}
    mirrorPc = null;
  }
  if (mirrorVideo) {
    try { mirrorVideo.pause(); } catch(e) {}
    mirrorVideo.srcObject = null;
  }
  if (mirrorCtx && mirrorCanvas) {
    mirrorCtx.clearRect(0, 0, mirrorCanvas.width, mirrorCanvas.height);
  }
  if (mirrorLayer) {
    mirrorLayer.style.display = 'none';
    mirrorLayer.style.opacity = '0';
  }
  if (mirrorBadge) mirrorBadge.style.display = 'none';

  // Restore layer visibility
  if (layerA) layerA.style.display = '';
  if (layerB) layerB.style.display = '';

  // Restore current preset overlays & display
  if (currentDisplayState) {
    renderDisplay(currentDisplayState, true);
  }
}

// WebSocket Connection for Real-Time Sync
let ws = null;
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log(`%c[Grimoire Display: ${currentScreen}] Connected! Sending HANDSHAKE...`, "color: #10b981; font-weight: bold;");
    // Send explicit handshake
    ws.send(JSON.stringify({
      action: "HANDSHAKE",
      client_type: `display_${currentScreen}`,
      version: DISPLAY_CLIENT_VERSION
    }));
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      handleBinaryMirrorFrame(event.data);
      return;
    }

    try {
      const msg = JSON.parse(event.data);

      if (msg.event === 'HANDSHAKE_ACK') {
        console.log(`%c[Grimoire Display: ${currentScreen}] Handshake ACK from Server v${msg.server_version}!`, "background: #065f46; color: #a7f3d0; font-weight: bold; padding: 2px 6px; border-radius: 3px;");
        const displays = msg.state ? msg.state.displays : null;
        if (displays && displays[currentScreen]) {
          currentDisplayState = displays[currentScreen];
          if (!isMirroring) {
            renderDisplay(displays[currentScreen], true);
          }
        }

      } else if (msg.event === 'SCENE_CHANGED') {
        console.log(`%c[Grimoire Display: ${currentScreen}] Received SCENE_CHANGED: '${msg.scene ? msg.scene.name : msg.state.scene_name}'`, "color: #f59e0b; font-weight: bold; font-size: 13px;");
        if (isMirroring) stopMirroringDisplay();
        const displays = msg.state ? msg.state.displays : null;
        if (displays && displays[currentScreen]) {
          renderDisplay(displays[currentScreen]);
        }

      } else if (msg.event === 'DISPLAY_UPDATED') {
        if (msg.screen === currentScreen) {
          console.log(`%c[Grimoire Display: ${currentScreen}] Received DISPLAY_UPDATED:`, "color: #a855f7; font-weight: bold;", msg.display);
          if (isMirroring) stopMirroringDisplay();
          renderDisplay(msg.display);
        }

      } else if (msg.event === 'START_MIRROR_STREAM') {
        if (msg.screen === currentScreen) {
          console.log(`%c[Grimoire Display: ${currentScreen}] Received START_MIRROR_STREAM`, "color: #10b981; font-weight: bold;");
          startMirroringDisplay(msg.options);
        }

      } else if (msg.event === 'WEBRTC_SIGNAL') {
        if (msg.target_screen === currentScreen) {
          if (msg.signal_type === 'offer') {
            handleMirrorOffer(msg);
          } else if (msg.signal_type === 'candidate') {
            handleMirrorCandidate(msg);
          }
        }

      } else if (msg.event === 'STOP_MIRROR') {
        if (msg.screen === currentScreen) {
          stopMirroringDisplay();
        }
      }
    } catch (e) {
      console.error(`[Grimoire Display: ${currentScreen}] Error handling WS message:`, e);
    }
  };

  ws.onclose = () => {
    console.warn(`%c[Grimoire Display: ${currentScreen}] WebSocket closed. Reconnecting in 2.5s...`, "color: #ef4444; font-weight: bold;");
    setTimeout(connectWebSocket, 2500);
  };
}

// Heartbeat PING every 15s to prevent router / OS idle connection drop
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "PING" }));
  }
}, 15000);

// Fullscreen Controls
if (fsBtn) {
  fsBtn.addEventListener('click', toggleFullscreen);
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
document.addEventListener('dblclick', toggleFullscreen);

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }
}

// Start immediately
fetchCurrentState();
connectWebSocket();
