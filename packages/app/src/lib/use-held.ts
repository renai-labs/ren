import { useState } from "react"

// oxlint-disable-next-line ren/no-comments -- Returns the last value seen while `holding` was false, so a list can keep showing its last results while the next ones load.
export function useHeld<A>(value: A, options: { readonly holding: boolean; readonly key: (value: A) => string }) {
  const key = options.key(value)
  const [held, setHeld] = useState({ key, value })
  if (!options.holding && held.key !== key) setHeld({ key, value })
  return options.holding ? held.value : value
}
