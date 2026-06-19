// ---------------------------------- Global State ----------------------------------

// Satu-satunya sumber kebenaran state mesin (disinkronkan dari backend)
let currentStatus = {
  position: [0.0, 0.0, 0.0], // [x, y, z]
  pausedAtPos: [0.0, 0.0, 0.0],
  isSpraying: false,
  isPaused: false,
  connected: false,
  startPoint: false,
  constraints: false,
  feed: 1000,
  progress: 0,
  seconds: 0,
  lastReport: "-",
  lastMessage: "GRBL ready",
};

let DEFAULT_STATUS = {
  position: [0.0, 0.0, 0.0], // [x, y, z]
  pausedAtPos: [0.0, 0.0, 0.0],
  isSpraying: false,
  isPaused: false,
  connected: false,
  startPoint: false,
  constraints: false,
  feed: 1000,
  progress: 0,
  seconds: 0,
  lastReport: "-",
  lastMessage: "GRBL ready",
};

const tileSize = {
  w: 300,
  h: 400,
};

// 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
let connectionState = "disconnected";
let prevPort = false;

// for autoreconnect
let _last_port = ""
let _last_baudrate = ""
let _auto_reconnect_enabled = false;


// ---------------------------------- WebSocket ----------------------------------

let ws = null;

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  logMsg("Menghubungkan ke server...");

  ws.onopen = () => {
    logMsg("Terhubung ke server ✅");
    fetchAvailablePorts();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("WS DATA:", data);

    // Update status, port, connection, and UI (0.2s)
    updateStatus(data);
    fetchAvailablePorts();
    
    // Sinc canvas animation and CNC machine 
    if (typeof data.isSpraying === "boolean")
      currentStatus.isSpraying = data.isSpraying;
    if (typeof data.isPaused === "boolean")
      currentStatus.isPaused = data.isPaused;
    if (typeof data.progress === "number") {
      currentStatus.progress = data.progress;
      updateProgressUI();
    }

    // Dynamic button control with the state machine
    if (currentStatus.isSpraying) {
      DOM.spray.btnStart.disabled = true;
      DOM.spray.btnStart.classList.add("opacity-50");
      DOM.spray.btnPause.classList.remove("hidden");

      if (currentStatus.isPaused) {
        DOM.spray.btnPause.innerHTML =
          '<i data-lucide="play" class="w-4 h-4"></i><span>RESUME</span>';
        DOM.spray.btnPause.className =
          "px-6 py-2.5 bg-success hover:bg-green-500 text-white shadow-md shadow-success/30 rounded-xl transition-all font-bold text-sm flex items-center justify-center space-x-2";
      } else {
        DOM.spray.btnPause.innerHTML =
          '<i data-lucide="pause" class="w-4 h-4"></i><span>PAUSE</span>';
        DOM.spray.btnPause.className =
          "px-6 py-2.5 bg-warning hover:bg-yellow-500 text-white shadow-md shadow-warning/30 rounded-xl transition-all font-bold text-sm flex items-center justify-center space-x-2";
      }
      lucide.createIcons();
    } else {
      DOM.spray.btnStart.disabled = false;
      DOM.spray.btnStart.classList.remove("opacity-50");
      DOM.spray.btnPause.classList.add("hidden");
    }

    // Sinc connection status
    if (typeof data.connected === "boolean") {
      const actualState = data.connected
        ? "connected"
        : "disconnected";

      if (
        connectionState !== "connecting" &&
        connectionState !== "disconnecting" &&
        connectionState !== actualState
      ) {
        connectionState = actualState;
        updateConnectionUI();
      }
    }
  };

  ws.onclose = () => {
    logMsg("Koneksi ke server terputus ❌", true);
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
    logMsg("WebSocket error", true);
    console.error("WS Error:", err);
  };
}


// ---------------------------------- DOM Elements ----------------------------------

const DOM = {
  time: document.getElementById("currentTime"),

  conn: {
    dot: document.getElementById("globalConnIndicator"),
    text: document.getElementById("globalConnText"),
  },

  spray: {
    connDot: document.getElementById("connStatusDot"),
    connText: document.getElementById("connStatusText"),
    btnConnect: document.getElementById("btnConnect"),
    btnDisconnect: document.getElementById("btnDisconnect"),
    portSelect: document.getElementById("portSelect"),
    btnStart: document.getElementById("btnStartSpray"),
    btnPause: document.getElementById("btnPauseSpray"),
    btnEstop: document.getElementById("btnEstopSpray"),
    progBar: document.getElementById("sprayProgressBar"),
    progTxt: document.getElementById("sprayProgressTxt"),
    console: document.getElementById("sprayConsole"),
  },

  canvas: {
    el: document.getElementById("sprayCanvas"),
    container: document.getElementById("canvasContainer"),
  },

  status: {
    coords: [
      [document.getElementById("sprayListX"),  document.getElementById("manListX")],
      [document.getElementById("sprayListY"),  document.getElementById("manListY")],
      [document.getElementById("sprayListZ"),  document.getElementById("manListZ")],
    ],
    percent:  [document.getElementById("sprayListPercent"),  document.getElementById("manListPercent")],
    connect:  [document.getElementById("sprayListConnection"),  document.getElementById("manListConnection")],
    startPt:      [document.getElementById("sprayListStartPt"),    document.getElementById("manListStartPt")],
    constraint:   [document.getElementById("sprayListConstraint"), document.getElementById("manListConstraint")],
    speed:        [document.getElementById("sprayListSpeed"),       document.getElementById("manListSpeed")],
    timer:        [document.getElementById("sprayListTimer"),       document.getElementById("manListTimer")],
    sprayerStatus:[document.getElementById("spraySprayerStatus"),  document.getElementById("manSprayerStatus")],
  },

  manualConsole: document.getElementById("manualConsole"),
  btnEstopSidebar: document.getElementById("estopBtnSidebar"),
};

const ctx = DOM.canvas.el.getContext("2d");

// ---------------------------------- Status Update ----------------------------------

function updateSprayButtonsUI() {
  if (currentStatus.isSpraying) {
    DOM.spray.btnStart.disabled = true;
    DOM.spray.btnStart.classList.add("opacity-50");
    DOM.spray.btnPause.classList.remove("hidden");

    if (currentStatus.isPaused) {
      DOM.spray.btnPause.innerHTML =
        '<i data-lucide="play" class="w-4 h-4"></i><span>RESUME</span>';
      DOM.spray.btnPause.className =
        "px-6 py-2.5 bg-success hover:bg-green-500 text-white shadow-md shadow-success/30 rounded-xl transition-all font-bold text-sm flex items-center justify-center space-x-2";
    } else {
      DOM.spray.btnPause.innerHTML =
        '<i data-lucide="pause" class="w-4 h-4"></i><span>PAUSE</span>';
      DOM.spray.btnPause.className =
        "px-6 py-2.5 bg-warning hover:bg-yellow-500 text-white shadow-md shadow-warning/30 rounded-xl transition-all font-bold text-sm flex items-center justify-center space-x-2";
    }
    lucide.createIcons();
  } else {
    DOM.spray.btnStart.disabled = false;
    DOM.spray.btnStart.classList.remove("opacity-50");
    DOM.spray.btnPause.classList.add("hidden");
  }
}

function updateStatusUI() {
  const [x, y, z] = currentStatus.position;

  DOM.status.coords[0].forEach    (el => el && (el.innerText = Number(x).toFixed(2)));
  DOM.status.coords[1].forEach    (el => el && (el.innerText = Number(y).toFixed(2)));
  DOM.status.coords[2].forEach    (el => el && (el.innerText = Number(z).toFixed(2)));
  DOM.status.connect.forEach      (el => el && (el.innerText = currentStatus.connected ? "ON" : "OFF"));
  DOM.status.percent.forEach      (el => el && (el.innerText = Math.round(currentStatus.progress) + "%"));
  DOM.status.startPt.forEach      (el => el && (el.innerText = currentStatus.startPoint ? "true" : "false"));
  DOM.status.constraint.forEach   (el => el && (el.innerText = currentStatus.constraints ? "ON" : "OFF"));
  DOM.status.speed.forEach        (el => el && (el.innerText = Number(currentStatus.feed).toFixed(1)));
  DOM.status.sprayerStatus.forEach(el => el && (el.innerText = currentStatus.isSpraying ? "ON" : "OFF"));

  updateSprayButtonsUI(); // <- panggil di sini, biar selalu sinkron
}

// ---------------------------------- Data Management ----------------------------------

function updateStatus(newData) {
  if (newData.position && !Array.isArray(newData.position)) {
    delete newData.position;
  }

  currentStatus = { ...currentStatus, ...newData };
  updateStatusUI();
}


// ---------------------------------- Send Data ----------------------------------

async function sendData(data, type) {
  logMsg(`Send [${type}] → backend`);
  const API_BASE = window.location.origin;

  try {
    const response = await fetch(`${API_BASE}/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (!response.ok)
      throw new Error(result.detail || "Backend menolak request");
    return result;
  } catch (err) {
    logMsg(`Gagal mengirim [${type}]: ${err.message}`, true);
    return null;
  }
}


// ---------------------------------- Port & Connection Management ----------------------------------

async function fetchAvailablePorts() {
  try {
    const res = await fetch("/ports");
    const ports = await res.json();

    if (!ports.length) {
      await handlePortDisconnected();
      return;
    }

    renderPorts(ports);

    if (!prevPort) {
      logMsg(`${ports.length} port ditemukan.`);
    }

    await autoReconnect();

    prevPort = true;

  } catch (err) {
    DOM.spray.portSelect.innerHTML =
      '<option value="">-- Gagal load port --</option>';
  }
}

function renderPorts(ports) {
  DOM.spray.portSelect.innerHTML = "";

  ports.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.device;
    opt.textContent = `${p.device} (${p.description})`;
    DOM.spray.portSelect.appendChild(opt);
  });
}

async function handlePortDisconnected() {
  DOM.spray.portSelect.innerHTML =
    '<option value="">-- Tidak ada port --</option>';

  if (!prevPort) return;

  logMsg("Tidak ada port serial yang tersedia.", true);

  if (connectionState === "connected") {
    const result = await sendData({}, "disconnect");

    if (result) {
      connectionState = "disconnected";
      updateConnectionUI();
      resetStatusUI();
    }
  }

  prevPort = false;
}

async function autoReconnect() {
  if (!_auto_reconnect_enabled) return;
  if (prevPort) return;
  if (connectionState !== "disconnected") return;

  const port = DOM.spray.portSelect.value;
  const baudrate = 115200;

  connectionState = "connecting";
  updateConnectionUI();

  logMsg(`Menghubungkan kembali ke ${port} @ ${baudrate}bps...`);

  const result = await sendData(
    { port, baudrate },
    "reconnect"
  );

  const stop = await sendData(
    {}, 
    "emergency-stop"
  );

  if (!result) {
    connectionState = "disconnected";
    updateConnectionUI();
    return;
  }

  connectionState = result.status?.connected
    ? "connected"
    : "disconnected";

  logMsg(result.message, !result.success);

  if (result.status) updateStatus(result.status);

  updateConnectionUI();
}


// ---------------------------------- Button Connection Logic ----------------------------------

function updateConnectionUI() {
  const isConn = connectionState === "connected";
  const isConnecting = connectionState === "connecting";
  const isDisconnecting = connectionState === "disconnecting";
  const isBusy = isConnecting || isDisconnecting;

  DOM.conn.dot.classList.toggle("bg-success", isConn);
  DOM.conn.dot.classList.toggle("bg-warning", isBusy);
  DOM.conn.dot.classList.toggle("bg-danger", !isConn && !isBusy);
  DOM.conn.dot.classList.toggle("animate-pulse", !isConn);

  DOM.conn.text.innerText = isConn
    ? "CONNECTED"
    : isConnecting
      ? "CONNECTING..."
      : "DISCONNECTED";
  DOM.conn.text.classList.toggle("text-success", isConn);
  DOM.conn.text.classList.toggle("text-warning", isConnecting);
  DOM.conn.text.classList.toggle("text-text-muted", !isConn && !isConnecting);

  DOM.spray.connDot.classList.toggle("bg-success", isConn);
  DOM.spray.connDot.classList.toggle("bg-warning", isBusy);
  DOM.spray.connDot.classList.toggle("bg-danger", !isConn && !isBusy);
  DOM.spray.connText.innerText = isConn
    ? "Connected"
    : isConnecting
      ? "Connecting..."
      : "Disconnected";

  DOM.spray.btnConnect.classList.toggle("hidden", isConn || isBusy);
  DOM.spray.btnDisconnect.classList.toggle("hidden", !isConn || isBusy);
  DOM.spray.btnConnect.disabled = isBusy;
  DOM.spray.btnDisconnect.disabled = isBusy;
  DOM.spray.portSelect.disabled = isConn || isBusy;
}

DOM.spray.btnConnect.addEventListener("click", async () => {
  if (connectionState !== "disconnected") return;
  const port = DOM.spray.portSelect.value;
  const baudrate = 115200;

  if (!port) {
    logMsg("Pilih port terlebih dahulu.", true);
    return;
  }

  connectionState = "connecting";
  updateConnectionUI();
  logMsg(`Menghubungkan ke ${port} @ ${baudrate}bps...`);

  const result = await sendData({ port, baudrate }, "connect");
  if (result) {
    connectionState = result.status?.connected ? "connected" : "disconnected";
    logMsg(result.message, !result.success);

    if (result.status) updateStatus(result.status);

    // Flag for reconnect (enable)
    _auto_reconnect_enabled = true;
  } else {
    connectionState = "disconnected";

    // Flag for reconnect (disable)
    _auto_reconnect_enabled = false;
  }
  updateConnectionUI();
});

DOM.spray.btnDisconnect.addEventListener("click", async () => {
  if (connectionState !== "connected") return;
  connectionState = "disconnecting";
  updateConnectionUI();

  const result = await sendData({}, "disconnect");
  connectionState = "disconnected";
  if (result) {
    logMsg(result.message, !result.success);
    if (result.status) updateStatus(result.status);
  }
  updateConnectionUI();
});


// ---------------------------------- Clock & Timer ----------------------------------

setInterval(() => {
  DOM.time.innerText = new Date().toLocaleTimeString("en-US", {
    hour12: false,
  });
}, 1000);

setInterval(() => {
  if (!currentStatus.isSpraying || currentStatus.isPaused) return;

  currentStatus.seconds++;

  const [h, m, s] = [
    Math.floor(currentStatus.seconds / 3600),
    Math.floor((currentStatus.seconds % 3600) / 60),
    currentStatus.seconds % 60,
  ].map((n) => String(n).padStart(2, "0"));
  
  DOM.status.timer.forEach(el => el && (el.innerText = `${h}:${m}:${s}`));
}, 1000);


// ---------------------------------- Navigation ----------------------------------

function switchTab(tabId) {
  ["spray-page", "manual-page"].forEach((id) => {
    document.getElementById(id).classList.toggle("hidden", id !== tabId);
  });

  const navSpray = document.getElementById("nav-spray");
  const navManual = document.getElementById("nav-manual");
  const activeNav = tabId === "spray-page" ? navSpray : navManual;
  const inactiveNav = tabId === "spray-page" ? navManual : navSpray;

  const activeClasses = [
    "bg-primary/10",
    "text-primary",
    "border-primary/20",
    "shadow-sm",
  ];
  const inactiveClasses = ["text-text-muted", "border-transparent"];

  activeNav.classList.add(...activeClasses);
  activeNav.classList.remove(...inactiveClasses);
  inactiveNav.classList.add(...inactiveClasses);
  inactiveNav.classList.remove(...activeClasses);

  if (tabId === "spray-page") resizeCanvas();
}


// ---------------------------------- Console Logging ----------------------------------

function logMsg(msg, isError = false, toManualOnly = false) {
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  const color = isError ? "text-red-400 font-bold" : "text-gray-300";
  const html = `<div><span class="text-gray-500 mr-2">[${time}]</span><span class="${color}">${msg}</span></div>`;

  if (!toManualOnly) {
    DOM.spray.console.innerHTML += html;
    DOM.spray.console.scrollTop = DOM.spray.console.scrollHeight;
  }
  DOM.manualConsole.innerHTML += html;
  DOM.manualConsole.scrollTop = DOM.manualConsole.scrollHeight;
}

function clearConsole(id) {
  document.getElementById(id).innerHTML = "";
}

// ---------------------------------- Manual Page Task ----------------------------------

async function jog(dir) {
  if (connectionState !== "connected") {
    logMsg("Cannot jog: Not connected.", true);
    return;
  }
  if (currentStatus.isSpraying) {
    logMsg("Cannot jog: Machine is busy.", true);
    return;
  }

  const step = parseFloat(document.getElementById("jogStepInput").value) || 1;
  const speed = parseInt(document.getElementById("jogSpeedInput").value) || 1000;

  const result = await sendData(
    { 
      direction: dir, 
      step, 
      feed: speed 
    }, 
    "jog"
  );
  
  if (result) updateStatus(result);
}

async function setStartingPoint() {
  if (connectionState !== "connected") return;

  const result = await sendData(
    { 
      zx: 0.0, 
      zy: 0.0, 
      zz: 0.0 
    },
    "set-starting-point",
  );

  if (result) {
    updateStatus(result);
    logMsg("G92 X0 Y0 Z0 — Starting point set ✅");
  }
}

async function goHome() {
  if (connectionState !== "connected") return;

  const speed = parseInt(document.getElementById("jogSpeedInput")?.value) || 1000;
  const result = await sendData(
    { to_x: 0.0, 
      to_y: 0.0, 
      to_z: 0.0, 
      feed: speed 
    },
    "back-to-start",
  );

  if (result) {
    updateStatus(result);
    logMsg("G0 X0 Y0 — Returning to start point");
  }
}

// ---------------------------------- Spray Canvas ----------------------------------

function updateCanvasDim() {
  tileSize.w = parseInt(document.getElementById("tileWidth").value) || 300;
  tileSize.h = parseInt(document.getElementById("tileHeight").value) || 400;
  resizeCanvas();
}

function resizeCanvas() {
  const cw = DOM.canvas.container.clientWidth - 40;
  const ch = DOM.canvas.container.clientHeight - 40;
  const aspect = tileSize.w / tileSize.h;

  if (cw / ch > aspect) {
    DOM.canvas.el.height = ch;
    DOM.canvas.el.width = ch * aspect;
  } else {
    DOM.canvas.el.width = cw;
    DOM.canvas.el.height = cw / aspect;
  }
  drawCanvas();
}

function drawCanvas(time = 0) {
  const { width: w, height: h } = DOM.canvas.el;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  if (currentStatus.progress > 0) {
    const fillH = h * (currentStatus.progress / 100);
    const startY = h - fillH;
    const amplitude = 10 * Math.sin((currentStatus.progress / 100) * Math.PI);

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 5) {
      ctx.lineTo(x, startY + Math.sin(x * 0.02 + time * 0.003) * amplitude);
    }
    ctx.lineTo(w, h);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "rgba(139, 92, 246, 0.6)");
    grad.addColorStop(1, "rgba(249, 115, 22, 0.6)");
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.save();
  ctx.font = `bold ${w * 0.4}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1e293b";
  ctx.fillText(Math.round(currentStatus.progress), w / 2, h / 2);
  ctx.restore();
}

function renderLoop(time) {
  drawCanvas(time);
  requestAnimationFrame(renderLoop);
}


// ---------------------------------- Spray Sequence ----------------------------------

async function resumeSpraying() {
  logMsg("Melanjutkan proses semprot mesin...");
  const result = await sendData({}, "resume-spraying");
  if (result) {
    if (result.status) updateStatus(result.status);
    logMsg(result.message || "Spraying dilanjutkan ✅", !result.success);
  }
}

async function pauseSpraying() {
  logMsg("Meminta jeda proses semprot (Pause)...");
  const result = await sendData({}, "pause-spraying");
  if (result) {
    if (result.status) updateStatus(result.status);
    logMsg(result.message || "Spraying di-pause ⏸️", !result.success);
  }
}

DOM.spray.btnStart.addEventListener("click", async () => {
  if (connectionState !== "connected") {
    alert("Please connect to machine first.");
    return;
  }
  if (!currentStatus.startPoint) {
    alert("Please set starting point (G92) in Manual Page first.");
    return;
  }

  if (currentStatus.isSpraying && currentStatus.isPaused) {
    await resumeSpraying();
    return;
  }

  const panjang       = parseFloat(document.getElementById("tileWidth").value)   || 100;
  const lebar         = parseFloat(document.getElementById("tileHeight").value)  || 100;
  const speed         = parseInt(document.getElementById("jogSpeedInput").value) || 1000;
  const diameterSpray = parseFloat(document.getElementById("sprayRadius").value) || 17;

  logMsg("=== SENDING JOB TO MACHINE ===");
  logMsg(`Dimensi Genteng: ${panjang}x${lebar}mm @ F${speed}`);

  const result = await sendData(
    {
      panjang: panjang,
      lebar: lebar,
      diameter: diameterSpray,
      feed_rate: speed,
    },
    "start-spraying",
  );

  if (result && result.success) {
    currentStatus.seconds = 0;
    DOM.status.timer.innerText = "00:00:00";
    if (result.status) updateStatus(result.status);
  }
});

DOM.spray.btnPause.addEventListener("click", async () => {
  if (!currentStatus.isSpraying) return;

  if (!currentStatus.isPaused) {
    await pauseSpraying();
  } else {
    await resumeSpraying();
  }
});

async function triggerEstop() {
  if (connectionState !== "connected") return;

  logMsg("!!! EMERGENCY STOP !!!", true);
  const result = await sendData({}, "emergency-stop");

  if (result) {
    updateStatus(result);
    logMsg("Machine halted.", true);
  }

  document.body.classList.add("ring-4", "ring-inset", "ring-danger");
  setTimeout(
    () => document.body.classList.remove("ring-4", "ring-inset", "ring-danger"),
    500,
  );
}

DOM.btnEstopSidebar.addEventListener("click", triggerEstop);
DOM.spray.btnEstop.addEventListener("click", triggerEstop);


// ---------------------------------- Boot ----------------------------------

window.addEventListener("DOMContentLoaded", () => {
  console.log("DOM LOADED");
  lucide.createIcons();
  window.addEventListener("resize", resizeCanvas);

  updateStatusUI();
  updateConnectionUI();
  updateCanvasDim();

  setTimeout(() => {
    resizeCanvas();
    requestAnimationFrame(renderLoop);
    connectWebSocket();
  }, 100);
});