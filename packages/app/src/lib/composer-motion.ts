export * as ComposerMotion from "./composer-motion.js"

import { useLayoutEffect, type RefObject } from "react"

const freshFor = 1500

const state: {
  source: HTMLElement | null
  from: { readonly left: number; readonly top: number; readonly at: number } | undefined
} = { source: null, from: undefined }

export const leave = () => {
  const rect = state.source?.getBoundingClientRect()
  state.from = rect && { left: rect.left, top: rect.top, at: performance.now() }
}

export function useComposer(composer: RefObject<HTMLElement | null>, options: { readonly placement: "home" | "chat" }) {
  const placement = options.placement
  useLayoutEffect(() => {
    const element = composer.current
    if (!element) return
    if (placement === "home") {
      state.source = element
      return () => {
        if (state.source === element) state.source = null
      }
    }
    const from = state.from
    state.from = undefined
    if (!from || performance.now() - from.at > freshFor) return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const to = element.getBoundingClientRect()
    const x = from.left - to.left
    const y = from.top - to.top
    if (Math.abs(x) < 1 && Math.abs(y) < 1) return
    const animation = element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], {
      duration: 260,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    })
    return () => animation.cancel()
  }, [composer, placement])
}
