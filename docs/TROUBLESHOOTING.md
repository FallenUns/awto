# Troubleshooting Awto

Step-by-step fixes for the most common local-model problems. If none of these
help, open an issue: https://github.com/FallenUns/awto/issues

## 1. "Ollama refused the request (HTTP 403)"

Ollama only answers allow-listed origins; Chrome sends a `chrome-extension://…`
origin that is blocked by default.

1. Set the origin and restart Ollama:
   - macOS app: `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"` then fully quit and reopen Ollama.
   - CLI: `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`
2. Still 403 after setting it? The running server predates the variable. Fully
   stop it and relaunch — see the "persistent 403" steps in the README.
3. Verify: `curl -H "Origin: chrome-extension://test" http://localhost:11434/api/tags`
   must return `200`, not `403`.

## 2. "model … not installed" / blank model list

1. Open Awto Options → Local model. Pick a model and click **Download**, or run
   `ollama pull qwen2.5:7b` in a terminal.
2. Click **Test connection** — it lists installed models from `/api/tags`.

## 3. Download (pull) fails or stalls

1. Confirm Ollama is running: `curl http://localhost:11434/api/version`.
2. Check free disk space — models are 2–20 GB.
3. A custom server URL other than `http://localhost:11434` may be blocked by the
   extension's host permissions; use the default local server.

## 4. Fills are wrong, empty, or you see a "format" error

1. Small models (3B) struggle on complex forms. Switch to the **Recommended**
   model (`qwen2.5:7b`) in Options and download it.
2. Add an Anthropic API key (Options → Cloud) so Awto can fall back on hard forms.
3. Awto always shows a confirmation step — review values before filling.

## 5. The model is very slow or the machine freezes

A model larger than your RAM/GPU will swap and crawl. Awto warns when a model
looks too heavy for your device, but cannot block it. Pick a lighter tier.

## 6. Collecting debug info for an issue

- Awto version (Options → About), Ollama version (`ollama --version`), OS, RAM.
- The exact error text shown in the popup.
- `ollama list` output (which models are installed).
