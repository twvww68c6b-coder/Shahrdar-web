
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = process.cwd();
const out = `${root}/www`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const item of [
  'index.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'assets'
]) {
  if (existsSync(`${root}/${item}`)) {
    await cp(`${root}/${item}`, `${out}/${item}`, {
      recursive: true
    });
  }
}

console.log('Web files copied to www/');
