const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const config = require('./config');
const uiServer = require('./ui_server');
const cli = require('./cli'); // To reuse display helpers

const G="\x1b[92m", R="\x1b[91m", Y="\x1b[93m";
const B="\x1b[94m", C="\x1b[38;2;43;210;255m", W="\x1b[1m";
const DIM="\x1b[2m", NC="\x1b[0m";

function _ok(msg) { console.log(`  ${G}✓${NC}  ${msg}`); }
function _err(msg) { console.log(`  ${R}✗${NC}  ${msg}`); }
function _info(msg) { console.log(`  ${B}→${NC}  ${msg}`); }
function _warn(msg) { console.log(`  ${Y}!${NC}  ${msg}`); }
function _head(msg) { console.log(`\n${W}${msg}${NC}`); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function _uiPidFile() {
  return path.join(config.PIDS_DIR, 'ui_server.pid');
}

function getUiPid() {
  const pf = _uiPidFile();
  if (!fs.existsSync(pf)) return null;

  const content = fs.readFileSync(pf, 'utf-8').trim();
  if (!content) return null;

  const pid = parseInt(content, 10);

  if (process.platform === 'win32') {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`).toString();
      if (!out.includes(String(pid))) {
        fs.unlinkSync(pf);
        return null;
      }
      return pid;
    } catch {
      return null;
    }
  } else {
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      fs.unlinkSync(pf);
      return null;
    }
  }
}

function isUiRunning() {
  return getUiPid() !== null;
}

function killUiPid(pid) {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    } catch {}
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  
  const pf = _uiPidFile();
  if (fs.existsSync(pf)) fs.unlinkSync(pf);
}

// ── Commands ───────────────────────────────────────────────────────────────────

function cmdUiStart(options) {
  if (isUiRunning()) {
    _warn(`ClawAPI Web UI is already running (PID ${W}${getUiPid()}${NC}).`);
    process.exit(0);
  }

  const port = options.port ? parseInt(options.port, 10) : 3001;

  _info(`Starting ClawAPI Web UI on port ${W}${port}${NC}...`);

  const logPath = path.join(config.LOGS_DIR, 'clawapi_ui.log');
  const scriptPath = path.join(__dirname, '..', 'bin', 'clawapi.js');
  const childArgs = [scriptPath, '--internal-ui-server-run', String(port)];

  if (process.platform === 'win32') {
    const nodeExe = process.execPath;
    const pidPath = _uiPidFile();
    
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);

    const argsList = childArgs.map(a => `'${a}'`).join(',');
    const psCmd = `Start-Process -FilePath '${nodeExe}' -ArgumentList ${argsList} -WindowStyle Hidden -RedirectStandardOutput '${logPath}' -RedirectStandardError '${logPath}.err'`;

    try {
      execSync(`powershell -NoProfile -Command "${psCmd}"`, { windowsHide: true, stdio: 'ignore' });
    } catch (e) {
      _err(`Failed to start UI server: ${e.message}`);
      process.exit(1);
    }

    setTimeout(() => {
      if (fs.existsSync(pidPath)) {
        const pid = fs.readFileSync(pidPath, 'utf-8').trim();
        if (pid && /^\d+$/.test(pid)) {
          _ok(`Web UI started in background (PID ${W}${pid}${NC}).`);
		  _info(`Dashboard available at ${C}http://localhost:${port}${NC}`);
        } else {
          _ok(`Web UI started in background.`);
        }
      } else {
        _ok(`Web UI started in background.`);
      }
    }, 2000);
  } else {
    const logFile = fs.openSync(logPath, 'a');
    const spawnOpts = {
      detached: true,
      stdio: ['ignore', logFile, logFile],
    };

    const proc = spawn(process.execPath, childArgs, spawnOpts);
    proc.unref();

    fs.writeFileSync(_uiPidFile(), String(proc.pid), 'utf-8');
    _ok(`Web UI started in background (PID ${W}${proc.pid}${NC}).`);
	_info(`Dashboard available at ${C}http://localhost:${port}${NC}`);
  }
}

function cmdUiStop() {
  const pid = getUiPid();
  if (pid) {
    _info(`Stopping ClawAPI Web UI (PID ${W}${pid}${NC})...`);
    killUiPid(pid);
    _ok(`Stopped.`);
  } else {
    _warn(`ClawAPI Web UI is not running.`);
  }
}

function cmdUiStatus() {
  const pid = getUiPid();
  _head('ClawAPI Web UI Status');
  if (pid) {
    console.log(`  UI Server ${G}running${NC}  ${C}→${NC}  ${DIM}http://localhost:3001${NC}  (PID ${pid})`); // Note: port might vary if custom port was provided, 3001 is default
  } else {
    console.log(`  UI Server ${R}stopped${NC}`);
  }
  console.log();
}

function cmdUiRestart(options) {
  cmdUiStop();
  setTimeout(() => cmdUiStart(options), 1000);
}

module.exports = {
  cmdUiStart,
  cmdUiStop,
  cmdUiStatus,
  cmdUiRestart
};

// Internal boot hook for detached process
if (process.argv[2] === '--internal-ui-server-run') {
  const port = parseInt(process.argv[3], 10) || 3001;
  uiServer.startUiServer(port).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
