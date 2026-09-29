// Shared laya (System One) plumbing for the triage stand: canonical tickets,
// the triage questions schema, health probe and lifecycle of laya-serve.
// laya wire API: POST /v1/systemone with { state, questions }.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url)); // scripts/
export const STAND = path.dirname(HERE);                          // triage/

// ---- where laya lives -------------------------------------------------------
export const LAYA_ENDPOINT = process.env.SYSTEMONE_URL || "http://localhost:8307/v1/systemone";
const LAYA_BASE = LAYA_ENDPOINT.replace(/\/v1\/[^/]*\/?$/, "");
const LAYA_PORT = Number(/^http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(LAYA_BASE)?.[1] || 8307);
// локальный venv фабрики, а вне её — глобальный laya-serve из PATH (`pip install "laya[serve]"`)
const VENV_BIN = path.join(STAND, "..", "laya-check", ".venv", "bin", "laya-serve");
const LAYA_BIN = existsSync(VENV_BIN) ? VENV_BIN : "laya-serve";

// ---- the triage schema (validated on laya zero-shot; texts match render.mjs) ----
export const INSTR = "Which team should handle this ticket";
export const REFUND_Q = "The customer is asking for money back";
export const DESC = {
  billing: "Payment, subscription or refund issues",
  technical: "Bugs or integration problems",
  sales: "Pricing or account questions",
};
// DEMO_BUG: internal team codes instead of meaningful descriptions
export const CODES = { billing: "FIN-OPS", technical: "PLAT-L2", sales: "GTM-EMEA" };

export const THRESHOLD = 0.6;  // confidence: assign >= thr, else human review
export const REFUND_FLAG = 0.7; // noul: refund flag when >= this
export const BUG = process.env.DEMO_BUG === "on";

// Canonical tickets — DO NOT EDIT THE PHRASES, voice-over numbers are tuned to them.
export const TICKETS = {
  billing:
    "You charged my card twice this month for the Pro plan. I want the duplicate charge removed.",
  api: "Your API returns a 500 error on every POST to /orders since this morning. Our integration is completely down.",
  vague:
    "Hey so the thing from yesterday is acting weird again, not sure what's going on, maybe you guys can look at it?",
  happy: "Just wanted to say the new export feature is great, nice work!",
};
export const LABEL = {
  billing: "двойное списание",
  api: "500 на /orders",
  vague: "«опять глючит»",
  happy: "комплимент",
};

// Canonical expectations (source of truth: assets/cut/v3/data.json, laya 0.3.20).
export const CANON = {
  normal: {
    billing: { choice: "billing", top: 0.9369, conf: 0.7459, refund: 0.8047, route: "assign", flag: true },
    api: { choice: "technical", top: 0.9615, conf: 0.8274, refund: 0.5838, route: "assign", flag: false },
    vague: { choice: "technical", top: 0.8247, conf: 0.4696, refund: 0.0055, route: "review", flag: false },
    happy: { choice: null, top: 0.3684, conf: 0.0063, refund: 0.0001, route: "review", flag: false },
  },
  bug: {
    billing: { choice: "billing", top: 0.8446, conf: 0.513, refund: 0.8047, route: "review", flag: true },
    api: { choice: "technical", top: 0.7873, conf: 0.3952, refund: 0.5838, route: "review", flag: false },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- health: POST with a noul question, exactly how the stand talks to laya ----
export async function layaHealthy(timeoutMs = 3000) {
  try {
    const r = await fetch(LAYA_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: { body: "health probe" },
        questions: { ok: { type: "noul", instructions: "Is this a health check" } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return typeof j?.answers?.ok?.noul === "number";
  } catch {
    return false;
  }
}

// ---- one triage request: two questions in a single POST ----------------------
export async function askLaya(ticket, { bug = BUG } = {}) {
  const payload = {
    state: { body: ticket },
    questions: {
      department: { type: "choice", instructions: INSTR, criteria: bug ? CODES : DESC },
      refund: { type: "noul", instructions: REFUND_Q },
    },
  };
  const t0 = performance.now();
  const r = await fetch(LAYA_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`laya ${r.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  const a = j.answers?.department;
  if (!a?.choice) throw new Error(`laya: no department answer: ${text.slice(0, 300)}`);
  return {
    model: j.model ?? "laya",
    choice: a.choice,
    p: {
      billing: a.probabilities?.billing ?? 0,
      technical: a.probabilities?.technical ?? 0,
      sales: a.probabilities?.sales ?? 0,
    },
    conf: a.confidence ?? 0,
    refund: j.answers?.refund?.noul ?? null,
    ms: Math.round(performance.now() - t0),
  };
}

// ---- lifecycle: reuse a running laya, or start one and own its death --------
export async function ensureLaya({ timeoutMs = 240_000, onStart } = {}) {
  if (await layaHealthy()) return { child: null, reused: true };

  let log = "";
  let exited = null;
  const child = spawn(LAYA_BIN, [], {
    env: { ...process.env, LAYA_DEVICE: "cpu", LAYA_PORT: String(LAYA_PORT), HF_HUB_OFFLINE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  child.once("exit", (code) => (exited = code));
  onStart?.(child);

  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (exited !== null)
      throw new Error(`laya-serve exited (${exited}):\n${log.split("\n").slice(-8).join("\n")}`);
    if (await layaHealthy(1500)) return { child, reused: false, log };
    await sleep(1000);
  }
  child.kill("SIGKILL");
  throw new Error(`laya-serve did not become healthy in ${timeoutMs / 1000}s:\n${log.split("\n").slice(-8).join("\n")}`);
}

export function stopLaya(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const t = setTimeout(() => child.kill("SIGKILL"), 8000);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    child.kill("SIGINT");
  });
}

// wait until an HTTP endpoint answers JSON (used for our own UI server)
export async function waitHttp(url, timeoutMs = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`no healthy response from ${url} in ${timeoutMs / 1000}s`);
}

export async function freePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
