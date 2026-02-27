# ClawAPI

**Browser-based OpenAI-compatible AI Gateway — in Node.js**

> Run AI models like Claude through an automated, headless Playwright session. No API keys needed!
> A 1:1 cross-platform NodeJS rewrite of the GhostAPI python gateway.

## Features
- Provides an **OpenAI-compatible HTTP API** `POST /v1/chat/completions` directly from your local browser.
- Automatically handles web authentication invisibly utilizing Playwright.
- Cross-platform support (runs seamlessly as a detached background service on Windows, Mac, and Linux).
- Colorful native custom CLI.

## Installation

Install globally via NPM:

```bash
npm install -g clawapi
```
*(This commands installs ClawAPI and natively runs a postinstall hook downloading Playwright's Chromium binary needed for web automation.)*

## Usage

### 1. Install and Authenticate an AI Provider

ClawAPI manages an internal registry of LLM providers that are web-scraped. 

```bash
# Add the Claude provider to your registry
clawapi add claude

# Authenticate Claude
clawapi auth claude
```
A browser window will open. Simply log in to Claude with your Google account or email. **Please wait for the web chat UI to fully load.** Once loaded, simply close the browser window. The CLI will save your session!

### 2. Start the Server

Start ClawAPI in the background as a detached REST API server:
```bash
clawapi start
# Or start on a custom port
clawapi start --port 8080
```
*Note: Due to the background headless detachment, no terminal window will block your screen!*

### 3. Send OpenAI-compatible HTTP Requests
Now that the server is active, you can interact with Claude.ai (or any installed provider) using exactly the same schema as OpenAI's official `chat/completions` specifications!

```bash
curl -X POST http://localhost:8855/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "clawapi/claude",
    "messages": [
      {
        "role": "user",
        "content": "Tell me a short joke"
      }
    ]
  }'
```

```json
{
  "id": "chatcmpl-df8a...699",
  "object": "chat.completion",
  "model": "clawapi/claude",
  "choices": [{"message": {"role": "assistant", "content": "Because they make up everything! 😄"}}]
}
```

## CLI Commands Reference
- `clawapi list`: View all authenticated models 
- `clawapi available`: View the registry of all available LLMs
- `clawapi status`: View the port and active/background server statuses 
- `clawapi stop`: Halt the detached HTTP server daemon 
- `clawapi restart`: Safely restage the server 
- `clawapi logs`: Recursively tail the background error/activity streams

### Example (Connecting Picoclaw)
ClawAPI acts identically to OpenAI infrastructure! You can plug it into clients native to ChatGPT effortlessly:
```bash
clawapi picoclaw
```
```json
{
  "api_key": "sk-clawapi",
  "api_base": "http://localhost:8855/v1",
  "model": "clawapi/claude"
}
```
