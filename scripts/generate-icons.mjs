#!/usr/bin/env node
/**
 * Renders the home screen icons into `public/icons/`.
 *
 * Generated from code, like `generate-chime.mjs`: this script is the source of
 * truth for the artwork and the committed PNGs are its build output. Re-run it
 * whenever the icon should change:
 *
 *   node scripts/generate-icons.mjs
 *
 * The picture is the board itself -- a 2x2 grid of tiles where three are still
 * waiting (muted, not red, so the icon stays calm on a busy home screen) and one
 * has arrived -- sitting on the marigold hazard band that is the app's
 * signature. Ink ground, full bleed: iOS and Android each apply their own
 * rounding, so the file itself stays a plain square.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer";

const INK = "#10151f";
const WAITING_TILE = "#353d4a"; // curb-700
const ARRIVED = "#12b76a"; // arrived-screen
const MARIGOLD = "#f5a524"; // marigold-500

/**
 * Artwork on a 512 grid. `scale` shrinks it about the centre: the maskable
 * variant needs everything inside the central 80% so a circular mask never
 * clips a tile corner.
 */
function iconSvg(scale) {
  const tile = 144;
  const gap = 24;
  const left = 96;
  const top = 72;
  const right = left + tile + gap;
  const lower = top + tile + gap;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <pattern id="hazard" width="48" height="48" patternUnits="userSpaceOnUse" patternTransform="translate(${left} ${lower + tile + 24}) rotate(45)">
      <rect width="24" height="48" fill="${MARIGOLD}"/>
    </pattern>
    <clipPath id="band"><rect x="${left}" y="${lower + tile + 24}" width="320" height="32" rx="8"/></clipPath>
  </defs>
  <rect width="512" height="512" fill="${INK}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <rect x="${left}" y="${top}" width="${tile}" height="${tile}" rx="28" fill="${WAITING_TILE}"/>
    <rect x="${right}" y="${top}" width="${tile}" height="${tile}" rx="28" fill="${ARRIVED}"/>
    <path d="M${right + 40} ${top + 74} l 22 22 l 42 -46" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${left}" y="${lower}" width="${tile}" height="${tile}" rx="28" fill="${WAITING_TILE}"/>
    <rect x="${right}" y="${lower}" width="${tile}" height="${tile}" rx="28" fill="${WAITING_TILE}"/>
    <rect x="${left}" y="${lower + tile + 24}" width="320" height="32" fill="${INK}" clip-path="url(#band)"/>
    <rect x="${left}" y="${lower + tile + 24}" width="320" height="32" fill="url(#hazard)" clip-path="url(#band)"/>
  </g>
</svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.8 },
  { file: "apple-touch-icon.png", size: 180, scale: 1 },
];

const outDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons",
);
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch();
try {
  const page = await browser.newPage();
  for (const { file, size, scale } of ICONS) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><body style="margin:0;background:${INK}">${iconSvg(scale)}</body>`,
    );
    await page.screenshot({ path: resolve(outDir, file), type: "png" });
    console.log(`wrote public/icons/${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
