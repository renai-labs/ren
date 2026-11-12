export * as TimelineSearch from "./timeline-search.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Projection } from "./projection.js"

export interface Match {
  readonly messageID: string
  readonly role: "user" | "assistant"
  readonly revealID: string
  readonly partID: string
  readonly occurrence: number
}

const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/u
const math = /(`+)[\s\S]*?\1|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/gu

const withoutMath = (prose: string) =>
  prose.replaceAll(math, (all, ticks, dollars, paren, bracket) =>
    ticks ? all : String(dollars ?? paren ?? bracket).replaceAll(/\\[a-zA-Z]+|[\s^_{}]/gu, ""),
  )

const closesFence = (line: string, open: { char: string; size: number }) => {
  const marker = line.trim()
  return marker.length >= open.size && marker === open.char.repeat(marker.length)
}

export const visibleText = (text: string) => {
  const out: Array<string> = []
  const prose: Array<string> = []
  const open: Array<{ char: string; size: number; lines: Array<string>; mermaid: boolean }> = []
  const flush = () => {
    out.push(withoutMath(prose.join("\n")))
    prose.length = 0
  }
  for (const line of text.split("\n")) {
    const current = open.at(0)
    const marker = fence.exec(line)
    if (current) {
      current.lines.push(line)
      const closes = closesFence(line, current)
      if (closes && !current.mermaid) out.push(current.lines.join("\n"))
      if (closes) open.length = 0
    } else if (marker?.[1]) {
      flush()
      open.push({ char: marker[1].charAt(0), size: marker[1].length, lines: [line], mermaid: marker[2] === "mermaid" })
    } else prose.push(line)
  }
  flush()
  for (const current of open) out.push(current.lines.join("\n"))
  return out.join("\n")
}

const occurrences = (text: string, query: string): number => {
  const count = (from: number, found: number): number => {
    const at = text.indexOf(query, from)
    return at === -1 ? found : count(at + query.length, found + 1)
  }
  return count(0, 0)
}

export const matches = (messages: ReadonlyArray<SessionMessage.Info>, query: string): ReadonlyArray<Match> => {
  const value = query.trim().toLowerCase()
  if (!value) return []
  const reveals = messages.reduce<Array<string>>((ids, message) => {
    ids.push(message.type === "user" || message.type === "shell" ? message.id : (ids.at(-1) ?? ""))
    return ids
  }, [])
  return messages.flatMap((message, index) => {
    if (message.type !== "user" && message.type !== "assistant") return []
    const parts =
      message.type === "user"
        ? [{ id: `${message.id}:text:0`, text: message.text }]
        : Projection.contentEntries(message).flatMap((entry) =>
            entry.content.type === "text" ? [{ id: entry.id, text: entry.content.text }] : [],
          )
    return parts.flatMap((part) =>
      Array.from({ length: occurrences(visibleText(part.text).toLowerCase(), value) }, (_, occurrence) => ({
        messageID: message.id,
        role: message.type,
        revealID: reveals[index] ?? "",
        partID: part.id,
        occurrence,
      })),
    )
  })
}

export const step = (active: number, count: number, delta: number) => {
  if (count === 0) return 0
  const current = active >= 0 && active < count ? active : 0
  return (current + delta + count) % count
}
