// Generates public/icon/{16,32,48,128}.png: a white page with a folded corner and a gold
// lightning bolt on a red rounded square (the red of the Canvas logo, lighter at the top left
// and darker at the bottom right). The page casts a soft shadow. 16px drops the page and shows
// just the bolt on the red square, which stays legible in a toolbar.
// Dependency-free (hand-rolled PNG encoder) so icons can be regenerated anywhere:
//   node scripts/make-icons.mjs
import { crc32, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const RED_LIGHT = [246, 86, 78];
const RED_DARK = [168, 18, 28];
const WHITE = [255, 255, 255];
const FOLD = [160, 160, 174];
const SHADOW = { dx: 0.025, dy: 0.035, blur: 0.045, opacity: 0.45 };
const GOLD = [255, 196, 32];
const GOLD_EDGE = [176, 112, 0];
const SAMPLES = 4; // supersampling per axis for anti-aliasing

// Lightning bolt outline in a unit box.
const BOLT = [[0.55, 0], [0.15, 0.58], [0.45, 0.58], [0.35, 1], [0.85, 0.4], [0.55, 0.4], [0.8, 0]];

// The page, and the bolt's box on it, in icon coordinates.
const PAGE = { left: 0.25, top: 0.16, right: 0.75, bottom: 0.84, fold: 0.16 };
const BOLT_ON_PAGE = { x: 0.32, y: 0.3, w: 0.38, h: 0.46 };
const BOLT_ALONE = { x: 0.15, y: 0.1, w: 0.7, h: 0.8 };

function segmentDistance(px, py, x1, y1, x2, y2) {
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

/** Signed distance from (x, y) to a polygon's outline: negative inside. */
function polygonDistance(x, y, points) {
  let inside = false;
  let nearest = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    nearest = Math.min(nearest, segmentDistance(x, y, xi, yi, xj, yj));
  }
  return inside ? -nearest : nearest;
}

/** The page outline with its top-right corner cut off, shifted by (dx, dy). */
function pageOutline(dx, dy) {
  const { left, top, right, bottom, fold } = PAGE;
  return [[left, top], [right - fold, top], [right, top + fold], [right, bottom], [left, bottom]].map(([x, y]) => [x + dx, y + dy]);
}

/** The bolt mapped into `box`, or null when (x, y) is outside it; else 'edge' or 'fill'. */
function boltAt(x, y, box, edge) {
  const points = BOLT.map(([px, py]) => [box.x + px * box.w, box.y + py * box.h]);
  const distance = polygonDistance(x, y, points);
  if (Math.abs(distance) <= edge / 2) return 'edge';
  return distance < 0 ? 'fill' : null;
}

/** Color of one sample point, or null for transparent. */
function sample(x, y, size) {
  if (!insideRoundedSquare(x, y, 0.22)) return null;
  const t = (x + y) / 2;
  const red = RED_LIGHT.map((c, i) => c + (RED_DARK[i] - c) * t);
  if (size <= 16) {
    const bolt = boltAt(x, y, BOLT_ALONE, 0.08);
    return bolt === 'edge' ? GOLD_EDGE : bolt === 'fill' ? GOLD : red;
  }
  const bolt = boltAt(x, y, BOLT_ON_PAGE, size <= 32 ? 0.05 : size <= 48 ? 0.035 : 0.02);
  if (bolt) return bolt === 'edge' ? GOLD_EDGE : GOLD;
  const { left, top, right, bottom, fold } = PAGE;
  if (x >= left && x <= right && y >= top && y <= bottom) {
    // Top-right corner: cut off above the diagonal, folded flap below it.
    const cornerX = x - (right - fold);
    const cornerY = y - top;
    if (cornerX < 0 || cornerY > fold) return WHITE;
    if (cornerX <= cornerY) return FOLD;
  }
  // Soft shadow: full strength inside the shifted page, fading out over `blur`.
  const d = polygonDistance(x, y, pageOutline(SHADOW.dx, SHADOW.dy));
  const fade = Math.min(1, Math.max(0, 0.5 - d / (2 * SHADOW.blur)));
  const shade = 1 - SHADOW.opacity * fade * fade * (3 - 2 * fade);
  return red.map((c) => c * shade);
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const total = SAMPLES * SAMPLES;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = sample((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size, size);
          if (!color) continue;
          covered++;
          for (let c = 0; c < 3; c++) sum[c] += color[c];
        }
      }
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) pixels[i + c] = covered ? Math.round(sum[c] / covered) : 0;
      pixels[i + 3] = Math.round((covered / total) * 255);
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
