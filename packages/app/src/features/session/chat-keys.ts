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

const actions = ["send", "sendOther", "stop", "historyUp", "historyDown", "editQueued", "chooseModel"] as const

export type Action = (typeof actions)[number]

export const apple = /Mac|iPhone|iPad/u.test(navigator.userAgent)

const keys: Readonly<Record<Action, ReadonlyArray<string>>> = {
  send: ["Enter"],
  sendOther: ["Mod+Enter"],
  stop: ["Escape", "Ctrl+g"],
  historyUp: ["ArrowUp"],
  historyDown: ["ArrowDown"],
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

export const toggleShell = (event: KeyboardEvent) =>
  event.key.toLowerCase() === "x" && event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey

const fields = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const layers = 'dialog, [role="dialog"], [role="alertdialog"], [role^="menu"], [role="listbox"], search'
const controls =
  'button, a[href], summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"]'

export type Capture = "type" | "focus" | "jump" | "pageUp" | "pageDown"

const pages: Readonly<Record<string, Capture>> = { PageUp: "pageUp", PageDown: "pageDown" }

const modified = (press: Press) => press.metaKey || press.ctrlKey

const typed = (press: Press, target: Element | null) => {
  if (modified(press)) return press.key.toLowerCase() === "v"
  return press.key.length === 1 && !(press.key === " " && target?.closest(controls))
}

const focuses = (press: Press) => press.ctrlKey && !press.metaKey && press.key.toLowerCase() === "l"

const jumps = (press: Press) => (press.metaKey ? press.key === "ArrowDown" : press.ctrlKey && press.key === "End")

const inComposer = (press: Press) => (modified(press) || press.shiftKey ? undefined : pages[press.key])

const elsewhere = (press: Press, target: Element | null): Capture | undefined => {
  if (target?.closest(fields)) return undefined
  return typed(press, target) ? "type" : undefined
}

export function capture(
  press: Press,
  target: Element | null,
  context: { readonly composer: boolean },
): Capture | undefined {
  if (press.isComposing || press.altKey || target?.closest(layers)) return undefined
  if (focuses(press)) return "focus"
  if (jumps(press)) return !context.composer && target?.closest(fields) ? undefined : "jump"
  if (context.composer) return inComposer(press)
  return elsewhere(press, target)
}
