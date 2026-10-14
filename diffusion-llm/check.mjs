// Smoke-тест: поднимает mock-server и проверяет контракт обоих режимов стрима.
//   без diffusing     → дельты: склейка += даёт точный финал
//   diffusing: true   → полные состояния: замещение, шум монотонно убывает,
//                       а конкатенация (баг) раздувает текст в «лестницу»
import { spawn } from "node:child_process";

const PORT = 8799;

const once = (emitter, ev) => new Promise((r) => emitter.once(ev, r));
const child = spawn(process.execPath, ["mock-server.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
await once(child, "spawn");
await new Promise((r) => setTimeout(r, 300));

async function readStream(diffusing) {
  const res = await fetch(`http://localhost:${PORT}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diffusing, messages: [] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const payloads = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data:"));
      if (!line || line === "data: [DONE]") continue;
      payloads.push(JSON.parse(line.slice(5).trim()));
    }
  }
  return payloads;
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const dirt = (s) => (s.match(/[▒▓█░#%&@$]/g) ?? []).length;

try {
  // --- Режим дельт: привычный OpenAI-стрим ---
  const deltaPayloads = await readStream(false);
  const deltas = deltaPayloads.map((p) => p.delta);
  const deltaFinal = deltas.join("");
  assert(deltas.length >= 10, `мало дельта-чанков: ${deltas.length}`);
  assert(deltas.every((d) => typeof d === "string" && d.length > 0), "пустые дельты");
  assert(dirt(deltaFinal) === 0, "дельта-стрим содержит шум");

  // --- Режим diffusing: полные состояния ---
  const states = (await readStream(true)).map((p) => p.text);
  const finalText = states.at(-1) ?? "";
  assert(states.length >= 6, `мало событий: ${states.length}`);
  assert(!finalText.includes("▒") && !finalText.includes("▓"), "финал остался шумным");
  // Монотонное уточнение: каждый следующий чанк чище предыдущего.
  for (let i = 1; i < states.length; i++) {
    assert(dirt(states[i]) <= dirt(states[i - 1]), `шум растёт на чанке ${i + 1}`);
  }
  // Замена, а не дописывание: длина колеблется около финальной.
  assert(states.every((s) => Math.abs(s.length - finalText.length) < 40), "чанки не похожи на полные состояния");

  // Оба режима сходятся в один финальный текст — сравнение честное.
  assert(deltaFinal === finalText, "дельты и diffusing дают разный финал");

  // --- «Лестница из черновиков»: конкатенация вместо замены ---
  const staircase = states.join("");
  assert(
    staircase.length > states.length * finalText.length * 0.9,
    "конкатенация не раздувает текст",
  );
  assert(dirt(staircase) > dirt(finalText), "лестница не содержит шума");

  console.log(
    `OK: дельты ${deltas.length} чанков → тот же финал; diffusing ${states.length} состояний, ` +
      `шум монотонно убывает, буфер замещается; баг-склейка += даёт ${staircase.length} симв. вместо ${finalText.length}`,
  );
} finally {
  child.kill();
}
