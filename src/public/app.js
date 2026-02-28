// DOM Elements
const els = {
    statusDot: document.getElementById('statusDot'),
    statusLabel: document.getElementById('statusLabel'),
    statusPid: document.getElementById('statusPid'),
    serverStatusCard: document.getElementById('serverStatusCard'),

    btnStart: document.getElementById('btnStart'),
    btnRestart: document.getElementById('btnRestart'),
    btnStop: document.getElementById('btnStop'),
    btnRefreshLogs: document.getElementById('btnRefreshLogs'),

    providerCount: document.getElementById('providerCount'),
    providerList: document.getElementById('providerList'),

    infoPort: document.getElementById('infoPort'),
    infoPlatform: document.getElementById('infoPlatform'),
    infoUrl: document.getElementById('infoUrl'),

    serverPort: document.getElementById('serverPort'),
    availableProviders: document.getElementById('availableProviders'),
    btnAddProvider: document.getElementById('btnAddProvider'),

    logOutput: document.getElementById('logOutput'),
    toastContainer: document.getElementById('toastContainer')
};

// State
let isRunning = false;
let port = 8855;

// API Calls
async function apiCall(endpoint, method = 'GET') {
    try {
        const res = await fetch(`/api/${endpoint}`, { method });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error(`API Error (${endpoint}):`, err);
        showToast(err.message, 'error');
        return null;
    }
}

// Update UI Functions
function updateStatusUI(data) {
    if (!data) return;

    isRunning = data.serverRunning;
    port = data.port || 8855;

    // Header Status
    if (isRunning) {
        els.statusDot.className = 'status-indicator online';
        els.statusLabel.textContent = 'Server Online';
        els.statusPid.textContent = `PID: ${data.serverPid}`;
        
        els.btnStart.disabled = true;
        els.btnRestart.disabled = false;
        els.btnStop.disabled = false;
    } else {
        els.statusDot.className = 'status-indicator offline';
        els.statusLabel.textContent = 'Server Offline';
        els.statusPid.textContent = 'Standby';

        els.btnStart.disabled = false;
        els.btnRestart.disabled = true;
        els.btnStop.disabled = true;
    }

    // System Info
    els.infoPort.textContent = port;
    els.infoPlatform.textContent = data.platform;
    els.infoUrl.textContent = `http://localhost:${els.serverPort.value || port}/v1`;

    // Available Providers Dropdown
    if (data.availableProviders) {
        els.availableProviders.innerHTML = '<option value="" disabled selected>Add Provider...</option>' + 
            data.availableProviders.map(p => `<option value="${p.name}">${p.displayName}</option>`).join('');
    }

    // Providers List
    els.providerCount.textContent = (data.providers || []).length;
    
    if (!data.providers || data.providers.length === 0) {
        els.providerList.innerHTML = `<div class="empty-state">No providers installed via CLI yet.</div>`;
    } else {
        els.providerList.innerHTML = data.providers.map(p => {
            let statusHtml = '';
            let iconClass = 'ph-robot';
            
            if (p.name.includes('claude')) iconClass = 'ph-brain';
            else if (p.name.includes('gpt')) iconClass = 'ph-sparkle';

            if (!p.authenticated) {
                statusHtml = '<span class="stat-badge unauth">Not Logged In</span>';
            } else if (p.active) {
                statusHtml = '<span class="stat-badge ready">Active & Ready</span>';
            } else {
                statusHtml = '<span class="stat-badge idle">Installed</span>';
            }

            return `
                <div class="provider-item">
                    <div class="provider-main">
                        <div class="provider-icon"><i class="ph ${iconClass}"></i></div>
                        <div class="provider-details">
                            <h3>${p.displayName}</h3>
                            <p>${p.vendor} | ${p.name}</p>
                        </div>
                    </div>
                    <div class="provider-actions">
                        ${statusHtml}
                        <button class="btn btn-icon interactive" onclick="handleProviderAction(this, 'auth', '${p.name}')" title="Authenticate"><i class="ph ph-key"></i></button>
                        <button class="btn btn-icon interactive" onclick="handleProviderAction(this, 'export', '${p.name}')" title="Export Session (Zip)"><i class="ph ph-download-simple"></i></button>
                        <button class="btn btn-icon interactive" onclick="triggerImportDialog('${p.name}')" title="Import Session (Zip)"><i class="ph ph-upload-simple"></i></button>
                        <button class="btn btn-icon interactive" onclick="handleProviderAction(this, 'test', '${p.name}')" title="Test API"><i class="ph ph-lightning"></i></button>
                        <button class="btn btn-icon interactive" onclick="handleProviderAction(this, 'rm', '${p.name}')" title="Remove"><i class="ph ph-trash" style="color: var(--danger)"></i></button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

async function fetchLogs() {
    const data = await apiCall('logs');
    if (data && data.logs) {
        els.logOutput.textContent = data.logs;
        els.logOutput.parentElement.scrollTop = els.logOutput.parentElement.scrollHeight;
    }
}

async function refreshData() {
    const statusData = await apiCall('status');
    updateStatusUI(statusData);
    await fetchLogs();
}

// Action Handlers
async function handleAction(action) {
    const btnMap = {
        'start': els.btnStart,
        'stop': els.btnStop,
        'restart': els.btnRestart
    };
    
    const btn = btnMap[action];
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Processing...';
    btn.disabled = true;

    try {
        const payload = { port: els.serverPort.value || 8855 };
        const res = await fetch(`/api/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data && data.success) {
            showToast(`Server ${action} command sent`, 'success');
            if (action === 'proxy/start') {
                showModal({ title: 'Proxy Bridge Online', message: data.message, type: 'info' });
            }
            setTimeout(refreshData, 1500); // Wait for bg process to boot/die
        } else {
            showToast(data.error || 'Request failed', 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        setTimeout(() => {
            btn.innerHTML = originalText;
            refreshData();
        }, 2000);
    }
}

// Modal System
function showModal({ title, message, type = 'info', confirmText = 'OK', cancelText = null, onConfirm = null }) {
    const modal = document.getElementById('customModal');
    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMessage');
    const footerEl = document.getElementById('modalFooter');
    const closeBtn = document.getElementById('btnModalClose');

    let icon = 'ph-info';
    let iconColor = 'var(--accent-primary)';
    if (type === 'warning') { icon = 'ph-warning'; iconColor = 'var(--warning)'; }
    if (type === 'error') { icon = 'ph-warning-circle'; iconColor = 'var(--danger)'; }
    if (type === 'success') { icon = 'ph-check-circle'; iconColor = 'var(--success)'; }

    titleEl.innerHTML = `<i class="ph ${icon}" style="color: ${iconColor}"></i> ${title}`;
    msgEl.textContent = message;

    footerEl.innerHTML = '';
    
    const hideModal = () => {
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    };

    if (cancelText) {
        const btnCancel = document.createElement('button');
        btnCancel.className = 'btn btn-secondary interactive';
        btnCancel.textContent = cancelText;
        btnCancel.onclick = hideModal;
        footerEl.appendChild(btnCancel);
    }

    const btnConfirm = document.createElement('button');
    btnConfirm.className = `btn btn-${type === 'error' || type === 'warning' ? 'danger' : 'primary'} interactive`;
    btnConfirm.textContent = confirmText;
    btnConfirm.onclick = () => {
        hideModal();
        if (onConfirm) onConfirm();
    };
    footerEl.appendChild(btnConfirm);

    closeBtn.onclick = hideModal;

    modal.style.display = 'flex';
    void modal.offsetWidth; // trigger reflow
    modal.classList.add('active');
}

async function handleProviderAction(btn, action, providerName) {
    if (action === 'rm') {
        showModal({
            title: 'Remove Provider',
            message: `Are you sure you want to remove the provider "${providerName}"?`,
            type: 'warning',
            confirmText: 'Remove',
            cancelText: 'Cancel',
            onConfirm: () => executeProviderAction(btn, action, providerName)
        });
        return;
    }
    await executeProviderAction(btn, action, providerName);
}

async function triggerImportDialog(providerName) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = async () => {
        if (!input.files || input.files.length === 0) return;
        
        const file = input.files[0];
        const formData = new FormData();
        formData.append('provider', providerName);
        formData.append('file', file);

        showToast(`Uploading session for ${providerName}...`, 'info');

        try {
            const res = await fetch('/api/providers/import', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            if (data && data.success) {
                showToast(`Session imported successfully!`, 'success');
                setTimeout(refreshData, 1000);
            } else {
                showToast(data.error || 'Import failed', 'error');
            }
        } catch (err) {
            showToast(err.message, 'error');
        }
    };
    input.click();
}

async function executeProviderAction(btn, action, providerName, extraPayload = {}) {
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
        btn.disabled = true;
    }

    try {
        const payload = { provider: providerName, port: els.serverPort.value || 8855, ...extraPayload };
        const res = await fetch(`/api/providers/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data && data.success) {
            if (action === 'test') {
                showToast(data.message.substring(0, 50) + (data.message.length > 50 ? '...' : ''), 'success');
                showModal({ title: `Test: ${providerName}`, message: data.message, type: 'success' });
            } else if (action === 'export') {
                showModal({ title: 'Export Successful', message: data.message, type: 'success' });
            } else {
                showToast(data.message, 'success');
                if (action === 'auth') {
                    showModal({ 
                        title: 'Authentication Started', 
                        message: data.message, 
                        type: 'info' 
                    });
                }
            }
            refreshData();
        } else {
            showToast(data.error || 'Failed action', 'error');
            if (action === 'test' || action === 'export' || action === 'import') {
                showModal({ title: `Action Failed: ${providerName}`, message: data.error || 'Unknown error occurred.', type: 'error' });
            }
        }
    } catch (err) {
        showToast(err.message, 'error');
        if (action === 'test') {
            showModal({ title: `Test Failed: ${providerName}`, message: err.message, type: 'error' });
        }
    } finally {
        if (btn) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }
}

async function handleAddProvider() {
    const providerName = els.availableProviders.value;
    if (!providerName) return showToast('Please select a provider to add', 'error');

    await executeProviderAction(els.btnAddProvider, 'add', providerName);
    els.availableProviders.value = "";
}

// Toast Notifications
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ph-info';
    if (type === 'success') icon = 'ph-check-circle';
    if (type === 'error') icon = 'ph-warning-circle';

    toast.innerHTML = `<i class="ph ${icon}"></i> <span>${message}</span>`;
    els.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Event Listeners
els.btnStart.addEventListener('click', () => handleAction('start'));
els.btnStop.addEventListener('click', () => handleAction('stop'));
els.btnRestart.addEventListener('click', () => handleAction('restart'));
els.btnRefreshLogs.addEventListener('click', fetchLogs);

els.btnAddProvider.addEventListener('click', handleAddProvider);

// Dynamic URL update when port input changes
els.serverPort.addEventListener('input', () => {
    const p = els.serverPort.value || port || 8855;
    els.infoUrl.textContent = `http://localhost:${p}/v1`;
});

// Initialize
refreshData();
const interval = setInterval(() => {
    refreshData();
}, 5000); // Auto-refresh every 5s
