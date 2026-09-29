// npm run record — screen capture of the UI (no voice): lifts the stack, drives
// the browser through the demo.md scenario with playwright, encodes the
// playwright webm into mp4 with ffmpeg and saves it next to the stand.
// playwright: npm i playwright (или любой node_modules рядом).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { ensureLaya, stopLaya, waitHttp, freePort } from "./laya.mjs";

const VP = { width: 1536, height: 864 };
const HERE = import.meta.dirname;
const OUT = path.resolve(HERE, "..", "record-triage.mp4"); // рядом со стендом
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  return new Promise((resolve, reject) =>
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}: ${err.slice(-400)}`)))));
};

console.log(`record: UI-сценарий из demo.md → ${path.relative(process.cwd(), OUT)}`);
const laya = await ensureLaya({ onStart: () => console.log("laya-serve не поднят — запускаю…") });
console.log(`laya: ${laya.reused ? "переиспользован" : "запущен"}`);

const port = await freePort();
const server = spawn(process.execPath, [path.join(HERE, "../server.mjs")], {
  stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PORT: String(port) },
});
let serverErr = "";
server.stderr.on("data", (d) => (serverErr += d));
await waitHttp(`http://127.0.0.1:${port}/api/state`);

const rawDir = path.join(os.tmpdir(), `triage-record-${process.pid}`);
mkdirSync(rawDir, { recursive: true });

let exitCode = 0;
try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VP,
    recordVideo: { dir: rawDir, size: VP },
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(() => document.fonts.ready);
  await sleep(1200); // empty screen beat

  const classify = async (preset, holdMs) => {
    await page.click(`.presets button[data-k="${preset}"]`);
    await sleep(350);
    await page.click("#classify");
    await page.waitForFunction(() => document.querySelector("#route").textContent !== "—", null, { timeout: 30_000 });
    await sleep(2300); // let the bars/confidence/route/refund animations finish
    await sleep(holdMs);
  };

  // 1. the headline: billing → auto-route + refund flag
  await classify("billing", 1400);
  // 2. obvious technical: 500 on /orders
  await classify("api", 1200);
  // 3. THE MONEY SHOT: vague ticket — big top probability, low confidence → human review
  await classify("vague", 2600);
  // 4. not a ticket at all: compliment — flat bars
  await classify("happy", 1600);
  // 5. the threshold is a dial: vague again, then lower it to 0.45 and back
  await classify("vague", 900);
  await page.focus("#thr");
  for (let i = 0; i < 3; i++) { await page.keyboard.press("ArrowLeft"); await sleep(420); }
  await sleep(1500); // route flips to assign → technical
  for (let i = 0; i < 3; i++) { await page.keyboard.press("ArrowRight"); await sleep(380); }
  await sleep(1400); // and back to human review

  await sleep(1000);
  const tReady = t0; // cut the blank head where the page was still loading
  const video = page.video();
  const webm = await (await ctx.close(), video.path());
  await browser.close();

  mkdirSync(path.dirname(OUT), { recursive: true });
  const head = 1.0; // seconds of lead-in kept minimal: goto happens fast on localhost
  await sh("ffmpeg", ["-y", "-ss", head.toFixed(3), "-i", webm,
    "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", OUT]);
  rmSync(webm, { force: true });
  console.log(`готово: ${OUT} (съёмка ${((Date.now() - tReady) / 1000).toFixed(0)} с)`);
} catch (e) {
  console.error("record упал:", e.message);
  exitCode = 1;
} finally {
  rmSync(rawDir, { recursive: true, force: true });
  server.kill("SIGINT");
  await new Promise((r) => server.once("exit", r));
  if (serverErr.trim()) console.error(serverErr.trim());
  if (laya.child) await stopLaya(laya.child);
}
process.exit(exitCode);
