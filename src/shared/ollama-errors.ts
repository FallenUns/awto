// Ollama rejects non-allow-listed origins with HTTP 403. Chrome attaches a
// "chrome-extension://<id>" Origin, so surface the actionable OLLAMA_ORIGINS fix.
export const OLLAMA_ORIGINS_HELP =
  'Ollama refused the request (HTTP 403). Ollama only serves allow-listed origins, ' +
  'and Chrome sends a "chrome-extension://…" origin that is blocked by default. ' +
  'Add it to OLLAMA_ORIGINS and restart Ollama. macOS app: run ' +
  'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*" then relaunch Ollama. ' +
  'CLI: OLLAMA_ORIGINS="chrome-extension://*" ollama serve';
