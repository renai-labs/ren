export * as TexMath from "./tex-math.js"

const fence = /^ {0,3}(`{3,}|~{3,})/u
const syntax = /(`+)[\s\S]*?\1|\\\\|\\\(((?:(?!\n[ \t]*\n)[\s\S])+?)\\\)|\\\[((?:(?!\n[ \t]*\n)[\s\S])+?)\\\]/gu

export function rewrite(text: string) {
  if (!text.includes("\\(") && !text.includes("\\[")) return text
  const convert = (prose: string) =>
    prose.replace(syntax, (match, _ticks, inline: string | undefined, block: string | undefined) => {
      if (inline) return `$$${inline}$$`
      if (block) return `\n$$\n${block.trim()}\n$$\n`
      return match
    })
  const out: string[] = []
  let prose: string[] = []
  let open: { char: string; size: number } | undefined
  const flush = () => {
    if (prose.length > 0) out.push(convert(prose.join("\n")))
    prose = []
  }
  for (const line of text.split("\n")) {
    const marker = fence.exec(line)?.at(1)
    if (open) {
      out.push(line)
      if (marker?.startsWith(open.char) && marker.length >= open.size && line.trim() === marker) open = undefined
    } else if (marker) {
      flush()
      out.push(line)
      open = { char: marker.charAt(0), size: marker.length }
    } else prose.push(line)
  }
  flush()
  return out.join("\n")
}
