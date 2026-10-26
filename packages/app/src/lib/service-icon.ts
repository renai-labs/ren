export * as ServiceIcon from "./service-icon.js"

const alias: Readonly<Record<string, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google-color",
  xai: "xai",
  "x-ai": "xai",
  zhipu: "zhipu-color",
  "z-ai": "zhipu-color",
  deepseek: "deepseek-color",
  qwen: "qwen-color",
  minimax: "minimax-color",
  bytedance: "bytedance-color",
  "bytedance-seed": "bytedance-color",
  nvidia: "nvidia-color",
  xiaomi: "xiaomimimo",
  mistral: "mistral-color",
  mistralai: "mistral-color",
  moonshot: "kimi-color",
  moonshotai: "kimi-color",
  ibm: "ibm",
  "ibm-granite": "ibm",
  amazon: "aws-color",
  inception: "inception",
}

export const url = (slug: string, theme: "light" | "dark") =>
  `https://cdn.jsdelivr.net/gh/lobehub/lobe-icons/packages/static-png/${theme}/${alias[slug] ?? slug}.png`
