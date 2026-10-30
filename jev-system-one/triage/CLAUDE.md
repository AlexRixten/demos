# CLAUDE.md — стенд `triage`

Стенд для ролика про Jev / System One: интерактивный триаж support-тикетов через
локальную модель laya (open-weights аналог Jev, wire-совместимый `POST /v1/systemone`).
Один запрос — два вопроса: `department` (choice: billing / technical / sales) и
`refund` (noul). UI рисует probability-бары, confidence, маршрут и флаг возврата.
Фразы канонических тикетов не менять — эталонные значения сверены
с laya 0.3.20 и зашиты в `scripts/laya.mjs` (CANON).

## Контракт стенда (обязателен)

- `npm run dev` — поднимает всё разом: laya-serve (порт 8307, только если не поднят —
  health-проверка POST-зондом с noul-вопросом; поднятый переиспользуется) + UI-сервер
  (`server.mjs`, порт 5177: статика из `public/` + прокси `POST /api/systemone`).
  Никаких ручных шагов. Остановка по Ctrl+C убивает своих детей (SIGINT → SIGKILL);
  чужой laya не трогается.
- `npm run reset` — чистое состояние: дергает `POST /api/reset`, сервер поднимает epoch,
  UI при поллинге видит новую epoch и вытирает тикет, результат, журнал и слайдер
  (localStorage тоже).
- `DEMO_BUG=on npm run dev` — контролируемый баг через env, не через правку кода:
  прокси подменяет descriptions у criteria department на внутренние коды команд
  (`FIN-OPS` / `PLAT-L2` / `GTM-EMEA`), уверенность падает ниже порога 0.6 — тикеты
  уходят в human review. В UI горит красный бейдж «DEMO_BUG: criteria = коды команд».
- `npm run check` — smoke-тест: поднимает/использует laya, прогоняет канонические
  тикеты в обоих режимах + проверяет прокси (обычный и DEMO_BUG=on), печатает таблицу,
  выходит 0/1. Сравнивает направление и близость к канону ±0.05.
- `npm run record` — автозапись экрана UI через playwright+ffmpeg (без голоса),
  сценарий из `demo.md`, mp4 пишется рядом со стендом (`record-triage.mp4`).

## Устройство

- Node без фреймворков: `server.mjs` — статика + прокси (UI ходит только на свой
  origin, без CORS). laya-URL из env `SYSTEMONE_URL`
  (дефолт `http://localhost:8307/v1/systemone`).
- laya 0.3.20: `laya-serve` берётся из PATH (venv по README: `source ../.venv/bin/activate`);
  ручной запуск — `LAYA_DEVICE=cpu LAYA_PORT=8307 laya-serve`.
- playwright для record в зависимости не входит: `npm i playwright && npx playwright install chromium`,
  плюс `ffmpeg` в PATH.
- Пороги: confidence ≥ 0.6 → `assign → <команда>`, иначе `human review`;
  refund-флаг при noul ≥ 0.7. Слайдер порога в UI: 0.3–0.9, дефолт 0.6.

## Правила

- Фразы канонических тикетов и тексты criteria — константы, не перефразировать.
- Ничего не писать вне папки стенда `triage/`.
- Ответы и данные — по-русски; даты ISO.
