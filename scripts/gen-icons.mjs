/**
 * Génère les icônes Android (mipmap-*) depuis le SVG source.
 * Usage : node scripts/gen-icons.mjs
 * Prérequis : npm install -D sharp  (dans webapp/)
 */
// sharp est installé dans webapp/node_modules
import sharp from "../webapp/node_modules/sharp/lib/index.js";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG  = join(ROOT, "webapp/public/icons/icon.svg");
const RES  = join(ROOT, "webapp/android/app/src/main/res");

const DENSITIES = [
  { density: "mdpi",    launcher: 48,  foreground: 108 },
  { density: "hdpi",    launcher: 72,  foreground: 162 },
  { density: "xhdpi",   launcher: 96,  foreground: 216 },
  { density: "xxhdpi",  launcher: 144, foreground: 324 },
  { density: "xxxhdpi", launcher: 192, foreground: 432 },
];

const svg = readFileSync(SVG);

for (const { density, launcher, foreground } of DENSITIES) {
  const dir = join(RES, `mipmap-${density}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // ic_launcher.png et ic_launcher_round.png
  const png = await sharp(svg).resize(launcher, launcher).png().toBuffer();
  await sharp(png).toFile(join(dir, "ic_launcher.png"));
  await sharp(png).toFile(join(dir, "ic_launcher_round.png"));

  // ic_launcher_foreground.png (adaptive icon layer — plus grand)
  const fg = await sharp(svg).resize(foreground, foreground).png().toBuffer();
  await sharp(fg).toFile(join(dir, "ic_launcher_foreground.png"));

  console.log(`✓ ${density.padEnd(10)} ${launcher}px launcher / ${foreground}px foreground`);
}

console.log("\n✅ Icônes Android générées.");
