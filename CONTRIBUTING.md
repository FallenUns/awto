# Contributing to Awto

Thanks for your interest in Awto — a privacy-first, LLM-assisted autofill
extension for Chrome. This guide covers how to get set up, the conventions we
follow, and how to propose changes.

## Project status

Awto is **v0.1.0, alpha**. It is Chrome-only (Manifest V3) and not yet on the
Chrome Web Store. Expect rough edges and breaking changes.

## Getting started

Prerequisites:

- Node.js 16+
- npm
- Chrome (or a Chromium-based browser)

```bash
git clone https://github.com/FallenUns/awto.git
cd awto
npm install
npm run dev     # Vite HMR build for popup/options/content
```

Load the extension in Chrome via `chrome://extensions` → **Load unpacked** →
select the generated `dist/` folder. See the [README](README.md) for the full
setup, including the local Ollama configuration (`OLLAMA_ORIGINS`).

## Development workflow

| Task | Command |
|---|---|
| Live dev build (HMR) | `npm run dev` |
| Type check | `npm run typecheck` |
| Run tests | `npm run test` |
| Watch tests | `npm run test:watch` |
| Production build | `npm run build` |

Before opening a pull request, make sure **both** pass cleanly:

```bash
npm run typecheck
npm run test
```

## Testing

- We use [Vitest](https://vitest.dev/) with `happy-dom`.
- New behavior needs a test. We practice test-driven development — write a
  failing test first, then the implementation.
- Bug fixes should include a regression test that fails before the fix.

## Conventions

These are enforced by review, not just lint:

- **TypeScript everywhere.** Keep the content / background / popup boundaries
  typed (see `src/shared/`).
- **No emojis as icons.** Use Lucide SVGs.
- **Comment WHY, not WHAT.** Well-named identifiers should carry the meaning;
  reserve comments for non-obvious rationale.
- **No backwards-compatibility shims.** We control the whole codebase.
- **Touch targets ≥ 44px** on every interactive element.
- **Confirm before destructive actions** (clearing the profile, deleting an API
  key, etc.).
- **Never log the profile or API key** — not even in dev.

More context on architectural decisions lives in [CLAUDE.md](CLAUDE.md).

## Pull requests

1. Branch off `main` (e.g. `feat/...`, `fix/...`, `chore/...`).
2. Keep the change focused. Avoid bundling unrelated refactors.
3. Ensure `npm run typecheck` and `npm run test` pass.
4. Write a clear PR description: what changed, why, and how you verified it.
5. Reference any related issue.

## Reporting bugs and requesting features

Open a GitHub issue with steps to reproduce (for bugs) or a concrete use case
(for features). For anything security-sensitive, **do not** open a public
issue — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
