export * as ContextLevel from "./context-level.js"

export type Level = "normal" | "filling" | "full"

export function of(percent: number | undefined): Level {
  if (!percent) return "normal"
  if (percent >= 90) return "full"
  if (percent >= 70) return "filling"
  return "normal"
}

export const words: Readonly<Record<Level, string | undefined>> = {
  normal: undefined,
  filling: "Context is filling up",
  full: "Compact soon",
}
