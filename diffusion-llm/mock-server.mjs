// Mock-стрим: один эндпоинт POST /chat, OpenAI-совместимый по духу.
// Семантика ответа задаётся флагом в теле — как у Mercury:
//   diffusing: true  → каждое событие несёт ВЕСЬ текст целиком ({"text": …})
//                     от шумного черновика к чистому финалу;
//   без флага        → привычные дельты ({"delta": "…"}) — дописывай в буфер.
// Работает без API-ключа — демо запускается офлайн.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const FINAL =
  "Диффузионная модель не пишет текст слева направо — она уточняет весь ответ " +
  "целиком: сначала набрасывает его шумом, а затем за несколько шагов параллельно " +
  "превращает черновик в чистый текст. Поэтому каждый чанк стрима — это не дополнение, " +
  "а полное новое состояние ответа.";
const NOISE = "▒▓█░#%&@$";
const STEPS = 6;
const DIFFUSE_MS = 420;
const DELTA_MS = 260;

// Детерминированный «шум»: на шаге k чисто k/STEPS символов.
const hash = (n) => Math.abs(Math.sin(n * 127.1) * 43758.5) % 1;
function noisy(clean, k) {
  const keep = k / STEPS;
  return clean
    .split("")
    .map((ch, i) =>
      ch === " " || hash(i * 3 + 1) < keep
        ? ch
        : NOISE[Math.floor(hash(i * 7 + k) * NOISE.length)]
    )
    .join("");
}

// Привычный AR-стрим: тот же финальный текст, но кусками по 1–3 слова.
// Конкатенация дельт восстанавливает текст байт в байт.
function deltas(text) {
  const words = text.split(" ");
  const out = [];
  for (let i = 0; i < words.length; ) {
    const end = Math.min(i + 1 + Math.floor(hash(i * 11 + 3) * 3), words.length);
    out.push(words.slice(i, end).join(" ") + (end < words.length ? " " : ""));
    i = end;
  }
  return out;
}

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      let diffusing = false;
      try {
        diffusing = Boolean(JSON.parse(body || "{}").diffusing);
      } catch {
        // битое тело — отвечаем привычным дельта-стримом
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      // close на req в Node срабатывает сразу после дочитывания тела, стрим убьёт.
      // Обрыв клиента ловим на res — это закрытие соединения.
      res.on("close", () => clearInterval(timer));

      if (diffusing) {
        let k = 0;
        var timer = setInterval(() => {
          const text = k >= STEPS ? FINAL : noisy(FINAL, k + 1);
          sse(res, { text });
          if (++k > STEPS) {
            res.write("data: [DONE]\n\n");
            res.end();
            clearInterval(timer);
          }
        }, DIFFUSE_MS);
      } else {
        const chunks = deltas(FINAL);
        let i = 0;
        var timer = setInterval(() => {
          sse(res, { delta: chunks[i] });
          if (++i >= chunks.length) {
            res.write("data: [DONE]\n\n");
            res.end();
            clearInterval(timer);
          }
        }, DELTA_MS);
      }
    });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    return res.end();
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () =>
  console.log(`mock stream → http://localhost:${PORT}/chat  (diffusing: true|false)`),
);
