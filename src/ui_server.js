const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const config = require('./config');
const multer = require('multer');
const upload = multer({ dest: config.TMP_UPLOADS_DIR });
const registry = require('./registry');

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// ── Helpers ─────────────────────────────────────────────────────────────────

function getMainServerPid() {
  const pf = path.join(config.PIDS_DIR, 'server.pid');
  if (!fs.existsSync(pf)) return null;

  const content = fs.readFileSync(pf, 'utf-8').trim();
  if (!content) return null;

  const pid = parseInt(content, 10);
  
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    return null;
  }
}

// ── API Routes for Dashboard ────────────────────────────────────────────────

// Get overall status
app.get('/api/status', (req, res) => {
  const pid = getMainServerPid();
  const installedNames = registry.allNames().filter(n => config.isInstalled(n));
  const installed = installedNames.map(name => {
    const data = registry.get(name);
    return {
      name,
      displayName: data.displayName,
      vendor: data.vendor,
      authenticated: config.hasSession(name),
      active: !!pid && config.hasSession(name)
    };
  });

  const available = registry.allNames().filter(n => !installedNames.includes(n)).map(name => {
      const data = registry.get(name);
      return {
          name,
          displayName: data.displayName,
          vendor: data.vendor
      };
  });

  res.json({
    serverRunning: !!pid,
    serverPid: pid,
    port: config.getPort(),
    platform: process.platform,
    providers: installed,
    availableProviders: available
  });
});

// Start the main server
app.post('/api/start', (req, res) => {
  try {
    const { port } = req.body;
    let cmd = 'start';
    if (port && !isNaN(parseInt(port, 10))) {
        cmd += ` --port ${parseInt(port, 10)}`;
    }
    const cliPath = path.join(__dirname, '..', 'bin', 'clawapi.js');
    execSync(`node "${cliPath}" ${cmd}`, { stdio: 'ignore', windowsHide: true });
    res.json({ success: true, message: 'Server start command issued' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stop the main server
app.post('/api/stop', (req, res) => {
  try {
    const cliPath = path.join(__dirname, '..', 'bin', 'clawapi.js');
    execSync(`node "${cliPath}" stop`, { stdio: 'ignore', windowsHide: true });
    res.json({ success: true, message: 'Server stop command issued' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Restart the main server
app.post('/api/restart', (req, res) => {
  try {
    const { port } = req.body;
    let cmd = 'restart';
    if (port && !isNaN(parseInt(port, 10))) {
        cmd += ` --port ${parseInt(port, 10)}`;
    }
    const cliPath = path.join(__dirname, '..', 'bin', 'clawapi.js');
    execSync(`node "${cliPath}" ${cmd}`, { stdio: 'ignore', windowsHide: true });
    res.json({ success: true, message: 'Server restart command issued' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Provide management routes
app.post('/api/providers/add', (req, res) => {
    try {
        const { provider } = req.body;
        if (!provider || !registry.exists(provider)) throw new Error('Invalid provider');
        config.setInstalled(provider);
        res.json({ success: true, message: `Added ${provider}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/providers/rm', (req, res) => {
    try {
        const { provider } = req.body;
        if (!provider || !config.isInstalled(provider)) throw new Error('Provider not installed');
        config.setUninstalled(provider);
        res.json({ success: true, message: `Removed ${provider}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/providers/auth', (req, res) => {
    try {
        const { provider } = req.body;
        if (!provider || !config.isInstalled(provider)) throw new Error('Provider not installed');
        
        // Spawning the auth command normally creates a browser window. Do it detached so we don't block.
        const cliPath = path.join(__dirname, '..', 'bin', 'clawapi.js');
        const { spawn } = require('child_process');
        
        const proc = spawn(process.execPath, [cliPath, 'auth', provider], {
            detached: true,
            stdio: 'ignore' // This means the browser window will open, but we won't capture console output.
        });
        proc.unref();

        res.json({ success: true, message: `Authenticator launched for ${provider}. Please complete login in the new window.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Proxy routes removed at user request

app.post('/api/providers/export', (req, res) => {
    try {
        const { provider } = req.body;
        if (!provider || !config.hasSession(provider)) throw new Error('No active session to export.');
        
        const cliPath = path.join(__dirname, '..', 'bin', 'clawapi.js');
        const output = execSync(`node "${cliPath}" export ${provider}`, { encoding: 'utf-8', windowsHide: true });
        
        // Extract archive path
        const match = output.match(/Session exported to (.*)/);
        const p = match ? match[1].replace(/\x1b\[[0-9;]*m/g, '').trim() : "Archive created.";

        res.json({ success: true, message: `Session securely exported to: ${p}` });
    } catch (err) {
        const errOut = err.stdout ? err.stdout.toString().replace(/\x1b\[[0-9;]*m/g, '') : err.message;
        res.status(500).json({ success: false, error: errOut || 'Export failed' });
    }
});

app.post('/api/providers/import', upload.single('file'), (req, res) => {
    let tempPath = null;
    try {
        const { provider } = req.body;
        let filePath = req.body.filePath;

        if (req.file) {
            tempPath = req.file.path;
            filePath = tempPath;
            console.log(`[UI Server] Received file upload for ${provider}: ${req.file.originalname}`);
        }

        console.log(`[UI Server] Import request for ${provider} with path/file: ${filePath}`);
        if (!provider || !filePath) throw new Error('Missing provider or file path.');
        
        const absPath = path.resolve(filePath);
        const cliPath = path.join(__dirname, '..', 'bin', 'clawapi.js');
        
        console.log(`[UI Server] Running import command...`);
        execSync(`node "${cliPath}" import ${provider} "${absPath}"`, { encoding: 'utf-8', windowsHide: true });

        res.json({ success: true, message: `Session successfully imported for ${provider}.` });
    } catch (err) {
        console.error(`[UI Server] Import Error:`, err);
        const errOut = err.stdout ? err.stdout.toString().replace(/\x1b\[[0-9;]*m/g, '') : err.message;
        res.status(500).json({ success: false, error: errOut || 'Import failed' });
    } finally {
        // Clean up temp file if it was an upload
        if (tempPath && fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch (e) {}
        }
    }
});

app.post('/api/providers/test', (req, res) => {
    try {
        const { provider, port } = req.body;
        if (!provider || !registry.exists(provider)) throw new Error('Invalid provider');
        
        const localPort = port || config.getPort();
        const cliPath = path.join(__dirname, '..', 'bin', 'clawapi.js');
        
        // Execute the CLI command. Since the CLI command writes directly to stdout, and uses ANSI color codes and simple loaders, 
        // we'll run it synchronously so we can read the final output to feed back to the UI.
        const output = execSync(`node "${cliPath}" test ${provider}`, { encoding: 'utf-8', windowsHide: true });
        
        // Extract just the actual message to clean up the output
        const match = output.match(/Received:\s+(.*)/);
        const reply = match ? match[1].replace(/\x1b\[[0-9;]*m/g, '').trim() : "Test completed with unparseable string.";

        res.json({ success: true, message: `Test successful: "${reply}"` });
    } catch (err) {
        // execSync throws if exit code != 0
        const errOut = err.stdout ? err.stdout.toString().replace(/\x1b\[[0-9;]*m/g, '') : err.message;
        res.status(500).json({ success: false, error: errOut || 'Test failed' });
    }
});

// Get logs snippet (last 50 lines)
app.get('/api/logs', (req, res) => {
  const logPath = path.join(config.LOGS_DIR, 'clawapi.log');
  if (!fs.existsSync(logPath)) {
    return res.json({ logs: '[No logs found yet]' });
  }

  try {
    let logs = '';
    if (process.platform === 'win32') {
      logs = execSync(`powershell -NoProfile -Command "Get-Content '${logPath}' -Tail 100"`, { encoding: 'utf-8' });
    } else {
      logs = execSync(`tail -n 100 "${logPath}"`, { encoding: 'utf-8' });
    }
    res.json({ logs });
  } catch (err) {
    res.json({ logs: `[Error reading logs: ${err.message}]` });
  }
});

// ── Server Boot ─────────────────────────────────────────────────────────────

async function startUiServer(port) {
  // Ensure the public directory exists
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // Write our PID
  const pidPath = path.join(config.PIDS_DIR, 'ui_server.pid');
  fs.writeFileSync(pidPath, String(process.pid), 'utf-8');

  app.listen(port, '127.0.0.1', () => {
    console.log(`[ClawAPI UI] Web Dashboard running on http://127.0.0.1:${port}`);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  process.exit(0);
});

module.exports = { startUiServer };
