export const c = {
  bg: "#0b0e14",
  panel: "#11151c",
  raised: "#161b24",
  border: "#232936",
  text: "#e6edf3",
  dim: "#8b949e",
  green: "#4ade80",
  greenDark: "#06210f",
  red: "#f87171",
  redDark: "#2b0f12",
  amber: "#d29922",
  mono: "'SF Mono', Menlo, Consolas, monospace",
  ui: "'SF Pro', Inter, -apple-system, sans-serif",
};

// Глифы, которыми мок «шумит» промежуточные состояния.
export const NOISE_CHARS = "▒▓█░#%&@$";
export const isNoise = (ch: string) => NOISE_CHARS.includes(ch);
export const noiseCount = (s: string) => [...s].filter(isNoise).length;
