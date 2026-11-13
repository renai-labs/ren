export * as TexMath from "./tex-math.js"

import { Fences } from "./fences.js"

const syntax = /(`+)[\s\S]*?\1|\\\\|\\\(((?:(?!\n[ \t]*\n)[\s\S])+?)\\\)|\\\[((?:(?!\n[ \t]*\n)[\s\S])+?)\\\]/gu

export function rewrite(text: string) {
  if (!text.includes("\\(") && !text.includes("\\[")) return text
  return Fences.mapProse(text, (prose) =>
    prose.replace(syntax, (match, _ticks, inline: string | undefined, block: string | undefined) => {
      if (inline) return `$$${inline}$$`
      if (block) return `\n$$\n${block.trim()}\n$$\n`
      return match
    }),
  )
}
