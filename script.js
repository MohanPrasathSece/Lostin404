// Lightweight Matrix-style Falling Code Background (disabled in favor of neon grid)
const canvas = document.getElementById('matrix-rain');
const ctx = canvas.getContext('2d');
// Offscreen buffer to apply slice glitches without redrawing characters twice
const buffer = document.createElement('canvas');
const bctx = buffer.getContext('2d');

function resizeMatrixCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    buffer.width = canvas.width;
    buffer.height = canvas.height;
    initMatrix();
}

// === PUZZLE 3: SIGNAL ROUTING (rotate tiles to connect START->GOAL) ===
let route = {
    size: 6,
    grid: [], // 2D of tiles {type, rot, conns: {u,d,l,r}, el}
    start: { r: 0, c: 0 },
    goal: { r: 0, c: 0 },
    moves: 0,
    gridEl: null,
    movesEl: null,
    statusEl: null,
    containerEl: null,
};

const TILE_TYPES = [
    { key: 'straight', base: { u: true, d: true, l: false, r: false } },
    { key: 'straight', base: { u: true, d: true, l: false, r: false } }, // weight straight 2x
    { key: 'elbow',   base: { u: true, r: true, d: false, l: false } },
    { key: 'elbow',   base: { u: true, r: true, d: false, l: false } }, // weight elbow 2x
    { key: 'tee',     base: { u: true, l: true, r: true, d: false } },
    { key: 'cross',   base: { u: true, d: true, l: true, r: true } },
];

function rotConns(base, rot) {
    // rot: 0,1,2,3 (clockwise 90deg steps)
    const map = [ 'u','r','d','l' ];
    const idx = { u:0, r:1, d:2, l:3 };
    const out = { u:false, r:false, d:false, l:false };
    for (const dir of ['u','r','d','l']) {
        if (base[dir]) {
            const newIdx = (idx[dir] + rot) % 4;
            out[ map[newIdx] ] = true;
        }
    }
    return out;
}

function placeTile(r, c, typeKey, rot) {
    const t = TILE_TYPES.find(t => t.key === typeKey) || TILE_TYPES[0];
    return { type: typeKey, rot: rot|0, conns: rotConns(t.base, rot|0), el: null, r, c };
}

function carvePath(size, start, goal) {
    // random path from start to goal biased to the right
    const path = [ { ...start } ];
    let { r, c } = start;
    while (r !== goal.r || c !== goal.c) {
        const choices = [];
        if (c < goal.c) choices.push('r','r'); // bias right
        if (r < goal.r) choices.push('d');
        if (r > goal.r) choices.push('u');
        // add some randomness
        choices.push('r','u','d');
        const dir = choices[Math.floor(Math.random()*choices.length)];
        let nr = r, nc = c;
        if (dir === 'r' && c+1 < size) nc++;
        else if (dir === 'u' && r-1 >= 0) nr--;
        else if (dir === 'd' && r+1 < size) nr++;
        else if (dir === 'l' && c-1 >= 0) nc--; // rarely used
        if (nr === r && nc === c) continue;
        r = nr; c = nc;
        if (!path.find(p => p.r===r && p.c===c)) path.push({ r, c });
    }
    return path;
}

function tileForStep(prev, curr, next) {
    // create a tile that connects prev->curr->next
    const dx1 = Math.sign(curr.c - prev.c);
    const dy1 = Math.sign(curr.r - prev.r);
    const dx2 = Math.sign((next?.c ?? curr.c) - curr.c);
    const dy2 = Math.sign((next?.r ?? curr.r) - curr.r);
    const need = new Set();
    if (dx1===0 && dy1<0) need.add('u');
    if (dx1===0 && dy1>0) need.add('d');
    if (dx1<0 && dy1===0) need.add('l');
    if (dx1>0 && dy1===0) need.add('r');
    if (dx2===0 && dy2<0) need.add('u');
    if (dx2===0 && dy2>0) need.add('d');
    if (dx2<0 && dy2===0) need.add('l');
    if (dx2>0 && dy2===0) need.add('r');
    const needed = Array.from(need);
    // choose type that supports all needed directions, then find rotation
    const candidates = ['cross','tee','elbow','straight'];
    for (const key of candidates) {
        const base = TILE_TYPES.find(t => t.key===key).base;
        for (let rot=0; rot<4; rot++) {
            const cc = rotConns(base, rot);
            if (needed.every(d => cc[d])) {
                return placeTile(curr.r, curr.c, key, rot);
            }
        }
    }
    return placeTile(curr.r, curr.c, 'cross', 0);
}

function randomTile(r,c) {
    const t = TILE_TYPES[Math.floor(Math.random()*TILE_TYPES.length)];
    return placeTile(r,c, t.key, Math.floor(Math.random()*4));
}

function renderRouteGrid() {
    const n = route.size;
    route.gridEl.innerHTML = '';
    route.gridEl.style.setProperty('--size', String(n));
    for (let r=0;r<n;r++) {
        for (let c=0;c<n;c++) {
            const tile = route.grid[r][c];
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'route-cell';
            if (r===route.start.r && c===route.start.c) el.classList.add('start');
            if (r===route.goal.r && c===route.goal.c) el.classList.add('goal');
            el.dataset.r = String(r); el.dataset.c = String(c);
            tile.el = el;
            el.addEventListener('click', () => {
                tile.rot = (tile.rot + 1) % 4;
                const base = TILE_TYPES.find(t => t.key===tile.type).base;
                tile.conns = rotConns(base, tile.rot);
                route.moves++;
                updateRouteUI();
                checkRoute();
            });
            route.gridEl.appendChild(el);
        }
    }
    paintRouteConns();
}

function paintRouteConns() {
    const n = route.size;
    for (let r=0;r<n;r++) {
        for (let c=0;c<n;c++) {
            const tile = route.grid[r][c];
            const el = tile.el;
            el.classList.remove('conn-u','conn-d','conn-l','conn-r','active');
            for (const d of ['u','d','l','r']) {
                if (tile.conns[d]) el.classList.add('conn-'+d);
            }
        }
    }
}

function neighbors(r,c) {
    return [
        { r:r-1, c, d:'u', od:'d' },
        { r:r+1, c, d:'d', od:'u' },
        { r, c:c-1, d:'l', od:'r' },
        { r, c:c+1, d:'r', od:'l' },
    ];
}

function checkRoute() {
    const n = route.size;
    // clear active marks
    for (let r=0;r<n;r++) for (let c=0;c<n;c++) route.grid[r][c].el.classList.remove('active');
    // BFS
    const q = [];
    const seen = Array.from({length:n},()=>Array(n).fill(false));
    q.push(route.start); seen[route.start.r][route.start.c] = true;
    while (q.length) {
        const cur = q.shift();
        const tile = route.grid[cur.r][cur.c];
        tile.el.classList.add('active');
        if (cur.r===route.goal.r && cur.c===route.goal.c) {
            setRouteStatus('POWERED', true);
            appendTerminal('> SIGNAL ROUTING SOLVED: Network online', false);
            route.containerEl.classList.add('route-solved');
            return true;
        }
        for (const nb of neighbors(cur.r, cur.c)) {
            if (nb.r<0||nb.c<0||nb.r>=n||nb.c>=n) continue;
            if (seen[nb.r][nb.c]) continue;
            const A = route.grid[cur.r][cur.c].conns;
            const B = route.grid[nb.r][nb.c].conns;
            if (A[nb.d] && B[nb.od]) {
                seen[nb.r][nb.c] = true;
                q.push({ r: nb.r, c: nb.c });
            }
        }
    }
    setRouteStatus('INCOMPLETE', false);
    route.containerEl.classList.remove('route-solved');
    return false;
}

function setRouteStatus(text, solved) {
    if (route.statusEl) {
        route.statusEl.textContent = text;
        route.statusEl.style.color = solved ? 'var(--accent-yellow)' : 'var(--text-secondary)';
    }
    if (route.movesEl) route.movesEl.textContent = String(route.moves);
}

function newRouteLayout() {
    const n = route.size;
    route.moves = 0;
    route.containerEl.classList.remove('route-solved');
    // choose start left edge mid, goal right edge mid
    route.start = { r: Math.floor(n/2), c: 0 };
    route.goal  = { r: Math.floor(n/2), c: n-1 };
    // empty grid random
    route.grid = Array.from({length:n}, (_,r)=>Array.from({length:n},(_,c)=>randomTile(r,c)));
    // carve guaranteed path
    const path = carvePath(n, route.start, route.goal);
    for (let i=1;i<path.length-1;i++) {
        const prev = path[i-1], curr = path[i], next = path[i+1];
        route.grid[curr.r][curr.c] = tileForStep(prev, curr, next);
    }
    // ensure start connects towards next
    if (path.length>1) {
        route.grid[path[0].r][path[0].c] = tileForStep(path[0], path[0], path[1]);
        route.grid[path[path.length-1].r][path[path.length-1].c] = tileForStep(path[path.length-2], path[path.length-1], path[path.length-1]);
    }
    renderRouteGrid();
    checkRoute();
}

function initRoutePuzzle(size=6) {
    route.size = size;
    route.gridEl = document.getElementById('routeGrid');
    route.movesEl = document.getElementById('routeMoves');
    route.statusEl = document.getElementById('routeStatus');
    route.containerEl = document.querySelector('#routePuzzle .puzzle-container');
    const newBtn = document.getElementById('routeNew');
    if (!route.gridEl || !route.movesEl || !route.statusEl || !route.containerEl) return;
    newBtn && newBtn.addEventListener('click', newRouteLayout);
    newRouteLayout();
}
// Use canvas for a neon letter rain background with shatter impacts
const disableMatrix = false; // enable matrix-style background
canvas.style.display = '';

const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz{}[]<>;:/$#=+-%|\\';
let fontSize = 16;
let columns = 0;
let drops = [];
let dropSpeeds = [];

function initMatrix() {
    columns = Math.floor(canvas.width / fontSize);
    drops = new Array(columns).fill(0).map(() => Math.random() * -50);
    dropSpeeds = new Array(columns).fill(0).map(() => 2 + Math.random() * 3); // 2..5 px/frame
}

resizeMatrixCanvas();
window.addEventListener('resize', () => { resizeMatrixCanvas(); shatterLast = 0; });

let last = 0;
const frameInterval = 1000 / 30; // ~30 FPS for perf
let glitchTimer = 0;
let glitchSlices = [];

function triggerGlitch() {
    glitchSlices = [];
    const count = Math.floor(Math.random() * 2) + 1; // 1-2 slices
    for (let i = 0; i < count; i++) {
        const h = Math.floor(Math.random() * 24) + 8; // 8-32px height
        const y = Math.floor(Math.random() * (canvas.height - h));
        const offset = Math.floor(Math.random() * 26) - 13; // -13..13 px
        glitchSlices.push({ y, h, offset });
    }
    glitchTimer = 6; // frames
}

function drawMatrix(ts) {
    if (disableMatrix) return;
    if (!last) last = ts;
    const delta = ts - last;
    if (delta < frameInterval) {
        requestAnimationFrame(drawMatrix);
        return;
    }
    last = ts;

    // Draw to buffer first
    bctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    bctx.fillRect(0, 0, canvas.width, canvas.height);

    bctx.fillStyle = '#00ff88';
    bctx.font = `${fontSize}px monospace`;

    for (let i = 0; i < columns; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        // slight per-column jitter when glitch active to simulate breaking
        const jx = glitchTimer > 0 ? (Math.random() * 2 - 1) : 0;
        bctx.fillText(text, x + jx, y);

        if (y > canvas.height) {
            // impact: spawn shards near bottom
            if (Math.random() > 0.7) triggerShatter(x, canvas.height - 4, 6 + Math.floor(Math.random()*6), 0.8);
            drops[i] = Math.random() * -20;
            dropSpeeds[i] = 2 + Math.random() * 3;
        }
        drops[i] += dropSpeeds[i];
    }

    // Blit buffer to visible canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buffer, 0, 0);

    // Apply a couple of horizontal break slices occasionally
    if (glitchTimer > 0) {
        for (const slice of glitchSlices) {
            ctx.drawImage(
                buffer,
                0, slice.y, canvas.width, slice.h,
                slice.offset, slice.y, canvas.width, slice.h
            );
        }
        glitchTimer--;
    } else if (Math.random() > 0.992) {
        triggerGlitch();
    }

    // Step and render shards over the rain
    const dt = frameInterval / 1000;
    stepShards(dt);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of shards) {
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        const a = Math.max(0, Math.min(1, s.life));
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 0.45 * a;
        ctx.fillRect(-s.w * 0.5, -s.h * 0.5, s.w, s.h);
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.restore();

    requestAnimationFrame(drawMatrix);
}

requestAnimationFrame(drawMatrix);
const reduceMotion = true;
const disableShatterEffects = true;

// Toggle background animations only while any shake animation runs
let __activeShakeAnimations = 0;
function __updateBodyShakingClass() {
    const body = document.body;
    if (__activeShakeAnimations > 0) body.classList.add('shaking');
    else body.classList.remove('shaking');
}

function __onAnimStart(e) {
    try {
        if (!e || !e.animationName) return;
        if (/shake/i.test(e.animationName)) {
            __activeShakeAnimations++;
            __updateBodyShakingClass();
        }
    } catch (_) {}
}

function __onAnimEnd(e) {
    try {
        if (!e || !e.animationName) return;
        if (/shake/i.test(e.animationName)) {
            __activeShakeAnimations = Math.max(0, __activeShakeAnimations - 1);
            __updateBodyShakingClass();
        }
    } catch (_) {}
}

document.addEventListener('animationstart', __onAnimStart, true);
document.addEventListener('animationend', __onAnimEnd, true);
document.addEventListener('animationcancel', __onAnimEnd, true);

// === Aggressive Shatter & Fall Background ===
let shards = [];
let shatterLast = 0;
const SHATTER_FPS = 60;
const SHATTER_INTERVAL = 1000 / SHATTER_FPS;
let shatterTimer = 0;

function spawnShard(x, y, power = 1) {
    if (disableShatterEffects) return;
    const ang = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 6 + 4) * power;
    shards.push({
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - (6 * power),
        w: 6 + Math.random() * 10,
        h: 6 + Math.random() * 14,
        rot: Math.random() * Math.PI,
        rv: (Math.random() - 0.5) * 0.2,
        life: 1,
        color: Math.random() > 0.5 ? '#00ff88' : '#ff0055'
    });
    if (shards.length > 320) shards.shift();
}

function triggerShatter(cx, cy, count = 80, power = 1) {
    if (disableShatterEffects) return;
    for (let i = 0; i < count; i++) {
        const jitterX = cx + (Math.random() * 120 - 60);
        const jitterY = cy + (Math.random() * 60 - 30);
        spawnShard(jitterX, jitterY, power);
    }
}

function stepShards(dt) {
    const g = 18; // gravity
    const air = 0.995;
    for (const s of shards) {
        s.vy += g * dt;
        s.vx *= air; s.vy *= air;
        s.x += s.vx; s.y += s.vy;
        s.rot += s.rv;
        // fade as it falls
        s.life -= 0.35 * dt;
    }
    // remove dead or far below
    shards = shards.filter(s => s.life > 0 && s.y < canvas.height + 120);
}

function drawShatterFall(ts) {
    if (!shatterLast) shatterLast = ts;
    const dtms = ts - shatterLast;
    if (dtms < SHATTER_INTERVAL) { requestAnimationFrame(drawShatterFall); return; }
    const dt = dtms / 1000;
    shatterLast = ts;
    shatterTimer += dt;

    // clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // periodic random shatters
    if (shatterTimer > 1.2) {
        shatterTimer = 0;
        const cx = Math.random() * canvas.width;
        const cy = Math.random() * (canvas.height * 0.6);
        triggerShatter(cx, cy, 90, 1.1);
    }
    // gentle debris rain
    if (Math.random() > 0.8) spawnShard(Math.random() * canvas.width, -20, 0.6);

    stepShards(dt);

    // draw shards
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of shards) {
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        const a = Math.max(0, Math.min(1, s.life));
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 0.45 * a;
        ctx.fillRect(-s.w * 0.5, -s.h * 0.5, s.w, s.h);
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.restore();

    requestAnimationFrame(drawShatterFall);
}

function startShatterFall() {
    if (disableShatterEffects) return;
    if (!canvas.width || !canvas.height) resizeMatrixCanvas();
    shards = [];
    shatterLast = 0; shatterTimer = 0;
    // initial big shatter from hero center-ish
    const hx = window.innerWidth * 0.5;
    const hy = window.innerHeight * 0.35;
    triggerShatter(hx, hy, 140, 1.3);
    requestAnimationFrame(drawShatterFall);
}

// Terminal Animation
const terminalOutput = document.getElementById('terminal-output');
const terminalMessages = [
    { text: '> Initializing system...', delay: 1200, error: false },
    { text: '> Scanning for utilities...', delay: 1400, error: false },
    { text: '> Error: utility.exe not found', delay: 1300, error: true },
    { text: '> Attempting bypass...', delay: 1200, error: false },
    { text: '> Access denied: permission level insufficient', delay: 1400, error: true },
    { text: '> Fetching roadmap...', delay: 1400, error: false },
    { text: '> Error: file missing', delay: 1200, error: true },
    { text: '> Retrying with root access...', delay: 1300, error: false },
    { text: '> Error: firewall breach detected', delay: 1400, error: true },
    { text: '> Loading backup protocol...', delay: 1300, error: false },
    { text: '> Error: memory allocation failed', delay: 1400, error: true },
    { text: '> Searching for alternatives...', delay: 1300, error: false },
    { text: '> Error: connection timeout', delay: 1400, error: true },
    { text: '> Running diagnostic --deep', delay: 1300, error: false },
    { text: '> Error: segmentation fault in module core', delay: 1400, error: true },
    { text: '> Recompiling plan...', delay: 1200, error: false },
    { text: '> Error: invalid opcode executed', delay: 1400, error: true },
    { text: '> Requesting help...', delay: 1200, error: false },
    { text: '> Error: null pointer exception', delay: 1400, error: true },
    { text: '> Terminating session...', delay: 1500, error: false }
];

let messageIndex = 0;

function typeTerminalMessage() {
    if (messageIndex < terminalMessages.length) {
        const message = terminalMessages[messageIndex];
        const line = document.createElement('div');
        line.className = `terminal-line ${message.error ? 'terminal-error' : ''}`;
        line.textContent = message.text;
        line.classList.add('terminal-newline');
        terminalOutput.appendChild(line);
        // Auto-scroll rules: always for errors, otherwise only if near bottom
        if (message.error) {
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        } else if (shouldAutoScroll(terminalOutput)) {
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }
        setTimeout(() => line.classList.remove('terminal-newline'), 600);

        // Mirror to browser console as well
        if (message.error) { __mirrorLock = true; console.error(message.text); __mirrorLock = false; }
        else console.log(message.text);
        
        messageIndex++;
        
        setTimeout(typeTerminalMessage, message.delay);
    } else {
        // Loop without clearing to keep all messages visible
        setTimeout(() => {
            messageIndex = 0;
            typeTerminalMessage();
        }, 2000);
    }
}

// Drop a clickable utility key into the terminal once, if not unlocked
let utilityKeyDropped = false;
function scheduleUtilityKey() {
    if (progress.utility) return;
    if (utilityKeyDropped) return;
    utilityKeyDropped = true;
    setTimeout(() => {
        const line = document.createElement('div');
        line.className = 'terminal-line';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '[KEY-UTIL]';
        btn.style.fontFamily = 'monospace';
        btn.style.background = 'transparent';
        btn.style.border = '1px dashed var(--accent-green)';
        btn.style.color = 'var(--accent-green)';
        btn.style.padding = '2px 6px';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => {
            unlock('utility');
        });
        line.append('> ', btn, ' — click to claim');
        terminalOutput.appendChild(line);
        if (shouldAutoScroll(terminalOutput)) {
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }
    }, 2200);
}

// Start terminal animation when page loads
window.addEventListener('load', () => {
    setTimeout(typeTerminalMessage, 500);
    
    // Initialize game elements
    initializeGameElements();
    // Play landing animation once on load
    try { playLandingShatter(); } catch (e) { console.error(e); }
    // Initialize memory puzzle game
    try { initMemoryPuzzle(); } catch (e) { console.error(e); }
    // Signal routing puzzle removed
    // Apply meta-puzzle progress and maybe drop terminal key
    try { loadProgress(); applyLocks(); updateRoadmap(); scheduleUtilityKey(); } catch (e) { console.error(e); }
    // Start aggressive shatter+fall background
    try { startShatterFall(); } catch (e) { console.error(e); }
});

// Buy Token Button
function buyToken() {
    showPopup('> Connecting to Raydium...<br>> Error: wallet not found<br>> Please install a Solana wallet first<br><br>(This is a demo - no real transaction)');
}

// Retry Button
function retryLoad() {
    const hero = document.querySelector('.hero');
    hero.style.opacity = '0';
    
    setTimeout(() => {
        showPopup('> Retrying...<br>> Still nothing found<br>> Error: 404 remains 404<br>> System working as intended');
        hero.style.opacity = '1';
    }, 300);
}

// Whitepaper Button
function openWhitepaper() {
    try {
        window.open('https://404-5.gitbook.io/404-docs/', '_blank');
    } catch (e) {
        showPopup('> Loading whitepaper.pdf...<br>> Error: File not found (0kb)<br>> Download failed<br>> Reason: File does not exist<br>> Status: Intentionally missing');
    }
}

// Top-right actions
function openTwitter() {
    try {
        window.open('https://x.com/lostin404', '_blank');
    } catch (e) {
        showPopup('> Unable to open Twitter');
    }
}

function scrollDown() {
    const target = document.querySelector('#roadmap') || document.querySelector('section:nth-of-type(2)');
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Popup Functions
function showPopup(message) {
    const popup = document.getElementById('error-popup');
    const popupMessage = document.getElementById('popup-message');
    popupMessage.innerHTML = message;
    popup.classList.add('active');
}

function closePopup() {
    const popup = document.getElementById('error-popup');
    popup.classList.remove('active');
}

// Close popup on background click
document.getElementById('error-popup').addEventListener('click', (e) => {
    if (e.target.id === 'error-popup') {
        closePopup();
    }
});

// Close popup on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePopup();
    }
});

// Easter Egg: Help Command
let keyBuffer = '';
const helpCommand = 'help';

document.addEventListener('keypress', (e) => {
    keyBuffer += e.key.toLowerCase();
    
    // Keep buffer limited to command length
    if (keyBuffer.length > helpCommand.length) {
        keyBuffer = keyBuffer.slice(-helpCommand.length);
    }
    
    // Check if help command was typed
    if (keyBuffer === helpCommand) {
        showPopup('> help command not recognized<br>> Available commands: none<br>> Error: help.exe missing<br>> Suggestion: give up');
        keyBuffer = '';
    }
});

// Random Glitch Effect
function randomGlitch() {
    const glitchElements = document.querySelectorAll('.glitch');
    const randomElement = glitchElements[Math.floor(Math.random() * glitchElements.length)];
    
    if (randomElement) {
        randomElement.style.animation = 'none';
        setTimeout(() => {
            randomElement.style.animation = '';
        }, 10);
    }
}

// Trigger random glitches
if (!reduceMotion) {
    setInterval(randomGlitch, 5000);
}

// Social Link Interactions
const socialLinks = document.querySelectorAll('.social-link');
socialLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        if (link.dataset.real === 'true') {
            // allow real external link to proceed
            return;
        }
        e.preventDefault();
        const errorMsg = link.getAttribute('data-error');
        showPopup(`> Attempting to connect...<br>> ${errorMsg}<br>> Connection failed<br>> Please try again never`);
    });
});

// Tokenomics wheel: no click or hover error

// Cursor Flicker Effect
function flickerCursor() {
    const cursors = document.querySelectorAll('.cursor');
    cursors.forEach(cursor => {
        if (Math.random() > 0.95) {
            cursor.style.opacity = '0';
            setTimeout(() => {
                cursor.style.opacity = '1';
            }, 50);
        }
    });
}

if (!reduceMotion) {
    setInterval(flickerCursor, 100);
}

// Screen Flicker Effect (rare)
function screenFlicker() {
    if (Math.random() > 0.98) {
        document.body.style.opacity = '0.8';
        setTimeout(() => {
            document.body.style.opacity = '1';
        }, 50);
    }
}

if (!reduceMotion) {
    setInterval(screenFlicker, 1000);
}

// Console Easter Eggs
console.log('%c> System initialized', 'color: #00ff88; font-family: monospace;');
console.log('%c> Warning: Nothing works here', 'color: #ff0055; font-family: monospace;');
console.log('%c> Error: Purpose not found', 'color: #ff3333; font-family: monospace;');
console.log('%c> $404 - The only coin that failed on purpose', 'color: #8800ff; font-family: monospace; font-weight: bold;');

// Add loading message
window.addEventListener('DOMContentLoaded', () => {
    console.log('%c> DOM loaded successfully (surprisingly)', 'color: #00ff88; font-family: monospace;');
});

// Konami Code Easter Egg (up, up, down, down, left, right, left, right, b, a)
let konamiCode = [];
const konamiSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

document.addEventListener('keydown', (e) => {
    konamiCode.push(e.key);
    
    if (konamiCode.length > konamiSequence.length) {
        konamiCode.shift();
    }
    
    if (JSON.stringify(konamiCode) === JSON.stringify(konamiSequence)) {
        showPopup('> Konami code detected<br>> Unlocking secret utility...<br>> Error: Still no utility found<br>> Nice try though<br>> Achievement unlocked: Wasted time');
        konamiCode = [];
        
        // Add extra glitch effect
        document.body.style.animation = 'glitchText 0.3s';
        setTimeout(() => {
            document.body.style.animation = '';
        }, 300);
    }
});

// Prevent right-click (optional - adds to the mysterious vibe)
// Uncomment if you want this feature
/*
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showPopup('> Right-click disabled<br>> Error: Context menu not found<br>> This is intentional');
});
*/

// Random error messages in console
const randomErrors = [
    'Warning: Utility module failed to load',
    'Error: Purpose.js not found',
    'Critical: Roadmap.exe has stopped working',
    'Alert: Team members have left the chat',
    'Notice: Whitepaper.pdf is corrupted',
    'Error: Success rate: 0%'
];

function logRandomError() {
    const error = randomErrors[Math.floor(Math.random() * randomErrors.length)];
    console.error(`%c> ${error}`, 'color: #ff3333; font-family: monospace;');
}

// Log random errors every 10-30 seconds
setInterval(logRandomError, Math.random() * 20000 + 10000);

// Smooth scroll behavior
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Static scroll handler - only minimal effects as per original brief
// Original brief: "Static feel - no scrolling effects"
let lastScrollTop = 0;
window.addEventListener('scroll', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    // No scroll effects as per original brief
    lastScrollTop = scrollTop;
}, { passive: true });

// Functions removed for static feel as per original brief

// Intense RGB Split Effect on random elements
function createRGBSplit() {
    const elements = document.querySelectorAll('.section-title, .logo, .stat-value');
    const randomElement = elements[Math.floor(Math.random() * elements.length)];
    
    if (randomElement) {
        randomElement.style.textShadow = `
            -2px 0 0 #ff0055,
            2px 0 0 #00ff88,
            0 0 20px rgba(0, 255, 136, 0.5)
        `;
        
        setTimeout(() => {
            randomElement.style.textShadow = '';
        }, 100);
    }
}

if (!reduceMotion) {
    setInterval(createRGBSplit, 3000);
}

// Random chromatic aberration effect
function chromaticAberration() {
    const sections = document.querySelectorAll('section');
    const randomSection = sections[Math.floor(Math.random() * sections.length)];
    
    if (randomSection && Math.random() > 0.95) {
        randomSection.style.filter = 'hue-rotate(90deg) saturate(1.5)';
        setTimeout(() => {
            randomSection.style.filter = '';
        }, 50);
    }
}

if (!reduceMotion) {
    setInterval(chromaticAberration, 500);
}

// Create floating glitch particles
function createGlitchParticle() {
    const particle = document.createElement('div');
    particle.style.position = 'fixed';
    particle.style.width = Math.random() * 100 + 50 + 'px';
    particle.style.height = '2px';
    particle.style.background = Math.random() > 0.5 ? '#00ff88' : '#ff0055';
    particle.style.left = Math.random() * window.innerWidth + 'px';
    particle.style.top = Math.random() * window.innerHeight + 'px';
    particle.style.opacity = '0.5';
    particle.style.zIndex = '0';
    particle.style.pointerEvents = 'none';
    particle.style.boxShadow = `0 0 10px ${particle.style.background}`;
    
    document.body.appendChild(particle);
    
    setTimeout(() => {
        particle.style.transition = 'all 0.5s';
        particle.style.opacity = '0';
        particle.style.transform = 'translateY(' + (Math.random() * 200 - 100) + 'px)';
    }, 10);
    
    setTimeout(() => {
        particle.remove();
    }, 600);
}

// Create glitch particles occasionally
if (!reduceMotion) {
    setInterval(() => {
        if (Math.random() > 0.7) {
            createGlitchParticle();
        }
    }, 2000);
}

// Intense screen shake on specific intervals
function screenShake() {
    if (Math.random() > 0.98) {
        document.body.style.transform = 'translate(' + (Math.random() * 4 - 2) + 'px, ' + (Math.random() * 4 - 2) + 'px)';
        setTimeout(() => {
            document.body.style.transform = '';
        }, 50);
    }
}

if (!reduceMotion) {
    setInterval(screenShake, 100);
}

// Add neon glow pulse to random elements
function neonPulse() {
    const cards = document.querySelectorAll('.stat-card, .team-card, .legend-item');
    const randomCard = cards[Math.floor(Math.random() * cards.length)];
    
    if (randomCard && Math.random() > 0.9) {
        const originalShadow = randomCard.style.boxShadow;
        randomCard.style.boxShadow = '0 0 40px rgba(0, 255, 136, 0.8), 0 0 80px rgba(0, 255, 136, 0.4)';
        
        setTimeout(() => {
            randomCard.style.boxShadow = originalShadow;
        }, 200);
    }
}

if (!reduceMotion) {
    setInterval(neonPulse, 1500);
}

// Terminal Hover Effects (disabled)
const terminal = document.querySelector('.terminal');

// === Global error mirroring into terminal and browser console ===
function appendTerminal(text, isError = false) {
    if (!terminalOutput) return;
    const line = document.createElement('div');
    line.className = `terminal-line ${isError ? 'terminal-error' : ''}`;
    line.textContent = text;
    line.classList.add('terminal-newline');
    terminalOutput.appendChild(line);
    if (isError) {
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    } else if (shouldAutoScroll(terminalOutput)) {
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
    setTimeout(() => line.classList.remove('terminal-newline'), 600);
}

// Capture runtime JS errors
window.addEventListener('error', (e) => {
    const msg = e?.message || 'Unknown error';
    appendTerminal(`> JS Error: ${msg}`, true);
    // let default console still show full stack
});

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
    const reason = (e && (e.reason?.message || e.reason)) || 'Unhandled rejection';
    appendTerminal(`> Promise Rejection: ${reason}`, true);
});

// Mirror console.error to terminal as well (with guard to avoid double-echo)
let __mirrorLock = false;
const __origConsoleError = console.error.bind(console);
console.error = (...args) => {
    if (!__mirrorLock) {
        appendTerminal('> ' + args.map(String).join(' '), true);
    }
    __origConsoleError(...args);
};

// determine if we should auto-scroll terminal (user near bottom)
function shouldAutoScroll(el) {
    const threshold = 16; // px from bottom
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

// === 404 MINI GAME: SYSTEM COLLAPSE (ENHANCED) ===
let gameState = {
    running: false,
    score: 0,
    health: 100,
    playerPos: 50, // percentage
    errors: [],
    powerUps: [],
    gameSpeed: 1,
    spawnRate: 0.02,
    combo: 0,
    maxCombo: 0,
    shield: 0,
    doublePoints: 0,
    wave: 1,
    bossActive: false
};

const errorTypes = [
    { text: '404', points: 10, color: '#ff0055', size: 'normal' },
    { text: 'NULL', points: 15, color: '#ff3333', size: 'normal' },
    { text: 'SEGV', points: 20, color: '#ff6600', size: 'normal' },
    { text: 'OOM', points: 25, color: '#ff9900', size: 'normal' },
    { text: 'FAIL', points: 12, color: '#cc0044', size: 'normal' },
    { text: 'ERR', points: 8, color: '#990033', size: 'small' },
    { text: 'BUG', points: 30, color: '#ff0088', size: 'large' }
];

const powerUpTypes = [
    { text: 'SHIELD', color: '#00ff88', effect: 'shield' },
    { text: '2X', color: '#ffaa00', effect: 'double' },
    { text: 'HEAL', color: '#0088ff', effect: 'heal' },
    { text: 'SLOW', color: '#8800ff', effect: 'slow' }
];

const bossErrors = [
    { text: 'KERNEL PANIC', health: 3, points: 100, color: '#ff0000' },
    { text: 'STACK OVERFLOW', health: 4, points: 150, color: '#ff4400' },
    { text: 'SYSTEM CRASH', health: 5, points: 200, color: '#ff0088' }
];
// Wait for DOM to be ready before getting elements
let gameArea, player, scoreEl, healthEl, statusEl, instructions;

function initializeGameElements() {
    gameArea = document.getElementById('gameArea');
    player = document.getElementById('player');
    scoreEl = document.getElementById('score');
    healthEl = document.getElementById('health');
    statusEl = document.getElementById('status');
    instructions = document.getElementById('instructions');
    
    console.log('Game elements initialized:', {
        gameArea: !!gameArea,
        player: !!player,
        scoreEl: !!scoreEl,
        healthEl: !!healthEl,
        statusEl: !!statusEl,
        instructions: !!instructions
    });
    
    // Set initial status
    if (statusEl) statusEl.textContent = 'READY';
    addTouchControls();
}

function addTouchControls() {
    if (!gameArea || !player) return;
    const setByX = (clientX) => {
        const rect = gameArea.getBoundingClientRect();
        let x = (clientX - rect.left) / rect.width;
        x = Math.max(0, Math.min(1, x));
        gameState.playerPos = x * 100;
        player.style.left = gameState.playerPos + '%';
    };
    gameArea.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        if (t) setByX(t.clientX);
        if (!gameState.running) startGame();
        e.preventDefault();
    }, { passive: false });
    gameArea.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        if (t) setByX(t.clientX);
        e.preventDefault();
    }, { passive: false });
}

// Game controls
const keys = {};
document.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ' && !gameState.running) {
        e.preventDefault();
        startGame();
    }
});
document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
});

function startGame() {
    if (gameState.running) return;
    
    // Initialize elements if not already done
    if (!gameArea) initializeGameElements();
    
    // Check if all elements exist
    if (!gameArea || !player || !scoreEl || !healthEl || !statusEl) {
        console.error('Game elements not found!');
        appendTerminal('> Error: Game elements not found', true);
        return;
    }
    
    gameState = {
        running: true,
        score: 0,
        health: 100,
        playerPos: 50,
        errors: [],
        powerUps: [],
        gameSpeed: 1,
        spawnRate: 0.02,
        combo: 0,
        maxCombo: 0,
        shield: 0,
        doublePoints: 0,
        wave: 1,
        bossActive: false
    };
    
    if (instructions) instructions.style.display = 'none';
    statusEl.textContent = 'ACTIVE';
    statusEl.style.color = 'var(--accent-green)';
    
    // Remove any existing game over screen
    const gameOver = gameArea.querySelector('.game-over');
    if (gameOver) gameOver.remove();
    
    appendTerminal('> Game started successfully', false);
    gameLoop();
}

function resetGame() {
    gameState.running = false;
    gameState.errors.forEach(error => error.element.remove());
    gameState.powerUps.forEach(powerUp => powerUp.element.remove());
    gameState.errors = [];
    gameState.powerUps = [];
    gameState.score = 0;
    gameState.health = 100;
    gameState.playerPos = 50;
    gameState.combo = 0;
    gameState.maxCombo = 0;
    gameState.shield = 0;
    gameState.doublePoints = 0;
    gameState.wave = 1;
    gameState.bossActive = false;
    
    updateUI();
    instructions.style.display = 'block';
    statusEl.textContent = 'READY';
    statusEl.style.color = 'var(--text-secondary)';
    
    const gameOver = gameArea.querySelector('.game-over');
    if (gameOver) gameOver.remove();
    
    // Reset player position and remove any effects
    player.style.left = '50%';
    player.style.boxShadow = '';
    gameArea.classList.remove('system-collapse');
}

// Update UI and handle timers/buffs
function updateUI() {
    if (scoreEl) scoreEl.textContent = String(gameState.score);
    if (healthEl) {
        const h = Math.max(0, Math.min(100, Math.round(gameState.health)));
        healthEl.textContent = h + '%';
        healthEl.style.color = h <= 30 ? 'var(--error-red)' : 'var(--accent-green)';
    }
    if (statusEl) {
        let status = gameState.running ? 'ACTIVE' : 'READY';
        if (gameState.doublePoints > 0) status = '2X POINTS';
        if (gameState.shield > 0) status = `SHIELD x${gameState.shield}`;
        statusEl.textContent = status;
        statusEl.style.color = gameState.running ? 'var(--accent-green)' : 'var(--text-secondary)';
    }
    // decrement timers
    if (gameState.doublePoints > 0) gameState.doublePoints--;
}

function spawnError() {
    const errorType = errorTypes[Math.floor(Math.random() * errorTypes.length)];
    const errorEl = document.createElement('div');
    errorEl.className = 'falling-error';
    errorEl.textContent = errorType.text;
    errorEl.style.left = Math.random() * (gameArea.offsetWidth - 80) + 'px';
    errorEl.style.backgroundColor = errorType.color;
    errorEl.style.animation = `errorFall ${3 - gameState.gameSpeed * 0.5}s linear forwards`;
    
    if (errorType.size === 'small') {
        errorEl.style.width = '60px';
        errorEl.style.fontSize = '0.7rem';
    } else if (errorType.size === 'large') {
        errorEl.style.width = '100px';
        errorEl.style.fontSize = '0.9rem';
        errorEl.style.fontWeight = 'bold';
    }
    
    gameArea.appendChild(errorEl);
    
    gameState.errors.push({
        element: errorEl,
        type: errorType,
        x: parseFloat(errorEl.style.left),
        y: -30,
        speed: 2 + gameState.gameSpeed
    });
}

function spawnPowerUp() {
    if (Math.random() > 0.15) return; // 15% chance
    
    const powerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
    const powerUpEl = document.createElement('div');
    powerUpEl.className = 'falling-powerup';
    powerUpEl.textContent = powerUp.text;
    powerUpEl.style.left = Math.random() * (gameArea.offsetWidth - 80) + 'px';
    powerUpEl.style.backgroundColor = powerUp.color;
    powerUpEl.style.animation = `errorFall ${4}s linear forwards`;
    
    gameArea.appendChild(powerUpEl);
    
    gameState.powerUps.push({
        element: powerUpEl,
        type: powerUp,
        x: parseFloat(powerUpEl.style.left),
        y: -30
    });
}

function spawnBoss() {
    if (gameState.bossActive) return;
    
    const boss = bossErrors[Math.floor(Math.random() * bossErrors.length)];
    const bossEl = document.createElement('div');
    bossEl.className = 'falling-error boss-error';
    bossEl.textContent = boss.text;
    bossEl.style.left = '50%';
    bossEl.style.transform = 'translateX(-50%)';
    bossEl.style.backgroundColor = boss.color;
    bossEl.style.width = '200px';
    bossEl.style.height = '60px';
    bossEl.style.fontSize = '1rem';
    bossEl.style.fontWeight = 'bold';
    bossEl.style.animation = `errorFall 8s linear forwards`;
    
    gameArea.appendChild(bossEl);
    
    gameState.errors.push({
        element: bossEl,
        type: { ...boss, isBoss: true, currentHealth: boss.health },
        x: parseFloat(bossEl.style.left),
        y: -60,
        speed: 1
    });
    
    gameState.bossActive = true;
    appendTerminal(`> BOSS ERROR DETECTED: ${boss.text}`, true);
}

function activatePowerUp(powerUp) {
    switch (powerUp.effect) {
        case 'shield':
            gameState.shield += 3;
            appendTerminal('> SHIELD ACTIVATED - 3 hits protected', false);
            break;
        case 'double':
            gameState.doublePoints = 300; // 5 seconds at 60fps
            appendTerminal('> DOUBLE POINTS ACTIVATED', false);
            break;
        case 'heal':
            gameState.health = Math.min(100, gameState.health + 30);
            appendTerminal('> SYSTEM REPAIRED +30 health', false);
            break;
        case 'slow':
            gameState.gameSpeed = Math.max(0.5, gameState.gameSpeed - 0.5);
            appendTerminal('> TIME DILATION ACTIVATED', false);
            break;
    }
    
    // Visual effect
    player.style.boxShadow = `0 0 20px ${powerUp.color}`;
    setTimeout(() => player.style.boxShadow = '', 500);
}

function createComboEffect(combo) {
    const comboEl = document.createElement('div');
    comboEl.className = 'combo-effect';
    comboEl.textContent = `${combo}x COMBO!`;
    comboEl.style.position = 'absolute';
    comboEl.style.top = '20px';
    comboEl.style.left = '50%';
    comboEl.style.transform = 'translateX(-50%)';
    comboEl.style.color = '#ffaa00';
    comboEl.style.fontSize = '1.5rem';
    comboEl.style.fontWeight = 'bold';
    comboEl.style.textShadow = '0 0 10px #ffaa00';
    comboEl.style.animation = 'comboFloat 2s ease-out forwards';
    comboEl.style.zIndex = '20';
    
    gameArea.appendChild(comboEl);
    setTimeout(() => comboEl.remove(), 2000);
}

function updatePlayer() {
    // Handle movement
    if (keys['a'] || keys['arrowleft']) {
        gameState.playerPos = Math.max(0, gameState.playerPos - 2);
    }
    if (keys['d'] || keys['arrowright']) {
        gameState.playerPos = Math.min(100, gameState.playerPos + 2);
    }
    
    player.style.left = gameState.playerPos + '%';
}

function updateErrors() {
    const playerRect = player.getBoundingClientRect();
    const gameAreaRect = gameArea.getBoundingClientRect();
    
    gameState.errors = gameState.errors.filter(error => {
        const errorRect = error.element.getBoundingClientRect();
        
        // Check collision with player
        if (errorRect.bottom >= playerRect.top &&
            errorRect.top <= playerRect.bottom &&
            errorRect.right >= playerRect.left &&
            errorRect.left <= playerRect.right) {
            
            if (error.type.isBoss) {
                // Boss hit - reduce health
                error.type.currentHealth--;
                if (error.type.currentHealth <= 0) {
                    gameState.score += error.type.points * (gameState.doublePoints > 0 ? 2 : 1);
                    gameState.combo += 5;
                    error.element.remove();
                    gameState.bossActive = false;
                    appendTerminal(`> BOSS DEFEATED! +${error.type.points} points`, false);
                    // Unlock Team on boss defeat
                    unlock('team');
                    return false;
                } else {
                    // Boss still alive, just flash
                    error.element.style.filter = 'brightness(2)';
                    setTimeout(() => error.element.style.filter = '', 100);
                }
                return true;
            } else {
                // Regular error caught
                const points = error.type.points * (gameState.doublePoints > 0 ? 2 : 1);
                gameState.score += points;
                gameState.combo++;
                if (gameState.combo > gameState.maxCombo) gameState.maxCombo = gameState.combo;
                
                error.element.remove();
                
                // Combo effects
                if (gameState.combo >= 10) {
                    createComboEffect(gameState.combo);
                }
                
                // Screen shake effect
                document.body.classList.add('shake-burst');
                setTimeout(() => document.body.classList.remove('shake-burst'), 200);
                
                return false;
            }
        }
        
        // Check if error hit bottom
        if (errorRect.top > gameAreaRect.bottom) {
            if (gameState.shield > 0) {
                gameState.shield--;
            } else {
                gameState.health -= error.type.isBoss ? 30 : 10;
            }
            gameState.combo = 0; // Break combo
            error.element.remove();
            
            if (error.type.isBoss) gameState.bossActive = false;
            
            // Add system damage effect
            if (gameState.health <= 30) {
                gameArea.classList.add('system-collapse');
            }
            
            return false;
        }
        
        return true;
    });
    
    // Update power-ups
    gameState.powerUps = gameState.powerUps.filter(powerUp => {
        const powerUpRect = powerUp.element.getBoundingClientRect();
        
        // Check collision with player
        if (powerUpRect.bottom >= playerRect.top &&
            powerUpRect.top <= playerRect.bottom &&
            powerUpRect.right >= playerRect.left &&
            powerUpRect.left <= playerRect.right) {
            
            // Activate power-up
            activatePowerUp(powerUp.type);
            powerUp.element.remove();
            return false;
        }
        
        // Remove if off screen
        if (powerUpRect.top > gameAreaRect.bottom) {
            powerUp.element.remove();
            return false;
        }
        
        return true;
    });
}

function gameOver() {
    gameState.running = false;
    gameArea.classList.remove('system-collapse');
    
    const gameOverEl = document.createElement('div');
    gameOverEl.className = 'game-over';
    gameOverEl.innerHTML = `
        <h3>SYSTEM COLLAPSED</h3>
        <p>Final Score: ${gameState.score}</p>
        <p>Max Combo: ${gameState.maxCombo}x</p>
        <p>Wave Reached: ${gameState.wave}</p>
        <p>Final Health: ${gameState.health}%</p>
        <p>Press REBOOT to try again</p>
    `;
    
    gameArea.appendChild(gameOverEl);
    
    // Log to terminal
    appendTerminal(`> Game Over - Score: ${gameState.score}, Max Combo: ${gameState.maxCombo}x, Wave: ${gameState.wave}`, true);
}

function gameLoop() {
    if (!gameState.running) return;
    
    if (gameState.health <= 0) {
        gameOver();
        return;
    }
    
    // Spawn errors
    if (Math.random() < gameState.spawnRate) {
        spawnError();
    }
    
    // Spawn power-ups occasionally
    if (Math.random() < 0.005) {
        spawnPowerUp();
    }
    
    // Spawn boss every 500 points (with a flag to prevent multiple spawns)
    if (gameState.score >= 500 && Math.floor(gameState.score / 500) > Math.floor((gameState.score - 10) / 500) && !gameState.bossActive) {
        spawnBoss();
    }
    
    updatePlayer();
    updateErrors();
    updateUI();
    
    // Wave progression
    const newWave = Math.floor(gameState.score / 200) + 1;
    if (newWave > gameState.wave) {
        gameState.wave = newWave;
        appendTerminal(`> WAVE ${gameState.wave} - Difficulty increased`, false);
    }
    
    // Increase difficulty over time
    gameState.gameSpeed += 0.001;
    gameState.spawnRate = Math.min(0.08, gameState.spawnRate + 0.0001);
    // Unlock Team if score threshold reached
    if (!progress.team && gameState.score >= 300) unlock('team');
    
    requestAnimationFrame(gameLoop);
}

// Landing animation: hacking theme "everything breaking into pieces"
function playLandingShatter() {
    const overlay = document.querySelector('.glitch-overlay');
    const hero = document.querySelector('.hero');
    
    // Create typing sequence in hero
    const typingEl = document.createElement('div');
    typingEl.className = 'landing-typing';
    typingEl.style.position = 'absolute';
    typingEl.style.top = '50%';
    typingEl.style.left = '50%';
    typingEl.style.transform = 'translate(-50%, -50%)';
    typingEl.style.fontSize = '2rem';
    typingEl.style.color = 'var(--accent-green)';
    typingEl.style.fontFamily = 'IBM Plex Mono, monospace';
    typingEl.style.zIndex = '999';
    typingEl.style.textShadow = '0 0 10px var(--accent-green)';
    
    const messages = ['Initializing hack...', 'Loading code...', 'Error: 404 detected', 'Bypassing security...', 'System breach!'];
    let messageIndex = 0;
    
    function typeMessage(msg, callback) {
        typingEl.textContent = '';
        let i = 0;
        const interval = setInterval(() => {
            typingEl.textContent += msg[i];
            i++;
            if (i === msg.length) {
                clearInterval(interval);
                setTimeout(callback, 500);
            }
        }, 100);
    }
    
    function nextMessage() {
        if (messageIndex < messages.length) {
            typeMessage(messages[messageIndex], () => {
                messageIndex++;
                setTimeout(nextMessage, 300);
            });
        } else {
            // After typing, trigger burst
            typingEl.remove();
            triggerLandingBurst();
        }
    }
    
    hero.appendChild(typingEl);
    nextMessage();
    
    // Show glitch overlay briefly
    if (overlay) {
        overlay.style.display = 'block';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'none';
        overlay.style.animation = 'glitchOverlay 1.5s ease-in-out';
    }
    
    // Screen shake pulses
    const shakes = 6;
    for (let i = 0; i < shakes; i++) {
        setTimeout(() => {
            document.body.classList.add('shake-burst');
            setTimeout(() => document.body.classList.remove('shake-burst'), 350);
        }, 500 + i * 200);
    }
    
    // Hide overlay after
    setTimeout(() => { if (overlay) overlay.style.display = 'none'; }, 2000);
}

function triggerLandingBurst() {
    const bursts = 120;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    let hx = centerX, hy = centerY;
    const hero = document.querySelector('.hero');
    if (hero) {
        const r = hero.getBoundingClientRect();
        hx = r.left + r.width / 2;
        hy = r.top + r.height / 2;
    }
    for (let i = 0; i < bursts; i++) {
        const t = i * 5;
        setTimeout(() => createBreakParticle(hx + (Math.random()*100-50), hy + (Math.random()*50-25)), t);
        if (i % 4 === 0) setTimeout(() => createBreakParticle(centerX, centerY), t + 2);
    }
}

// Enhanced breaking effects for sections
const tokenomicsSection = document.querySelector('.tokenomics');
const teamSection = document.querySelector('.team');
const pieChart = document.querySelector('.pie-chart');
const teamCards = document.querySelectorAll('.team-card');
const legendItems = document.querySelectorAll('.legend-item');
const hoverShakeTargets = document.querySelectorAll('.team-image, img');

// Scroll-triggered full-site shake (throttled)
let lastScrollShake = 0;
let scrollShakeScheduled = false;
const SCROLL_SHAKE_COOLDOWN = 250; // ms

window.addEventListener('scroll', () => {
    const now = performance.now();
    if (now - lastScrollShake < SCROLL_SHAKE_COOLDOWN || scrollShakeScheduled) return;
    lastScrollShake = now;
    scrollShakeScheduled = true;
    requestAnimationFrame(() => {
        document.body.classList.remove('shake-burst');
        void document.body.offsetWidth;
        document.body.classList.add('shake-burst');
        setTimeout(() => {
            document.body.classList.remove('shake-burst');
            scrollShakeScheduled = false;
        }, 320);
    });
}, { passive: true });

// Full-screen shake on image hover (short burst)
let shakeTimeoutId;
hoverShakeTargets.forEach(el => {
    el.addEventListener('mouseenter', () => {
        document.body.classList.remove('shake-burst');
        // restart animation by reflow
        // eslint-disable-next-line no-unused-expressions
        void document.body.offsetWidth;
        document.body.classList.add('shake-burst');
        clearTimeout(shakeTimeoutId);
        shakeTimeoutId = setTimeout(() => {
            document.body.classList.remove('shake-burst');
        }, 320);
    });
});

// Tokenomics hover effects - DISABLED

// Pie chart hover effects - DISABLED

// Legend items hover effects - DISABLED

// Team section hover effects (only on hover, not scroll)
if (teamSection) {
    teamSection.addEventListener('mouseenter', () => {
        if (reduceMotion) return;
        document.body.style.filter = 'contrast(1.2) brightness(0.9) blur(0.5px)';
        setTimeout(() => {
            document.body.style.filter = '';
        }, 400);
        for (let i = 0; i < 8; i++) {
            setTimeout(() => createBreakParticle(), i * 80);
        }
    });
}

// Team cards hover effects (only on hover, not scroll)
teamCards.forEach((card, index) => {
    card.addEventListener('mouseenter', () => {
        if (reduceMotion) return;
        setTimeout(() => {
            const rect = card.getBoundingClientRect();
            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    createBreakParticle(
                        rect.left + Math.random() * rect.width,
                        rect.top + Math.random() * rect.height
                    );
                }, i * 120);
            }
        }, index * 120);
    });
});

// Create breaking particle effect with hacking theme
function createBreakParticle(x = Math.random() * window.innerWidth, y = Math.random() * window.innerHeight) {
    if (reduceMotion) return;
    const particle = document.createElement('span');
    particle.className = 'hacking-code';
    particle.style.position = 'fixed';
    particle.style.left = x + 'px';
    particle.style.top = y + 'px';
    particle.style.fontSize = (Math.random() * 20 + 10) + 'px';
    particle.style.fontFamily = 'IBM Plex Mono, monospace';
    particle.style.zIndex = '1000';
    particle.style.pointerEvents = 'none';
    particle.style.userSelect = 'none';
    
    // Hacking-themed text: random chars or code snippets
    const codeSnippets = ['if (error)', '404', 'null', 'crash()', 'hack()', 'bug', 'fix', 'code', 'data', 'loop'];
    const text = Math.random() > 0.5 ? chars[Math.floor(Math.random() * chars.length)] : codeSnippets[Math.floor(Math.random() * codeSnippets.length)];
    particle.textContent = text;
    
    document.body.appendChild(particle);
    
    // Animate with hacking burst
    particle.classList.add('hacking-burst');
    
    // Gravity and movement
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 300 + 150;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed + Math.random() * 100;
    
    let currentX = x;
    let currentY = y;
    let gravity = 0;
    
    function animate() {
        gravity += 0.5;
        currentX += vx * 0.015;
        currentY += (vy + gravity) * 0.015;
        
        particle.style.left = currentX + 'px';
        particle.style.top = currentY + 'px';
        particle.style.opacity = Math.max(0, parseFloat(particle.style.opacity || 1) - 0.015);
        particle.style.transform = `scale(${Math.max(0.3, 1 - (currentY - y) / 800)}) rotate(${currentY * 2}deg)`;
        
        if (parseFloat(particle.style.opacity) > 0 && currentY < window.innerHeight + 100) {
            requestAnimationFrame(animate);
        } else {
            particle.remove();
        }
    }
    
    requestAnimationFrame(animate);
}

// === PUZZLE: CIRCUIT UNLOCK (Lights Out variant) ===
let puzzle = {
    size: 5,
    state: [],
    initial: [],
    moves: 0,
    gridEl: null,
    movesEl: null,
    statusEl: null,
    containerEl: null,
};

function initPuzzle(size = 5) {
    puzzle.size = size;
    puzzle.gridEl = document.getElementById('puzzleGrid');
    puzzle.movesEl = document.getElementById('puzzleMoves');
    puzzle.statusEl = document.getElementById('puzzleStatus');
    puzzle.containerEl = document.querySelector('.puzzle-container');
    const newBtn = document.getElementById('puzzleNew');
    const resetBtn = document.getElementById('puzzleReset');

    if (!puzzle.gridEl || !puzzle.movesEl || !puzzle.statusEl || !puzzle.containerEl) {
        console.warn('Puzzle elements missing');
        return;
    }

    newBtn && newBtn.addEventListener('click', newPuzzle);
    resetBtn && resetBtn.addEventListener('click', resetPuzzle);

    // Build empty state
    puzzle.state = Array.from({ length: size }, () => Array(size).fill(false));
    puzzle.initial = puzzle.state.map(row => row.slice());
    puzzle.moves = 0;
    renderPuzzle();
    newPuzzle();
}

function renderPuzzle() {
    const n = puzzle.size;
    puzzle.gridEl.innerHTML = '';
    puzzle.gridEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'puzzle-cell ' + (puzzle.state[r][c] ? 'active' : 'inactive');
            cell.setAttribute('role', 'gridcell');
            cell.setAttribute('aria-pressed', String(!!puzzle.state[r][c]));
            cell.dataset.r = String(r);
            cell.dataset.c = String(c);
            cell.textContent = puzzle.state[r][c] ? '■' : '□';
            cell.addEventListener('click', () => toggleAt(r, c, true));
            puzzle.gridEl.appendChild(cell);
        }
    }
    updatePuzzleUI();
}

function updatePuzzleUI() {
    if (puzzle.movesEl) puzzle.movesEl.textContent = String(puzzle.moves);
    const n = puzzle.size;
    const cells = puzzle.gridEl.querySelectorAll('.puzzle-cell');
    let idx = 0;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const el = cells[idx++];
            if (!el) continue;
            el.classList.toggle('active', !!puzzle.state[r][c]);
            el.classList.toggle('inactive', !puzzle.state[r][c]);
            el.setAttribute('aria-pressed', String(!!puzzle.state[r][c]));
            el.textContent = puzzle.state[r][c] ? '■' : '□';
        }
    }
}

function setPuzzleStatus(text, colorVar) {
    if (!puzzle.statusEl) return;
    puzzle.statusEl.textContent = text;
    puzzle.statusEl.style.color = colorVar || 'var(--accent-green)';
}

function flip(r, c) {
    const n = puzzle.size;
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    puzzle.state[r][c] = !puzzle.state[r][c];
}

function toggleAt(r, c, countMove) {
    flip(r, c);
    flip(r - 1, c);
    flip(r + 1, c);
    flip(r, c - 1);
    flip(r, c + 1);
    if (countMove) puzzle.moves++;
    updatePuzzleUI();
    checkPuzzleWin();
}

function checkPuzzleWin() {
    const n = puzzle.size;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (!puzzle.state[r][c]) {
                setPuzzleStatus('INCOMPLETE', 'var(--text-secondary)');
                puzzle.containerEl.classList.remove('puzzle-solved');
                return false;
            }
        }
    }
    setPuzzleStatus('UNLOCKED', 'var(--accent-yellow)');
    puzzle.containerEl.classList.add('puzzle-solved');
    appendTerminal('> PUZZLE SOLVED: Circuit unlocked', false);
    return true;
}

function newPuzzle() {
    const n = puzzle.size;
    // start from all true goal, then apply random toggles to generate solvable state
    puzzle.state = Array.from({ length: n }, () => Array(n).fill(true));
    // apply K random toggles
    const K = n * n; // reasonable shuffle
    for (let i = 0; i < K; i++) {
        const r = Math.floor(Math.random() * n);
        const c = Math.floor(Math.random() * n);
        toggleAt(r, c, false);
    }
    puzzle.initial = puzzle.state.map(row => row.slice());
    puzzle.moves = 0;
    renderPuzzle();
    setPuzzleStatus('INCOMPLETE', 'var(--text-secondary)');
    puzzle.containerEl.classList.remove('puzzle-solved');
    appendTerminal('> New puzzle generated', false);
}

function resetPuzzle() {
    if (!puzzle.initial.length) return;
    puzzle.state = puzzle.initial.map(row => row.slice());
    puzzle.moves = 0;
    renderPuzzle();
    setPuzzleStatus('INCOMPLETE', 'var(--text-secondary)');
    puzzle.containerEl.classList.remove('puzzle-solved');
    appendTerminal('> Puzzle reset', false);
}

// === MEMORY MATCH PUZZLE (Hacking Symbols) ===
let mem = {
    symbols: ['<>', '{}', '[]', '()','//', '::', '==', '||', '&&', '$$', '##', '++'],
    deck: [], // {id, symbol, matched}
    flipped: [], // indices of flipped (max 2)
    lock: false,
    moves: 0,
    gridEl: null,
    movesEl: null,
    statusEl: null,
};

function initMemoryPuzzle() {
    mem.gridEl = document.getElementById('puzzleGrid');
    mem.movesEl = document.getElementById('puzzleMoves');
    mem.statusEl = document.getElementById('puzzleStatus');
    const newBtn = document.getElementById('puzzleNew');
    const resetBtn = document.getElementById('puzzleReset');
    if (!mem.gridEl || !mem.movesEl || !mem.statusEl) return;
    newBtn && newBtn.addEventListener('click', newMemoryPuzzle);
    resetBtn && resetBtn.addEventListener('click', resetMemoryPuzzle);
    newMemoryPuzzle();
}

function buildDeck() {
    const base = mem.symbols.slice(0, 10); // 10 pairs => 20 cards (fits 5x4 nicely)
    const pairs = base.flatMap((s, i) => ([{ id: i*2, symbol: s, matched: false }, { id: i*2+1, symbol: s, matched: false }]));
    // shuffle
    for (let i = pairs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    return pairs;
}

function renderMemory() {
    mem.gridEl.innerHTML = '';
    // set grid to 5 columns, 4 rows
    mem.gridEl.style.gridTemplateColumns = 'repeat(5, 1fr)';
    mem.deck.forEach((card, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'puzzle-cell memory-card' + (card.matched ? ' matched' : '');
        btn.dataset.index = String(idx);
        btn.setAttribute('aria-pressed', 'false');
        btn.textContent = '■'; // hidden face
        btn.addEventListener('click', onCardClick);
        mem.gridEl.appendChild(btn);
    });
    updateMemoryUI();
}

function updateMemoryUI() {
    if (mem.movesEl) mem.movesEl.textContent = String(mem.moves);
    if (!mem.statusEl) return;
    const allMatched = mem.deck.length > 0 && mem.deck.every(c => c.matched);
    mem.statusEl.textContent = allMatched ? 'UNLOCKED' : 'INCOMPLETE';
    mem.statusEl.style.color = allMatched ? 'var(--accent-yellow)' : 'var(--text-secondary)';
    if (allMatched) {
        appendTerminal('> MEMORY MATCH SOLVED: Access granted', false);
        unlock('tokenomics');
    }
}

function onCardClick(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (mem.lock) return;
    const card = mem.deck[idx];
    if (!card || card.matched) return;
    const already = mem.flipped.includes(idx);
    if (already) return;
    flipCardUI(idx, true);
    mem.flipped.push(idx);
    if (mem.flipped.length === 2) {
        mem.lock = true;
        mem.moves++;
        const [a, b] = mem.flipped.map(i => mem.deck[i]);
        if (a.symbol === b.symbol) {
            setTimeout(() => {
                a.matched = b.matched = true;
                markMatchedUI(mem.flipped);
                mem.flipped = [];
                mem.lock = false;
                updateMemoryUI();
            }, 250);
        } else {
            setTimeout(() => {
                flipCardUI(mem.flipped[0], false);
                flipCardUI(mem.flipped[1], false);
                mem.flipped = [];
                mem.lock = false;
                updateMemoryUI();
            }, 600);
        }
    }
}

function flipCardUI(index, faceUp) {
    const btn = mem.gridEl.querySelector(`.memory-card[data-index="${index}"]`);
    if (!btn) return;
    const card = mem.deck[index];
    if (!card) return;
    if (faceUp) {
        btn.classList.add('flipped');
        btn.textContent = card.symbol;
    } else {
        btn.classList.remove('flipped');
        btn.textContent = '■';
    }
}

function markMatchedUI(indices) {
    indices.forEach(i => {
        const btn = mem.gridEl.querySelector(`.memory-card[data-index="${i}"]`);
        if (btn) btn.classList.add('matched');
    });
}

function newMemoryPuzzle() {
    mem.deck = buildDeck();
    mem.flipped = [];
    mem.moves = 0;
    mem.lock = false;
    renderMemory();
    appendTerminal('> New memory puzzle generated', false);
}

function resetMemoryPuzzle() {
    // reset flips and matches but keep deck order
    mem.deck = mem.deck.map((c, i) => ({ id: i, symbol: c.symbol, matched: false }));
    mem.flipped = [];
    mem.moves = 0;
    renderMemory();
    appendTerminal('> Memory puzzle reset', false);
}

// === META-PUZZLE: Progress, Locks, Rewards ===
let progress = { utility: false, tokenomics: false, team: false };

function loadProgress() {
    try {
        const raw = localStorage.getItem('meta_progress');
        if (raw) progress = { ...progress, ...JSON.parse(raw) };
    } catch (_) { /* ignore */ }
}

function saveProgress() {
    try { localStorage.setItem('meta_progress', JSON.stringify(progress)); } catch (_) { /* ignore */ }
}

function applyLocks() {
    document.querySelectorAll('.section-lock').forEach(lock => {
        const key = lock.getAttribute('data-section');
        const unlocked = !!progress[key];
        lock.classList.toggle('hidden', unlocked);
        const section = lock.closest('section');
        if (section) section.style.filter = unlocked ? '' : 'grayscale(0.3)';
    });
}

function updateRoadmap() {
    document.querySelectorAll('.roadmap-item').forEach(item => {
        const key = item.getAttribute('data-key');
        const status = item.querySelector('.roadmap-status');
        const unlocked = key === 'reward' ? (progress.utility && progress.tokenomics && progress.team) : !!progress[key];
        item.classList.toggle('unlocked', unlocked);
        if (status) status.textContent = unlocked ? '[x]' : '[ ]';
    });
}

function unlock(key) {
    if (!progress[key]) {
        progress[key] = true;
        saveProgress();
        applyLocks();
        updateRoadmap();
        appendTerminal(`> SECTION UNLOCKED: ${key.toUpperCase()}`, false);
        if (progress.utility && progress.tokenomics && progress.team) {
            showReward();
        }
    }
}

function showReward() {
    const pop = document.getElementById('reward-popup');
    if (pop) pop.classList.add('active');
}

function closeReward() {
    const pop = document.getElementById('reward-popup');
    if (pop) pop.classList.remove('active');
}

function downloadReward() {
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450" style="background:#000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#00ff88"/><stop offset="100%" stop-color="#8800ff"/></linearGradient></defs><rect x="0" y="0" width="800" height="450" fill="#000"/><text x="50%" y="45%" fill="url(#g)" font-family="IBM Plex Mono, monospace" font-size="56" text-anchor="middle" style="letter-spacing:2px;">$404 OPERATIVE</text><text x="50%" y="60%" fill="#fff" font-family="Space Mono, monospace" font-size="22" opacity="0.8" text-anchor="middle">All Sections Unlocked</text><rect x="150" y="330" width="500" height="3" fill="#00ff88" opacity="0.6"/></svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '404-operative-badge.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
