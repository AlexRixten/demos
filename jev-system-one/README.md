# Jev / System One — стенд триажа тикетов

Компаньон-код к ролику «Модель, которая не пишет текст — Jev на практике»: живой стенд триажа support-тикетов через [laya](https://github.com/NandhaKishorM/laya) — открытые веса (Apache 2.0) модели того же класса, что и Jev от [TypeSafe AI](https://typesafe.ai). Протокол один: `POST /v1/systemone`, клиенты совместимы сменой base URL.

Один запрос задаёт два вопроса — `department` (choice: какая команда) и `requests_refund` (noul: да/нет с вероятностью) — и возвращает вероятности по вариантам плюс `confidence`, по которому стенд маршрутизирует тикет: выше порога — `assign`, ниже — `human review`.

## Быстрый старт

Нужны Node ≥ 20 и Python ≥ 3.10.

```bash
pip install "laya[serve]"        # модель + Jev-совместимый сервер
cd triage
npm run dev                       # поднимет laya (если не запущена) и UI на http://localhost:5177
```

Кнопки-пресеты вставляют канонические тикеты; слайдер меняет порог confidence на ходу — маршрут пересчитывается в журнале.

## Команды стенда

| Команда | Что делает |
|---|---|
| `npm run dev` | поднимает laya-serve (порт 8307, если занят — переиспользует) и UI :5177 |
| `DEMO_BUG=on npm run dev` | баг-режим: описания вариантов превращаются в коды команд (`FIN-OPS`…) — уверенность падает, тикеты уходят в ревью |
| `npm run check` | smoke-тест: канонические тикеты в обоих режимах + прокси |
| `npm run reset` | чистит журнал и состояние UI между дублями |
| `npm run record` | автозапись экрана (нужен `npm i playwright` + chromium) |

Порт/адрес laya переопределяется: `SYSTEMONE_URL=http://localhost:8000/v1/systemone npm run dev`.

## Мини-клиент без стенда

`systemone.ts` — 16 строк на fetch, работает и с laya, и с хостед-Jev (ключ нужен только второму):

```bash
SYSTEMONE_URL=http://localhost:8000 node triage.ts "You charged my card twice this month."
# → billing · p=0.9369 · confidence=0.75 · 56 ms
```

(Node ≥ 22.6 c `--experimental-strip-types` или Node 24+ из коробки; младше — через `npx tsx triage.ts`.)

## Важно

- Канонические тикеты и цифры в `triage/scripts/laya.mjs` сверены с показанными в ролике (laya 0.3.20, CPU) — формулировки не менять, иначе значения разойдутся.
- laya без файнтюна: уверенные английские тикеты классифицирует прилично, расплывчатые честно отправляет в ревью, а порядковые шкалы (score) — её слабое место. Подробнее — в README laya.
- Классификация — не авторизация: решение модели не заменяет проверку прав.

## Ссылки

- laya — https://github.com/NandhaKishorM/laya
- TypeSafe AI / Jev — https://typesafe.ai, дока — https://docs.typesafe.ai
- Jev в AI SDK (гайд Vercel) — https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk
- Разбор в видео: [ссылка на ролик — добавить после публикации]
