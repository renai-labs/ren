import { EnrichedMarkdownText } from "react-native-enriched-markdown"
import { useCSSVariable } from "uniwind"

const string = (value: string | number | undefined) => (typeof value === "string" ? value : undefined)

function Markdown(props: { readonly text: string; readonly streaming?: boolean; readonly size?: "sm" }) {
  const foreground = string(useCSSVariable("--color-foreground"))
  const muted = string(useCSSVariable("--color-muted"))
  const border = string(useCSSVariable("--color-border"))
  const sans = string(useCSSVariable("--font-sans"))
  const mono = string(useCSSVariable("--font-mono"))
  const small = props.size === "sm"
  const ink = foreground ? { color: foreground } : {}
  const surface = muted ? { backgroundColor: muted } : {}
  const body = { fontSize: small ? 14 : 16, lineHeight: small ? 22 : 26, ...ink, ...(sans ? { fontFamily: sans } : {}) }
  const heading = (fontSize: number) => ({ ...body, fontSize, lineHeight: fontSize * 1.4, fontWeight: "600" })
  const code = { fontSize: small ? 12 : 14, ...ink, ...(mono ? { fontFamily: mono } : {}) }
  return (
    <EnrichedMarkdownText
      markdown={props.text}
      flavor="github"
      streamingAnimation={props.streaming === true}
      selectable
      markdownStyle={{
        paragraph: body,
        h1: heading(22),
        h2: heading(19),
        h3: heading(17),
        h4: heading(16),
        list: body,
        blockquote: { ...body, ...(border ? { borderColor: border } : {}) },
        strong: ink,
        em: ink,
        code: { ...code, ...surface },
        codeBlock: { ...code, lineHeight: 20, padding: 12, borderRadius: 8, ...surface },
        link: ink,
      }}
    />
  )
}

export { Markdown }
