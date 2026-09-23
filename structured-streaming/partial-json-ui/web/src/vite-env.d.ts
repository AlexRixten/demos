/// <reference types="vite/client" />

declare const __APP_CONFIG__: {
  /** DEMO_BUG=on at dev start → naive JSON.parse on every chunk (crash column). */
  bugMode: boolean;
  /** DEMO_PROMPT=naive|contract at dev start → show the request panel + fixture. */
  promptMode: 'naive' | 'contract' | null;
  /** BASE_URL points anywhere other than the local mock. */
  realEndpoint: boolean;
  /** MODEL at dev start (default: the mock model). */
  model: string;
};
