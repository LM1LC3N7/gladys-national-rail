// Generates cover.png (800x534) for gladys-national-rail: plain Node, no
// dependency. A departure board with three rows of lit dots above a train on
// its track, on a night-blue to teal gradient (no brand logo, no National Rail
// mark). Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = x / W;
    const u = y / H;
    set(x, y, [20 + 20 * t, 40 + 80 * t + 30 * u, 90 + 40 * t]);
  }
}
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const rect = (x0, y0, w, h, color, alpha = 1) => {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) set(x, y, color, alpha);
};
const amber = [255, 190, 60];
const dim = [70, 60, 40];
const dark = [18, 20, 28];
const white = [240, 244, 250];
const red = [210, 60, 60];

// The board.
rect(140, 50, 520, 230, dark);
rect(140, 50, 520, 6, [90, 100, 120]);
for (let row = 0; row < 3; row += 1) {
  for (let col = 0; col < 44; col += 1) {
    const lit = (col * 7 + row * 13) % 5 !== 0 && !(col > 8 && col < 11) && !(col > 30 && col < 33);
    disc(170 + col * 10.6, 95 + row * 60, 3.4, lit ? (row === 1 && col > 33 ? red : amber) : dim);
  }
}
rect(395, 280, 10, 60, [90, 100, 120]);

// The track and the train.
rect(0, 470, W, 8, [60, 66, 80]);
for (let x = 10; x < W; x += 40) rect(x, 478, 18, 10, [80, 70, 60]);
rect(150, 380, 500, 80, white);
rect(150, 380, 500, 14, [40, 120, 200]);
for (let i = 0; i < 6; i += 1) rect(180 + i * 75, 405, 50, 28, [60, 90, 130]);
rect(610, 400, 40, 40, [255, 220, 120]);
for (const cx of [210, 300, 500, 590]) disc(cx, 465, 14, dark);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
