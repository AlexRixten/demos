/**
 * Smoke test for the partial-json-ui stand.
 * 1. Boots the mock server on a test port (:8791) with fast timing.
 * 2. Checks SSE: content-type, data: frames, role/stop/[DONE] events,
 *    assembled content byte-identical to the fixture.
 * 3. Non-stream mode returns the whole fixture.
 * 4. Feeds the same chunks through the @streamparser/json engine:
 *    no errors on incomplete prefixes, partial values mid-stream, expected
 *    paths ($.skills[0], $.location.city), snapshot has $.nickname before the
 *    stream ends, final snapshot deep-equals the fixture.
 * 5. Bug-mode simulation: naive JSON.parse on a mid-stream buffer must throw
 *    (the DEMO_BUG crash), while the streaming engine digests the same
 *    prefix without error.
 * 6. DEMO_PROMPT=naive (second server on :8792): the "no contract" answer —
 *    markdown fences, `name` key instead of `nickname`, skills as a string;
 *    the parser never sees $.nickname, so the card cannot assemble.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROFILE_CARD,
  PROFILE_CARD_JSON,
  NAIVE_ANSWER,
  chunkString,
  DEFAULT_CHUNK_SIZE,
} from '../server/src/fixture';
import { createEngine } from '../web/src/lib/streamEngine';
import type { ParserEvent, Snapshot } from '../web/src/lib/streamEngine';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stable(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'undefined';
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  const obj = x as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
    .join(',')}}`;
}

const server = spawn('npm', ['run', 'mock'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), CHUNK_DELAY_MS: '1', CHUNK_SIZE: String(DEFAULT_CHUNK_SIZE) },
});
server.stdout?.on('data', (d: Buffer) => process.stdout.write(`[server] ${d}`));
server.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`));

// Second instance in DEMO_PROMPT=naive mode (the "no contract" drifted answer).
const NAIVE_PORT = 8792;
const NAIVE_BASE = `http://127.0.0.1:${NAIVE_PORT}`;
const naiveServer = spawn('npm', ['run', 'mock'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PORT: String(NAIVE_PORT),
    CHUNK_DELAY_MS: '1',
    CHUNK_SIZE: String(DEFAULT_CHUNK_SIZE),
    DEMO_PROMPT: 'naive',
  },
});
naiveServer.stdout?.on('data', (d: Buffer) => process.stdout.write(`[server:naive] ${d}`));
naiveServer.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server:naive] ${d}`));

async function waitForHealth(base: string): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  return false;
}

async function stopChild(proc: ReturnType<typeof spawn>): Promise<void> {
  if (proc.exitCode !== null) return;
  try {
    process.kill(-proc.pid!, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  try {
    await Promise.race([once(proc, 'exit'), sleep(3000)]);
    if (proc.exitCode === null) {
      try {
        process.kill(-proc.pid!, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* already gone */
  }
}

async function stopServer(): Promise<void> {
  await Promise.all([stopChild(server), stopChild(naiveServer)]);
}

async function main(): Promise<void> {
  console.log('1) booting mock servers (:8791 contract, :8792 DEMO_PROMPT=naive)');
  ok(await waitForHealth(BASE), 'healthz responds (contract)');
  ok(await waitForHealth(NAIVE_BASE), 'healthz responds (naive)');

  console.log('2) POST /v1/chat/completions (stream: true, response_format: json_schema)');
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mock-structured-v1',
      messages: [{ role: 'user', content: 'card please' }],
      stream: true,
      response_format: { type: 'json_schema', json_schema: { name: 'profile_card', strict: true, schema: {} } },
    }),
  });
  ok(res.status === 200, `HTTP 200 (got ${res.status})`);
  ok((res.headers.get('content-type') ?? '').includes('text/event-stream'), 'content-type: text/event-stream');

  const raw = await res.text();
  const frames = raw
    .split('\n\n')
    .filter((f) => f.startsWith('data:'))
    .map((f) => f.slice(5).trim());
  ok(frames.length >= 30, `enough SSE frames (${frames.length})`);
  ok(frames[frames.length - 1] === '[DONE]', 'last frame is [DONE]');

  let assembled = '';
  let sawStop = false;
  let sawRole = false;
  for (const f of frames) {
    if (f === '[DONE]') continue;
    const evt = JSON.parse(f) as {
      choices?: Array<{ delta?: { content?: string; role?: string }; finish_reason?: string | null }>;
    };
    const ch = evt?.choices?.[0];
    if (ch?.delta?.role === 'assistant') sawRole = true;
    if (ch?.finish_reason === 'stop') sawStop = true;
    if (typeof ch?.delta?.content === 'string') assembled += ch.delta.content;
  }
  ok(sawRole, 'first frame: delta.role=assistant');
  ok(sawStop, 'final frame: finish_reason=stop');
  ok(assembled === PROFILE_CARD_JSON, `assembled content is byte-identical to the fixture (${assembled.length} bytes)`);

  console.log('3) non-streaming mode (stream: false)');
  const res2 = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mock-structured-v1', messages: [], stream: false }),
  });
  const body2 = (await res2.json()) as { choices?: Array<{ message?: { content?: string } }> };
  ok(body2?.choices?.[0]?.message?.content === PROFILE_CARD_JSON, 'stream:false returns the whole fixture');

  console.log('4) event-driven parsing via @streamparser/json (same chunking)');
  const chunks = chunkString(PROFILE_CARD_JSON, DEFAULT_CHUNK_SIZE);
  const events: ParserEvent[] = [];
  let snapshot: Snapshot | null = null;
  let engineErrors = 0;
  let consumed = 0;
  let firstEventAtChunk = -1;
  let midNicknameSeen = false;
  const midIdx = Math.floor(chunks.length * 0.4);

  const engine = createEngine({
    onEvent: (e) => {
      if (firstEventAtChunk < 0) firstEventAtChunk = consumed;
      events.push(e);
    },
    onSnapshot: (s) => {
      snapshot = s;
    },
    onError: () => {
      engineErrors++;
    },
  });

  for (const [i, c] of chunks.entries()) {
    consumed = i + 1;
    engine.write(c);
    if (i === midIdx) {
      midNicknameSeen = (snapshot as Snapshot | null)?.nickname === PROFILE_CARD.nickname;
    }
  }
  engine.end();

  ok(engineErrors === 0, 'parser never fails on incomplete prefixes');
  ok(events.length > chunks.length / 2, `enough events (${events.length})`);
  ok(
    firstEventAtChunk > 0 && firstEventAtChunk < chunks.length - 1,
    `first value arrives before the stream ends (after chunk #${firstEventAtChunk})`,
  );
  ok(midNicknameSeen, `mid-stream ($.nickname is ready at chunk #${midIdx}) — the card is alive before the answer ends`);
  ok(events.some((e) => e.partial && e.path === '$.nickname' && typeof e.value === 'string'), 'partial preview for $.nickname');
  ok(
    events.some((e) => !e.partial && e.path === '$.nickname' && e.value === PROFILE_CARD.nickname),
    '$.nickname completed',
  );
  ok(
    events.some((e) => !e.partial && e.path === '$.skills[0]' && e.value === PROFILE_CARD.skills[0]),
    'array path: $.skills[0]',
  );
  ok(
    events.some((e) => !e.partial && e.path === '$.location.city' && e.value === PROFILE_CARD.location.city),
    'nested path: $.location.city',
  );
  ok(stable(snapshot) === stable(PROFILE_CARD), 'final snapshot deep-equals the fixture');

  console.log('5) DEMO_BUG simulation: naive JSON.parse of an incomplete buffer');
  const midBuffer = chunks.slice(0, 10).join('');
  let threw = false;
  try {
    JSON.parse(midBuffer);
  } catch {
    threw = true;
  }
  ok(threw, 'JSON.parse mid-stream throws SyntaxError (the DEMO_BUG crash)');
  let prefixErrors = 0;
  const prefixEngine = createEngine({ onError: () => { prefixErrors++; } });
  for (const c of chunks.slice(0, 10)) prefixEngine.write(c);
  ok(prefixErrors === 0, 'streaming parse of the same prefix — no errors');

  console.log('6) DEMO_PROMPT=naive: answer without a contract (key/language drift, fences)');
  const naiveHealth = (await (await fetch(`${NAIVE_BASE}/healthz`)).json()) as {
    promptMode?: string;
  };
  ok(naiveHealth.promptMode === 'naive', 'healthz reports promptMode=naive');

  const naiveRes = await fetch(`${NAIVE_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mock-structured-v1', messages: [], stream: false }),
  });
  const naiveBody = (await naiveRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const naiveText = naiveBody?.choices?.[0]?.message?.content ?? '';
  ok(naiveText === NAIVE_ANSWER, 'the NAIVE_ANSWER fixture is streamed (not the card)');
  ok(naiveText.includes('```json'), 'the answer is wrapped in markdown fences');
  ok(naiveText.includes('"name"') && !naiveText.includes('"nickname"'), 'name key instead of nickname');
  ok(naiveText.includes('"skills": "'), 'skills arrived as a string, not an array');

  // Parser on the naive answer: no card paths — only one event for the whole object at the end.
  const naiveEvents: ParserEvent[] = [];
  const naiveEngine = createEngine({ onEvent: (e) => naiveEvents.push(e) });
  for (const c of chunkString(NAIVE_ANSWER, DEFAULT_CHUNK_SIZE)) naiveEngine.write(c);
  naiveEngine.end();
  ok(
    !naiveEvents.some((e) => e.path === '$.nickname'),
    '$.nickname never appears — the card has nothing to assemble from',
  );

  console.log('');
  if (failures.length === 0) {
    console.log(`CHECK PASSED — ${passed} checks green`);
  } else {
    console.log(`CHECK FAILED — ${failures.length} of ${passed + failures.length} failed:`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  await stopServer();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('CHECK CRASHED:', err);
  await stopServer();
  process.exit(1);
});
