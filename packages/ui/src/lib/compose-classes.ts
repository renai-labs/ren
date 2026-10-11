import { clsx } from "clsx"
import type { ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "xs", "sm", "base", "title", "display"] }],
      "font-weight": [{ font: ["regular", "medium", "reading-semibold"] }],
      shadow: [{ shadow: ["overlay", "raised", "dialog", "none"] }],
    },
  },
})

export function composeClasses(...inputs: ClassValue[]) {
  return merge(clsx(inputs))
}
