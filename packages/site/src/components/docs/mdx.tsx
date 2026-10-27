import type { ComponentProps } from "react"
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock"

export function MdxPre(props: ComponentProps<"pre">) {
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
