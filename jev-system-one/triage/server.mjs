// Triage stand server: static UI from public/ + thin proxy POST /api/systemone → laya.
// Node core only, no frameworks. The browser talks to its own origin only (no CORS).
//
// DEMO_BUG=on  — the proxy swaps department criteria descriptions for internal
// team codes (FIN-OPS / PLAT-L2 / GTM-EMEA): meaningless descriptions tank
// confidence below the threshold and tickets fall into human review.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askLaya, LAYA_ENDPOINT, BUG, THRESHOLD, REFUND_FLAG } from "./scripts/laya.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5177);
const indexHtmlPath = path.join(HERE, "public", "index.html");

const log = [];      // journal of recent runs (kept in memory, cleared by /api/reset)
let epoch = 0;       // bumped by /api/reset; the UI wipes itself when it changes

const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 200_000) { reject(new Error("request body too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(readFileSync(indexHtmlPath)); // без кэша: правки UI подхватываются перезагрузкой
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      return json(res, 200, {
        epoch, bug: BUG, log,
        threshold: THRESHOLD, refundThreshold: REFUND_FLAG, laya: LAYA_ENDPOINT,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      epoch += 1;
      log.length = 0;
      return json(res, 200, { ok: true, epoch });
    }
    if (req.method === "POST" && url.pathname === "/api/systemone") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const ticket = String(body.ticket ?? "").trim();
      if (!ticket) return json(res, 400, { ok: false, error: "ticket is empty" });
      const r = await askLaya(ticket, { bug: BUG });
      log.push({
        ts: new Date().toISOString(),
        ticket: ticket.length > 64 ? ticket.slice(0, 64) + "…" : ticket,
        choice: r.choice,
        conf: +r.conf.toFixed(4),
        refund: r.refund == null ? null : +r.refund.toFixed(4),
      });
      if (log.length > 12) log.shift();
      return json(res, 200, { ok: true, bug: BUG, ...r, route: r.conf >= THRESHOLD ? "assign" : "review" });
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (e) {
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
});

server.on("error", (e) => {
  console.error(`[server] ${e.code === "EADDRINUSE" ? `порт ${PORT} занят — stop the process using it first` : e.message}`);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[server] UI:     http://localhost:${PORT}`);
  console.log(`[server] proxy → ${LAYA_ENDPOINT}${BUG ? "  (DEMO_BUG=on: criteria = коды команд)" : ""}`);
});
