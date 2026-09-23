#!/usr/bin/env node
/**
 * Clean state between takes: stops stand processes on the mock/web ports,
 * wipes vite caches. A fresh page load = fresh deterministic replay.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ports = [Number(process.env.PORT ?? 8787), 5173];

const killed = [];
for (const port of ports) {
  try {
    const pids = execSync(`lsof -ti tcp:${port} || true`, { encoding: 'utf8' }).trim();
    for (const pid of pids.split('\n').filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGTERM');
        killed.push(`:${port}/${pid}`);
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* lsof found nothing */
  }
}

for (const p of ['web/node_modules/.vite', 'web/dist', 'node_modules/.vite', 'node_modules/.cache']) {
  const full = join(root, p);
  if (existsSync(full)) {
    rmSync(full, { recursive: true, force: true });
    console.log(`rm  ${p}`);
  }
}

console.log('');
if (killed.length > 0) {
  console.log(`Stopped processes: ${killed.join(', ')}`);
} else {
  console.log('No running stand processes found.');
}
console.log('Vite cache and state cleared.');
console.log('Between takes: `npm run reset`, then `npm run dev` (or F5 the open page) — the replay starts from scratch.');
