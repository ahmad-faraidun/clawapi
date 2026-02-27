const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const config = require('./config');
const registry = require('./registry');

const app = express();
app.use(express.json());
app.use(cors());

// Global state
let _playwright = null;
let _providers = {}; // { name: { page, ctx, busy_lock } }

// ── Background Lifecycle ──────────────────────────────────────────────────────

async function initProvider(name, sessionDir) {
  const providerData = registry.get(name);
  if (!providerData) return;

  try {
    const ctx = await chromium.launchPersistentContext(sessionDir, {
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page = await ctx.newPage();
    await page.addInitScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})");

    _providers[name] = {
      page,
      ctx,
      lock: Promise.resolve(), // Simple async queue
      providerData
    };

    console.log(`[ClawAPI] OK  ${providerData.displayName} ready`);
  } catch (err) {
    console.error(`[ClawAPI] ERR Failed to init ${name}:`, err.message);
  }
}

async function closeProvider(name) {
  if (_providers[name]) {
    await _providers[name].ctx.close();
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
    const page = state.page;
    const provider = state.providerData;
    const sel = provider.selectors;

    try {
      await page.goto(provider.url, { timeout: 30000 });
      await page.waitForTimeout(2000);

      await page.waitForSelector(sel.input, { timeout: 15000 });
      await page.waitForTimeout(300);
      await page.click(sel.input);
      await page.waitForTimeout(300);
      
      // Simulate slow typing for bots
      for (let char of prompt) {
        if (char === '\n') {
          await page.keyboard.down('Shift');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Shift');
        } else {
          await page.keyboard.insertText(char);
        }
      }
      
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);

      // Wait for stop button to appear
      for (let i = 0; i < 10; i++) {
        const stop = await page.$(sel.stop_button);
        if (stop) break;
        await page.waitForTimeout(500);
      }

      // Wait for stop button to disappear
      for (let i = 0; i < 120; i++) {
        const stop = await page.$(sel.stop_button);
        if (!stop) break;
        await page.waitForTimeout(1000);
      }

      await page.waitForTimeout(1000);

      for (const selector of sel.response) {
        const els = await page.$$(selector);
        if (els.length > 0) {
          return (await els[els.length - 1].innerText()).trim();
        }
      }

      return "Response received but could not be extracted. Selectors may need updating.";
    } catch (err) {
      return `[${name} error]: ${err.message}`;
    }
  });
}

// ── API Routes ─────────────────────────────────────────────────────────────────

app.get('/v1/models', (req, res) => {
  const models = registry.allNames().map(name => {
    const data = registry.get(name);
    return {
      id: `clawapi/${name}`,
      object: 'model',
      created: 1677610602,
      owned_by: 'clawapi',
      provider: name,
      display_name: data.displayName,
      vendor: data.vendor,
      active: !!_providers[name],
      authenticated: config.hasSession(name),
    };
  });
  res.json({ object: 'list', data: models });
});

app.post('/v1/chat/completions', async (req, res) => {
  const body = req.body;
  const modelRaw = body.model || '';

  if (!modelRaw.startsWith('clawapi/')) {
    const available = registry.allNames().join(', ');
    return res.status(400).json({ error: { message: `Missing 'model' field. Use format: clawapi/<provider>  e.g. clawapi/claude | Available: ${available}` } });
  }

  const providerName = modelRaw.replace('clawapi/', '');

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
      id: `chatcmpl-${uuidv4()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: `clawapi/${providerName}`,
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
  const installed = registry.allNames().filter(n => config.isInstalled(n));
  const authed = installed.filter(n => config.hasSession(n));
  
  const tasks = authed.map(name => {
    const sessionDir = path.join(config.SESSIONS_DIR, name);
    return initProvider(name, sessionDir);
  });

  await Promise.all(tasks);

  app.listen(port, () => {
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
