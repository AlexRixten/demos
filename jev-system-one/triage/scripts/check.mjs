// npm run check — smoke test: makes sure laya answers (starts it if needed,
// reuses if healthy), runs the canonical tickets through the real wire API in
// both modes (normal criteria + DEMO_BUG team codes), then exercises the UI
// proxy layer (server.mjs, normal and DEMO_BUG=on). Prints a table, exits 0/1.
//
// Direction is what matters (choice, conf vs threshold, refund vs 0.7); real
// numbers must stay within ±0.05 of the canonical values from data.json.
import { spawn } from "node:child_process";
import path from "node:path";
import { ensureLaya, stopLaya, askLaya, waitHttp, freePort,
  TICKETS, LABEL, CANON, THRESHOLD, REFUND_FLAG } from "./laya.mjs";

const TOL = 0.05;
const rows = [];
let failures = 0;

const near = (got, want) => got != null && Math.abs(got - want) <= TOL;
const check = (ok, msg) => { if (!ok) failures++; return ok ? "OK" : "FAIL: " + msg; };

async function runCase(mode, key) {
  const want = CANON[mode][key];
  const r = await askLaya(TICKETS[key], { bug: mode === "bug" });
  const top = r.p[r.choice];
  const route = r.conf >= THRESHOLD ? "assign" : "review";
  const flag = (r.refund ?? 0) >= REFUND_FLAG;

  const verdicts = [
    check(want.choice == null || r.choice === want.choice, `choice ${r.choice}, канон ${want.choice}`),
    check(near(top, want.top), `top ${top.toFixed(4)} ≠ ${want.top}±${TOL}`),
    check(near(r.conf, want.conf), `conf ${r.conf.toFixed(4)} ≠ ${want.conf}±${TOL}`),
    check(near(r.refund, want.refund), `refund ${r.refund?.toFixed(4)} ≠ ${want.refund}±${TOL}`),
    check(route === want.route, `маршрут ${route}, канон ${want.route}`),
    check(flag === want.flag, `флаг возврата ${flag}, канон ${want.flag}`),
  ];
  const ok = verdicts.every((v) => v === "OK");
  if (!ok) failures++; // a case counts once, verdict details are in the row
  rows.push({
    mode, label: LABEL[key] ?? key,
    got: `${r.choice} · top ${top.toFixed(2)} · conf ${r.conf.toFixed(2)} · refund ${r.refund.toFixed(2)} ·`,
    want: `${want.choice ?? "—"} · top ${want.top.toFixed(2)} · conf ${want.conf.toFixed(2)} · refund ${want.refund.toFixed(2)}`,
    route: `${route}${flag ? " +флаг" : ""}`, wantRoute: `${want.route}${want.flag ? " +флаг" : ""}`,
    ok, bad: verdicts.filter((v) => v !== "OK"),
    ms: r.ms,
  });
}

// exercise the UI proxy (server.mjs) in both modes, including DEMO_BUG plumbing
async function proxyCase({ bug }) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "../server.mjs")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), DEMO_BUG: bug ? "on" : "off" },
  });
  let errBuf = "";
  child.stderr.on("data", (d) => (errBuf += d));
  try {
    await waitHttp(`http://127.0.0.1:${port}/api/state`, 10_000);
    const t0 = performance.now();
    const r = await fetch(`http://127.0.0.1:${port}/api/systemone`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: TICKETS.billing }),
    }).then((x) => x.json());
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) throw new Error(r.error);
    const wantRoute = bug ? "review" : "assign";
    const ok = r.route === wantRoute && r.bug === bug && (bug ? r.conf < THRESHOLD : r.conf >= THRESHOLD);
    if (!ok) failures++;
    rows.push({
      mode: bug ? "ui-bug" : "ui", label: `прокси /api/systemone${bug ? " (DEMO_BUG=on)" : ""}`,
      got: `${r.choice} · conf ${r.conf.toFixed(2)} → ${r.route}`,
      want: `billing → ${wantRoute}`, route: r.route, wantRoute,
      ok, bad: ok ? [] : [`route ${r.route} ≠ ${wantRoute} или bug=${r.bug}`], ms,
    });
  } finally {
    child.kill("SIGINT");
    await new Promise((r) => child.once("exit", r));
    if (errBuf.trim()) console.error(errBuf.trim());
  }
}

// ---- main ----
console.log(`check: laya endpoint из env, порог confidence ${THRESHOLD}, флаг возврата при noul ≥ ${REFUND_FLAG}\n`);
const laya = await ensureLaya({ onStart: () => console.log("laya-serve не поднят — запускаю на время check…") });
console.log(`laya: ${laya.reused ? "переиспользован" : "запущен"} (pid ${laya.child?.pid ?? "external"})\n`);
let exitCode = 0;
try {
  await askLaya("warm up"); await askLaya("warm up");
  for (const key of ["billing", "api", "vague", "happy"]) await runCase("normal", key);
  for (const key of ["billing", "api"]) await runCase("bug", key);
  await proxyCase({ bug: false });
  await proxyCase({ bug: true });
} catch (e) {
  console.error("check упал:", e.message);
  exitCode = 1;
} finally {
  if (laya.child) await stopLaya(laya.child);
}

const w = (s, n) => String(s).padEnd(n + 1), Wc = (s, n) => String(s).padStart(n);
const cols = [w("режим", 7), w("тикет", 26), w("получено", 44), w("канон (±0.05)", 24), w("маршрут", 14), "мс"];
console.log(cols.join(" "));
console.log("-".repeat(140));
for (const r of rows) {
  console.log(
    w(r.mode, 7) + w(r.label, 26) + w(r.got, 44) + w(r.want, 24) +
    w((r.ok ? "✓ " : "✗ ") + r.route, 14) + Wc(r.ms, 4),
    r.ok ? "" : "← " + r.bad.join("; "),
  );
}
console.log("-".repeat(140));
const okN = rows.filter((r) => r.ok).length;
console.log(`итог: ${okN}/${rows.length} OK${failures ? " — ЕСТЬ РАСХОЖДЕНИЯ" : " — стенд соответствует канону"}`);
process.exit(failures || exitCode ? 1 : 0);
