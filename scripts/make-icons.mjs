// Generates public/icon/{16,32,48,128}.png: a white "</>" on a red rounded square (the red of
// the Canvas logo).
// Dependency-free (hand-rolled PNG encoder) so icons can be regenerated anywhere:
//   node scripts/make-icons.mjs
import { crc32, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const RED = [231, 36, 41];
const SAMPLES = 4; // supersampling per axis for anti-aliasing

// Glyph strokes in unit coordinates.
const SEGMENTS = [
  [0.37, 0.32, 0.2, 0.5], [0.2, 0.5, 0.37, 0.68], // <
  [0.63, 0.32, 0.8, 0.5], [0.8, 0.5, 0.63, 0.68], // >
  [0.56, 0.27, 0.44, 0.73], // /
];

function segmentDistance(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function insideRoundedSquare(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function render(size) {
  // Thicker strokes at small sizes so the glyph stays legible.
  const stroke = size <= 16 ? 0.11 : size <= 32 ? 0.09 : 0.075;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (x + (sx + 0.5) / SAMPLES) / size;
          const v = (y + (sy + 0.5) / SAMPLES) / size;
          if (!insideRoundedSquare(u, v, 0.22)) continue;
          bg++;
          if (SEGMENTS.some((s) => segmentDistance(u, v, s) <= stroke / 2)) fg++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = bg / total;
      const white = bg ? fg / bg : 0;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(RED[c] + (255 - RED[c]) * white);
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, pixels);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icon', { recursive: true });
for (const size of SIZES) writeFileSync(`public/icon/${size}.png`, render(size));
console.log(`Wrote ${SIZES.map((s) => `public/icon/${s}.png`).join(', ')}`);
