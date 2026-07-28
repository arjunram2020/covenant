#!/usr/bin/env node
/**
 * Hydration smoke test — the guard against "the page renders but the app is dead".
 *
 * Why this exists: on 2026-07-27 a CSP change (script-src without 'unsafe-eval'
 * in dev) threw an EvalError before React hydrated. Every page still returned
 * 200 with complete-looking SSR HTML, so curl/typecheck/build all passed — but
 * the wallet button, campaign data and every form were dead in the browser.
 * Only a real browser can catch that class of failure, so this script loads the
 * app in headless Chrome and fails loudly if hydration doesn't happen.
 *
 * Checks per page:
 *   1. No uncaught page errors (CSP violations, module-eval crashes, etc.)
 *   2. The header contains at least one <button> — RainbowKit's ConnectButton
 *      is client-only, so its presence proves React actually hydrated.
 *
 * Deliberately NOT checked: console.error noise and on-chain data, because
 * public RPCs are flaky and a flaky gate gets deleted. This test only fails
 * when client-side JS is genuinely broken.
 *
 * Usage:  node scripts/smoke-hydration.mjs [baseUrl]
 *         baseUrl defaults to http://localhost:3002
 *         CHROME_PATH overrides browser autodetection.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] || "http://localhost:3002").replace(/\/$/, "");
const PAGES = ["/", "/campaigns", "/create", "/dashboard", "/history"];
const SETTLE_MS = 3000;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const macPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const p of macPaths) if (existsSync(p)) return p;
  for (const bin of ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium"]) {
    try {
      return execSync(`which ${bin}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      /* try next */
    }
  }
  throw new Error("No Chrome/Chromium found. Set CHROME_PATH.");
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: "new",
  // CI runners (and only CI runners) need --no-sandbox.
  args: process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
});

let failed = false;
try {
  for (const path of PAGES) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message.split("\n")[0]));

    await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60_000 });
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const headerButtons = await page.evaluate(
      () => document.querySelectorAll("header button").length
    );

    const problems = [];
    if (pageErrors.length) problems.push(`uncaught errors: ${pageErrors.join(" | ")}`);
    if (headerButtons === 0) {
      problems.push("no header buttons — React did not hydrate (ConnectButton missing)");
    }

    if (problems.length) {
      failed = true;
      console.error(`✗ ${path}\n    ${problems.join("\n    ")}`);
      if (problems.some((p) => /Content Security Policy|EvalError/i.test(p))) {
        console.error(
          "    ↳ This is a CSP failure. Check the Content-Security-Policy in " +
            "next.config.js — see the comment above the CSP constant."
        );
      }
    } else {
      console.log(`✓ ${path} (header buttons: ${headerButtons})`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}

if (failed) {
  console.error("\nHydration smoke test FAILED — client-side JS is broken.");
  process.exit(1);
}
console.log("\nAll pages hydrated cleanly.");
