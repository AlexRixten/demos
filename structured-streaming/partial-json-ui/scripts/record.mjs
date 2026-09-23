#!/usr/bin/env node
/**
 * Auto-record screen takes of the stand (playwright + ffmpeg-static).
 * Screen only, no voice.
 *
 * Usage: node scripts/record.mjs <scenario>
 *   text     — text-mode stream (the "everyone streams text" picture)
 *   card     — card assembles live + inspector (the money shot)
 *   bug      — DEMO_BUG=on: red crash of the naive JSON.parse column
 *   slow     — slowed-down card variant (CHUNK_DELAY_MS=120)
 *   naive    — DEMO_PROMPT=naive: drifted answer, card never assembles
 *   contract — DEMO_PROMPT=contract: prompt panel + live card
 *
 * Output: recordings/<name>.mp4 (h264, 30fps).
 * The recorder boots `npm run dev` itself and captures the app's auto-started
 * replay — exactly one full pass per file — then converts webm → mp4 and
 * stops the dev servers.
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'recordings');

const SCENARIOS = {
  text: { seg: 1, name: 'text', env: {}, text: true },
  'text-slow': { seg: 1, name: 'text-slow', env: { CHUNK_DELAY_MS: '120' }, text: true },
  card: { seg: 2, name: 'card', env: {}, text: false },
  'card-240': { seg: 2, name: 'card-240', env: { CHUNK_DELAY_MS: '240' }, text: false },
  'card-420': { seg: 2, name: 'card-420', env: { CHUNK_DELAY_MS: '420' }, text: false },
  bug: { seg: 3, name: 'bug', env: { DEMO_BUG: 'on' }, text: false },
  slow: { seg: 2, name: 'card-slow', env: { CHUNK_DELAY_MS: '120' }, text: false },
  // Prompt-contract contrast: naive ask → drifted answer, card never assembles;
  // contract ask → same clean fixture, card assembles under the prompt panel.
  naive: { seg: 6, name: 'naive', env: { DEMO_PROMPT: 'naive', CHUNK_DELAY_MS: '280' }, text: false },
  contract: { seg: 7, name: 'contract', env: { DEMO_PROMPT: 'contract', CHUNK_DELAY_MS: '500' }, text: false },
};

const scenarioKey = process.argv[2];
const scenario = SCENARIOS[scenarioKey];
if (!scenario) {
  console.error(`Unknown scenario "${scenarioKey}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForUrl(url, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${url} after ${timeoutMs} ms`);
    await sleep(250);
  }
}

let dev = null;
async function stopDev() {
  if (!dev || dev.exitCode !== null) return;
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  try {
    await Promise.race([once(dev, 'exit'), sleep(4000)]);
    if (dev.exitCode === null) {
      try {
        process.kill(-dev.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* already gone */
  }
}

async function main() {
  console.log(`[record] scenario: ${scenarioKey} → recordings/${scenario.name}.mp4`);

  // Ports must be free (contract: reset between takes kills :8787/:5173).
  const reset = spawnSync('npm', ['run', 'reset'], { cwd: root, stdio: 'pipe' });
  if (reset.status !== 0) {
    console.error('[record] npm run reset failed:', reset.stderr?.toString().slice(-300));
    process.exit(1);
  }
  console.log('[record] ports cleared (npm run reset)');

  dev = spawn('npm', ['run', 'dev'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...scenario.env },
  });
  dev.stdout.on('data', (d) => process.stdout.write(`[dev] ${d}`));
  dev.stderr.on('data', (d) => process.stderr.write(`[dev] ${d}`));

  await waitForUrl('http://localhost:8787/healthz', 30000);
  await waitForUrl('http://localhost:5173', 30000);
  console.log('[record] dev is up, launching the browser');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    recordVideo: { dir: path.join(root, 'node_modules', '.record-tmp'), size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  try {
    // A dark placeholder before the app loads, so the recording has no white flash.
    await page.goto('about:blank');
    await page.evaluate(() => {
      document.documentElement.style.background = '#0b0e14';
    });

    // One pass per file: capture the app's auto-started replay, no second pass
    // via "Replay". The text scenario starts in text mode right away (?mode=text).
    // domcontentloaded, not networkidle: a live SSE stream never lets the network idle.
    const url = `http://localhost:5173${scenario.text ? '?mode=text' : ''}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('.replay').waitFor({ state: 'visible', timeout: 60000 });

    // End of the replay: the "done" badge; for the bug scenario also wait for the crash.
    await page.waitForFunction(
      (isBug) => document.body.innerText.includes('done') && (!isBug || document.querySelector('.crash') !== null),
      scenarioKey === 'bug',
      { timeout: 60000 },
    );
    await sleep(800); // a tail, so the last frame is not cut off
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    const webm = await video.path();
    await stopDev();

    const out = path.join(OUT_DIR, `${scenario.name}.mp4`);
    if (ffmpegPath) {
      const res = spawnSync(ffmpegPath, ['-y', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', '30', out], { stdio: 'pipe' });
      if (res.status !== 0) {
        console.error('[record] ffmpeg failed:', res.stderr?.toString().slice(-400));
        process.exit(1);
      }
    } else {
      console.error('[record] ffmpeg-static not found — keeping webm');
    }
    const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
    console.log(`[record] done: ${out} (${mb} MB)`);
  }
}

main().catch(async (err) => {
  console.error('[record] error:', err);
  await stopDev();
  process.exit(1);
});
