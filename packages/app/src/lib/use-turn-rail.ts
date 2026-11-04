import { useEffect, useRef, useState } from "react"

export const turnSelector = (id: string) => `[data-turn="${CSS.escape(id)}"]`

export function useTurnRail(ids: ReadonlyArray<string>) {
  const ref = useRef<HTMLElement>(null)
  const [inView, setInView] = useState<ReadonlySet<string>>(() => new Set())
  const key = ids.join(",")
  const scope = () => ref.current?.parentElement
  const ticks = () => [...(ref.current?.querySelectorAll<HTMLElement>("[data-turn-tick]") ?? [])]
  useEffect(() => {
    const root = ref.current?.parentElement
    if (!root) return
    const seen = new Set<string>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute("data-turn")
        if (id && entry.isIntersecting) seen.add(id)
        if (id && !entry.isIntersecting) seen.delete(id)
      }
      setInView(new Set(seen))
    })
    for (const id of key.split(",")) {
      const element = id ? root.querySelector(turnSelector(id)) : null
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [key])
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.code !== "KeyJ") return
      event.preventDefault()
      ref.current?.querySelector<HTMLElement>("[data-turn-tick][tabindex='0']")?.focus()
    }
    window.addEventListener("keydown", focus)
    return () => window.removeEventListener("keydown", focus)
  }, [])
  return [ref, { inView, scope, focus: (index: number) => ticks()[index]?.focus() }] as const
}
