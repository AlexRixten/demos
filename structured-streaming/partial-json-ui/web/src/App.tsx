import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { appConfig, requestBodyFor } from './lib/config';
import { streamChatCompletion } from './lib/sseClient';
import { createEngine, type ParserEvent, type Snapshot } from './lib/streamEngine';

type Mode = 'text' | 'card';
type Status = 'idle' | 'streaming' | 'done';

interface ChunkEntry {
  seq: number;
  atMs: number;
  delta: string;
}

interface CrashInfo {
  message: string;
  bufferTail: string;
  atMs: number;
  chunkSeq: number;
}

function preview(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 42 ? `${s.slice(0, 42)}…` : s;
}

function Ghost() {
  return <span className="ghost">…</span>;
}

function Field({ label, done, children }: { label: string; done: boolean; children: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">{empty ? done ? '—' : <Ghost /> : children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="stat">
      <span className="stat-v">{value ?? '·'}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}

interface CardLocation {
  city?: string;
  timezone?: string;
  remote?: boolean;
}

function ProfileCard({ snapshot, done }: { snapshot: Snapshot | null; done: boolean }) {
  if (!snapshot) return <div className="card-empty">waiting for the first tokens…</div>;

  const nickname = String(snapshot.nickname ?? '');
  const role = String(snapshot.role ?? '');
  const level = snapshot.level != null ? String(snapshot.level) : null;
  const loc = snapshot.location as CardLocation | undefined;
  const skills = Array.isArray(snapshot.skills) ? (snapshot.skills as unknown[]) : [];
  const stats = snapshot.stats as { years?: number; projects?: number; talks?: number } | undefined;
  const bio = snapshot.bio != null ? String(snapshot.bio) : '';
  const available = snapshot.available;

  const locText =
    loc && (loc.city || loc.timezone)
      ? `${loc.city ?? ''}${loc.city && loc.timezone ? ', ' : ''}${loc.timezone ?? ''}${
          loc.remote ? ' · remote' : ''
        }`
      : null;

  return (
    <div className={`card${done ? ' is-done' : ''}`}>
      <div className="card-head">
        <div className="avatar">{nickname ? nickname.slice(0, 2) : '··'}</div>
        <div className="card-id">
          <div className="nickname">
            {nickname}
            {!done && <span className="cursor">▍</span>}
          </div>
          {role ? <div className="role">{role}</div> : <div className="role dim">…</div>}
        </div>
        {level && <span className="chip chip-level">{level}</span>}
      </div>

      <div className="card-fields">
        <Field label="Location" done={done}>
          {locText}
        </Field>
        <Field label="Available" done={done}>
          {available == null ? null : available ? 'yes' : 'no'}
        </Field>
      </div>

      <div className="stats">
        <Stat label="yrs" value={stats?.years} />
        <Stat label="projects" value={stats?.projects} />
        <Stat label="talks" value={stats?.talks} />
      </div>

      <div className="skills">
        {skills.length === 0 && !done && <span className="chip ghost-chip">…</span>}
        {skills.map((s, i) => (
          <span key={i} className="chip">
            {String(s)}
          </span>
        ))}
        {!done && skills.length > 0 && skills.length < 5 && <span className="chip ghost-chip">…</span>}
      </div>

      {bio && (
        <p className="bio">
          {bio}
          {!done && <span className="cursor">▍</span>}
        </p>
      )}
    </div>
  );
}

function ChunkLog({ chunks }: { chunks: ChunkEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chunks]);
  return (
    <div className="log" ref={ref}>
      {chunks.slice(-80).map((c) => (
        <div key={c.seq} className="log-row">
          <span className="log-i">#{c.seq}</span>
          <span className="log-t">+{c.atMs}ms</span>
          <span className="log-v">{JSON.stringify(c.delta)}</span>
        </div>
      ))}
    </div>
  );
}

function EventLog({ events }: { events: ParserEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);
  return (
    <div className="log" ref={ref}>
      {events.slice(-80).map((e) => (
        <div key={e.seq} className={`log-row${e.partial ? ' is-partial' : ' is-complete'}`}>
          <span className="log-i">{e.partial ? '…' : '✓'}</span>
          <span className="log-p">{e.path}</span>
          <span className="log-v">{preview(e.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  // Deep link for recordings: ?mode=text — the stream starts in text mode.
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(window.location.search).get('mode') === 'text' ? 'text' : 'card',
  );
  const [status, setStatus] = useState<Status>('idle');
  const [chunks, setChunks] = useState<ChunkEntry[]>([]);
  const [text, setText] = useState('');
  const [events, setEvents] = useState<ParserEvent[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [bufferLen, setBufferLen] = useState(0);
  const [naiveCard, setNaiveCard] = useState<Snapshot | null>(null);
  const [naiveMs, setNaiveMs] = useState<number | null>(null);
  const [crash, setCrash] = useState<CrashInfo | null>(null);
  const [liveMs, setLiveMs] = useState<number | null>(null);
  const [firstFieldMs, setFirstFieldMs] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const runRef = useRef(0);
  const startedAt = useRef(0);

  const start = useCallback(async () => {
    const run = ++runRef.current;
    setChunks([]);
    setText('');
    setEvents([]);
    setSnapshot(null);
    setEngineError(null);
    setBufferLen(0);
    setNaiveCard(null);
    setNaiveMs(null);
    setCrash(null);
    setLiveMs(null);
    setFirstFieldMs(null);
    setFetchError(null);
    setStatus('streaming');
    startedAt.current = performance.now();

    const engine = createEngine({
      onEvent: (e) => {
        if (runRef.current !== run) return;
        setEvents((prev) => [...prev, e]);
      },
      onSnapshot: (s) => {
        if (runRef.current !== run) return;
        setSnapshot(s);
        setFirstFieldMs((m) => m ?? Math.round(performance.now() - startedAt.current));
      },
      onError: (err) => {
        if (runRef.current !== run) return;
        setEngineError(String(err));
      },
    });

    let buffer = '';

    await streamChatCompletion(requestBodyFor(appConfig.promptMode), {
      onChunk: (delta, meta) => {
        if (runRef.current !== run) return;
        const atMs = Math.round(performance.now() - startedAt.current);
        setChunks((prev) => [...prev, { seq: meta.seq, atMs, delta }]);
        setText((prev) => prev + delta);
        buffer += delta;
        setBufferLen(buffer.length);
        engine.write(delta);

        if (appConfig.bugMode) {
          // Naive "live" parsing: JSON.parse the incomplete buffer on every chunk.
          try {
            JSON.parse(buffer);
          } catch (err) {
            setCrash({
              message: (err as Error).message,
              bufferTail: buffer.slice(-48),
              atMs,
              chunkSeq: meta.seq,
            });
          }
        }
      },
      onDone: (ms) => {
        if (runRef.current !== run) return;
        engine.end();
        setLiveMs(Math.round(ms));
        if (!appConfig.bugMode) {
          try {
            setNaiveCard(JSON.parse(buffer) as Snapshot);
            setNaiveMs(Math.round(ms));
          } catch (err) {
            setCrash({
              message: (err as Error).message,
              bufferTail: buffer.slice(-48),
              atMs: Math.round(ms),
              chunkSeq: -1,
            });
          }
        }
        setStatus('done');
      },
      onError: (err) => {
        if (runRef.current !== run) return;
        setFetchError(String(err));
        setStatus('done');
      },
    });
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const streaming = status === 'streaming';
  const lastPath = events.length > 0 ? events[events.length - 1].path : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">{'{ }'}</span>
          <h1>
            partial-json-ui <small>a card assembled from a stream</small>
          </h1>
        </div>
        <div className="badges">
          <span className={`badge ${appConfig.realEndpoint ? 'badge-real' : 'badge-mock'}`}>
            {appConfig.realEndpoint ? 'live API' : 'mock :8787'}
          </span>
          {appConfig.bugMode && (
            <span className="badge badge-bug">DEMO_BUG=on · JSON.parse on every chunk</span>
          )}
          <span className={`badge ${streaming ? 'badge-live' : 'badge-idle'}`}>
            {streaming
              ? `streaming · ${chunks.length} chunks`
              : status === 'done'
                ? `done · ${chunks.length} chunks · ${liveMs ?? 0} ms`
                : 'idle'}
          </span>
        </div>
        <div className="controls">
          <div className="switch">
            <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>
              Text
            </button>
            <button className={mode === 'card' ? 'on' : ''} onClick={() => setMode('card')}>
              Card
            </button>
          </div>
          <button className="replay" onClick={() => void start()} disabled={streaming}>
            {streaming ? 'streaming…' : 'Replay'}
          </button>
        </div>
      </header>

      {appConfig.promptMode && (
        <section className="prompt-panel">
          <div className="prompt-head">
            <span
              className={`prompt-badge ${
                appConfig.promptMode === 'naive' ? 'is-naive' : 'is-contract'
              }`}
            >
              {appConfig.promptMode === 'naive'
                ? 'no contract — a casual ask'
                : 'contract ask: schema with descriptions + few-shot + rules'}
            </span>
            <span className="prompt-meta">
              {appConfig.promptMode === 'naive'
                ? 'response_format: —'
                : 'response_format: json_schema · strict'}
            </span>
          </div>
          <pre className="prompt-body">{JSON.stringify(requestBodyFor(appConfig.promptMode), null, 2)}</pre>
        </section>
      )}

      {fetchError && <div className="fatal">Request failed: {fetchError}</div>}

      {mode === 'text' ? (
        <main className="panel text-panel">
          <div className="panel-title">plain streaming: the model answers as text — the familiar picture</div>
          <pre className="stream-text">
            {text}
            <span className="cursor">▍</span>
          </pre>
          <div className="panel-foot">
            {chunks.length} chunks · {bufferLen} bytes
          </div>
        </main>
      ) : (
        <>
          <main className="split">
            <section className={`panel naive${appConfig.bugMode ? ' is-bug' : ''}`}>
              <div className="panel-title">
                naive: {appConfig.bugMode ? 'JSON.parse on every chunk' : 'wait for the whole answer'}
              </div>

              {crash ? (
                <div className="crash" role="alert">
                  <div className="crash-title">CRASH · SyntaxError</div>
                  <div className="crash-msg">{crash.message}</div>
                  <pre className="crash-snippet">…{crash.bufferTail}</pre>
                  <div className="crash-meta">
                    {crash.chunkSeq === -1
                      ? `stream finished · +${crash.atMs} ms · final JSON.parse over the whole buffer`
                      : `chunk #${crash.chunkSeq} · +${crash.atMs} ms · stream alive, JSON not closed yet`}
                  </div>
                  <div className="crash-hint">
                    {crash.chunkSeq === -1
                      ? 'buffer is full but not clean JSON — fences and prose around it; no schema given, the model "helped" as best it could'
                      : 'buffer is incomplete — that is not how JSON.parse works'}
                  </div>
                </div>
              ) : streaming ? (
                <div className="wait">
                  <div className="spinner" />
                  <div>
                    {appConfig.bugMode ? 'parsing every chunk…' : 'waiting for the whole answer…'}
                  </div>
                  <div className="wait-meta">
                    {chunks.length} chunks · {bufferLen} bytes received
                  </div>
                </div>
              ) : naiveCard ? (
                <div className="naive-ok">
                  <div className="naive-ok-title">
                    done in {naiveMs} ms — but the user stared at a spinner the whole time
                  </div>
                  <ProfileCard snapshot={naiveCard} done />
                </div>
              ) : (
                <div className="wait">—</div>
              )}
            </section>

            <section className="panel live">
              <div className="panel-title">
                event-driven: @streamparser/json
                {appConfig.bugMode && <span className="fix-badge">the right way</span>}
              </div>
              <ProfileCard snapshot={snapshot} done={status === 'done'} />
              <div className="live-meta">
                {firstFieldMs !== null && <span>first field: +{firstFieldMs} ms</span>}
                {lastPath && (
                  <span>
                    now: <code>{lastPath}</code>
                  </span>
                )}
                {engineError && <span className="err">parser error: {engineError}</span>}
              </div>
            </section>
          </main>

          <section className="inspector">
            <div className="inspector-col">
              <div className="inspector-title">raw chunks (SSE)</div>
              <ChunkLog chunks={chunks} />
            </div>
            <div className="inspector-col">
              <div className="inspector-title">what the parser sees: paths &amp; partial values</div>
              <EventLog events={events} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
