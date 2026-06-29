# Detection stress-test harness

Drives a headless browser across ~30 popular websites and runs the **real**
bundled form detector (`src/content/detector.ts` → `diagnose()`) on each page,
flagging:

- **false positives** — the pill would appear on a page with no personal-detail
  form (search pages, shopping/product listings, news, cookie dialogs), and
- **misses** — a real signup/personal form where the pill should appear but
  doesn't.

This exists because unit tests use synthetic DOM; only real sites surface
label-extraction and keyword edge cases (e.g. the "stor**age**" → `age`
false-match that this harness caught on IKEA product pages).

## Files

- `detect-probe.entry.ts` — tiny entry that bundles `diagnose()` and exposes
  `window.__awtoDiagnose()` returning JSON `{ count, triggered[] }`. The sweep
  bundles this with esbuild (write-less, in-memory) so it always tests current
  source.
- `detection-sweep.mjs` — the runner: site list (tagged `zero` / `form`),
  navigation, probe injection, and a pass/fail summary.

## Run

Puppeteer is intentionally **not** a project dependency (it pulls a ~150 MB
Chromium). Install it once, locally:

```bash
npm i -D puppeteer
npx puppeteer browsers install chrome
node scripts/detection-sweep.mjs
```

Injection uses Chrome's `Runtime.evaluate` (via `page.evaluate`), which is not
subject to the page's CSP, so the probe runs even on strict-CSP sites.

## Interpreting results

- `FALSE+` on a `zero` site is a real detector bug — investigate the printed
  `triggered` labels.
- Some logged-out homepages (e.g. `pinterest.com`) are themselves signup walls
  (email + password + birthdate) and **correctly** report `count > 0`; tag such
  sites `form`, not `zero`.
- Progressive signups that start with an email-only step (e.g. Microsoft's
  `signup.live.com`) correctly report `0` on step 1 — email-only forms are
  intentionally ignored.

Last full run (2026-06-30): 31 sites reached, **0 genuine false positives,
0 genuine misses**.
