export * as Theme from "./theme.js"

import { createContext, use, useEffect, useSyncExternalStore } from "react"
import type { ReactNode } from "react"

export type Preference = "dark" | "light" | "system" | "girliepop"
export type Appearance = "dark" | "light" | "girliepop"

export const preferences: ReadonlyArray<Preference> = ["dark", "light", "system", "girliepop"]

const appearanceClasses: Record<Appearance, ReadonlyArray<string>> = {
  dark: ["dark"],
  light: ["light"],
  girliepop: ["light", "girliepop"],
}

const allClasses = [...new Set(Object.values(appearanceClasses).flat())]
const darkScheme = "(prefers-color-scheme: dark)"

function subscribe(listener: () => void) {
  const media = window.matchMedia(darkScheme)
  media.addEventListener("change", listener)
  return () => media.removeEventListener("change", listener)
}

function systemAppearance(): Appearance {
  return window.matchMedia(darkScheme).matches ? "dark" : "light"
}

interface Value {
  readonly preference: Preference
  readonly appearance: Appearance
  readonly setPreference: (preference: Preference) => void
}

const Context = createContext<Value | null>(null)

export function Provider(props: {
  preference: Preference
  onPreferenceChange: (preference: Preference) => void
  children: ReactNode
}) {
  const system = useSyncExternalStore(subscribe, systemAppearance, () => "dark" as const)
  const appearance = props.preference === "system" ? system : props.preference
  useEffect(() => {
    const root = document.documentElement
    root.toggleAttribute("data-theme-switching", true)
    root.classList.remove(...allClasses)
    root.classList.add(...appearanceClasses[appearance])
    window.getComputedStyle(root).getPropertyValue("color")
    const frame = requestAnimationFrame(() => root.removeAttribute("data-theme-switching"))
    return () => {
      cancelAnimationFrame(frame)
      root.removeAttribute("data-theme-switching")
    }
  }, [appearance])
  return (
    <Context value={{ preference: props.preference, appearance, setPreference: props.onPreferenceChange }}>
      {props.children}
    </Context>
  )
}

export function useTheme() {
  const value = use(Context)
  if (value === null) throw new Error("Theme.useTheme must be used inside Theme.Provider")
  return value
}
