// npm run dev — lifts the whole stand in one command:
//   1. laya-serve on :8307 (reused if already healthy, started and owned otherwise)
//   2. the UI server (server.mjs) with the /api/systemone proxy
// DEMO_BUG=on npm run dev — the controlled bug: criteria descriptions become
// internal team codes. Env only, never a code edit.
import { spawn } from "node:child_process";
import path from "node:path";
import { ensureLaya, stopLaya, waitHttp, LAYA_ENDPOINT } from "./laya.mjs";

const PORT = Number(process.env.PORT || 5177);
const UI = `http://127.0.0.1:${PORT}`;

const laya = await ensureLaya({
  onStart: () => console.log(`laya-serve не отвечает на ${LAYA_ENDPOINT} — запускаю (LAYA_DEVICE=cpu, LAYA_PORT из URL)…`),
});
console.log(`laya:  ${LAYA_ENDPOINT} ${laya.reused ? "(уже поднят — переиспользуем)" : `(запущен, pid ${laya.child.pid})`}`);

const ui = spawn(process.execPath, [path.join(import.meta.dirname, "../server.mjs")], {
  stdio: "inherit", env: process.env,
});
await waitHttp(`${UI}/api/state`);
console.log(`UI:    ${UI}   (Ctrl+C — остановить)`);
if (laya.log) {
  for (const l of laya.log.split(/[\r\n]+/).filter((l) => /RuntimeWarning/.test(l))) console.log(`  laya ${l.trim()}`);
}

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nостанавливаю…");
  if (ui.exitCode === null) {
    ui.kill("SIGINT");
    await new Promise((r) => { const t = setTimeout(r, 3000); ui.once("exit", () => { clearTimeout(t); r(); }); });
  }
  if (laya.child) {
    console.log("останавливаю laya-serve (он был запущен этим процессом)");
    await stopLaya(laya.child);
  } else {
    console.log("laya-serve остаётся работать (он был поднят не здесь)");
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
ui.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`UI-сервер упал (код ${code})`);
    shutdown();
  }
});
await new Promise(() => {});
