# Awto

Smart personal-detail autofill Chrome extension that uses an LLM to map a user's stored profile to form fields semantically. Awto is privacy-first, runs locally by default, and falls back to the cloud only when explicitly configured by the user.

## Status

v0.1.0, alpha. Not yet on the Chrome Web Store.

## Install (dev)

### Prerequisites

- Node.js 16+
- npm or yarn
- Chrome or Chromium-based browser

### Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/FallenUns/awto.git
   cd awto
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```
   This produces a `dist/` directory containing the compiled extension.

4. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable Developer mode (toggle in the top-right corner)
   - Click "Load unpacked"
   - Select the `dist/` folder
   - The Awto extension should now appear in your toolbar

## Set up the local LLM

Awto uses a local Ollama instance by default for maximum privacy.

1. Install Ollama:
   ```bash
   brew install ollama
   ```

2. Pull the default model:
   ```bash
   ollama pull llama3.2
   ```

3. Allow the extension to talk to Ollama.

   Ollama only answers requests from allow-listed origins. Chrome sends a
   `chrome-extension://<id>` origin that Ollama rejects with **HTTP 403** by
   default, so you must add it to `OLLAMA_ORIGINS` **before starting the server**:

   - **CLI (`ollama serve`):**
     ```bash
     OLLAMA_ORIGINS="chrome-extension://*" ollama serve
     ```
   - **macOS desktop app (recommended — automated):** run the bundled installer
     once. It installs a LaunchAgent that sets `OLLAMA_ORIGINS` at every login
     (so it survives reboots) and applies it to the current session immediately:
     ```bash
     ./scripts/install-ollama-origins-agent.sh
     ```
     Then restart Ollama once (quit the menu-bar app and reopen) so the running
     server inherits the value. To remove it later:
     ```bash
     ./scripts/install-ollama-origins-agent.sh --uninstall
     ```
   - **macOS desktop app (manual, one-off):** set it for the current login
     session only — this does **not** survive a reboot:
     ```bash
     launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
     ```

   For a tighter allow-list, replace `chrome-extension://*` with your extension's
   exact id (`chrome-extension://<id>`, copy it from `chrome://extensions`). The
   installer accepts it as an argument:
   `./scripts/install-ollama-origins-agent.sh "chrome-extension://<id>"`.

4. Start Ollama. With the CLI, the command in step 3 already starts it. With the
   macOS app, launch (or relaunch) it after setting the variable.

5. Verify it is running and reachable from the extension origin:
   ```bash
   curl http://localhost:11434/api/version
   curl -H "Origin: chrome-extension://test" http://localhost:11434/api/version
   ```
   The first returns the version JSON. The second must **also** return `200`
   (not `403`) — that confirms `OLLAMA_ORIGINS` is set correctly. A plain `curl`
   sends no `Origin` header, so it can succeed even when the extension is blocked.

   **Still getting HTTP 403 after all of the above?** The most common cause is a
   stale server: the `OLLAMA_ORIGINS` value is set, but the Ollama process that is
   *currently running* was started **before** the value existed, so it never
   inherited it. A normal "Quit Ollama" from the menu bar often just hides the app
   — the background `ollama serve` keeps holding port 11434 with the old env. Fully
   stop every Ollama process and relaunch:
   ```bash
   # 1. Confirm the value is set for your login session
   launchctl getenv OLLAMA_ORIGINS        # expect: chrome-extension://*

   # 2. Check whether the RUNNING server actually has it
   ps eww "$(pgrep -f 'Resources/ollama serve')" | tr ' ' '\n' | grep OLLAMA_ORIGINS \
     || echo "running server is missing OLLAMA_ORIGINS — restart needed"

   # 3. Kill everything and relaunch so the new server inherits the value
   pkill -9 -f "Ollama.app"; pkill -9 -f "ollama serve"
   open -a Ollama

   # 4. Re-test (should now be 200)
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Origin: chrome-extension://test" http://localhost:11434/api/tags
   ```
   After relaunch, step 2's command should print `OLLAMA_ORIGINS=chrome-extension://*`.

## (Optional) Cloud fallback

Awto can fall back to Anthropic's Claude API for form fills when the local LLM is uncertain or unavailable. To enable this:

1. Open the Awto extension's options page:
   - Right-click the Awto toolbar icon
   - Select "Options"

2. Paste your Anthropic API key in the designated field and save

Your API key is stored securely in `chrome.storage.local` on your machine and never transmitted except to Anthropic's servers when you explicitly use the cloud fallback.

## Use

1. Visit any webpage with a form
2. Click the Awto toolbar icon
3. Review the preview of what will be auto-filled
4. Click "Fill" to apply the form fill, or "Cancel" to skip

## Develop

- **Live development** (with hot-reload): `npm run dev`
- **Type checking**: `npm run typecheck`
- **Run tests**: `npm run test`
- **Watch tests**: `npm run test:watch`
- **Build for production**: `npm run build`

## Project structure

```
src/
├── background/          # Service worker and LLM client logic
│   └── llm/            # LLM prompt, local Ollama, cloud Anthropic, hybrid orchestration
├── content/            # Content script (form scanner, filler, message listener)
├── popup/              # Popup UI (confirmation flow)
├── options/            # Options page (profile editor, LLM settings)
├── shared/             # Zod schemas, storage wrapper, message types
└── assets/             # Icons and static assets

dist/                   # Built extension (generated by `npm run build`)
```

## Architecture

For detailed design and implementation notes, see:

- `CLAUDE.md` — Development journal and decision log
- `PLAN.md` — Overall feature roadmap and design approach
- `DESIGN_SYSTEM.md` — React component architecture and patterns
- `graphify-out/GRAPH_REPORT.md` — Codebase knowledge graph (generated)

## Privacy

Awto is designed to protect your data:

- **Local-first** — Form fills run on your machine using a local LLM by default
- **No mandatory cloud** — Cloud API calls only occur if the local model is uncertain AND you have explicitly configured an API key
- **Secure storage** — Your profile and API key live in `chrome.storage.local`, which is encrypted at rest by Chrome
- **No telemetry** — Awto does not collect, log, or transmit any usage data

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Patrick Adrianus.
