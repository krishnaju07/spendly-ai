// Renders the Spendly ring mark to every icon size the PWA needs. Run: npm run icons
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const out = path.resolve('apps/web/public');
const INK = '#0A0B0D';
const MINT = '#B8F8FD';

const mark = (scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <circle cx="256" cy="256" r="112" fill="none" stroke="#1B2A2D" stroke-width="46"/>
    <path d="M256 144 A112 112 0 1 1 144 256" fill="none" stroke="${MINT}" stroke-width="46" stroke-linecap="round"/>
    <circle cx="256" cy="256" r="24" fill="#ffffff"/>
  </g>`;

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="${INK}"/>${mark()}</svg>`;
// maskable icons are cropped by the OS: full-bleed background, mark kept inside the central safe zone
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${INK}"/>${mark(0.72)}</svg>`;

await mkdir(path.join(out, 'icons'), { recursive: true });
await writeFile(path.join(out, 'favicon.svg'), rounded);
await writeFile(path.join(out, 'icons/icon.svg'), rounded);
for (const [file, size, svg] of [
  ['icons/icon-192.png', 192, rounded],
  ['icons/icon-512.png', 512, rounded],
  ['icons/maskable-512.png', 512, maskable],
  ['icons/apple-touch-icon.png', 180, maskable],
]) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(out, file));
  console.log('wrote', file);
}
