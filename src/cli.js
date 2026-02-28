const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { chromium } = require('playwright');
const AdmZip = require('adm-zip');
const config = require('./config');
const registry = require('./registry');
const server = require('./server');

const G="\x1b[92m", R="\x1b[91m", Y="\x1b[93m";
const B="\x1b[94m", C="\x1b[38;2;43;210;255m", W="\x1b[1m";
const DIM="\x1b[2m", NC="\x1b[0m";

function _ok(msg) { console.log(`  ${G}✓${NC}  ${msg}`); }
function _err(msg) { console.log(`  ${R}✗${NC}  ${msg}`); }
function _info(msg) { console.log(`  ${B}→${NC}  ${msg}`); }
function _warn(msg) { console.log(`  ${Y}!${NC}  ${msg}`); }
function _head(msg) { console.log(`\n${W}${msg}${NC}`); }
function _dim(msg) { console.log(`  ${DIM}${msg}${NC}`); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function _pidFile() {
  return path.join(config.PIDS_DIR, 'server.pid');
}

function getPid() {
  const pf = _pidFile();
  if (!fs.existsSync(pf)) return null;

  const content = fs.readFileSync(pf, 'utf-8').trim();
  if (!content) return null;

  const pid = parseInt(content, 10);

  // Check if process actually exists
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    // If ESRCH, process doesn't exist.
    if (e.code === 'ESRCH') {
      if (fs.existsSync(pf)) fs.unlinkSync(pf);
    }
    return null;
  }
}

function isServerRunning() {
  return getPid() !== null;
}

function killPid(pid) {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    } catch {}
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  
  const pf = _pidFile();
  if (fs.existsSync(pf)) fs.unlinkSync(pf);
}

// ── Commands ───────────────────────────────────────────────────────────────────

async function cmdAdd(providerName) {
  if (!registry.exists(providerName)) {
    _err(`Unknown provider: ${C}${providerName}${NC}`);
    process.exit(1);
  }
  config.setInstalled(providerName);
  _ok(`Added ${C}${providerName}${NC}.`);
  _info(`Next: ${G}clawapi auth ${providerName}${NC}`);
}

async function cmdAuth(providerName) {
  if (!registry.exists(providerName)) {
    _err(`Unknown provider: ${C}${providerName}${NC}`);
    process.exit(1);
  }
  if (!config.isInstalled(providerName)) {
    _err(`Provider ${C}${providerName}${NC} is not installed.`);
    process.exit(1);
  }

  const p = registry.get(providerName);
  _info(`Authenticating ${W}${p.displayName}${NC} (GUI Mode)...`);

  const sessionDir = path.join(config.SESSIONS_DIR, providerName);

  const browser = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    channel: 'chrome' // Force using standard Chrome if available
  }).catch(async (e) => {
    // Fallback to stock chromium
    return await chromium.launchPersistentContext(sessionDir, { headless: false });
  });

  const page = await browser.newPage();
  let userAgent = "";
  try {
      userAgent = await page.evaluate(() => navigator.userAgent);
      const uaPath = path.join(sessionDir, 'userAgent.txt');
      fs.writeFileSync(uaPath, userAgent, 'utf8');
      _ok(`Captured User-Agent signature.`);
  } catch(e) {}
  
  await page.goto(p.loginUrl);
  console.log();
  _info(`Please log in to ${C}${p.displayName}${NC} in the browser window.`);
  _dim(`Close the browser when you are fully logged in and can chat.`);

  let lastCookies = [];
  const pollInterval = setInterval(async () => {
    try {
      const c = await browser.cookies();
      // Usually auth sessions have multiple cookies.
      if (c && c.length > 2) {
        lastCookies = c;
      }
    } catch(e) {}
  }, 1000);

  browser.on('close', async () => {
    clearInterval(pollInterval);
    console.log();
    
    if (lastCookies.length > 5) {
      try {
        const cookiePath = path.join(sessionDir, 'cookies.json');
        fs.writeFileSync(cookiePath, JSON.stringify(lastCookies, null, 2), 'utf8');
        
        const uaPath = path.join(sessionDir, 'userAgent.txt');
        if (userAgent) fs.writeFileSync(uaPath, userAgent, 'utf8');

        _ok(`Session saved for ${C}${p.displayName}${NC} in HTTP-native format.`);
      } catch (err) {
        _warn(`Failed to save session data: ${err.message}`);
      }
    } else {
      _warn(`Browser closed but no valid session was detected. You must fully log in.`);
      // Force cleanup of the entire session directory to prevent 'ghost' sessions
      if (fs.existsSync(sessionDir)) {
          try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          } catch(e) {
            _warn(`Could not clean up session directory: ${e.message}`);
          }
      }
    }
    process.exit(0);
  });
}

function cmdExport(providerName) {
  if (!registry.exists(providerName)) {
    _err(`Unknown provider: ${C}${providerName}${NC}`);
    process.exit(1);
  }
  const sessionDir = path.join(config.SESSIONS_DIR, providerName);
  const archivePath = path.resolve(process.cwd(), `${providerName}_session.zip`);
  
  _info(`Exporting session for ${C}${providerName}${NC}...`);
  if (!fs.existsSync(sessionDir)) {
    _err(`No active session found for this provider.`);
    process.exit(1);
  }

  try {
    const zip = new AdmZip();
    
    // We only need the essential session files to keep the ZIP clean and small.
    // Browser junk like Cache/GPUCache/etc. are excluded.
    const essentials = ['cookies.json', 'userAgent.txt'];
    let added = 0;

    essentials.forEach(file => {
      const filePath = path.join(sessionDir, file);
      if (fs.existsSync(filePath)) {
        // Add to the ZIP, putting it inside the provider folder
        zip.addLocalFile(filePath, providerName);
        added++;
      }
    });

    if (added === 0) {
      _err(`No essential session files found in ${sessionDir}.`);
      process.exit(1);
    }

    zip.writeZip(archivePath);

    _ok(`Session exported to ${W}${archivePath}${NC} (${added} essential files included)`);
    _info(`Transfer this ZIP to another machine and run: ${G}clawapi import ${providerName} "${archivePath}"${NC}`);
  } catch (err) {
    _err(`Failed to export session: ${err.message}`);
    process.exit(1);
  }
}

function cmdImport(providerName, filePath) {
  if (!registry.exists(providerName)) {
    _err(`Unknown provider: ${C}${providerName}${NC}`);
    process.exit(1);
  }
  
  const absFilePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absFilePath)) {
    _err(`Cannot find export file: ${W}${absFilePath}${NC}`);
    process.exit(1);
  }

  const sessionDir = path.join(config.SESSIONS_DIR, providerName);
  _info(`Importing session for ${C}${providerName}${NC}...`);

  // Wipe old session if exists
  if (fs.existsSync(sessionDir)) {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (e) {
      _warn(`Could not fully clean old session: ${e.message}`);
    }
  }

  try {
    const zip = new AdmZip(absFilePath);
    zip.extractAllTo(config.SESSIONS_DIR, true);

    // Verify import
    if (config.hasSession(providerName)) {
      config.setInstalled(providerName); 
      _ok(`Session successfully imported for ${C}${providerName}${NC}.`);
    } else {
      _err(`Import completed but session files (cookies.json) appear missing or invalid.`);
      process.exit(1);
    }
  } catch(err) {
     _err(`Failed to import session: ${err.message}`);
     process.exit(1);
  }
}

// Proxy command removed at user request

function cmdStart(options) {
  if (isServerRunning()) {
    _warn(`ClawAPI is already running (PID ${W}${getPid()}${NC}).`);
    process.exit(0);
  }

  const port = options.port ? parseInt(options.port, 10) : config.getPort();
  config.setPort(port);

  _info(`Starting ClawAPI on port ${W}${port}${NC}...`);

  const logPath = path.join(config.LOGS_DIR, 'clawapi.log');
  const scriptPath = path.join(__dirname, '..', 'bin', 'clawapi.js');
  const childArgs = [scriptPath, '--internal-server-run', String(port)];

  if (process.platform === 'win32') {
    // On Windows, use PowerShell Start-Process -WindowStyle Hidden to launch node
    // completely invisibly as a fully detached background process.
    // The node server writes its own PID to file on startup (in server.js).
    const nodeExe = process.execPath;
    const pidPath = _pidFile();
    
    // Clean any stale PID file
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);

    const argsList = childArgs.map(a => `'${a}'`).join(',');
    const psCmd = `Start-Process -FilePath '${nodeExe}' -ArgumentList ${argsList} -WindowStyle Hidden -RedirectStandardOutput '${logPath}' -RedirectStandardError '${logPath}.err'`;

    try {
      execSync(`powershell -NoProfile -Command "${psCmd}"`, { windowsHide: true, stdio: 'ignore' });
    } catch (e) {
      _err(`Failed to start server: ${e.message}`);
      process.exit(1);
    }

    // Wait for the server to write its own PID file on startup
    setTimeout(() => {
      if (fs.existsSync(pidPath)) {
        const pid = fs.readFileSync(pidPath, 'utf-8').trim();
        if (pid && /^\d+$/.test(pid)) {
          _ok(`Server started in background (PID ${W}${pid}${NC}).`);
        } else {
          _ok(`Server started in background.`);
        }
      } else {
        _ok(`Server started in background.`);
      }
    }, 5000);
  } else {
    // Unix: spawn directly, no console window issue
    const logFile = fs.openSync(logPath, 'a');
    const spawnOpts = {
      detached: true,
      stdio: ['ignore', logFile, logFile],
    };

    const proc = spawn(process.execPath, childArgs, spawnOpts);
    proc.unref();

    fs.writeFileSync(_pidFile(), String(proc.pid), 'utf-8');
    _ok(`Server started in background (PID ${W}${proc.pid}${NC}).`);
  }
}

function cmdStop() {
  const pid = getPid();
  if (pid) {
    _info(`Stopping ClawAPI (PID ${W}${pid}${NC})...`);
    killPid(pid);
    _ok(`Stopped.`);
  } else {
    _warn(`ClawAPI is not running.`);
  }
}

function cmdStatus() {
  const pid = getPid();
  _head('ClawAPI Status');
  if (pid) {
    console.log(`  Server    ${G}running${NC}  ${C}→${NC}  ${DIM}http://localhost:${config.getPort()}/v1${NC}  (PID ${pid})`);
  } else {
    console.log(`  Server    ${R}stopped${NC}`);
  }
  console.log(`  Platform  ${process.platform}`);
  if (pid) console.log(`  Port      ${config.getPort()}`);
  
  const installed = registry.allNames().filter(n => config.isInstalled(n));
  if (installed.length > 0) {
    console.log(`\n  ${DIM}PROVIDER       DISPLAY                AUTH     ACTIVE${NC}`);
    console.log(`  ${DIM}-------------- ---------------------- -------- ------${NC}`);
    installed.forEach(name => {
      const p = registry.get(name);
      const auth = config.hasSession(name) ? `${G}yes${NC}` : `${R}no${NC} `;
      const active = (pid && config.hasSession(name)) ? `${G}yes${NC}` : `${R}no${NC} `;
      // Avoid raw length bugs with ansi codes by padding the unformatted string then wrapping it
      console.log(`  ${C}${name.padEnd(14)}${NC} ${p.displayName.padEnd(22)} ${auth.padEnd(8 + G.length + NC.length)} ${active}`);
    });
  }
  console.log();
}

function cmdRestart(options) {
  cmdStop();
  setTimeout(() => cmdStart(options), 1000);
}

function cmdLogs() {
  const p = path.join(config.LOGS_DIR, 'clawapi.log');
  if (!fs.existsSync(p)) {
    console.log('! No logs found yet.');
    return;
  }
  console.log('→ Tailing logs... (Ctrl+C to stop)');
  const tail = spawn(process.platform === 'win32' ? 'powershell' : 'tail', 
    process.platform === 'win32' ? ['-c', `Get-Content '${p}' -Wait -Tail 20`] : ['-f', p], 
    { stdio: 'inherit' }
  );
  process.on('SIGINT', () => {
    try { tail.kill(); } catch {}
    process.exit(0);
  });
}

function cmdList() {
  const installed = registry.allNames().filter(n => config.isInstalled(n));
  if (installed.length === 0) {
    console.log();
    _warn('No providers installed.');
    _info(`Install with: ${G}clawapi add <provider>${NC}`);
    console.log();
    return;
  }
  
  _head('Installed Providers');
  console.log(`  ${DIM}NAME           DISPLAY                VENDOR${NC}`);
  console.log(`  ${DIM}-------------- ---------------------- --------------------${NC}`);
  installed.forEach(name => {
    const p = registry.get(name);
    console.log(`  ${C}${name.padEnd(14)}${NC} ${p.displayName.padEnd(22)} ${p.vendor}`);
  });
  console.log();
}

function cmdAvailable() {
  _head('Available Providers');
  console.log(`  ${DIM}NAME           DISPLAY                VENDOR               INSTALLED${NC}`);
  console.log(`  ${DIM}-------------- ---------------------- -------------------- ---------${NC}`);
  registry.allNames().forEach(name => {
    const p = registry.get(name);
    const inst = config.isInstalled(name) ? `${G}yes${NC}` : `${DIM}no${NC} `;
    console.log(`  ${C}${name.padEnd(14)}${NC} ${p.displayName.padEnd(22)} ${p.vendor.padEnd(20)} ${inst}`);
  });
  console.log();
  _info(`Install with: ${G}clawapi add <provider>${NC}`);
  console.log();
}

function cmdRm(providerName) {
  if (!config.isInstalled(providerName)) {
    _err(`Provider ${C}${providerName}${NC} is not installed.`);
    process.exit(1);
  }
  config.setUninstalled(providerName);
  _ok(`Removed ${C}${providerName}${NC}.`);
}

async function cmdTest(providerName) {
  if (!config.isInstalled(providerName)) {
    _err(`Provider ${C}${providerName}${NC} is not installed.`);
    process.exit(1);
  }

  const port = config.getPort();
  if (!isServerRunning()) {
    _err(`ClawAPI does not seem to be running on this port (${port}).`);
    _info(`Start it first using: ${G}clawapi start${NC}`);
    process.exit(1);
  }

  _info(`Testing ${C}${providerName}${NC} via localhost:${port}...`);
  // Simple animation for CLI loading
  const P = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let x = 0;
  const loader = setInterval(() => {
    process.stdout.write(`\r  ${B}${P[x++]}${NC}  Waiting for response...`);
    x &= 9;
  }, 100);

  try {
    const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-clawapi-test"
      },
      body: JSON.stringify({
        model: providerName,
        messages: [{ role: "user", content: "say the exact phrase: 'ClawAPI works'" }]
      })
    });

    const data = await res.json();
    clearInterval(loader);
    process.stdout.write(`\r\x1b[K`); // clear line

    if (!res.ok) {
      _err(`API Error: ${data.error?.message || res.statusText}`);
      process.exit(1);
    }
    
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (reply) {
      _ok(`Received: ${W}${reply}${NC}`);
    } else {
      _warn(`Received empty valid response or misconfigured payload.`);
      console.dir(data, {depth: null, colors: true});
    }

  } catch (err) {
    clearInterval(loader);
    process.stdout.write(`\r\x1b[K`);
    _err(`Request failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  cmdAdd,
  cmdAuth,
  cmdExport,
  cmdImport,
  cmdStart,
  cmdStop,
  cmdStatus,
  cmdRestart,
  cmdLogs,
  cmdList,
  cmdAvailable,
  cmdRm,
  cmdTest
};

// Internal boot hook for detached process
if (process.argv[2] === '--internal-server-run') {
  const port = parseInt(process.argv[3], 10) || 8855;
  server.startServer(port).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
