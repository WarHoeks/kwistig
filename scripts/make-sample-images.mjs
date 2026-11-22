// Generates the placeholder images used by samples/kitchen-sink.json.
// Run: node scripts/make-sample-images.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const out = path.resolve(import.meta.dirname, "../samples/media");
fs.mkdirSync(out, { recursive: true });

// 5×7 bitmap font for the characters we need.
const FONT = {
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(w, h, [r1, g1, b1], [r2, g2, b2], label) {
  const scale = Math.floor(Math.min(w / (label.length * 6), h / 9) * 0.8);
  const textW = label.length * 6 * scale - scale;
  const x0 = Math.floor((w - textW) / 2);
  const y0 = Math.floor((h - 7 * scale) / 2);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      let px = [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t];
      // Checker texture so the pixelate/blur effects are visible.
      if (((x >> 5) + (y >> 5)) % 2) px = px.map((v) => v * 0.9);
      const cx = Math.floor((x - x0) / scale);
      const cy = Math.floor((y - y0) / scale);
      const ch = label[Math.floor(cx / 6)];
      if (cy >= 0 && cy < 7 && cx >= 0 && cx % 6 < 5 && ch && FONT[ch]?.[cy][cx % 6] === "1") px = [255, 255, 255];
      raw.set(px.map(Math.round), y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const images = {
  "zelfportret.png": [[245, 158, 11], [190, 24, 93], "?"],
  "trap.png": [[14, 165, 233], [30, 27, 75], "128"],
  "podium.png": [[139, 92, 246], [236, 72, 153], "2"],
  "persoon1.png": [[16, 185, 129], [6, 78, 59], "1"],
  "persoon2.png": [[239, 68, 68], [127, 29, 29], "2"],
  "persoon3.png": [[59, 130, 246], [30, 58, 138], "3"],
  "persoon4.png": [[234, 179, 8], [113, 63, 18], "4"],
  "persoon5.png": [[236, 72, 153], [131, 24, 67], "5"],
};

for (const [name, [a, b, label]] of Object.entries(images)) {
  fs.writeFileSync(path.join(out, name), png(640, 480, a, b, label));
}
console.log(`wrote ${Object.keys(images).length} images to ${out}`);
