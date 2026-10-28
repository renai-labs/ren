import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { loadHighlighter } from "../lib/highlighter.js"

type Highlighter = NonNullable<Awaited<ReturnType<typeof loadHighlighter>>>

type Highlighted = {
  readonly highlighter: Highlighter | null
  readonly text: string
  readonly lines: ReadonlyArray<ReactNode>
  readonly state?: Parameters<Highlighter["highlight"]>[1]
}

export function useHighlightedCode(value: string, language: string) {
  const code = value.endsWith("\n") ? value.slice(0, -1) : value
  const [loaded, setLoaded] = useState<{ language: string; highlighter: Highlighter | null }>()
  const highlighter = loaded?.language === language ? loaded.highlighter : null

  useEffect(() => {
    const run = { cancelled: false }
    loadHighlighter(language)
      .then((next) => {
        if (!run.cancelled) setLoaded({ language, highlighter: next })
      })
      .catch(() => undefined)
    return () => {
      run.cancelled = true
    }
  }, [language])

  const [done, setDone] = useState<Highlighted>({ highlighter: null, text: "", lines: [] })
  const kept: Highlighted =
    done.highlighter === highlighter && code.startsWith(done.text) ? done : { highlighter, text: "", lines: [] }
  const end = code.lastIndexOf("\n") + 1
  const result =
    highlighter && end > kept.text.length
      ? highlighter.highlight(code.slice(kept.text.length, end - 1), kept.state)
      : undefined
  const next: Highlighted =
    result && highlighter
      ? { highlighter, text: code.slice(0, end), lines: [...kept.lines, ...result.lines], state: result.state }
      : kept
  if (next !== done) setDone(next)

  if (!highlighter) return code.split("\n")
  return [...next.lines, highlighter.highlight(code.slice(end), next.state).lines[0]]
}
