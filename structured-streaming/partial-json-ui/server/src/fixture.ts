/**
 * Fixed fixture for the stand: a generic profile card streamed as
 * pretty-printed JSON. Everything is deterministic on purpose: same object,
 * same serialization, same chunking, same timing => identical replay on every
 * take. Content is fictional — no real people, employers or personal data.
 */

export const PROFILE_CARD = {
  nickname: 'stream_dev',
  role: 'Front-end Engineer',
  level: 'senior',
  location: { city: 'Tbilisi', timezone: 'GMT+4', remote: true },
  skills: ['TypeScript', 'React', 'SSE', 'Node.js', 'Playwright'],
  stats: { years: 7, projects: 42, talks: 12 },
  bio: 'Builds interfaces that come alive before the model finishes its answer.',
  available: true,
};

/** Deterministic serialization of the fixture (what the model "streams"). */
export const PROFILE_CARD_JSON: string = JSON.stringify(PROFILE_CARD, null, 2);

/**
 * What the model answers WITHOUT a contract (DEMO_PROMPT=naive): a casual
 * prompt gets a "helpful" reply — markdown fences, drifted keys (`name`
 * instead of `nickname`), skills as a comma string, no
 * location/stats/available. Deterministic, fictional, same replay every take.
 */
export const NAIVE_ANSWER = `Sure! Here is the developer card:

\`\`\`json
{
  "name": "Alex K.",
  "role": "React Developer",
  "level": "Senior",
  "skills": "React, TypeScript, Node.js, SSE, Playwright",
  "bio": "Alex is a passionate front-end developer who loves building live interfaces and streaming UIs that feel instant. He also enjoys speaking at local meetups, mentoring juniors, and writing about web performance and rendering."
}
\`\`\`

Let me know if you want anything changed!`;

export const DEFAULT_CHUNK_SIZE = 6;
export const DEFAULT_CHUNK_DELAY_MS = 60;

/** Prompt mode of the replay: 'contract' streams the clean fixture, 'naive' streams the drifted answer. */
export type PromptMode = 'contract' | 'naive';

/** Split a string into fixed-size chunks (deterministic "tokens"). */
export function chunkString(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

/** json_schema advertised by the mock and sent by the client for structured output. */
export const PROFILE_CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nickname', 'role', 'level', 'location', 'skills', 'stats', 'bio', 'available'],
  properties: {
    nickname: { type: 'string' },
    role: { type: 'string' },
    level: { type: 'string' },
    location: {
      type: 'object',
      additionalProperties: false,
      required: ['city', 'timezone', 'remote'],
      properties: {
        city: { type: 'string' },
        timezone: { type: 'string' },
        remote: { type: 'boolean' },
      },
    },
    skills: { type: 'array', items: { type: 'string' } },
    stats: {
      type: 'object',
      additionalProperties: false,
      required: ['years', 'projects', 'talks'],
      properties: {
        years: { type: 'number' },
        projects: { type: 'number' },
        talks: { type: 'number' },
      },
    },
    bio: { type: 'string' },
    available: { type: 'boolean' },
  },
};
