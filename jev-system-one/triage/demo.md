# demo.md — что показывает стенд triage

## Суть

Support-триаж одним запросом к System One (`laya`, локально, wire-совместим с Jev):
в тикет задаются сразу два вопроса —

- `department` · **choice** — billing / technical / sales, у каждого варианта
  осмысленное описание («Payment, subscription or refund issues», …);
- `refund` · **noul** — «клиент просит вернуть деньги», число 0…1.

Ответ рисуется тремя probability-барами, крупным confidence, маршрутом
(`assign → <команда>` при confidence ≥ порога, иначе `human review`) и
refund-чекпоинтом (флаг при noul ≥ 0.7). Внизу — журнал последних прогонов.
Слайдер порога confidence (0.3–0.9, дефолт 0.6) пересчитывает маршрут на лету —
порог это регулятор цены ошибки.

## Денежный кадр

Расплывчатый тикет («the thing from yesterday is acting weird again… maybe you
guys can look at it?»): верхний бар technical ≈ 0.82 — звучит уверенно, — но
confidence ≈ 0.47 < 0.6, и тикет уходит в **human review**. Вероятности врут,
confidence — нет: он смотрит на форму всего распределения (хвост размазан по
billing/sales), а не на верхний вариант.

Второй сюжет: `DEMO_BUG=on` — в descriptions criteria попадают внутренние коды
команд (FIN-OPS / PLAT-L2 / GTM-EMEA), бессмысленные описания валят confidence:
«двойное списание» падает с 0.75 до ~0.51 → тот же тикет, минуту назад
уходивший автоматически, теперь в ревью. Ломает не краткость, а бессмысленность.

## Канонические цифры (laya 0.3.20, обычный режим, порог 0.6)

| тикет | choice | top | confidence | refund | маршрут |
|---|---|---|---|---|---|
| двойное списание | billing | 0.94 | 0.75 | 0.80 ✓флаг | assign → billing |
| 500 на /orders | technical | 0.96 | 0.83 | 0.58 | assign → technical |
| «опять глючит» | technical | 0.82 | **0.47** | 0.01 | **human review** |
| комплимент | — | 0.37 (плоско) | 0.006 | 0.00 | human review |

DEMO_BUG: двойное списание conf ≈ 0.51 → review; 500-тикет conf ≈ 0.40 → review.

## Шаги автозаписи (`npm run record`, экран 1536×864, без голоса)

1. Пустой экран (~1.2 с).
2. Пресет «двойное списание» → Classify: бары 0.94/0.03/0.03, confidence 0.75
   (зелёный, порог 0.6 на шкале), маршрут `assign → billing`, refund 0.80 —
   флаг возврата ✓. Пауза.
3. Пресет «500 на /orders» → Classify: `assign → technical`, refund 0.58 —
   ниже 0.7, без флага. Пауза.
4. Пресет «опять глючит» → Classify — денежный кадр: technical 0.82, но
   confidence 0.47 (amber) → `human review`. Долгая пауза.
5. Пресет «комплимент» → Classify: плоские бары, confidence 0.006 → review.
6. Снова «опять глючит» → Classify; затем слайдер порога клавишами ←←←
   (0.6 → 0.45): маршрут перещёлкивается в `assign → technical`; →→→ обратно
   (0.6): снова `human review`. Порог — это dial.
7. Финальная пауза ~1 c.

Итог: `record-triage.mp4` рядом со стендом (H.264, 30 fps).

## Ручной прогон

```
npm run dev                # UI: http://localhost:5177
DEMO_BUG=on npm run dev    # режим бага: красный бейдж, тикеты валятся в review
npm run reset              # чистое состояние между дублями
npm run check              # канон по таблице выше
```
