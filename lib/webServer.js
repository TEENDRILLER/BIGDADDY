import http from 'http';
import chalk from 'chalk';
import { getPlatformInfo } from './platformDetect.js';

let _server = null;

/* ─────────────────────────────────────────────────────────
   LOG BUFFER  (ring buffer, max 300 lines, persists across
   hot-reloads via globalThis so lines aren't lost)
───────────────────────────────────────────────────────── */
const LOG_MAX = 300;
if (!globalThis._logBuffer)           globalThis._logBuffer           = [];
if (!globalThis._logSseClients)       globalThis._logSseClients       = new Set();
if (!globalThis._consolePatchedByWS)  globalThis._consolePatchedByWS  = false;

function _pushLog(level, args) {
  const text = args
    .map(a => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  const entry = { ts: Date.now(), level, text };
  globalThis._logBuffer.push(entry);
  if (globalThis._logBuffer.length > LOG_MAX) globalThis._logBuffer.shift();
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of globalThis._logSseClients) {
    try { res.write(payload); } catch { globalThis._logSseClients.delete(res); }
  }
}

function _patchConsole() {
  if (globalThis._consolePatchedByWS) return;
  globalThis._consolePatchedByWS = true;
  const _orig = {
    log:   console.log.bind(console),
    error: console.error.bind(console),
    warn:  console.warn.bind(console),
    info:  console.info.bind(console),
  };
  for (const level of ['log', 'error', 'warn', 'info']) {
    console[level] = (...args) => {
      _orig[level](...args);
      _pushLog(level, args);
    };
  }
}

/* ─────────────────────────────────────────────────────────
   STATUS HELPERS
───────────────────────────────────────────────────────── */
function getStatus() {
  const s = globalThis._webStatus || {};
  const uptime = process.uptime();
  const h   = Math.floor(uptime / 3600);
  const m   = Math.floor((uptime % 3600) / 60);
  const sec = Math.floor(uptime % 60);

  const platform = getPlatformInfo();
  const mem = process.memoryUsage();

  // Read live state directly from the actual config globals — never stale
  const antilink     = !!(globalThis._antilinkConfig?.enabled);
  const antispam     = !!(globalThis._antispamConfig?.enabled);
  const antibug      = !!(globalThis._antibugConfig?.enabled);
  const antidelete   = !!(globalThis._antideleteEnabled  ?? s.antidelete  ?? false);
  const antiviewonce = !!(globalThis._antiviewonceEnabled ?? s.antiviewonce ?? false);
  const autoread     = !!(globalThis._autoreadEnabled     ?? s.autoread    ?? false);

  return {
    status:          (s.connected ?? false) ? 'ok' : 'degraded',
    botName:         s.botName       || global.BOT_NAME || 'KLAUS MD',
    version:         s.version       || global.VERSION  || '1.0.0',
    connected:       s.connected     ?? false,
    uptime:          `${h}h ${m}m ${sec}s`,
    uptimeSecs:      Math.floor(uptime),
    platform:        `${platform.icon} ${platform.name}`,
    commands:        s.commands      || 0,
    prefix:          s.prefix        || '.',
    botMode:         s.botMode       || 'public',
    owner:           s.owner         || 'Unknown',
    antispam,
    antibug,
    antilink,
    antidelete,
    antiviewonce,
    autoread,
    memoryMB:        parseFloat((mem.heapUsed  / 1024 / 1024).toFixed(1)),
    memoryTotalMB:   parseFloat((mem.heapTotal / 1024 / 1024).toFixed(1)),
    nodeVersion:     process.version,
    timestamp:       new Date().toISOString(),
  };
}

function getPort() {
  if (process.env.PORT)        return parseInt(process.env.PORT);
  if (process.env.SERVER_PORT) return parseInt(process.env.SERVER_PORT);
  if (process.env.APP_PORT)    return parseInt(process.env.APP_PORT);
  return 3000;
}

/* ─────────────────────────────────────────────────────────
   LOG AUTH  (optional — set LOG_PASSWORD in env to protect)
───────────────────────────────────────────────────────── */
function logAuthOk(req) {
  const pw = process.env.LOG_PASSWORD;
  if (!pw) return true;
  try {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    return qs.get('key') === pw;
  } catch { return false; }
}

/* ─────────────────────────────────────────────────────────
   STATUS PAGE HTML
───────────────────────────────────────────────────────── */
function getHTML(st) {
  const online      = st.connected;
  const statusLabel = online ? 'ONLINE' : 'OFFLINE';
  const statusColor = online ? '#22c55e' : '#ef4444';
  const memPercent = Math.min(100, (st.memoryMB / 512) * 100);
  const memBar = '█'.repeat(Math.round(memPercent / 10)) + '░'.repeat(10 - Math.round(memPercent / 10));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${st.botName} — Hosting Panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:linear-gradient(180deg,#0a0a2e 0%,#0f172a 50%,#1e1b4b 100%);color:#fff;min-height:100vh;overflow-x:hidden}
.space-bg{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:radial-gradient(ellipse at 20% 30%,rgba(124,58,237,0.15),transparent 50%),radial-gradient(ellipse at 80% 70%,rgba(59,130,246,0.12),transparent 55%)}
.nebula{position:absolute;border-radius:50%;filter:blur(80px);opacity:0.4}
.n1{width:40vmax;height:40vmax;background:radial-gradient(circle,rgba(124,58,237,0.25),transparent 65%);top:-10vmax;left:-15vmax;animation:d1 30s ease-in-out infinite alternate}
.n2{width:35vmax;height:35vmax;background:radial-gradient(circle,rgba(59,130,246,0.22),transparent 65%);bottom:-10vmax;right:-15vmax;animation:d2 36s ease-in-out infinite alternate}
@keyframes d1{to{transform:translate(10vmax,8vmax) scale(1.1)}}
@keyframes d2{to{transform:translate(-8vmax,-6vmax) scale(1.15)}}
.container{position:relative;z-index:1;max-width:860px;margin:0 auto;padding:24px 16px}
.header{text-align:center;margin-bottom:32px;padding:24px;background:rgba(30,41,59,0.6);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,0.4)}
.header h1{font-size:28px;font-weight:800;letter-spacing:0.02em;margin-bottom:8px}
.header .sub{color:#94a3b8;font-size:14px;margin-bottom:16px}
.status-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:999px;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;background:${statusColor}15;border:1px solid ${statusColor}40;color:${statusColor}}
.status-dot{width:8px;height:8px;border-radius:50%;background:${statusColor};box-shadow:0 0 8px ${statusColor};animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.card{background:rgba(30,41,59,0.6);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:16px;transition:all 0.25s}
.card:hover{border-color:rgba(124,58,237,0.3);box-shadow:0 0 20px rgba(124,58,237,0.1)}
.card-label{font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-bottom:8px;font-family:'JetBrains Mono',monospace}
.card-value{font-size:20px;font-weight:700;color:#fff;font-family:'JetBrains Mono',monospace}
.card-value.green{color:#22c55e}
.card-value.purple{color:#a78bfa}
.card-value.blue{color:#60a5fa}
.card-value.amber{color:#fbbf24}
.card-value.small{font-size:14px}
.ram-bar{font-family:'JetBrains Mono',monospace;font-size:16px;color:#22c55e;letter-spacing:0.05em}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;border-radius:14px;font-size:14px;font-weight:700;border:none;cursor:pointer;text-decoration:none;transition:all 0.25s;font-family:'Inter',sans-serif}
.btn-restart{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;box-shadow:0 4px 14px rgba(239,68,68,0.3)}
.btn-restart:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(239,68,68,0.4)}
.btn-pair{background:linear-gradient(135deg,#25D366,#128C7E);color:#fff;box-shadow:0 4px 14px rgba(37,211,102,0.3)}
.btn-pair:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(37,211,102,0.4)}
.btn-repo{background:linear-gradient(135deg,#7c3aed,#3b82f6);color:#fff;box-shadow:0 4px 14px rgba(124,58,237,0.3)}
.btn-repo:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(124,58,237,0.4)}
.btn-health{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#94a3b8}
.btn-health:hover{color:#fff;border-color:rgba(255,255,255,0.3)}
.btn-logs{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#94a3b8}
.btn-logs:hover{color:#fff;border-color:rgba(255,255,255,0.3)}
.info-bar{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(30,41,59,0.6);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);border-radius:14px;margin-bottom:20px;font-family:'JetBrains Mono',monospace;font-size:12px}
.info-bar .left{color:#64748b}
.info-bar .right{color:#94a3b8}
.footer{text-align:center;padding:16px 0;font-size:12px;color:#64748b}
.footer strong{color:#94a3b8}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:100;align-items:center;justify-content:center}
.modal.show{display:flex}
.modal-box{background:rgba(30,41,59,0.95);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:32px;max-width:400px;text-align:center}
.modal-box h2{font-size:20px;margin-bottom:8px}
.modal-box p{color:#94a3b8;margin-bottom:20px;font-size:14px}
.modal-box .btn{width:100%;margin-bottom:8px}
@media(max-width:600px){.header h1{font-size:22px}.grid{grid-template-columns:1fr 1fr}.card-value{font-size:16px}}
</style>
</head>
<body>
<div class="space-bg"><div class="nebula n1"></div><div class="nebula n2"></div></div>
<div class="container">
  <div class="header">
    <h1>⚡ ${st.botName}</h1>
    <div class="sub">Hosting Panel · v${st.version}</div>
    <div class="status-badge"><div class="status-dot"></div>${statusLabel}</div>
  </div>

  <div class="grid">
    <div class="card"><div class="card-label">// UPTIME</div><div class="card-value green">${st.uptime}</div></div>
    <div class="card"><div class="card-label">// COMMANDS</div><div class="card-value purple">${st.commands}</div></div>
    <div class="card"><div class="card-label">// PREFIX</div><div class="card-value blue">${st.prefix === 'none' ? '(none)' : st.prefix}</div></div>
    <div class="card"><div class="card-label">// MODE</div><div class="card-value amber">${st.botMode.toUpperCase()}</div></div>
    <div class="card"><div class="card-label">// OWNER</div><div class="card-value small">${st.owner === 'Unknown' ? 'Not Set' : '+' + st.owner}</div></div>
    <div class="card"><div class="card-label">// PLATFORM</div><div class="card-value small">${st.platform}</div></div>
    <div class="card"><div class="card-label">// MEMORY</div><div class="card-value small">${st.memoryMB} MB</div></div>
    <div class="card"><div class="card-label">// RAM</div><div class="ram-bar">${memBar} ${Math.round(memPercent)}%</div></div>
    <div class="card"><div class="card-label">// NODE</div><div class="card-value small">${st.nodeVersion}</div></div>
    <div class="card"><div class="card-label">// UPDATED</div><div class="card-value small">${new Date().toLocaleTimeString()}</div></div>
  </div>

  <div class="actions">
    <button class="btn btn-restart" onclick="confirmRestart()">🔄 Restart Bot</button>
    <a class="btn btn-pair" href="https://klausmd.pairsite.space" target="_blank">📱 Pair Link</a>
    <a class="btn btn-repo" href="https://github.com/Luffy-ui21/Klaus-Bot" target="_blank">📦 GitHub</a>
    <a class="btn btn-logs" href="/logs">📜 Live Console</a>
    <a class="btn btn-health" href="/health">❤️ Health Check</a>
  </div>

  <div class="info-bar">
    <span class="left">◈ ${st.botName} · AUTO-REFRESH 30s</span>
    <span class="right">Powered by Klaus Labs</span>
  </div>
</div>

<div class="modal" id="restartModal">
  <div class="modal-box">
    <h2>🔄 Restart Bot?</h2>
    <p>This will restart the bot process. It will come back online automatically within a few seconds.</p>
    <button class="btn btn-restart" onclick="doRestart()">Yes, Restart Now</button>
    <button class="btn btn-health" onclick="closeModal()">Cancel</button>
  </div>
</div>

<script>
function confirmRestart(){document.getElementById('restartModal').classList.add('show')}
function closeModal(){document.getElementById('restartModal').classList.remove('show')}
function doRestart(){
  fetch('/api/restart',{method:'POST'}).then(()=>{
    document.querySelector('.modal-box').innerHTML='<h2>✅ Restarting...</h2><p>The bot will be back online in a few seconds. This page will auto-refresh.</p>';
    setTimeout(()=>location.reload(),10000);
  }).catch(()=>{
    document.querySelector('.modal-box').innerHTML='<h2>✅ Restarting...</h2><p>The bot is restarting. This page will auto-refresh.</p>';
    setTimeout(()=>location.reload(),10000);
  });
}
// Auto-refresh every 30 seconds
setTimeout(()=>location.reload(),30000);
</script>
</body>
</html>`;
}

/* ─────────────────────────────────────────────────────────
   LIVE CONSOLE PAGE HTML
───────────────────────────────────────────────────────── */
function getLogsHTML(initialLogs) {
  const escaped = JSON.stringify(initialLogs);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title> Live Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{
    --bg:hsl(120,100%,2%);--neon:hsl(120,100%,50%);--neon-dim:hsl(120,80%,30%);
    --border-faint:hsla(120,100%,50%,.15);--muted:hsl(120,50%,40%);
    --c-log:hsl(120,100%,60%);--c-error:hsl(0,84%,65%);
    --c-warn:hsl(45,100%,60%);--c-info:hsl(200,100%,65%);--c-ts:hsl(120,30%,35%);
    --font-mono:'JetBrains Mono',monospace;--font-head:'Orbitron',sans-serif
  }
  html,body{height:100%;scrollbar-color:var(--neon-dim) var(--bg);scrollbar-width:thin}
  ::-webkit-scrollbar{width:6px}
  ::-webkit-scrollbar-track{background:hsl(120,100%,3%)}
  ::-webkit-scrollbar-thumb{background:hsl(120,100%,20%);border-radius:4px}
  body{
    background:var(--bg);
    background-image:
      linear-gradient(0deg,transparent 24%,hsla(120,100%,50%,.018) 25%,hsla(120,100%,50%,.018) 26%,transparent 27%,transparent 74%,hsla(120,100%,50%,.018) 75%,hsla(120,100%,50%,.018) 76%,transparent 77%),
      linear-gradient(90deg,transparent 24%,hsla(120,100%,50%,.018) 25%,hsla(120,100%,50%,.018) 26%,transparent 27%,transparent 74%,hsla(120,100%,50%,.018) 75%,hsla(120,100%,50%,.018) 76%,transparent 77%);
    background-size:40px 40px;
    color:var(--neon);font-family:var(--font-mono);
    display:flex;flex-direction:column;height:100%
  }
  header{
    display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;
    padding:14px 20px;border-bottom:1px solid var(--border-faint);
    background:hsla(120,100%,50%,.03);flex-shrink:0
  }
  .hdr-left{display:flex;align-items:center;gap:14px}
  h1{font-family:var(--font-head);font-size:16px;letter-spacing:4px;color:#fff;text-shadow:0 0 8px var(--neon)}
  .live-pill{
    display:flex;align-items:center;gap:7px;
    padding:4px 12px;border-radius:.4rem;font-size:10px;font-weight:700;letter-spacing:2px;
    background:hsla(120,100%,50%,.06);border:1px solid hsla(120,100%,50%,.3);
    color:var(--neon);text-shadow:0 0 6px var(--neon)
  }
  .live-dot{width:7px;height:7px;border-radius:50%;background:var(--neon);box-shadow:0 0 6px var(--neon);animation:pd 1.4s ease-in-out infinite}
  @keyframes pd{0%,100%{opacity:1}50%{opacity:.2}}
  .hdr-right{display:flex;gap:8px;flex-wrap:wrap}
  button{
    padding:6px 14px;border-radius:.5rem;font-size:10px;font-weight:700;
    letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;
    font-family:var(--font-mono);transition:all .15s;border:1px solid
  }
  .btn-clear{background:hsla(0,84%,60%,.07);color:hsl(0,84%,65%);border-color:hsl(0,84%,40%)}
  .btn-clear:hover{background:hsla(0,84%,60%,.18);border-color:hsl(0,84%,60%)}
  .btn-scroll{background:hsla(120,100%,50%,.06);color:var(--neon);border-color:var(--neon-dim)}
  .btn-scroll:hover{background:hsla(120,100%,50%,.15);border-color:var(--neon)}
  .btn-back{background:transparent;color:var(--muted);border-color:hsl(120,20%,20%);text-decoration:none;display:inline-flex;align-items:center;padding:6px 14px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:var(--font-mono);border-radius:.5rem}
  .btn-back:hover{color:var(--neon);border-color:var(--neon-dim)}
  #console{
    flex:1;overflow-y:auto;padding:12px 16px;
    display:flex;flex-direction:column;gap:1px
  }
  .line{display:flex;gap:10px;line-height:1.55;font-size:12.5px;padding:2px 4px;border-radius:3px;word-break:break-all}
  .line:hover{background:hsla(120,100%,50%,.04)}
  .ts{color:var(--c-ts);flex-shrink:0;user-select:none;font-size:11px;padding-top:1px}
  .lvl{flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:1px;width:34px;text-align:right;padding-top:2px}
  .lvl-log{color:hsl(120,60%,40%)}
  .lvl-error{color:var(--c-error)}
  .lvl-warn{color:var(--c-warn)}
  .lvl-info{color:var(--c-info)}
  .msg{color:#c8ffc8;flex:1;white-space:pre-wrap}
  .msg.error{color:var(--c-error)}
  .msg.warn{color:var(--c-warn)}
  .msg.info{color:var(--c-info)}
  .empty{color:var(--muted);font-size:12px;text-align:center;margin-top:60px;letter-spacing:2px}
  footer{
    padding:8px 20px;border-top:1px solid var(--border-faint);
    font-size:10px;color:var(--muted);display:flex;justify-content:space-between;
    letter-spacing:1px;flex-shrink:0
  }
  #conn-state{font-weight:700}
  #line-count{font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<header>
  <div class="hdr-left">
    <h1> LIVE CONSOLE</h1>
    <div class="live-pill"><div class="live-dot"></div>STREAMING</div>
  </div>
  <div class="hdr-right">
    <button class="btn-clear" onclick="clearLogs()">CLEAR</button>
    <button class="btn-scroll" onclick="toggleAutoScroll()" id="scroll-btn">AUTO-SCROLL ON</button>
    <a class="btn-back" href="/">← STATUS</a>
  </div>
</header>

<div id="console"><div class="empty" id="empty-msg">// awaiting log output...</div></div>

<footer>
  <span>SSE &nbsp;|&nbsp; <span id="conn-state" style="color:var(--c-warn)">CONNECTING</span></span>
  <span><span id="line-count">0</span> / 300 lines</span>
</footer>

<script>
const consoleEl  = document.getElementById('console');
const emptyMsg   = document.getElementById('empty-msg');
const lineCount  = document.getElementById('line-count');
const connState  = document.getElementById('conn-state');
const scrollBtn  = document.getElementById('scroll-btn');

let autoScroll = true;
let lines = [];
const MAX = 300;

const COLORS = { log:'lvl-log', error:'lvl-error', warn:'lvl-warn', info:'lvl-info' };

function fmt(ts) {
  const d = new Date(ts);
  return d.toTimeString().slice(0,8) + '.' + String(d.getMilliseconds()).padStart(3,'0');
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildLine(entry) {
  const div = document.createElement('div');
  div.className = 'line';
  div.innerHTML =
    '<span class="ts">' + fmt(entry.ts) + '</span>' +
    '<span class="lvl ' + (COLORS[entry.level]||'lvl-log') + '">' + entry.level.toUpperCase() + '</span>' +
    '<span class="msg ' + (entry.level === 'log' ? '' : entry.level) + '">' + esc(entry.text) + '</span>';
  return div;
}

function appendLine(entry) {
  if (emptyMsg.parentNode) emptyMsg.remove();
  lines.push(entry);
  if (lines.length > MAX) {
    lines.shift();
    if (consoleEl.firstChild) consoleEl.removeChild(consoleEl.firstChild);
  }
  consoleEl.appendChild(buildLine(entry));
  lineCount.textContent = lines.length;
  if (autoScroll) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearLogs() {
  lines = [];
  consoleEl.innerHTML = '';
  consoleEl.appendChild(emptyMsg);
  lineCount.textContent = '0';
  fetch('/api/logs/clear', { method:'POST' }).catch(()=>{});
}

function toggleAutoScroll() {
  autoScroll = !autoScroll;
  scrollBtn.textContent = autoScroll ? 'AUTO-SCROLL ON' : 'AUTO-SCROLL OFF';
  if (autoScroll) consoleEl.scrollTop = consoleEl.scrollHeight;
}

// Seed with buffered logs
const seed = ${escaped};
seed.forEach(appendLine);

// Connect SSE
function connect() {
  const es = new EventSource('/api/logs/stream');
  es.onopen = () => {
    connState.textContent = 'LIVE';
    connState.style.color = 'var(--c-log)';
  };
  es.onmessage = e => {
    try { appendLine(JSON.parse(e.data)); } catch {}
  };
  es.onerror = () => {
    connState.textContent = 'RECONNECTING';
    connState.style.color = 'var(--c-warn)';
    es.close();
    setTimeout(connect, 3000);
  };
}
connect();
</script>
</body>
</html>`;
}

/* ─────────────────────────────────────────────────────────
   HTTP SERVER
───────────────────────────────────────────────────────── */
export function setupWebServer() {
  if (_server) return Promise.resolve();

  // Start intercepting console output as early as possible
  _patchConsole();

  const PORT = getPort();

  _server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const st  = getStatus();

    /* ── Health / status endpoints ── */
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        status:       st.status,
        connected:    st.connected,
        botName:      st.botName,
        version:      st.version,
        uptime:       st.uptime,
        uptimeSecs:   st.uptimeSecs,
        memoryMB:     st.memoryMB,
        memoryTotalMB: st.memoryTotalMB,
        platform:     st.platform,
        nodeVersion:  st.nodeVersion,
        timestamp:    st.timestamp,
      }));
    }

    if (url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(st, null, 2));
    }

    /* ── Log endpoints ── */
    if (url === '/logs') {
      if (!logAuthOk(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('403 Forbidden — set LOG_PASSWORD env var and pass ?key=<password>');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getLogsHTML(globalThis._logBuffer));
    }

    if (url === '/api/logs') {
      if (!logAuthOk(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Forbidden' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(globalThis._logBuffer));
    }

    if (url === '/api/logs/stream') {
      if (!logAuthOk(req)) {
        res.writeHead(403); return res.end();
      }
      res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      globalThis._logSseClients.add(res);
      req.on('close', () => globalThis._logSseClients.delete(res));
      return;
    }

    if (url === '/api/logs/clear' && req.method === 'POST') {
      if (!logAuthOk(req)) { res.writeHead(403); return res.end(); }
      globalThis._logBuffer.length = 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    /* ── Restart endpoint ── */
    if (url === '/api/restart' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Restarting...' }));
      setTimeout(() => {
        try { if (typeof globalThis.preExitSave === 'function') globalThis.preExitSave(); } catch {}
        process.exit(0);
      }, 1000);
      return;
    }

    /* ── Main hosting panel page ── */
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHTML(st));
  });

  return new Promise((resolve) => {
    let finalPort = PORT;

    _server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        finalPort = PORT + 1;
        _server.listen(finalPort, '0.0.0.0');
      }
    });

    _server.listen(PORT, '0.0.0.0', () => {
      const { name } = getPlatformInfo();

      const N  = '\x1b[38;2;0;255;156m';
      const NB = '\x1b[1m\x1b[38;2;0;255;156m';
      const B  = '\x1b[38;2;34;193;255m';
      const BB = '\x1b[1m\x1b[38;2;34;193;255m';
      const Y  = '\x1b[38;2;250;204;21m';
      const YB = '\x1b[1m\x1b[38;2;250;204;21m';
      const D  = '\x1b[2m\x1b[38;2;100;120;130m';
      const W  = '\x1b[38;2;200;215;225m';
      const R  = '\x1b[0m';

      // KLAUS MD signature style: ╭─⌈ icon TITLE ⌋ … ╰⊷
      const sep = `${D}·${R}`;
      process.stdout.write(`\n${NB}╭─⌈ KLASU MD CONTROL CORE ⌋${R}\n`);
      process.stdout.write(`${NB}» ${R}${Y}🏗️${R} ${W}${name}${R}  ${sep}  ${Y}🔌${R} ${W}${finalPort}${R}  ${sep}  ${Y}📂${R} ${W}/logs${R}\n`);
      process.stdout.write(`${NB}╰⊷${R}\n\n`);
      resolve();
    });
  });
}

export function updateWebStatus(data) {
  globalThis._webStatus = { ...(globalThis._webStatus || {}), ...data };
}
