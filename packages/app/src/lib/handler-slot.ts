export * as HandlerSlot from "./handler-slot.js"

import { useEffect, useRef } from "react"

export interface Info<A> {
  readonly get: () => A | undefined
  readonly set: (next: A) => void
}

export function useSlot<A>(): Info<A> {
  const current = useRef<A | undefined>(undefined)
  return {
    get: () => current.current,
    set: (next: A) => {
      current.current = next
    },
  }
}

export function useFill<A>(slot: Info<A>, handler: A) {
  useEffect(() => slot.set(handler), [slot, handler])
}
