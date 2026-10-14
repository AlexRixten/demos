import { useCallback, useState } from "react";

/**
 * useDiffusing — хук для стрима диффузионной LLM (Mercury, флаг `diffusing: true`).
 *
 * Ключевое отличие от привычного OpenAI-стрима: каждое событие несёт ВЕСЬ
 * текущий текст целиком (промежуточное состояние денойза), поэтому буфер
 * ЗАМЕЩАЕТСЯ, а не дописывается. Никакой агрегации дельт.
 */
export type DiffusingChunk = { text: string };

export type DiffusingOptions = {
  /** Эндпоинт: локальный mock (по умолчанию) или прокси к живому API. */
  url?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** Вызывается с каждым сырым состоянием — например, для «лестницы из черновиков». */
  onChunk?: (text: string) => void;
};

const SSE_TERM = "\n\n";

/** Mercury-мок присылает {"text": …}, живой OpenAI-совместимый API — choices[].delta.content. */
function extractState(payload: any): string {
  if (typeof payload?.text === "string") return payload.text;
  return payload?.choices?.[0]?.delta?.content ?? "";
}

export function useDiffusing(opts: DiffusingOptions = {}) {
  const { url = "/chat", model = "mercury-2.5", fetchImpl = fetch, onChunk } = opts;
  const [text, setText] = useState("");
  const [chunks, setChunks] = useState(0);
  const [running, setRunning] = useState(false);

  const send = useCallback(
    async (prompt: string) => {
      setText("");
      setChunks(0);
      setRunning(true);
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: true,
            diffusing: true, // ← промежуточные состояния вместо готовых кусков
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split(SSE_TERM);
          buf = events.pop() ?? ""; // хвост может быть неполным — ждём дальше
          for (const ev of events) {
            const line = ev.split("\n").find((l) => l.startsWith("data:"));
            if (!line || line === "data: [DONE]") continue;
            const state = extractState(JSON.parse(line.slice(5).trim()));
            if (!state) continue;
            setText(state); // ЗАМЕНА буфера целиком, не +=
            setChunks((c) => c + 1);
            onChunk?.(state);
          }
        }
      } finally {
        setRunning(false);
      }
    },
    [url, model, fetchImpl, onChunk]
  );

  return { text, chunks, running, send };
}
