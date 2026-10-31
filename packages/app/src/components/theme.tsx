export * as Theme from "./theme.js"

import { createContext, use, useEffect } from "react"
import type { ReactNode } from "react"

export const preferences = ["system", "light", "dark"] as const

export type Preference = (typeof preferences)[number]

const darkQuery = "(prefers-color-scheme: dark)"

const Context = createContext<{ readonly preference: Preference; readonly choose: (next: Preference) => void } | null>(
  null,
)

export function Provider(props: {
  preference: Preference
  onPreferenceChange: (next: Preference) => void
  children: ReactNode
}) {
  const preference = props.preference
  useEffect(() => {
    const media = window.matchMedia(darkQuery)
    const apply = () => {
      const dark = preference === "dark" || (preference === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
      document.documentElement.style.colorScheme = dark ? "dark" : "light"
    }
    apply()
    if (preference !== "system") return
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [preference])
  return <Context value={{ preference, choose: props.onPreferenceChange }}>{props.children}</Context>
}

export function useTheme() {
  const value = use(Context)
  if (value === null) throw new Error("useTheme must be used inside Theme.Provider")
  return value
}
