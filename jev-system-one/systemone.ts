// Один клиент для хостед-Jev и laya: протокол один, меняется только адрес.
const BASE = process.env.SYSTEMONE_URL ?? "https://api.typesafe.ai";
const KEY = process.env.TYPESAFE_API_KEY; // laya локально — без ключа

export async function decide(state: object, questions: object) {
  const res = await fetch(`${BASE}/v1/systemone`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
    },
    body: JSON.stringify({ state, questions }),
  });
  if (!res.ok) throw new Error(`systemone: HTTP ${res.status}`);
  return res.json();
}
