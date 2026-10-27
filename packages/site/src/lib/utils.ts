import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-title-2",
        "text-title-3",
        "text-title-4",
        "text-title-5",
        "text-title-6",
        "text-title-7",
        "text-body-lg",
        "text-body",
        "text-body-sm",
        "text-caption",
        "text-micro",
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
