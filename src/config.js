const fs = require('fs');
const path = require('path');
const os = require('os');

class Config {
  constructor() {
    this.ROOT_DIR = path.join(os.homedir(), '.clawapi');
    this.SESSIONS_DIR = path.join(this.ROOT_DIR, 'sessions');
    this.LOGS_DIR = path.join(this.ROOT_DIR, 'logs');
    this.PIDS_DIR = path.join(this.ROOT_DIR, 'pids');

    this._ensureDirs();
  }

  _ensureDirs() {
    [this.ROOT_DIR, this.SESSIONS_DIR, this.LOGS_DIR, this.PIDS_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  hasSession(providerName) {
    const sessionPath = path.join(this.SESSIONS_DIR, providerName);
    return fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0;
  }

  isInstalled(providerName) {
    return fs.existsSync(path.join(this.ROOT_DIR, 'installed', providerName)); // Simulating install flags
  }

  setInstalled(providerName) {
    const installDir = path.join(this.ROOT_DIR, 'installed');
    if (!fs.existsSync(installDir)) fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, providerName), 'true', 'utf-8');
  }

  setUninstalled(providerName) {
    const p = path.join(this.ROOT_DIR, 'installed', providerName);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  setPort(port) {
    fs.writeFileSync(path.join(this.ROOT_DIR, 'current_port'), String(port), 'utf-8');
  }

  getPort() {
    const p = path.join(this.ROOT_DIR, 'current_port');
    if (fs.existsSync(p)) {
      return parseInt(fs.readFileSync(p, 'utf-8'), 10);
    }
    return 8855; // Default fallback port
  }
}

module.exports = new Config();
