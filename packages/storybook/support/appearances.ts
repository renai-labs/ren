import { Theme } from "@ren/ui/theme"

export const appearances = Theme.preferences.filter(
  (preference): preference is Theme.Appearance => preference !== "system",
)
