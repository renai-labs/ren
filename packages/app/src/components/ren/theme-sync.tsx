import { useEffect } from "react"
import { useTheme } from "@/stores/ui"

const darkQuery = "(prefers-color-scheme: dark)"

export function ThemeSync() {
  const theme = useTheme()
  useEffect(() => {
    const media = window.matchMedia(darkQuery)
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
      document.documentElement.style.colorScheme = dark ? "dark" : "light"
    }
    apply()
    if (theme !== "system") return
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])
  return null
}
