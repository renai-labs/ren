import type { ComponentProps } from "react"
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock"

const OUTPUT_TITLES = new Set(["Output", "Response"])

export function MdxPre(props: ComponentProps<"pre">) {
  if (props.title && OUTPUT_TITLES.has(props.title))
    return (
      <figure className="docs-output">
        <figcaption>{props.title}</figcaption>
        <pre>{props.children}</pre>
      </figure>
    )
  return (
    <CodeBlock {...props}>
      <Pre>{props.children}</Pre>
    </CodeBlock>
  )
}

export function MdxTable(props: ComponentProps<"table">) {
  return (
    <div className="relative my-6 prose-no-margin overflow-auto overscroll-contain">
      <table {...props} />
    </div>
  )
}
