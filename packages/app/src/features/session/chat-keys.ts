export * as ChatKeys from "./chat-keys.js"

export interface Press {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly repeat: boolean
  readonly isComposing: boolean
}

const actions = [
  "send",
  "sendOther",
  "stop",
  "historyUp",
  "historyDown",
  "historySearch",
  "editQueued",
  "chooseModel",
] as const

export type Action = (typeof actions)[number]

export const apple = /Mac|iPhone|iPad/u.test(navigator.userAgent)

const keys: Readonly<Record<Action, ReadonlyArray<string>>> = {
  send: ["Enter"],
  sendOther: ["Mod+Enter"],
  stop: ["Escape", "Ctrl+g"],
  historyUp: ["ArrowUp"],
  historyDown: ["ArrowDown"],
  historySearch: ["Shift+ArrowUp"],
  editQueued: ["Mod+ArrowUp"],
  chooseModel: ["Mod+'"],
}

const chordOf = (press: Press) =>
  [
    press.ctrlKey && "Ctrl",
    press.metaKey && "Meta",
    press.altKey && "Alt",
    press.shiftKey && "Shift",
    press.key.length === 1 ? press.key.toLowerCase() : press.key,
  ]
    .filter(Boolean)
    .join("+")

export function intent(
  press: Press,
  context: { readonly apple: boolean; readonly running: boolean },
): Action | "swallow" | undefined {
  if (press.isComposing) return undefined
  const chord = chordOf(press)
  const found = actions.find((action) =>
    keys[action].some((binding) => binding.replace("Mod", context.apple ? "Meta" : "Ctrl") === chord),
  )
  if (found === "sendOther" && press.repeat) return "swallow"
  if (found === "stop" && !context.running) return undefined
  if (found === "chooseModel" && press.repeat) return undefined
  return found
}
