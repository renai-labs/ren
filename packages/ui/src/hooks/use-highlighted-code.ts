import { useEffect, useState } from "react"
import { type Highlighter, loadHighlighter, readyHighlighter, type Stream } from "../lib/highlighter.js"

export function useHighlightedCode(value: string, language: string) {
  const code = value.endsWith("\n") ? value.slice(0, -1) : value
  const [stream, setStream] = useState<{ initial: string; highlighter?: Highlighter; lines?: Stream }>({
    initial: code,
  })
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

  if (!highlighter) return code.split("\n")
  if (code === stream.initial) return highlighter.highlight(code)
  const lines = stream.highlighter === highlighter ? stream.lines?.(code) : null
  if (lines) return lines
  const next = { initial: stream.initial, highlighter, lines: highlighter.stream() }
  setStream(next)
  return next.lines(code) ?? code.split("\n")
}
