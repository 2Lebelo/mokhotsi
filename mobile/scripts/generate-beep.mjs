// Writes the till's scan beep: a short, clean electronic tone like a retail
// barcode scanner. Generated rather than downloaded so the sound is reproducible
// and free of licensing questions; the output is byte-for-byte deterministic.
//
// Usage: node scripts/generate-beep.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44_100;
const FREQUENCY_HZ = 2_400; // Bright enough to cut through a busy shop, not shrill.
const DURATION_S = 0.11;
const FADE_S = 0.004; // Raised-cosine edges: no click at the start or end.
const PEAK = 0.5; // About -6 dBFS, leaving headroom on small phone speakers.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(projectRoot, "assets", "sounds", "scan-beep.wav");

function envelope(i, total, fade) {
  const edge = Math.min(i, total - 1 - i);
  return edge >= fade ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * edge) / fade);
}

const total = Math.round(SAMPLE_RATE * DURATION_S);
const fade = Math.round(SAMPLE_RATE * FADE_S);
const data = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) {
  const tone = Math.sin((2 * Math.PI * FREQUENCY_HZ * i) / SAMPLE_RATE);
  const sample = Math.round(tone * envelope(i, total, fade) * PEAK * 32_767);
  data.writeInt16LE(sample, i * 2);
}

// Canonical 44-byte RIFF/WAVE header: 16-bit PCM, mono.
const header = Buffer.alloc(44);
header.write("RIFF", 0, "ascii");
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8, "ascii");
header.write("fmt ", 12, "ascii");
header.writeUInt32LE(16, 16); // fmt chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write("data", 36, "ascii");
header.writeUInt32LE(data.length, 40);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, data]));
console.log(`Wrote ${output} (${44 + data.length} bytes)`);
