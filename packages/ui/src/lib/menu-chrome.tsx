import { cva } from "class-variance-authority"
import { createContext } from "react"
import type { ReactNode } from "react"
import { composeClasses } from "./compose-classes.js"
import { optionRow } from "./control-chrome.js"

export type Density = "regular" | "spacious"

export const MenuDensity = createContext<Density>("regular")

export const itemVariants = cva("", {
  variants: {
    tone: {
      neutral: composeClasses(optionRow, "[&_svg:not([data-tone])]:text-text-secondary"),
      danger: composeClasses(optionRow, "text-status-danger data-highlighted:bg-status-danger/tint"),
    },
    density: {
      regular: "",
      spacious: "h-9 gap-3 rounded-control px-3 py-0 data-highlighted:[&_svg:not([data-tone])]:text-current",
    },
  },
  defaultVariants: { density: "regular" },
})

const plain = (node: unknown) => typeof node === "string" || typeof node === "number"

export function menuLabel(content: ReactNode) {
  return (Array.isArray(content) ? content : [content]).every(plain) ? (
    <span className="truncate">{content}</span>
  ) : (
    content
  )
}
