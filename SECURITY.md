# Security Policy

Awto is a privacy-first browser extension that handles personal data (names,
addresses, contact details) and, optionally, an Anthropic API key. We take
security and privacy seriously and welcome responsible disclosure.

## Supported versions

Awto is in early alpha. Only the latest `main` / most recent release receives
security fixes.

| Version | Supported |
|---|---|
| 0.1.x (alpha) | ✅ |
| < 0.1.0 | ❌ |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of:

- **GitHub private advisory** — open a draft advisory via the repository's
  **Security → Report a vulnerability** tab (preferred).
- **Email** — patrickadrianus20@gmail.com with the subject line
  `[Awto Security]`.

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- The affected version / commit.
- Any suggested remediation, if you have one.

**Response targets** (best effort for a solo-maintained alpha project):

- Acknowledgement within **5 business days**.
- An initial assessment and severity rating within **10 business days**.
- A fix or mitigation plan communicated once the issue is confirmed.

Please give us a reasonable window to address the issue before any public
disclosure. We're happy to credit reporters who request it.

## Security & privacy model

Context that helps when assessing reports:

- **Local-first.** Form-field mapping runs against a local Ollama model by
  default. Data leaves the device only when the optional Anthropic cloud
  fallback is explicitly configured and triggered.
- **No backend, no telemetry.** Awto has no server. It does not collect, log, or
  transmit usage data.
- **Storage.** The user profile and (optional) Anthropic API key live in
  `chrome.storage.local` on the user's machine. v0.1.0 stores the profile in
  plain text; passphrase encryption is deferred to a future version.
- **No auto-submit.** Awto fills fields but never submits forms — the user is
  always the final verifier.
- **Third-party endpoints.** With explicit opt-in, Awto may contact
  `api.anthropic.com` (cloud fallback) and `nominatim.openstreetmap.org`
  (address autocomplete in the profile editor).

## Known accepted risks

Some development-dependency advisories are knowingly accepted because they do not
affect the shipped extension (they live in build tooling, never in `dist/`). See
the "Security Advisories — Accepted Residual" section of [CLAUDE.md](CLAUDE.md)
for the current list and rationale.
