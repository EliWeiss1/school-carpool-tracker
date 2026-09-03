#!/usr/bin/env node
/**
 * Screenshot a running page.
 *
 * Phase 5 cannot judge "readable across a room" by reading JSX, so this exists
 * to render /display at the size it will actually be shown at and let someone
 * look at the result.
 *
 * Usage:
 *   node scripts/screenshot.mjs <url> [--out FILE] [--size WxH] [--wait MS]
 *                                     [--selector CSS] [--full]
 *
 * Examples:
 *   node scripts/screenshot.mjs http://localhost:3000/display --size 1920x1080
 *   node scripts/screenshot.mjs http://localhost:3001/announce --size 390x844
 *
 * Always a localhost URL — never a file:// path, which would skip Next's
 * compilation of Tailwind and the App Router entirely.
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const VIEWPORTS = {
  // The wall-mounted board.
  display: { width: 1920, height: 1080 },
  // A phone held one-handed at the kerb.
  phone: { width: 390, height: 844 },
  // The office desktop.
  desk: { width: 1440, height: 900 },
};

function parseArgs(argv) {
  const [url, ...rest] = argv;
  if (!url) {
    throw new Error(
      "Usage: node scripts/screenshot.mjs <url> [--out FILE] [--size WxH|display|phone|desk] [--wait MS] [--selector CSS] [--full]",
    );
  }
  if (!/^https?:\/\//.test(url)) {
    throw new Error(
      `Refusing to screenshot "${url}". Start the dev server and pass an http:// URL — a file:// page has no Tailwind build behind it.`,
    );
  }

  const options = {
    url,
    out: "screenshots/shot.png",
    viewport: VIEWPORTS.desk,
    wait: 600,
    selector: null,
    fullPage: false,
  };

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    switch (flag) {
      case "--out":
        options.out = value;
        i++;
        break;
      case "--size": {
        if (VIEWPORTS[value]) {
          options.viewport = VIEWPORTS[value];
        } else {
          const match = /^(\d+)x(\d+)$/.exec(value ?? "");
          if (!match) {
            throw new Error(
              `--size wants WxH or one of ${Object.keys(VIEWPORTS).join(", ")}, got "${value}"`,
            );
          }
          options.viewport = {
            width: Number(match[1]),
            height: Number(match[2]),
          };
        }
        i++;
        break;
      }
      case "--wait":
        options.wait = Number(value);
        i++;
        break;
      case "--selector":
        options.selector = value;
        i++;
        break;
      case "--full":
        options.fullPage = true;
        break;
      default:
        throw new Error(`Unknown flag ${flag}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let puppeteer;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch {
    throw new Error(
      "Puppeteer is not installed. Run `npm install` in this checkout first.",
    );
  }

  const outPath = resolve(process.cwd(), options.out);
  await mkdir(dirname(outPath), { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ ...options.viewport, deviceScaleFactor: 1 });

    const response = await page.goto(options.url, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });
    if (response && !response.ok()) {
      console.warn(
        `warning: ${options.url} answered ${response.status()} — screenshotting it anyway`,
      );
    }

    if (options.selector) {
      await page.waitForSelector(options.selector, { timeout: 15_000 });
    }
    // Web fonts land after networkidle and change every measurement on screen.
    await page.evaluate(() => document.fonts?.ready);
    await new Promise((done) => setTimeout(done, options.wait));

    const target = options.selector ? await page.$(options.selector) : page;
    await target.screenshot({ path: outPath, fullPage: options.fullPage });

    console.log(
      `${outPath}  ${options.viewport.width}x${options.viewport.height}`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
