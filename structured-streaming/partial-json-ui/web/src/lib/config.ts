export const appConfig = __APP_CONFIG__;

/**
 * The request the stand sends — OpenAI-compatible chat completion.
 * Which body depends on the DEMO_PROMPT mode (vite define → appConfig.promptMode):
 *   - 'contract' (default when the env is set): schema WITH field descriptions,
 *     system prompt with rules + a few-shot example — the "prompt contract".
 *   - 'naive': just a casual user message, no response_format — "ask like a human".
 *   - unset: the plain contract body without the prompt panel (clean stand UI).
 * Works unchanged against the local mock and a real endpoint
 * (BASE_URL/AUTH_TOKEN are handled by the vite proxy).
 */

const CONTRACT_SYSTEM = `You are a developer-card generator.
Rules:
- answer strictly with JSON matching the schema, no markdown fences or explanations;
- all string values in English; use null when data is missing;
- bio — one sentence, up to 90 characters.
Example (few-shot):
{"nickname":"stream_dev","role":"Front-end Engineer","level":"senior","location":{"city":"Tbilisi","timezone":"GMT+4","remote":true},"skills":["TypeScript","React"],"stats":{"years":7,"projects":42,"talks":12},"bio":"Builds interfaces that come alive before the model finishes its answer.","available":true}`;

// properties — nickname first: on a 1080p frame the prompt panel fits ~14 lines,
// and the nickname description must land in the visible part (the narration
// quotes it right over this frame). JSON Schema key order is semantically free.
const CARD_SCHEMA = {
  type: 'object',
  properties: {
    nickname: { type: 'string', description: 'nickname, 2–12 chars, latin, no spaces' },
    role: { type: 'string', description: 'role, up to 30 chars' },
    level: { type: 'string', description: 'grade: junior | middle | senior | lead' },
    location: {
      type: 'object',
      additionalProperties: false,
      required: ['city', 'timezone', 'remote'],
      properties: {
        city: { type: 'string', description: 'city name' },
        timezone: { type: 'string', description: 'timezone like GMT+4' },
        remote: { type: 'boolean', description: 'works remotely or not' },
      },
    },
    skills: {
      type: 'array',
      items: { type: 'string' },
      description: 'exactly 5 skills, one per array item, latin',
    },
    stats: {
      type: 'object',
      additionalProperties: false,
      required: ['years', 'projects', 'talks'],
      properties: {
        years: { type: 'number', description: 'full years of experience' },
        projects: { type: 'number', description: 'finished projects' },
        talks: { type: 'number', description: 'public talks' },
      },
    },
    bio: { type: 'string', description: 'one sentence, up to 90 chars' },
    available: { type: 'boolean', description: 'open to new projects' },
  },
  additionalProperties: false,
  required: ['nickname', 'role', 'level', 'location', 'skills', 'stats', 'bio', 'available'],
};

// Key order is pedagogical: the schema with descriptions on top (the first
// level of the contract), the few-shot system prompt below.
export const CONTRACT_REQUEST_BODY = {
  model: appConfig.model,
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'profile_card', strict: true, schema: CARD_SCHEMA },
  },
  messages: [
    { role: 'system', content: CONTRACT_SYSTEM },
    {
      role: 'user',
      content: 'Make a demo card: a front-end engineer, 5 skills, stats, a short bio.',
    },
  ],
  stream: true,
};

export const NAIVE_REQUEST_BODY = {
  model: appConfig.model,
  messages: [{ role: 'user', content: 'Make a developer card in JSON.' }],
  stream: true,
  // no response_format — "just asked like a human"
};

export function requestBodyFor(mode: string | null | undefined) {
  return mode === 'naive' ? NAIVE_REQUEST_BODY : CONTRACT_REQUEST_BODY;
}
