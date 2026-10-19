import { createContext } from "react"
import type { Ref } from "react"

export const ShellContext = createContext<{
  dock: HTMLDivElement | null
  populated: boolean
  scrollbar: "visible" | "hidden" | undefined
}>({ dock: null, populated: true, scrollbar: undefined })

export function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") return ref(node)
  if (ref) ref.current = node
}
