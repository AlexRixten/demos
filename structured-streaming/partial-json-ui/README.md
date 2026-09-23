# partial-json-ui

The stand from the video "[Streaming structured output: what changed in 2 years?](https://youtube.com/@alex-dione)".

An OpenAI-compatible mock streamer serves a JSON answer as SSE chunks, while a React card assembles **field-by-field right during generation** — instead of waiting for the whole answer. Naive `JSON.parse` on every chunk crashes (that is shown too); event-driven rendering via [`@streamparser/json`](https://www.npmjs.com/package/@streamparser/json) works.

## Run

```bash
npm install
npm run dev        # mock server :8787 + app :5173 → http://localhost:5173
```

The mock is deterministic: a fixed fixture, 6-char chunks, 60 ms per chunk — every replay is identical.

## Modes

```bash
npm run dev                                  # card assembles live + chunk inspector
DEMO_BUG=on npm run dev                      # naive JSON.parse per chunk → a loud red crash
DEMO_PROMPT=naive npm run dev                # "just ask for JSON": drifted keys and values, the card never assembles
DEMO_PROMPT=contract npm run dev             # the contract: descriptions in the schema + few-shot + rules, the card assembles
BASE_URL=https://api.openai.com/v1 AUTH_TOKEN=<key> MODEL=gpt-4o-mini npm run dev   # a real OpenAI-compatible API
```

`BASE_URL` is the full API base URL including the version path (`https://api.openai.com/v1`, `https://api.z.ai/api/paas/v4`, …): the mock is replaced by a real endpoint with zero code changes, requests go out with `response_format: json_schema`, and the model can be anything that supports structured outputs. The badge in the app header switches from "mock :8787" to "live API".

## Also

- `npm run check` — a smoke test of the stream, the parser and both prompt modes;
- `npm run record` — auto screen-recording into `recordings/` (playwright + ffmpeg): scenarios `text | card | bug | slow | naive | contract`;
- `npm run reset` — clean state between runs.

## Stack

npm workspaces: `server` (Node + TypeScript, bare `node:http`, no frameworks) and `web` (React + Vite + TypeScript). The parser is `@streamparser/json` (events by paths like `$.skills[0]`, partial values).
