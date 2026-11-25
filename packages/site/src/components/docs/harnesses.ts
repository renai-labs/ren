export const HARNESSES = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "pi", label: "Pi" },
  { id: "hermes", label: "Hermes" },
  { id: "other", label: "Other client" },
] as const

export type HarnessId = (typeof HARNESSES)[number]["id"]
