export * as TimelineSearch from "./timeline-search.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Fences } from "./fences.js"
import { Projection } from "./projection.js"

export interface Match {
  readonly messageID: string
  readonly role: "user" | "assistant"
  readonly revealID: string
  readonly partID: string
  readonly occurrence: number
}

const math = /(`+)[\s\S]*?\1|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/gu

const visibleText = (text: string) =>
  Fences.split(text)
    .filter((part) => !(part.closed && part.info === "mermaid"))
    .map((part) =>
      part.code
        ? part.text
        : part.text.replaceAll(math, (all, ticks, dollars, paren, bracket) =>
            ticks ? all : String(dollars ?? paren ?? bracket).replaceAll(/\\[a-zA-Z]+|[\s^_{}]/gu, ""),
          ),
    )
    .join("\n")

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
