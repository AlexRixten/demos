import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Источник стрима выбирается переменными окружения при запуске dev-сервера:
//
//   mock (по умолчанию):     npm run dev            → прокси на mock-server :8787
//   живой Mercury (Inception):
//     MERCURY_URL=https://api.inceptionlabs.ai MERCURY_KEY=sk-… npm run mock & npm run dev
//   живой Mercury (OpenRouter):
//     MERCURY_URL=https://openrouter.ai MERCURY_KEY=sk-or-… MERCURY_MODEL=inception/mercury-2.5 …
//
// Ключ живёт только в окружении dev-сервера — в браузер не попадает.
const upstream = process.env.MERCURY_URL;
const model = process.env.MERCURY_MODEL ?? "mercury-2.5";
const source = upstream
  ? `live · ${upstream.replace(/^https?:\/\//, "")} · ${model}`
  : "mock · офлайн";

export default defineConfig({
  plugins: [react()],
  define: { __STREAM_SOURCE__: JSON.stringify(source) },
  server: {
    port: 5173,
    proxy: upstream
      ? {
          "/chat": {
            target: upstream,
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/chat/, "/v1/chat/completions"),
            headers: {
              ...(process.env.MERCURY_KEY && {
                Authorization: `Bearer ${process.env.MERCURY_KEY}`,
              }),
            },
          },
        }
      : { "/chat": { target: "http://localhost:8787", changeOrigin: true } },
  },
});
