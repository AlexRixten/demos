import { useCallback, useState } from "react";

/**
 * useDeltaStream — привычный OpenAI-стрим для сравнения: события несут дельты,
 * буфер ДОПИСЫВАЕТСЯ (+=). Живёт рядом с useDiffusing, чтобы показать
 * разницу семантик на одном и том же ответе.
 */
export type DeltaOptions = {
  url?: string;
  model?: string;
  fetchImpl?: typeof fetch;
};

const SSE_TERM = "\n\n";

/** Мок присылает {"delta": …}, живой OpenAI-совместимый API — choices[].delta.content. */
function extractDelta(payload: any): string {
  if (typeof payload?.delta === "string") return payload.delta;
  return payload?.choices?.[0]?.delta?.content ?? "";
}

export function useDeltaStream(opts: DeltaOptions = {}) {
  const { url = "/chat", model = "mercury-2.5", fetchImpl = fetch } = opts;
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
            stream: true, // ← без diffusing: готовы только готовые куски
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split(SSE_TERM);
          buf = events.pop() ?? "";
          for (const ev of events) {
            const line = ev.split("\n").find((l) => l.startsWith("data:"));
            if (!line || line === "data: [DONE]") continue;
            acc += extractDelta(JSON.parse(line.slice(5).trim())); // ДОПИСЫВАЕМ
            setText(acc);
            setChunks((c) => c + 1);
          }
        }
      } finally {
        setRunning(false);
      }
    },
    [url, model, fetchImpl]
  );

  return { text, chunks, running, send };
}
