import type { ReactNode } from "react"
import type { ThemedToken } from "@pierre/highlights"

export const longLine = 1000

const loaded: { library: ReturnType<typeof load> | undefined } = { library: undefined }

function load() {
  return Promise.all([
    import("@pierre/highlights"),
    import("@pierre/highlights/themes/pierre-light"),
    import("@pierre/highlights/themes/pierre-dark"),
  ]).then(([core, light, dark]) => ({ core, themes: { light: light.default, dark: dark.default } }))
}

const render = (line: ReadonlyArray<ThemedToken>) =>
  line.map((token) => (
    <span key={token.offset} style={token.htmlStyle} className="text-(--hls-light) dark:text-(--hls-dark)">
      {token.content}
    </span>
  ))

export type Stream = (code: string) => ReadonlyArray<ReactNode> | null

export interface Highlighter {
  readonly highlight: (code: string) => ReadonlyArray<ReactNode>
  readonly stream: () => Stream
}

const ready = new Map<string, Highlighter>()

export const readyHighlighter = (language: string) => ready.get(language) ?? null

export async function loadHighlighter(language: string) {
  const lang = language.toLowerCase()
  if (!lang) return null
  loaded.library ??= load()
  const library = await loaded.library
  if (!library.core.isSupportedLanguage(lang)) return null
  const options = { lang, themes: library.themes, defaultColor: false, tokenizeMaxLineLength: longLine } as const
  const highlighter: Highlighter = {
    highlight: (code) => library.core.codeToTokens(code, options).tokens.map(render),
    stream() {
      const tokenizer = new library.core.StreamTokenizer(options)
      const done = { text: "", lines: new Array<ReactNode>() }
      return (code) => {
        if (!code.startsWith(done.text)) return null
        const end = code.lastIndexOf("\n") + 1
        if (end > done.text.length) {
          done.lines = [...done.lines, ...tokenizer.pushCode(code.slice(done.text.length, end)).map(render)]
          done.text = code.slice(0, end)
        }
        return [...done.lines, ...highlighter.highlight(code.slice(end))]
      }
    },
  }
  ready.set(language, highlighter)
  return highlighter
}
