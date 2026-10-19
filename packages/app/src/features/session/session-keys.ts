export * as SessionKeys from "./session-keys.js"

import type { ComposerKeys } from "./composer-keys.js"

export interface Press extends ComposerKeys.Press {
  readonly code: string
}

export interface Context {
  readonly apple: boolean
  readonly child: boolean
  readonly blocking: boolean
}

export type Intent = "previous" | "next" | "background" | "parent"

const brackets: Readonly<Record<string, Intent>> = { BracketLeft: "previous", BracketRight: "next" }

const modified = (press: Press, apple: boolean) =>
  (apple ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey) && press.altKey && !press.shiftKey

const plain = (press: Press) => !press.metaKey && !press.altKey && !press.shiftKey

const background = (press: Press, context: Context) =>
  plain(press) && press.ctrlKey && press.key.toLowerCase() === "b" && context.blocking && !context.child

const parent = (press: Press, context: Context) =>
  plain(press) && !press.ctrlKey && press.key === "Escape" && context.child

export function intent(press: Press, context: Context): Intent | undefined {
  if (press.isComposing || press.repeat) return
  if (modified(press, context.apple)) return brackets[press.code]
  if (background(press, context)) return "background"
  if (parent(press, context)) return "parent"
  return
}
