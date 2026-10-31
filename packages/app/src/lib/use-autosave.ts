import { useEffect } from "react"

export function useAutosave(draft: string | undefined, saved: string, save: (value: string) => unknown, delay = 800) {
  useEffect(() => {
    if (draft === undefined || draft === saved) return
    const timer = setTimeout(() => void save(draft), delay)
    return () => clearTimeout(timer)
  }, [draft, saved, save, delay])
}
