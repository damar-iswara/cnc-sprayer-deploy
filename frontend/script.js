// ======================= INIT =======================
lucide.createIcons();


// ======================= GLOBAL STATE =======================

const machineStatus = {
    pos:         [0.00, 0.00, 50.00],  // [x, y, z]
    wPos:        [0.00, 0.00, 0.00],
    wco:         [0.00, 0.00, 0.00],
    feed:        0,
    spindle:     0,
    connected:   false,
    lastReport:  '-',
    lastMessage: 'GRBL ready',
};

const sprayState = {
    isActive: false,
    isPaused: false,
    progress: 0,
    path:     [],
    seconds:  0,
    animId:   null,
};

const tileSize = {
    w: 300,
    h: 400,
};

const jogSettings = {
    step:  1,
    speed: 1200,
};

const constraints = {
    x: 150,
    y: 100,
    z: 40,
};

let hasStartPoint = false;
let constraintsOk = true;

// 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
let connectionState = 'disconnected';


// ======================= DOM ELEMENTS =======================

const DOM = {
    time: document.getElementById('currentTime'),

    conn: {
        dot:  document.getElementById('globalConnIndicator'),
        text: document.getElementById('globalConnText'),
    },

    spray: {
        connDot:       document.getElementById('connStatusDot'),
        connText:      document.getElementById('connStatusText'),
        btnConnect:    document.getElementById('btnConnect'),
        btnDisconnect: document.getElementById('btnDisconnect'),
        portSelect:    document.getElementById('portSelect'),
        btnStart:      document.getElementById('btnStartSpray'),
        btnPause:      document.getElementById('btnPauseSpray'),
        btnEstop:      document.getElementById('btnEstopSpray'),
        progBar:       document.getElementById('sprayProgressBar'),
        progTxt:       document.getElementById('sprayProgressTxt'),
        console:       document.getElementById('sprayConsole'),
    },

    canvas: {
        el:        document.getElementById('sprayCanvas'),
        container: document.getElementById('canvasContainer'),
    },

    status: {
        percent:    document.getElementById('manListPercent'),
        coords:     [
            document.getElementById('manListX'),
            document.getElementById('manListY'),
            document.getElementById('manListZ'),
        ],
        startPt:    document.getElementById('manListStartPt'),
        constraint: document.getElementById('manListConstraint'),
        speed:      document.getElementById('manListSpeed'),
        timer:      document.getElementById('manListTimer'),
    },

    manualConsole:   document.getElementById('manualConsole'),
    btnEstopSidebar: document.getElementById('estopBtnSidebar'),
};

const ctx = DOM.canvas.el.getContext('2d');


// ======================= WEBSOCKET =======================
// WebSocket otomatis terhubung saat halaman dibuka.
// Hanya untuk menerima status real-time dari backend,
// bukan untuk mengontrol koneksi serial port.

let ws = null;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    logMsg('Menghubungkan ke server...');

    ws.onopen = () => {
        logMsg('Terhubung ke server ✅');
        fetchAvailablePorts(); // Ambil daftar port saat WS siap
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Sinkronisasi status dari backend
        Object.assign(machineStatus, data);

        // Sinkronisasi posisi jika ada dari backend
        if (data.mPos) machineStatus.pos = [...data.mPos];

        // Update connectionState berdasarkan field 'connected' dari backend
        if (typeof data.connected === 'boolean') {
            const prev = connectionState;
            connectionState = data.connected ? 'connected' : 'disconnected';
            if (prev !== connectionState) updateConnectionUI();
        }

        updateStatusUI();
        if (typeof drawCoordinateGraph === 'function') drawCoordinateGraph();
    };

    ws.onclose = () => {
        logMsg('Koneksi ke server terputus ❌', true);
        // Coba reconnect setelah 3 detik
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
        logMsg('WebSocket error', true);
        console.error('WS Error:', err);
    };
}


// ======================= PORT MANAGEMENT =======================

async function fetchAvailablePorts() {
    try {
        const res   = await fetch('/ports');
        const ports = await res.json();

        DOM.spray.portSelect.innerHTML = '';

        if (ports.length === 0) {
            DOM.spray.portSelect.innerHTML = '<option value="">-- No ports found --</option>';
            logMsg('Tidak ada port serial yang tersedia.', true);
            return;
        }

        ports.forEach(p => {
            const opt = document.createElement('option');
            opt.value       = p.device;
            opt.textContent = `${p.device} — ${p.description}`;
            DOM.spray.portSelect.appendChild(opt);
        });

        logMsg(`${ports.length} port ditemukan.`);
    } catch (err) {
        logMsg('Gagal mengambil daftar port.', true);
        console.error('fetchAvailablePorts error:', err);
    }
}


// ======================= CONNECTION LOGIC =======================
// Tombol Connect/Disconnect mengontrol koneksi ke serial port
// melalui REST API backend, bukan WebSocket.

function updateConnectionUI() {
    const isConn         = connectionState === 'connected';
    const isConnecting   = connectionState === 'connecting';
    const isDisconnecting = connectionState === 'disconnecting';
    const isBusy         = isConnecting || isDisconnecting;

    // --- Global header indicator ---
    DOM.conn.dot.classList.toggle('bg-success',     isConn);
    DOM.conn.dot.classList.toggle('bg-warning',     isBusy);
    DOM.conn.dot.classList.toggle('bg-danger',      !isConn && !isBusy);
    DOM.conn.dot.classList.toggle('animate-pulse',  !isConn);

    if (isConn)            DOM.conn.text.innerText = 'CONNECTED';
    else if (isConnecting) DOM.conn.text.innerText = 'CONNECTING...';
    else                   DOM.conn.text.innerText = 'DISCONNECTED';

    DOM.conn.text.classList.toggle('text-success',    isConn);
    DOM.conn.text.classList.toggle('text-warning',    isConnecting);
    DOM.conn.text.classList.toggle('text-text-muted', !isConn && !isConnecting);

    // --- Spray page indicator ---
    DOM.spray.connDot.classList.toggle('bg-success', isConn);
    DOM.spray.connDot.classList.toggle('bg-warning',  isBusy);
    DOM.spray.connDot.classList.toggle('bg-danger',   !isConn && !isBusy);

    if (isConn)            DOM.spray.connText.innerText = 'Connected';
    else if (isConnecting) DOM.spray.connText.innerText = 'Connecting...';
    else                   DOM.spray.connText.innerText = 'Disconnected';

    // --- Buttons ---
    DOM.spray.btnConnect.classList.toggle('hidden',   isConn || isBusy);
    DOM.spray.btnDisconnect.classList.toggle('hidden', !isConn || isBusy);
    DOM.spray.btnConnect.disabled    = isBusy;
    DOM.spray.btnDisconnect.disabled = isBusy;
    DOM.spray.portSelect.disabled    = isConn || isBusy;
}

DOM.spray.btnConnect.addEventListener('click', async () => {
    if (connectionState !== 'disconnected') return;

    const port     = DOM.spray.portSelect.value;
    const baudrate = 115200; // default GRBL

    if (!port) { logMsg('Pilih port terlebih dahulu.', true); return; }

    connectionState = 'connecting';
    updateConnectionUI();
    logMsg(`Menghubungkan ke ${port} @ ${baudrate}bps...`);

    try {
        const res  = await fetch('/connect', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ port, baudrate }),
        });
        const data = await res.json();

        if (data.success) {
            connectionState = 'connected';
            logMsg(`Terhubung ke GRBL pada ${port} ✅`);
            logMsg(data.message, false, true);
            if (data.status) Object.assign(machineStatus, data.status);
        } else {
            connectionState = 'disconnected';
            logMsg(`Gagal terhubung: ${data.message}`, true);
        }
    } catch (err) {
        connectionState = 'disconnected';
        logMsg('Error saat menghubungkan ke backend.', true);
        console.error('Connect error:', err);
    }

    updateConnectionUI();
    updateStatusUI();
});

DOM.spray.btnDisconnect.addEventListener('click', async () => {
    if (connectionState !== 'connected') return;

    connectionState = 'disconnecting';
    updateConnectionUI();
    logMsg('Memutus koneksi serial port...');

    try {
        const res  = await fetch('/disconnect', { method: 'POST' });
        const data = await res.json();

        connectionState = 'disconnected';
        logMsg(data.success
            ? `Port diputus: ${data.message}`
            : `Gagal memutus: ${data.message}`,
            !data.success
        );
        if (data.status) Object.assign(machineStatus, data.status);
    } catch (err) {
        connectionState = 'disconnected';
        logMsg('Error saat memutus koneksi.', true);
        console.error('Disconnect error:', err);
    }

    updateConnectionUI();
    updateStatusUI();
});


// ======================= CLOCK & TIMER =======================

setInterval(() => {
    DOM.time.innerText = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

setInterval(() => {
    if (!sprayState.isActive || sprayState.isPaused) return;
    sprayState.seconds++;
    const [h, m, s] = [
        Math.floor(sprayState.seconds / 3600),
        Math.floor((sprayState.seconds % 3600) / 60),
        sprayState.seconds % 60,
    ].map(n => String(n).padStart(2, '0'));
    DOM.status.timer.innerText = `${h}:${m}:${s}`;
}, 1000);


// ======================= NAVIGATION =======================

function switchTab(tabId) {
    ['spray-page', 'manual-page'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== tabId);
    });

    const navSpray    = document.getElementById('nav-spray');
    const navManual   = document.getElementById('nav-manual');
    const activeNav   = tabId === 'spray-page' ? navSpray : navManual;
    const inactiveNav = tabId === 'spray-page' ? navManual : navSpray;

    const activeClasses   = ['bg-primary/10', 'text-primary', 'border-primary/20', 'shadow-sm'];
    const inactiveClasses = ['text-text-muted', 'border-transparent'];

    activeNav.classList.add(...activeClasses);
    activeNav.classList.remove(...inactiveClasses);
    inactiveNav.classList.add(...inactiveClasses);
    inactiveNav.classList.remove(...activeClasses);

    const getBadge = nav => nav.querySelectorAll('span')[1];
    getBadge(activeNav)?.classList.replace('bg-input-bg',    'bg-primary/20');
    getBadge(activeNav)?.classList.replace('text-text-muted','text-primary');
    getBadge(inactiveNav)?.classList.replace('bg-primary/20', 'bg-input-bg');
    getBadge(inactiveNav)?.classList.replace('text-primary',  'text-text-muted');

    if (tabId === 'spray-page') resizeCanvas();
}


// ======================= STATUS UPDATE =======================

function updateStatusUI() {
    const [x, y, z] = machineStatus.pos;

    DOM.status.coords[0].innerText  = x.toFixed(2);
    DOM.status.coords[1].innerText  = y.toFixed(2);
    DOM.status.coords[2].innerText  = z.toFixed(2);
    DOM.status.percent.innerText    = Math.round(sprayState.progress) + '%';
    DOM.status.startPt.innerText    = hasStartPoint ? 'True'  : 'False';
    DOM.status.constraint.innerText = constraintsOk  ? 'ON'   : 'OFF';
    DOM.status.speed.innerText      = jogSettings.speed.toFixed(1);
}


// ======================= CONSOLE LOGGING =======================

function logMsg(msg, isError = false, toManualOnly = false) {
    const time  = new Date().toLocaleTimeString('en-US', { hour12: false });
    const color = isError ? 'text-red-400 font-bold' : 'text-gray-300';
    const html  = `<div><span class="text-gray-500 mr-2">[${time}]</span><span class="${color}">${msg}</span></div>`;

    if (!toManualOnly) {
        DOM.spray.console.innerHTML += html;
        DOM.spray.console.scrollTop  = DOM.spray.console.scrollHeight;
    }
    DOM.manualConsole.innerHTML += html;
    DOM.manualConsole.scrollTop  = DOM.manualConsole.scrollHeight;
}

function clearConsole(id) {
    document.getElementById(id).innerHTML = '';
}


// ======================= MANUAL JOG =======================

function jog(dir) {
    if (connectionState !== 'connected') { logMsg('Cannot jog: Not connected.', true); return; }
    if (sprayState.isActive)             { logMsg('Cannot jog: Machine is busy.', true); return; }

    jogSettings.step  = parseFloat(document.getElementById('jogStepInput').value) || 1;
    jogSettings.speed = parseInt(document.getElementById('jogSpeedInput').value)   || 1200;

    const delta = {
        'X+': [ 1, 0, 0], 'X-': [-1, 0, 0],
        'Y+': [ 0, 1, 0], 'Y-': [ 0,-1, 0],
        'Z+': [ 0, 0, 1], 'Z-': [ 0, 0,-1],
    };
    const d = delta[dir];
    if (d) machineStatus.pos = machineStatus.pos.map((v, i) => v + d[i] * jogSettings.step);

    logMsg(`G91 G0 ${dir[0]}${dir[1] === '+' ? '' : '-'}${jogSettings.step} F${jogSettings.speed}`, false, true);
    updateStatusUI();
    drawCanvas();
}

function setStartingPoint() {
    if (connectionState !== 'connected') return;
    machineStatus.pos[0] = 0;
    machineStatus.pos[1] = 0;
    hasStartPoint = true;
    logMsg('G92 X0 Y0 (Set Zero)');
    updateStatusUI();
    drawCanvas();
}

function goHome() {
    if (connectionState !== 'connected') return;
    logMsg('G90 G0 X0 Y0 (Go to Start)');

    const interval = setInterval(() => {
        const [x, y] = machineStatus.pos;
        const dist   = Math.hypot(-x, -y);

        if (dist < 1) {
            machineStatus.pos[0] = 0;
            machineStatus.pos[1] = 0;
            clearInterval(interval);
            logMsg('Reached Start Point.');
        } else {
            machineStatus.pos[0] += (-x) * 0.2;
            machineStatus.pos[1] += (-y) * 0.2;
        }
        updateStatusUI();
        drawCanvas();
    }, 50);
}


// ======================= SPRAY CANVAS =======================

function updateCanvasDim() {
    tileSize.w = parseInt(document.getElementById('tileWidth').value)  || 300;
    tileSize.h = parseInt(document.getElementById('tileHeight').value) || 400;
    logMsg(`Dimensions set to ${tileSize.w}mm x ${tileSize.h}mm`);
    resizeCanvas();
}

function resizeCanvas() {
    const cw     = DOM.canvas.container.clientWidth  - 40;
    const ch     = DOM.canvas.container.clientHeight - 40;
    const aspect = tileSize.w / tileSize.h;

    if (cw / ch > aspect) {
        DOM.canvas.el.height = ch;
        DOM.canvas.el.width  = ch * aspect;
    } else {
        DOM.canvas.el.width  = cw;
        DOM.canvas.el.height = cw / aspect;
    }
    drawCanvas();
}

function drawCanvas(time = 0) {
    const { width: w, height: h } = DOM.canvas.el;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (sprayState.progress > 0) {
        const fillH     = h * (sprayState.progress / 100);
        const startY    = h - fillH;
        const amplitude = 10 * Math.sin((sprayState.progress / 100) * Math.PI);

        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 5) {
            ctx.lineTo(x, startY + Math.sin(x * 0.02 + time * 0.003) * amplitude);
        }
        ctx.lineTo(w, h);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, 'rgba(139, 92, 246, 0.6)');
        grad.addColorStop(1, 'rgba(249, 115, 22, 0.6)');
        ctx.fillStyle = grad;
        ctx.fill();
    }

    ctx.save();
    ctx.font         = `bold ${w * 0.4}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#1e293b';
    ctx.fillText(Math.round(sprayState.progress), w / 2, h / 2);
    ctx.restore();
}

function renderLoop(time) {
    drawCanvas(time);
    requestAnimationFrame(renderLoop);
}


// ======================= SPRAY SEQUENCE =======================

DOM.spray.btnStart.addEventListener('click', () => {
    if (connectionState !== 'connected') { alert('Please connect to machine first.'); return; }
    if (!hasStartPoint)                  { alert('Please set starting point (G92) in Manual Page first.'); return; }

    if (sprayState.isActive && sprayState.isPaused) {
        sprayState.isPaused = false;
        DOM.spray.btnPause.innerHTML = '<i data-lucide="pause" class="w-4 h-4"></i><span>PAUSE</span>';
        DOM.spray.btnPause.className = 'px-6 py-2.5 bg-warning hover:bg-yellow-500 text-white shadow-md shadow-warning/30 rounded-xl transition-all font-bold text-sm flex items-center justify-center space-x-2';
        logMsg('Spray Resumed.');
        lucide.createIcons();
        return;
    }

    Object.assign(sprayState, { isActive: true, isPaused: false, path: [], progress: 0, seconds: 0 });
    machineStatus.pos[0] = 0;
    machineStatus.pos[1] = 0;
    DOM.status.timer.innerText = '00:00:00';

    DOM.spray.btnStart.disabled = true;
    DOM.spray.btnStart.classList.add('opacity-50');
    DOM.spray.btnPause.classList.remove('hidden');

    logMsg('=== SPRAY JOB STARTED ===');
    logMsg(`Target: ${tileSize.w}x${tileSize.h}mm`);
    simulateSprayPath();
});

DOM.spray.btnPause.addEventListener('click', () => {
    if (!sprayState.isActive) return;
    sprayState.isPaused = !sprayState.isPaused;

    if (sprayState.isPaused) {
        DOM.spray.btnPause.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i><span>RESUME</span>';
        DOM.spray.btnPause.className = 'px-6 py-2.5 bg-success hover:bg-green-500 text-white shadow-md shadow-success/30 rounded-xl transition-all font-bold text-sm flex items-center justify-center space-x-2';
        logMsg('Spray Paused.');
    } else {
        DOM.spray.btnStart.click();
    }
    lucide.createIcons();
});

function triggerEstop() {
    if (connectionState !== 'connected') return;
    Object.assign(sprayState, { isActive: false, isPaused: false });
    cancelAnimationFrame(sprayState.animId);

    DOM.spray.btnStart.disabled = false;
    DOM.spray.btnStart.classList.remove('opacity-50');
    DOM.spray.btnPause.classList.add('hidden');

    logMsg('!!! EMERGENCY STOP !!!', true);
    logMsg('Machine halted.', true);

    document.body.classList.add('ring-4', 'ring-inset', 'ring-danger');
    setTimeout(() => document.body.classList.remove('ring-4', 'ring-inset', 'ring-danger'), 500);
}

DOM.btnEstopSidebar.addEventListener('click', triggerEstop);
DOM.spray.btnEstop.addEventListener('click', triggerEstop);

function simulateSprayPath() {
    const passWidth  = 40;
    const targetPath = [];
    let currentY     = 0;
    let movingRight  = true;

    while (currentY <= tileSize.h) {
        targetPath.push({ x: movingRight ? tileSize.w : 0, y: currentY });
        movingRight = !movingRight;
        currentY   += passWidth;
        if (currentY <= tileSize.h) {
            targetPath.push({ x: movingRight ? 0 : tileSize.w, y: currentY });
        }
    }
    targetPath.push({ x: movingRight ? tileSize.w : 0, y: tileSize.h });

    let targetIdx  = 0;
    const simSpeed = 200;
    let lastTime   = performance.now();

    function step(time) {
        if (!sprayState.isActive) return;
        requestAnimationFrame(step);
        if (sprayState.isPaused) { lastTime = time; return; }

        const dt       = (time - lastTime) / 1000;
        lastTime       = time;
        const target   = targetPath[targetIdx];
        const dx       = target.x - machineStatus.pos[0];
        const dy       = target.y - machineStatus.pos[1];
        const dist     = Math.hypot(dx, dy);
        const moveDist = simSpeed * dt;

        if (dist <= moveDist) {
            machineStatus.pos[0] = target.x;
            machineStatus.pos[1] = target.y;
            sprayState.path.push({ x: target.x, y: target.y });
            targetIdx++;

            if (targetIdx >= targetPath.length) {
                sprayState.isActive = false;
                sprayState.progress = 100;
                updateProgressUI();
                DOM.spray.btnStart.disabled = false;
                DOM.spray.btnStart.classList.remove('opacity-50');
                DOM.spray.btnPause.classList.add('hidden');
                logMsg('=== SPRAY JOB COMPLETED ===');
                logMsg('G0 X0 Y0 (Returning to home)');
                goHome();
                return;
            }
        } else {
            machineStatus.pos[0] += (dx / dist) * moveDist;
            machineStatus.pos[1] += (dy / dist) * moveDist;
            sprayState.path.push({ x: machineStatus.pos[0], y: machineStatus.pos[1] });
            sprayState.progress = Math.min(99, (machineStatus.pos[1] / tileSize.h) * 100);
        }

        updateStatusUI();
        updateProgressUI();
        drawCanvas();
    }

    sprayState.animId = requestAnimationFrame(step);
}

function updateProgressUI() {
    const p = Math.round(sprayState.progress);
    DOM.spray.progTxt.innerText   = p + '%';
    DOM.spray.progBar.style.width = p + '%';
}


// ======================= BOOT =======================

window.addEventListener('resize', resizeCanvas);
updateStatusUI();
updateConnectionUI();

setTimeout(() => {
    resizeCanvas();
    requestAnimationFrame(renderLoop);
}, 100);

updateCanvasDim();

// WebSocket auto-connect saat halaman dibuka
connectWebSocket();