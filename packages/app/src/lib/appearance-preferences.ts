export * as AppearancePreferences from "./appearance-preferences.js"

import { Schema } from "effect"
import { Preference } from "./preference.js"

export const themes = ["system", "light", "dark"] as const

export const uiFonts = [
  { value: "sf-pro", label: "SF Pro", family: "SF Pro Variable" },
  { value: "inter", label: "Inter", family: "Inter Variable" },
  { value: "geist", label: "Geist", family: "Geist Variable" },
] as const

export const codeFonts = [
  { value: "ibm-plex-mono", label: "IBM Plex Mono", family: "IBM Plex Mono" },
  { value: "geist-mono", label: "Geist Mono", family: "Geist Mono Variable" },
  { value: "jetbrains-mono", label: "JetBrains Mono", family: "JetBrains Mono Variable" },
] as const

export const uiSizes = [
  { value: 15, label: "Small" },
  { value: 16, label: "Default" },
  { value: 17, label: "Large" },
  { value: 18, label: "Larger" },
] as const

export const codeSizes = [
  { value: 0.9, label: "90%" },
  { value: 1, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.25, label: "125%" },
] as const

const valuesOf = <V extends string | number>(options: ReadonlyArray<{ readonly value: V }>) =>
  Schema.Literals(options.map((option) => option.value))

export const theme = Preference.make("theme.v1", Schema.Literals(themes), "dark")

export const uiFont = Preference.make("appearance.ui-font.v2", valuesOf(uiFonts), "sf-pro")

export const uiSize = Preference.make("appearance.ui-size.v1", valuesOf(uiSizes), 16)

export const codeFont = Preference.make("appearance.code-font.v2", valuesOf(codeFonts), "ibm-plex-mono")

export const codeSize = Preference.make("appearance.code-size.v1", valuesOf(codeSizes), 1)

const familyOf = (fonts: ReadonlyArray<{ readonly value: string; readonly family: string }>, chosen: string) =>
  fonts.find((font) => font.value === chosen)?.family

export function apply(
  root: HTMLElement,
  values: {
    uiFont: (typeof uiFonts)[number]["value"]
    uiSize: (typeof uiSizes)[number]["value"]
    codeFont: (typeof codeFonts)[number]["value"]
    codeSize: (typeof codeSizes)[number]["value"]
  },
) {
  root.style.setProperty("--user-font-sans", `"${familyOf(uiFonts, values.uiFont)}",`)
  root.style.setProperty("--user-font-mono", `"${familyOf(codeFonts, values.codeFont)}",`)
  root.style.setProperty("--code-scale", String(values.codeSize))
  root.style.fontSize = values.uiSize === 16 ? "" : `${values.uiSize}px`
}
