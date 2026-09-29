import { decide } from "./systemone.ts";

const t0 = performance.now();
const { answers } = await decide({ body: process.argv[2] }, {
  department: {
    type: "choice",
    instructions: "Which team should handle this ticket",
    criteria: {
      billing: "Payment, subscription or refund issues",
      technical: "Bugs or integration problems",
      sales: "Pricing or account questions",
    },
  },
});
const d = answers.department;
const ms = Math.round(performance.now() - t0);
console.log(`${d.choice} · p=${d.probabilities[d.choice]} · confidence=${d.confidence.toFixed(2)} · ${ms} ms`);
