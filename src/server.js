const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const registry = require('./registry');

const app = express();
app.use(express.json());
app.use(cors());

// Global state
let _providers = {}; // { name: { cookies: string, userAgent: string, lock: Promise } }

// ── Background Lifecycle ──────────────────────────────────────────────────────

async function initProvider(name, sessionDir) {
  const providerData = registry.get(name);
  if (!providerData) return;

  try {
    const cookiesPath = path.join(sessionDir, 'cookies.json');
    if (!fs.existsSync(cookiesPath)) throw new Error("No cookies.json found. Please re-authenticate.");
    
    // Parse Playwright/Proxy cookies back into a standard cookie string
    const cookieData = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
    let cookieString = "";
    
    if (Array.isArray(cookieData)) {
      // It's a Playwright cookie array
      cookieString = cookieData.map(c => `${c.name}=${c.value}`).join('; ');
    } else if (cookieData.cookieString) {
      // Custom proxy format
      cookieString = cookieData.cookieString;
    }

    let userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const uaPath = path.join(sessionDir, 'userAgent.txt');
    if (fs.existsSync(uaPath)) {
      userAgent = fs.readFileSync(uaPath, 'utf8').trim() || userAgent;
      console.log(`[ClawAPI] Loaded custom User-Agent from file.`);
    } else {
      console.log(`[ClawAPI] WARN: No userAgent.txt found. Using default UA.`);
    }

    _providers[name] = {
      cookies: cookieString,
      userAgent: userAgent,
      lock: Promise.resolve(), // Simple async queue
      providerData
    };

    console.log(`[ClawAPI] OK  ${providerData.displayName} ready (HTTP Mode)`);
  } catch (err) {
    console.error(`[ClawAPI] ERR Failed to init ${name}:`, err.message);
  }
}

async function closeProvider(name) {
  if (_providers[name]) {
    delete _providers[name];
  }
}

// Simple mutex queue
async function withLock(name, fn) {
  const state = _providers[name];
  const oldLock = state.lock;
  let release;
  state.lock = new Promise(resolve => { release = resolve; });
  try {
    await oldLock;
    return await fn();
  } finally {
    release();
  }
}

// ── Core AI Ask Logic ──────────────────────────────────────────────────────

async function ask(name, prompt) {
  if (!_providers[name]) throw new Error(`Provider '${name}' is not running.`);

  return await withLock(name, async () => {
    const state = _providers[name];
    
    // For now, we only have specialized logic for Claude
    if (name === 'claude') {
      try {
        const baseHeaders = {
          'Cookie': state.cookies,
          'User-Agent': state.userAgent,
          'Accept': 'application/json, text/event-stream',
          'Accept-Language': 'en-US,en;q=0.9',
          'Content-Type': 'application/json',
          'Referer': 'https://claude.ai/chat',
          'Origin': 'https://claude.ai',
          'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'anthropic-client-version': '5.4.3',
          'anthropic-client-sha': 'da0583fac' // Mocked SHA
        };

        // 1. Get Organization ID
        const orgsRes = await fetch('https://claude.ai/api/organizations', { headers: baseHeaders });
        if (!orgsRes.ok) {
           const body = await orgsRes.text().catch(() => "");
           throw new Error(`Auth failed (HTTP ${orgsRes.status}). Please re-authenticate.`);
        }
        const orgs = await orgsRes.json();
        const orgId = orgs[0].uuid;

        // 2. Create conversation
        const crypto = require('crypto');
        const convId = crypto.randomUUID();
        const createRes = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations`, {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify({ uuid: convId, name: "ClawAPI Session" })
        });
        if (!createRes.ok) {
           const body = await createRes.text().catch(() => "");
           throw new Error(`Failed to create conversation (HTTP ${createRes.status})`);
        }

        // 2.5 Probe Available Models (New Step)
        let availableModels = [];
        try {
          const mRes = await fetch(`https://claude.ai/api/organizations/${orgId}/models`, { headers: baseHeaders });
          if (mRes.ok) {
             const models = await mRes.json();
             availableModels = models.map(m => m.model);
          }
        } catch(e) {
          // Model probe failed, using hardcoded fallback.
        }

        // 3. Completion with Auto-Detection
        const modelsToTry = [
          "claude-haiku-4-5-20251001", // User suggested
          ...availableModels,
          "claude-3-5-sonnet-20240620", 
          "claude-3-haiku-20240307",
          "claude-2.1",
          "claude-2.0"
        ];
        let lastError = null;
        let finalText = "";

        for (const modelName of modelsToTry) {
          const completionRes = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations/${convId}/completion`, {
            method: 'POST',
            headers: baseHeaders,
            body: JSON.stringify({
              prompt: prompt,
              timezone: "UTC",
              model: modelName,
              attachments: [],
              files: [],
              rendering_mode: "markdown"
            })
          });

          if (!completionRes.ok) {
            const errBody = await completionRes.text().catch(() => "{}");
            let errJson = {};
            try { errJson = JSON.parse(errBody); } catch(e) {}
            
            if (errJson.error && errJson.error.type === "permission_error" && errJson.error.details && errJson.error.details.error_code === "model_not_available") {
              lastError = `Model ${modelName} not available`;
              continue;
            }
            
            throw new Error(`Claude API rejected response (HTTP ${completionRes.status})`);
          }

          // 4. Parse the SSE Stream
          const reader = completionRes.body.getReader();
          const decoder = new TextDecoder();
          let done = false;

          while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.completion) {
                      finalText += data.completion;
                    }
                    if (data.stop_reason) done = true;
                  } catch (e) {}
                }
              }
            }
          }
          
          if (finalText) break; // Success!
        }

        if (!finalText && lastError) throw new Error(lastError);
        
        return finalText.trim() || "[No response received from Claude]";

        // Cleanup: Ideally we'd delete the temp conversation, but Claude limits deletion rate.
        // We'll leave it for now.
        
        return finalText.trim() || "[No response received from Claude]";

      } catch (err) {
        return `[Claude error]: ${err.message}`;
      }
    }

    // Generic fallback for other providers (to be implemented)
    return `[Provider ${name}]: Native HTTP engine not yet implemented for this provider.`;
  });
}

// ── API Routes ─────────────────────────────────────────────────────────────────

app.get('/v1/models', (req, res) => {
  const models = [];
  registry.allNames().forEach(name => {
    const data = registry.get(name);
    const baseModel = {
      object: 'model',
      created: 1677610602,
      owned_by: 'clawapi',
      provider: name,
      display_name: data.displayName,
      vendor: data.vendor,
      active: !!_providers[name],
      authenticated: config.hasSession(name),
    };
    models.push({ id: `clawapi/${name}`, ...baseModel });
    models.push({ id: name, ...baseModel });
  });
  res.json({ object: 'list', data: models });
});

app.post('/v1/chat/completions', async (req, res) => {
  const body = req.body;
  const modelRaw = body.model || '';

  if (!modelRaw) {
    const available = registry.allNames().join(', ');
    return res.status(400).json({ error: { message: `Missing 'model' field. Use: claude, clawapi/claude | Available: ${available}` } });
  }

  // Accept both "clawapi/claude" and plain "claude"
  const providerName = modelRaw.includes('/') ? modelRaw.split('/').pop() : modelRaw;

  if (!registry.exists(providerName)) {
    return res.status(404).json({ error: { message: `Provider '${providerName}' does not exist in the ClawAPI registry.` } });
  }

  if (!config.hasSession(providerName)) {
    return res.status(401).json({ error: { message: `Provider '${providerName}' has no saved session.` } });
  }

  if (!_providers[providerName]) {
    return res.status(503).json({ error: { message: `Provider '${providerName}' is installed but not currently active. Restart ClawAPI: clawapi restart` } });
  }

  const messages = body.messages || [];
  const parts = [];
  
  for (const m of messages) {
    const role = m.role || 'user';
    const content = m.content || '';
    if (role === 'system') parts.push(`[Instructions]: ${content}`);
    else if (role === 'user') parts.push(content);
    else if (role === 'assistant') parts.push(`[Previous reply]: ${content}`);
  }
  
  const prompt = parts.join('\n\n');

  try {
    const responseText = await ask(providerName, prompt);
    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelRaw,
      choices: [{
        index: 0,
        message: { role: "assistant", content: responseText },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: prompt.length, completion_tokens: responseText.length, total_tokens: prompt.length + responseText.length }
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// Startup hook wrapper internally exposed to src/cli.js
async function startServer(port) {
  // Write our own PID so the CLI can track us reliably
  const fs2 = require('fs');
  const pidPath = path.join(config.PIDS_DIR, 'server.pid');
  fs2.writeFileSync(pidPath, String(process.pid), 'utf-8');

  const installed = registry.allNames().filter(n => config.isInstalled(n));
  const authed = installed.filter(n => config.hasSession(n));
  
  const tasks = authed.map(name => {
    const sessionDir = path.join(config.SESSIONS_DIR, name);
    return initProvider(name, sessionDir);
  });

  await Promise.all(tasks);

  app.listen(port, '127.0.0.1', () => {
    console.log(`[ClawAPI] HTTP server running on http://127.0.0.1:${port}`);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    for (const name of Object.keys(_providers)) {
        await closeProvider(name);
    }
    process.exit(0);
});

module.exports = { startServer };
