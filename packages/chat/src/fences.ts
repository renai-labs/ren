export * as Fences from "./fences.js"

export interface Part {
  readonly code: boolean
  readonly info: string
  readonly closed: boolean
  readonly text: string
}

const opening = /^ {0,3}(?<ticks>`{3,}|~{3,})[ \t]*(?<info>\S*)/u

const prose = { code: false, info: "", closed: false }

export function split(text: string): ReadonlyArray<Part> {
  const parts: Part[] = []
  let lines: string[] = []
  let open: { readonly ticks: string; readonly info: string } | undefined
  const push = (part: Omit<Part, "text">) => {
    if (lines.length > 0) parts.push({ ...part, text: lines.join("\n") })
    lines = []
  }
  for (const line of text.split("\n")) {
    const found = open ? undefined : opening.exec(line)?.groups
    if (found) push(prose)
    lines.push(line)
    const marker = line.trim()
    if (found) open = { ticks: found.ticks ?? "", info: found.info ?? "" }
    else if (open && marker.length >= open.ticks.length && marker === open.ticks.charAt(0).repeat(marker.length)) {
      push({ code: true, info: open.info, closed: true })
      open = undefined
    }
  }
  push(open ? { code: true, info: open.info, closed: false } : prose)
  return parts
}

export const mapProse = (text: string, convert: (prose: string) => string) =>
  split(text)
    .map((part) => (part.code ? part.text : convert(part.text)))
    .join("\n")
