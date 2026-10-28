import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import type { GrammarState } from "shiki/core"
import { type Highlighter, loadHighlighter, readyHighlighter } from "../lib/highlighter.js"

type Highlighted = {
  readonly highlighter: Highlighter | null
  readonly text: string
  readonly lines: ReadonlyArray<ReactNode>
  readonly state?: GrammarState | undefined
}

export function useHighlightedCode(value: string, language: string) {
  const code = value.endsWith("\n") ? value.slice(0, -1) : value
  const [loaded, setLoaded] = useState<{ language: string; highlighter: Highlighter | null }>()
  const highlighter = loaded?.language === language ? loaded.highlighter : readyHighlighter(language)

  useEffect(() => {
    if (readyHighlighter(language)) return
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
