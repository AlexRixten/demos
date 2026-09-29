// npm run reset — clean state between takes: bumps the reset epoch on the
// running stand. The UI sees the new epoch on its next poll and wipes the
// ticket field, results, journal and the threshold slider (localStorage too).
// If the stand is not running, there is nothing to reset.
const PORT = Number(process.env.PORT || 5177);
const url = `http://127.0.0.1:${PORT}/api/reset`;

try {
  const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(String(r.status));
  console.log(`сброшено: ${url} → журнал пуст, UI очистится в течение ~2 с (поллинг /api/state)`);
} catch (e) {
  console.log(`стенд не запущен на :${PORT} (${e.message ?? e}) — нечего сбрасывать.`);
  console.log("подними его:  npm run dev");
  process.exit(0);
}
