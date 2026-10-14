import React, { useEffect, useReducer, useRef, useState } from "react";
import { c, isNoise, noiseCount } from "./theme";
import { useDeltaStream } from "./useDeltaStream";
import { useDiffusing } from "./useDiffusing";

/** Текст диффузионной панели: шум — приглушённый, только что очищенное — зелёная вспышка. */
function DiffText({ text }: { text: string }) {
  const prev = useRef("");
  const [, settle] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    // через 350мс фиксируем текст как «прошлый» и перерисовываемся,
    // чтобы вспышка .cleaned погасла даже если новых событий не будет
    const t = setTimeout(() => {
      prev.current = text;
      settle();
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  if (!text) return null;
  return (
    <>
      {[...text].map((ch, i) => {
        const was = prev.current[i];
        let cls = "ch";
        if (isNoise(ch)) cls += " noise";
        else if (was === undefined || isNoise(was)) cls += " cleaned";
        return (
          <span key={i} className={cls}>
            {ch}
          </span>
        );
      })}
    </>
  );
}

/** Левая панель: только что дописанные символы коротко подсвечиваются. */
function DeltaText({ text }: { text: string }) {
  const prevLen = useRef(0);
  const [, settle] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = setTimeout(() => {
      prevLen.current = text.length;
      settle();
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  if (!text) return null;
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} className={"ch" + (i >= prevLen.current ? " cleaned" : "")}>
          {ch}
        </span>
      ))}
    </>
  );
}

function Panel({
  title,
  formula,
  accent,
  chipColor,
  running,
  children,
  footer,
}: {
  title: string;
  formula: string;
  accent: string;
  chipColor?: string;
  running: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: c.panel,
        border: `1px solid ${accent}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        minHeight: 260,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 18px",
          borderBottom: `1px solid ${c.border}`,
          fontFamily: c.ui,
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        <span>{title}</span>
        <code style={{ color: chipColor ?? accent, fontWeight: 500, fontSize: 14 }}>{formula}</code>
      </div>
      <div
        style={{
          padding: "18px 20px",
          flex: 1,
          fontFamily: c.mono,
          fontSize: 16,
          lineHeight: 1.65,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {children}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 18px",
          borderTop: `1px solid ${c.border}`,
          fontFamily: c.mono,
          fontSize: 13,
          color: c.dim,
        }}
      >
        {footer}
        <span style={{ marginLeft: "auto" }}>{running ? "стрим…" : "готово"}</span>
      </div>
    </div>
  );
}

function Meter({ value, total, accent }: { value: number; total: number; accent: string }) {
  return (
    <div style={{ display: "flex", gap: 5, flex: 1, minWidth: 60 }}>
      {Array.from({ length: 10 }, (_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 5,
            borderRadius: 3,
            background: i < Math.min(Math.ceil((value / total) * 10), 10) ? accent : c.raised,
          }}
        />
      ))}
    </div>
  );
}

export function App() {
  const [prompt, setPrompt] = useState("Объясни диффузионные модели одним абзацем");
  const [showBug, setShowBug] = useState(false);
  const [staircase, setStaircase] = useState("");
  const [err, setErr] = useState("");

  const delta = useDeltaStream();
  const diff = useDiffusing({
    onChunk: (state) => setStaircase((s) => s + state),
  });

  const running = delta.running || diff.running;
  const bugRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bugRef.current) bugRef.current.scrollTop = bugRef.current.scrollHeight;
  }, [staircase]);

  const go = () => {
    setErr("");
    setStaircase("");
    // Оба стрима стартуют одновременно — разница семантик видна сразу.
    delta.send(prompt).catch((e) => setErr(String(e)));
    diff.send(prompt).catch((e) => setErr(String(e)));
  };

  const cleanliness = diff.text
    ? Math.round((1 - noiseCount(diff.text) / [...diff.text].length) * 100)
    : 0;

  return (
    <div
      style={{
        background: c.bg,
        minHeight: "100vh",
        fontFamily: c.ui,
        color: c.text,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "min(1100px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            diffusing stream{" "}
            <span style={{ color: c.dim, fontWeight: 400 }}>
              — дельты vs полные состояния
            </span>
          </div>
          <span
            style={{
              fontFamily: c.mono,
              fontSize: 12,
              color: c.dim,
              background: c.raised,
              border: `1px solid ${c.border}`,
              borderRadius: 6,
              padding: "3px 8px",
            }}
          >
            {__STREAM_SOURCE__}
          </span>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !running && go()}
            placeholder="Вопрос модели…"
            style={{
              flex: 1,
              background: c.panel,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              color: c.text,
              padding: "12px 16px",
              fontSize: 16,
              outline: "none",
            }}
          />
          <button
            onClick={go}
            disabled={running}
            style={{
              background: running ? c.raised : c.green,
              color: running ? c.dim : c.greenDark,
              border: "none",
              borderRadius: 10,
              padding: "12px 22px",
              fontSize: 16,
              fontWeight: 700,
              cursor: running ? "default" : "pointer",
            }}
          >
            {running ? "денойз…" : "спросить"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
          <Panel
            title="OpenAI-стрим · дельты"
            formula="buffer += delta"
            accent={c.border}
            chipColor={c.dim}
            running={delta.running}
            footer={
              <>
                <span>чанков {delta.chunks}</span>
                <Meter value={delta.chunks} total={28} accent={c.dim} />
              </>
            }
          >
            {delta.text ? (
              <DeltaText text={delta.text} />
            ) : (
              <span style={{ color: c.dim }}>текст дописывается слева направо, кусками</span>
            )}
          </Panel>

          <Panel
            title="diffusing · полные состояния"
            formula="buffer = chunk"
            accent={diff.chunks > 0 ? c.green : c.border}
            running={diff.running}
            footer={
              <>
                <span>чанков {diff.chunks}</span>
                <Meter value={cleanliness} total={100} accent={c.green} />
                <span>чистота {cleanliness}%</span>
              </>
            }
          >
            {diff.text ? (
              <DiffText text={diff.text} />
            ) : (
              <span style={{ color: c.dim }}>шумный черновик → чище → финал, целиком</span>
            )}
          </Panel>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: c.mono,
            fontSize: 14,
            color: c.dim,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input type="checkbox" checked={showBug} onChange={(e) => setShowBug(e.target.checked)} />
          показать баг: склеить diffusing-чанки как дельты (+=)
        </label>

        {showBug && (
          <div
            style={{
              background: c.panel,
              border: `1px solid ${staircase ? c.red : c.border}`,
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 18px",
                borderBottom: `1px solid ${c.border}`,
                fontFamily: c.ui,
                fontSize: 15,
                fontWeight: 600,
                color: staircase ? c.red : c.dim,
              }}
            >
              <span>«лестница из черновиков» — concat вместо replace</span>
              <span style={{ fontFamily: c.mono, fontWeight: 400, fontSize: 13 }}>
                {staircase ? `${staircase.length} символов мусора` : "ждёт стрим"}
              </span>
            </div>
            <div
              ref={bugRef}
              style={{
                padding: "14px 20px",
                maxHeight: 180,
                overflowY: "auto",
                fontFamily: c.mono,
                fontSize: 13,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: c.dim,
              }}
            >
              {staircase || "включи чекбокс и запусти стрим — каждый черновик допишется к предыдущему"}
            </div>
          </div>
        )}

        {err && <div style={{ color: c.red, fontSize: 14, fontFamily: c.mono }}>{err}</div>}

        <div style={{ fontSize: 13, color: c.dim, lineHeight: 1.5 }}>
          Одно отличие в запросе — <b>diffusing: true</b> — и семантика стрима меняется: не
          «добавь к буферу», а «замени буфер». Привычная агрегация дельт здесь не просто
          не нужна — она вредна.
        </div>
      </div>
    </div>
  );
}
