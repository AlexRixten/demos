/**
 * Mock OpenAI-compatible endpoint for the partial-json-ui stand.
 * Plain node:http — no frameworks. Streams a fixed fixture as SSE
 * chat-completion chunks with deterministic timing.
 *
 * Env: PORT (8787), CHUNK_SIZE (6), CHUNK_DELAY_MS (60),
 *      DEMO_PROMPT ('contract' | 'naive', default 'contract') — which fixture
 *      to replay: the clean card or the "no contract" drifted answer.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  PROFILE_CARD_JSON,
  NAIVE_ANSWER,
  chunkString,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_DELAY_MS,
  type PromptMode,
} from './fixture';

const PORT = Number(process.env.PORT ?? 8787);
const CHUNK_DELAY_MS = Number(process.env.CHUNK_DELAY_MS ?? DEFAULT_CHUNK_DELAY_MS);
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE ?? DEFAULT_CHUNK_SIZE);
const MODEL = 'mock-structured-v1';
const CREATED = 1760000000; // fixed timestamp => fully deterministic replay
const COMPLETION_ID = 'chatcmpl-partial-json-ui';

const PROMPT_MODE: PromptMode = process.env.DEMO_PROMPT === 'naive' ? 'naive' : 'contract';
const STREAM_TEXT = PROMPT_MODE === 'naive' ? NAIVE_ANSWER : PROFILE_CARD_JSON;

const chunks = chunkString(STREAM_TEXT, CHUNK_SIZE);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res: ServerResponse, code: number, payload: unknown): void {
  cors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function chunkEvent(content: string) {
  return {
    id: COMPLETION_ID,
    object: 'chat.completion.chunk',
    created: CREATED,
    model: MODEL,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

const server = createServer(async (req, res) => {
  const url = (req.url ?? '').split('?')[0];

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url === '/') {
    json(res, 200, {
      stand: 'partial-json-ui',
      endpoints: ['GET /healthz', 'GET /v1/models', 'POST /v1/chat/completions'],
    });
    return;
  }

  if (req.method === 'GET' && url === '/healthz') {
    json(res, 200, {
      ok: true,
      model: MODEL,
      promptMode: PROMPT_MODE,
      fixtureBytes: STREAM_TEXT.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
      chunkDelayMs: CHUNK_DELAY_MS,
    });
    return;
  }

  if (req.method === 'GET' && url === '/v1/models') {
    json(res, 200, {
      object: 'list',
      data: [{ id: MODEL, object: 'model', created: CREATED, owned_by: 'partial-json-ui' }],
    });
    return;
  }

  if (req.method === 'POST' && url === '/v1/chat/completions') {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      // keep default empty request
    }
    const wantsSchema =
      (body as { response_format?: { type?: string } }).response_format?.type === 'json_schema';
    console.log(
      `[mock] POST /v1/chat/completions  stream=${Boolean(body.stream)}  json_schema=${wantsSchema}` +
        `  → replay fixture: ${chunks.length} chunks × ${CHUNK_DELAY_MS}ms`,
    );

    if (!body.stream) {
      json(res, 200, {
        id: COMPLETION_ID,
        object: 'chat.completion',
        created: CREATED,
        model: MODEL,
        choices: [
          { index: 0, message: { role: 'assistant', content: STREAM_TEXT }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 12, completion_tokens: chunks.length, total_tokens: 12 + chunks.length },
      });
      return;
    }

    // SSE streaming replay
    cors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.socket?.setNoDelay(true);

    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    res.write(
      sseEvent({
        id: COMPLETION_ID,
        object: 'chat.completion.chunk',
        created: CREATED,
        model: MODEL,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      }),
    );

    for (const chunk of chunks) {
      if (closed) return;
      await sleep(CHUNK_DELAY_MS);
      if (closed) return;
      res.write(sseEvent(chunkEvent(chunk)));
    }

    res.write(
      sseEvent({
        id: COMPLETION_ID,
        object: 'chat.completion.chunk',
        created: CREATED,
        model: MODEL,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
    );
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  json(res, 404, { error: { message: `Not found: ${req.method} ${url}` } });
});

server.listen(PORT, () => {
  console.log(`[mock] OpenAI-compatible endpoint: http://localhost:${PORT}/v1`);
  console.log(
    `[mock] promptMode=${PROMPT_MODE} · fixture: ${STREAM_TEXT.length} bytes → ${chunks.length} chunks` +
      ` (size=${CHUNK_SIZE}, delay=${CHUNK_DELAY_MS}ms)`,
  );
  console.log('[mock] env: PORT, CHUNK_SIZE, CHUNK_DELAY_MS, DEMO_PROMPT');
});
