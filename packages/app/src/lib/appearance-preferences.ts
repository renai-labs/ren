export * as AppearancePreferences from "./appearance-preferences.js"

import { Schema } from "effect"
import type { Platform } from "../platform/platform.js"
import { Preference } from "./preference.js"

export const uiFont = Preference.make("appearance.ui-font.v1", Schema.String, "")

export const uiSize = Preference.make("appearance.ui-size.v1", Schema.Literals([15, 16, 17, 18]), 16)

export const codeFont = Preference.make("appearance.code-font.v1", Schema.String, "")

export const codeSize = Preference.make("appearance.code-size.v1", Schema.Literals([0.9, 1, 1.1, 1.25]), 1)

export const uiSizes = [
  { size: 15, label: "Small" },
  { size: 16, label: "Default" },
  { size: 17, label: "Large" },
  { size: 18, label: "Larger" },
] as const

export const codeSizes = [
  { size: 0.9, label: "90%" },
  { size: 1, label: "100%" },
  { size: 1.1, label: "110%" },
  { size: 1.25, label: "125%" },
] as const

const font = (name: string) => {
  const family = name.replaceAll(/["\\]/g, "").trim()
  return family === "" ? undefined : `"${family}",`
}

export function read(storage: Platform.Storage) {
  return {
    uiFont: uiFont.read(storage),
    uiSize: uiSize.read(storage),
    codeFont: codeFont.read(storage),
    codeSize: codeSize.read(storage),
  }
}

export function apply(root: HTMLElement, values: ReturnType<typeof read>) {
  const sans = font(values.uiFont)
  const mono = font(values.codeFont)
  if (sans === undefined) root.style.removeProperty("--user-font-sans")
  else root.style.setProperty("--user-font-sans", sans)
  if (mono === undefined) root.style.removeProperty("--user-font-mono")
  else root.style.setProperty("--user-font-mono", mono)
  root.style.fontSize = values.uiSize === 16 ? "" : `${values.uiSize}px`
  if (values.codeSize === 1) root.style.removeProperty("--code-scale")
  else root.style.setProperty("--code-scale", String(values.codeSize))
}
