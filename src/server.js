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

async function ask(name, prompt, options = {}) {
  const { stream = false, onChunk = null, tools = null } = options;
  if (!_providers[name]) throw new Error(`Provider '${name}' is not running.`);

  return await withLock(name, async () => {
    const state = _providers[name];
    
    if (name === 'claude') {
      try {
        const baseHeaders = {
          'Cookie': state.cookies,
          'User-Agent': state.userAgent,
          'Accept': '*/*',
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
          'anthropic-version': '2023-06-01',
          'anthropic-client-version': '5.4.3',
          'anthropic-client-sha': 'da0583fac'
        };

        // 1. Get Organization
        const orgsRes = await fetch('https://claude.ai/api/organizations', { headers: baseHeaders });
        if (!orgsRes.ok) {
           const errBody = await orgsRes.text();
           console.error(`[ClawAPI] Auth Check Failed (${orgsRes.status}):`, errBody);
           throw new Error(`Auth failed (${orgsRes.status})`);
        }
        const orgs = await orgsRes.json();
        const orgId = orgs[0].uuid;

        // 2. Create Conversation
        const convId = require('crypto').randomUUID();
        const convCreateRes = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations`, {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify({ uuid: convId, name: "ClawAPI Session" })
        });
        if (!convCreateRes.ok) throw new Error(`Conv create failed (${convCreateRes.status})`);

        // 3. Try Models (Fallback sequence for account-specific availability)
        const modelsToTry = [
          "claude-sonnet-4-6",
          "claude-opus-4-6",
          "claude-sonnet-4",
          "claude-3-7-sonnet-20250219",
          "claude-3-5-sonnet-latest",
          "claude-3-5-sonnet-20241022",
          "claude-3-5-sonnet-20240620", 
          "claude-3-haiku-20240307",
          "claude-2.1"
        ];
        
        let finalText = "";
        let toolCalls = [];
        let success = false;

        for (const modelName of modelsToTry) {
          const completionBody = {
            prompt: prompt,
            timezone: "UTC",
            model: modelName,
            rendering_mode: "markdown"
          };

          if (tools && Array.isArray(tools)) {
            completionBody.tools = tools.map(t => ({
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters
            }));
          }

          const completionRes = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations/${convId}/completion`, {
            method: 'POST',
            headers: { 
              ...baseHeaders, 
              'Accept': 'text/event-stream',
              'Sec-Fetch-User': '?1'
            },
            body: JSON.stringify(completionBody)
          });

          if (!completionRes.ok) {
             const errBody = await completionRes.text();
             console.error(`[ClawAPI] Model ${modelName} Failed (${completionRes.status}):`, errBody);
             continue;
          }

          const reader = completionRes.body.getReader();
          const decoder = new TextDecoder();
          success = true;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.completion) {
                    finalText += data.completion;
                    if (stream && onChunk) onChunk({ content: data.completion });
                  }
                  if (data.tool_use) {
                     const tc = {
                       id: data.tool_use.id,
                       type: "function",
                       function: {
                         name: data.tool_use.name,
                         arguments: JSON.stringify(data.tool_use.input)
                       }
                     };
                     toolCalls.push(tc);
                     if (stream && onChunk) onChunk({ tool_calls: [tc] });
                  }
                } catch (e) {}
              }
            }
          }
          if (success) break;
        }

        if (!success) throw new Error("All models failed or refused (last was 403/Forbidden)");
        
        return { text: finalText.trim(), tool_calls: toolCalls.length > 0 ? toolCalls : null };

      } catch (err) { throw err; }
    }
    throw new Error(`Provider ${name} implementation missing.`);
  });
}

// ── API Routes ─────────────────────────────────────────────────────────────────

app.get('/v1/health', (req, res) => {
  res.json({ status: "ok", version: "1.1.1", providers: Object.keys(_providers) });
});

app.get('/v1/models', (req, res) => {
  const models = [];
  registry.allNames().forEach(name => {
    const data = registry.get(name);
    const baseModel = {
      object: 'model',
      created: 1677610602,
      owned_by: 'clawapi',
      context_window: data.contextWindow || 200000,
      display_name: data.displayName,
      vendor: data.vendor,
      active: !!_providers[name],
      authenticated: config.hasSession(name),
    };
    // Advertise plain name first as per spec
    models.push({ id: name, ...baseModel });
    // Keep prefix as optional hidden support
    // models.push({ id: `clawapi/${name}`, ...baseModel }); 
  });
  res.json({ object: 'list', data: models });
});

app.post('/v1/chat/completions', async (req, res) => {
  const body = req.body;
  const modelRaw = body.model || '';
  const stream = !!body.stream;

  if (!modelRaw) {
    return res.status(400).json({ error: { message: "Missing 'model' field.", type: "invalid_request_error" } });
  }

  const providerName = modelRaw.includes('/') ? modelRaw.split('/').pop() : modelRaw;
  if (!registry.exists(providerName)) {
    return res.status(404).json({ error: { message: `Model '${providerName}' not found.`, type: "invalid_request_error", code: "model_not_found" } });
  }

  if (!config.hasSession(providerName)) {
    return res.status(401).json({ error: { message: `Provider '${providerName}' not authenticated.`, type: "authentication_error" } });
  }

  const messages = body.messages || [];
  const prompt = messages.map(m => {
    if (m.role === 'system') return `[System]: ${m.content}`;
    if (m.role === 'assistant') return `[Assistant]: ${m.content}`;
    return m.content;
  }).join('\n\n');

  const chatcmplId = `chatcmpl-${require('crypto').randomBytes(12).toString('hex')}`;
  const created = Math.floor(Date.now() / 1000);

  try {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      await ask(providerName, prompt, {
        stream: true,
        tools: body.tools,
        onChunk: (chunk) => {
          const sseData = {
            id: chatcmplId,
            object: "chat.completion.chunk",
            created,
            model: modelRaw,
            choices: [{
              index: 0,
              delta: chunk,
              finish_reason: null
            }]
          };
          res.write(`data: ${JSON.stringify(sseData)}\n\n`);
        }
      });

      res.write(`data: [DONE]\n\n`);
      res.end();
    } else {
      const result = await ask(providerName, prompt, { tools: body.tools });
      const promptTokens = Math.ceil(prompt.length / 4);
      const completionTokens = Math.ceil((result.text || "").length / 4);

      res.json({
        id: chatcmplId,
        object: "chat.completion",
        created,
        model: modelRaw,
        choices: [{
          index: 0,
          message: { 
            role: "assistant", 
            content: result.text,
            tool_calls: result.tool_calls 
          },
          finish_reason: result.tool_calls ? "tool_calls" : "stop"
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        }
      });
    }
  } catch (err) {
    console.error(`[ClawAPI] Chat Error:`, err);
    res.status(500).json({ error: { message: err.message, type: "server_error" } });
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

  app.post('/v1/completions', async (req, res) => {
  const body = req.body;
  const prompt = body.prompt || '';
  const modelRaw = body.model || 'claude';

  // Wrap legacy prompt into OpenAI chat format
  req.body.messages = [{ role: "user", content: prompt }];
  
  // Reuse chat/completions logic internally but adjust response format if not streaming
  if (body.stream) {
    return app._router.handle(req, res); 
  }

  // Override capture for JSON response to match legacy shape
  const originalJson = res.json;
  res.json = (data) => {
    if (data.choices && data.choices[0].message) {
      const legacyData = {
        id: data.id.replace('chatcmpl-', 'cmpl-'),
        object: "text_completion",
        created: data.created,
        model: data.model,
        choices: [{
          text: data.choices[0].message.content,
          index: 0,
          logprobs: null,
          finish_reason: data.choices[0].finish_reason
        }],
        usage: data.usage
      };
      return originalJson.call(res, legacyData);
    }
    return originalJson.call(res, data);
  };

  return app._router.handle(req, res);
});

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
