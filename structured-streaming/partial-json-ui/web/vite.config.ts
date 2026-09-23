import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Env switches — no code edits ever needed on camera:
 *   DEMO_BUG=on  npm run dev  → the "naive" column runs JSON.parse on every
 *                               chunk and crashes (loud red error UI)
 *   DEMO_PROMPT=naive|contract → prompt-contract demo: shows the request panel
 *                               and streams the corresponding fixture (naive =
 *                               drifted answer without a contract)
 *   BASE_URL=…                → point /v1 at any OpenAI-compatible endpoint
 *                               (default: the local mock on :8787)
 *   AUTH_TOKEN=…              → forwarded as Authorization: Bearer <token>
 */
const MOCK_ORIGIN = 'http://localhost:8787';
// BASE_URL is the full API base URL including the version path, e.g.
// https://api.openai.com/v1 or https://api.z.ai/api/paas/v4
const MOCK_BASE = `${MOCK_ORIGIN}/v1`;
const BASE_URL = process.env.BASE_URL || MOCK_BASE;
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const MODEL = process.env.MODEL || 'mock-structured-v1';
const BUG_MODE = process.env.DEMO_BUG === 'on';
const PROMPT_MODE =
  process.env.DEMO_PROMPT === 'naive' || process.env.DEMO_PROMPT === 'contract'
    ? process.env.DEMO_PROMPT
    : null;

const target = new URL(BASE_URL);
const targetPath = target.pathname.replace(/\/+$/, ''); // e.g. '/v1' or ''

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_CONFIG__: JSON.stringify({
      bugMode: BUG_MODE,
      promptMode: PROMPT_MODE,
      realEndpoint: target.origin !== MOCK_ORIGIN,
      model: MODEL,
    }),
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': {
        target: target.origin,
        changeOrigin: true,
        rewrite: (path) => targetPath + path.replace(/^\/v1/, ''),
        headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : undefined,
      },
    },
  },
});
