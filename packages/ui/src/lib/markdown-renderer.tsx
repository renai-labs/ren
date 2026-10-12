import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { createMermaidPlugin } from "@streamdown/mermaid"
import { Streamdown } from "streamdown"

const gradualReveal = { animation: "blurIn", duration: 360, easing: "ease-out", sep: "char", stagger: 0 } as const

const plugins = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid: createMermaidPlugin({ config: { fontFamily: "var(--ren-font-sans)" } }),
}
const controls = { table: false }
const linkSafety = { enabled: false }

export function MarkdownRenderer(props: {
  content: string
  source: "static" | "streaming"
  reveal: "none" | "gradual"
}) {
  const streaming = props.source === "streaming"
  return (
    <Streamdown
      mode={props.source}
      isAnimating={streaming}
      animated={streaming && props.reveal === "gradual" ? gradualReveal : false}
      plugins={plugins}
      controls={controls}
      linkSafety={linkSafety}
      tableMaxHeight="32rem"
    >
      {props.content}
    </Streamdown>
  )
}
