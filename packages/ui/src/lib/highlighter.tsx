import type { ReactNode } from "react"
import { createHighlighterCore, type GrammarState, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

const languages = {
  bash: () => import("shiki/langs/shellscript.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
}

type Language = keyof typeof languages

const aliases: Readonly<Record<string, Language>> = {
  js: "javascript",
  md: "markdown",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
}

const isLanguage = (name: string): name is Language => Object.hasOwn(languages, name)

const loaded: { highlighter: Promise<HighlighterCore> | undefined } = { highlighter: undefined }

function shiki() {
  loaded.highlighter ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
  return loaded.highlighter
}

function languageOf(language: string) {
  const name = language.toLowerCase()
  if (name === "ansi") return name
  if (isLanguage(name)) return name
  return aliases[name] ?? null
}

export interface Highlighter {
  readonly highlight: (
    code: string,
    state?: GrammarState,
  ) => { readonly lines: ReadonlyArray<ReactNode>; readonly state: GrammarState | undefined }
}

const ready = new Map<string, Highlighter>()

export const readyHighlighter = (language: string) => ready.get(language) ?? null

export async function loadHighlighter(language: string) {
  const lang = languageOf(language)
  if (!lang) return null
  const core = await shiki()
  if (lang !== "ansi" && !core.getLoadedLanguages().includes(lang)) await core.loadLanguage(languages[lang])
  const highlighter: Highlighter = {
    highlight(code, state) {
      const tokenize = (text: string) =>
        core.codeToTokens(text, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
          ...(state && { grammarState: state }),
        }).tokens
      const tokens = lang === "ansi" ? code.split("\n").flatMap((line) => tokenize(line)) : tokenize(code)
      return {
        lines: tokens.map((line) =>
          line.map((token) => (
            <span key={token.offset} style={token.htmlStyle} className="text-(--shiki-light) dark:text-(--shiki-dark)">
              {token.content}
            </span>
          )),
        ),
        state: core.getLastGrammarState(tokens),
      }
    },
  }
  ready.set(language, highlighter)
  return highlighter
}
