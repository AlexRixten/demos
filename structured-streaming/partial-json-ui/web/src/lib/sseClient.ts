export interface ChunkMeta {
  seq: number;
  bytes: number;
}

export interface StreamHandlers {
  onChunk: (delta: string, meta: ChunkMeta) => void;
  onDone: (totalMs: number) => void;
  onError: (error: Error) => void;
}

/**
 * Reads an OpenAI-compatible SSE chat-completion stream and calls `onChunk`
 * for every `choices[0].delta.content` fragment. Works against the local mock
 * and real endpoints alike (the vite proxy owns the URL and auth).
 */
export async function streamChatCompletion(
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    handlers.onError(err as Error);
    return;
  }

  if (!res.ok || !res.body) {
    handlers.onError(new Error(`HTTP ${res.status} ${res.statusText}`));
    return;
  }

  // Some gateways answer HTTP 200 with a JSON error envelope instead of SSE
  // (e.g. z.ai). Surface it as an error instead of a silent empty stream.
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    const text = await res.text();
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = String(j?.error?.message ?? j?.msg ?? detail);
    } catch { /* keep raw slice */ }
    handlers.onError(new Error(`HTTP ${res.status} · not SSE (${contentType}) — ${detail}`));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const started = performance.now();
  let carry = '';
  let seq = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = carry.indexOf('\n\n')) !== -1) {
        const frame = carry.slice(0, sep);
        carry = carry.slice(sep + 2);

        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          handlers.onDone(performance.now() - started);
          return;
        }

        let evt: {
          choices?: Array<{ delta?: { content?: string; role?: string }; finish_reason?: string | null }>;
        };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = evt?.choices?.[0]?.delta?.content ?? '';
        if (delta) handlers.onChunk(delta, { seq: seq++, bytes: delta.length });
      }
    }
    handlers.onDone(performance.now() - started);
  } catch (err) {
    handlers.onError(err as Error);
  }
}
