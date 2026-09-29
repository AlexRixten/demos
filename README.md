# demos

Stands (demo projects) from videos of the [@alex-dione](https://youtube.com/@alex-dione) channel — MCP servers, LLM streaming, React Native + AI.

Each folder is a self-contained project from a specific video: `npm install` → `npm run dev`.

| Video | Stand | What it shows |
|---|---|---|
| [Streaming structured output: what changed in 2 years?](https://www.youtube.com/watch?v=CS6eq7h0nTk) | [structured-streaming/partial-json-ui](structured-streaming/partial-json-ui) | a card assembling field-by-field right during generation: mock streamer, `@streamparser/json`, "wait for the whole JSON" vs "render as it arrives" |
| [Модель, которая не пишет текст — Jev на практике](https://youtu.be/Mapl0SfcRVo) | [jev-system-one/triage](jev-system-one/triage) | live ticket triage on a local System One model (open-weights laya): probability bars, confidence-gated routing (assign vs human review) with a threshold slider, and a DEMO_BUG mode where team codes instead of descriptions break confidence |
