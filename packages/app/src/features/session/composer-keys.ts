export * as ComposerKeys from "./composer-keys.js"

export interface Press {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly repeat: boolean
  readonly isComposing: boolean
}

export type Intent = "alternate" | "swallow" | "stop" | "up" | "down"

const chords: Readonly<Record<string, Intent>> = {
  "Meta+Enter": "alternate",
  "Ctrl+Enter": "alternate",
  Escape: "stop",
  "Ctrl+g": "stop",
  ArrowUp: "up",
  ArrowDown: "down",
}

export function intent(press: Press, running: boolean): Intent | undefined {
  if (press.isComposing) return undefined
  const modifiers = [press.ctrlKey && "Ctrl", press.metaKey && "Meta", press.altKey && "Alt", press.shiftKey && "Shift"]
  const found = chords[[...modifiers.filter(Boolean), press.key].join("+")]
  if (found === "alternate" && press.repeat) return "swallow"
  if (found === "stop" && !running) return undefined
  return found
}
