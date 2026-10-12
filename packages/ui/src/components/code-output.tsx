import { cva } from "class-variance-authority"
import { composeClasses } from "../lib/compose-classes.js"
import { toneText } from "../lib/tone.js"
import { CopyButton } from "./copy-button.js"

type TokenKind = "key" | "string" | "punctuation" | "literal" | "plain"

const outputVariants = cva("m-0 p-3 font-mono text-xs/base", {
  variants: {
    wrapping: {
      preformatted: "whitespace-pre",
      wrapped: "wrap-break-word whitespace-pre-wrap",
    },
    tone: { primary: toneText.primary, secondary: toneText.secondary },
  },
  defaultVariants: { wrapping: "wrapped", tone: "primary" },
})

const tokenTone: Record<TokenKind, string> = {
  key: "text-accent-primary",
  string: "text-status-success",
  literal: "text-status-warning",
  punctuation: "text-text-secondary",
  plain: "text-text-primary",
}

const whitespace = /^\s+$/
const operator = /^(?:\|\|?|&&|;)$/

function classify(part: string, commandNext: boolean): { kind: TokenKind; commandNext: boolean } {
  if (whitespace.test(part)) return { kind: "plain", commandNext: commandNext || part.includes("\n") }
  if (operator.test(part)) return { kind: "punctuation", commandNext: true }
  if (/^["']/.test(part)) return { kind: "string", commandNext }
  if (commandNext) return { kind: "key", commandNext: false }
  return { kind: part.startsWith("-") ? "literal" : "plain", commandNext: false }
}

function shellTokens(source: string) {
  return source
    .split(/(\s+|\|\|?|&&|;|"[^"]*"|'[^']*')/)
    .filter((part) => part !== "")
    .reduce<ReadonlyArray<{ text: string; start: number; kind: TokenKind; commandNext: boolean }>>((tokens, part) => {
      const previous = tokens.at(-1)
      return tokens.concat({
        text: part,
        start: previous === undefined ? 0 : previous.start + previous.text.length,
        ...classify(part, previous?.commandNext ?? true),
      })
    }, [])
}

export type CodeOutputProps = {
  content: string
  label?: string
  wrapping?: "wrapped" | "preformatted"
  tone?: "primary" | "secondary"
  height?: "bounded" | "content"
  syntax?: "plain" | "shell"
  continuation?: "none" | "ellipsis"
  truncated?: boolean
  onShowMore?: () => void
  copyText?: string
  onCopy?: (text: string) => void | Promise<void>
}

export function CodeOutput(props: CodeOutputProps) {
  return (
    <div data-slot="code-output" className="relative min-w-0">
      {props.onCopy === undefined ? null : (
        <span className="absolute top-2 right-2 z-10">
          <CopyButton value={props.copyText ?? props.content} onCopy={props.onCopy} size="extra-small" />
        </span>
      )}
      <section
        aria-label={props.label ?? "Output"}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the output can overflow, so keyboard users need to reach it to scroll
        tabIndex={0}
        className={composeClasses(
          "overflow-auto overscroll-contain outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary",
          props.height !== "content" && "max-h-64",
        )}
        data-scrollable
      >
        <pre className={composeClasses(outputVariants({ wrapping: props.wrapping, tone: props.tone }))}>
          {props.syntax === "shell"
            ? shellTokens(props.content).map((token) => (
                <span key={token.start} className={tokenTone[token.kind]}>
                  {token.text}
                </span>
              ))
            : props.content}
          {props.continuation === "ellipsis" ? <span className="text-text-secondary">{"\n"}…</span> : null}
        </pre>
      </section>
      {props.truncated === true && props.onShowMore !== undefined ? (
        <button
          type="button"
          onClick={props.onShowMore}
          className="w-full border-t border-border-primary py-2 text-xs text-text-secondary transition-standard outline-none hover:text-text-primary focus-visible:bg-fill-primary"
        >
          Show more
        </button>
      ) : null}
    </div>
  )
}
