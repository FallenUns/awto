// Live detection stress-test: drives a headless browser across many popular
// sites and runs the REAL bundled detector (src/content/detector.ts `diagnose`)
// on each, flagging false positives (fires on a non-form page) and misses
// (fails to fire on a real personal-detail form).
//
// One-time setup (puppeteer is intentionally NOT a project dependency):
//   npm i -D puppeteer && npx puppeteer browsers install chrome
// Run:
//   node scripts/detection-sweep.mjs
//
// Tag each site "zero" (no personal-detail form → must report 0) or "form"
// (a real personal form → should report > 0). Note some logged-out homepages
// (e.g. pinterest.com) ARE signup walls and correctly report > 0.

import { build } from "esbuild";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require("puppeteer");
} catch {
  console.error("puppeteer not installed. Run: npm i -D puppeteer && npx puppeteer browsers install chrome");
  process.exit(1);
}

const SITES = [
  ["https://www.google.com", "zero"],
  ["https://www.youtube.com", "zero"],
  ["https://en.wikipedia.org/wiki/Main_Page", "zero"],
  ["https://www.amazon.com", "zero"],
  ["https://www.ebay.com", "zero"],
  ["https://www.bing.com", "zero"],
  ["https://stackoverflow.com", "zero"],
  ["https://www.nytimes.com", "zero"],
  ["https://www.cnn.com", "zero"],
  ["https://www.bbc.com", "zero"],
  ["https://www.espn.com", "zero"],
  ["https://www.imdb.com", "zero"],
  ["https://weather.com", "zero"],
  ["https://www.target.com", "zero"],
  ["https://www.walmart.com", "zero"],
  ["https://www.bestbuy.com", "zero"],
  ["https://www.etsy.com", "zero"],
  ["https://www.apple.com", "zero"],
  ["https://www.theguardian.com/international", "zero"],
  ["https://duckduckgo.com", "zero"],
  ["https://www.quora.com", "zero"],
  ["https://medium.com", "zero"],
  ["https://news.ycombinator.com", "zero"],
  ["https://www.ikea.com/au/en/cat/sofa-beds-10663/", "zero"],
  ["https://demoqa.com/automation-practice-form", "form"],
  ["https://github.com/signup", "form"],
  ["https://www.linkedin.com/signup", "form"],
  ["https://accounts.google.com/signup", "form"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildProbe() {
  const result = await build({
    entryPoints: [new URL("./detect-probe.entry.ts", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    minify: true,
    banner: { js: "globalThis.chrome = globalThis.chrome || {};" },
  });
  return result.outputFiles[0].text;
}

const probeSrc = await buildProbe();

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});

const results = [];
for (const [url, expect] of SITES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
  );
  const row = { url, expect, count: null, cats: [], trig: [], err: null };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);
    await page.evaluate(probeSrc);
    const diag = await page.evaluate(() => JSON.parse(window.__awtoDiagnose()));
    row.count = diag.count;
    row.cats = [...new Set(diag.triggered.map((t) => t.category))];
    row.trig = diag.triggered.slice(0, 6).map((t) => `${t.category}:${(t.label || "").slice(0, 40)}`);
  } catch (e) {
    row.err = e.message.split("\n")[0].slice(0, 80);
  }
  await page.close();

  const host = new URL(url).host + new URL(url).pathname.replace(/\/$/, "");
  const verdict = row.err
    ? "ERR  "
    : expect === "zero"
      ? row.count === 0 ? "ok   " : "FALSE+"
      : row.count > 0 ? "ok   " : "MISS ";
  console.log(
    `${verdict} [${expect}] ${host.padEnd(46)} count=${row.count} cats=${row.cats.join(",")}` +
      (row.err ? ` ERR=${row.err}` : "") +
      ((verdict.trim() === "FALSE+" || (expect === "form" && row.count > 0)) ? `\n        ${JSON.stringify(row.trig)}` : "")
  );
  results.push(row);
}
await browser.close();

const zeros = results.filter((r) => r.expect === "zero" && !r.err);
const falsePos = zeros.filter((r) => r.count !== 0);
const forms = results.filter((r) => r.expect === "form" && !r.err);
const misses = forms.filter((r) => r.count === 0);
const errs = results.filter((r) => r.err);
console.log("\n===== SUMMARY =====");
console.log(`zero-expected reached: ${zeros.length} | false positives: ${falsePos.length} ${falsePos.map((r) => r.url).join(", ")}`);
console.log(`form-expected reached: ${forms.length} | triggered: ${forms.length - misses.length} | missed: ${misses.length} ${misses.map((r) => r.url).join(", ")}`);
console.log(`errors/unreachable: ${errs.length} ${errs.map((r) => new URL(r.url).host).join(", ")}`);
