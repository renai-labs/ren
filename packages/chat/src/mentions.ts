export * as Mentions from "./mentions.js"

import type { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionMessage } from "@ren/schema/session/message"

export type Kind = "agent" | "skill" | "file" | "app"

export interface Item {
  readonly kind: Kind
  readonly id: string
  readonly label: string
  readonly handle: string
  readonly description?: string | undefined
}

export interface Token {
  readonly start: number
  readonly end: number
  readonly item: Item
}

export const key = (item: Item) => `${item.kind}:${item.id}`

export const fromAgent = (agent: SessionCatalog.Agent): Item => ({
  kind: "agent",
  id: agent.id,
  label: agent.name,
  handle: agent.id,
  ...(agent.description && { description: agent.description }),
})

export const fromSkill = (skill: SessionCatalog.Skill): Item => ({
  kind: "skill",
  id: skill.id,
  label: skill.name,
  handle: skill.id,
  ...(skill.description && { description: skill.description }),
})

export const fromFile = (file: SessionCatalog.File): Item => ({
  kind: "file",
  id: file.path,
  label: file.path,
  handle: file.path,
})

export const fromApp = (app: {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly description: string
}): Item => ({
  kind: "app",
  id: app.id,
  label: app.name,
  handle: app.slug,
  ...(app.description && { description: app.description }),
})

const named = (item: Item, query: string) =>
  [item.label, item.handle].some((value) => value.toLowerCase().includes(query.toLowerCase()))

const matches = (item: Item, query: string) =>
  [item.label, item.handle, item.description ?? ""].some((value) => value.toLowerCase().includes(query.toLowerCase()))

export const suggest = (input: {
  readonly agents: ReadonlyArray<Item>
  readonly skills: ReadonlyArray<Item>
  readonly apps: ReadonlyArray<Item>
  readonly files: ReadonlyArray<Item>
  readonly query: string
}): ReadonlyArray<Item> => {
  const listed = [
    ...[...input.agents, ...input.skills].filter((item) => matches(item, input.query)),
    ...input.apps.filter((item) => named(item, input.query)),
  ]
  return [...listed, ...input.files.filter((file) => !listed.some((item) => key(item) === key(file)))]
}

export const text = (item: Pick<Item, "label">) => `@  ${item.label}`

const space = /\s/
const word = /[\p{L}\p{N}_]/u

const positions = (input: string, needle: string, from: number): ReadonlyArray<number> => {
  const at = input.indexOf(needle, from)
  return at === -1 ? [] : [at, ...positions(input, needle, at + 1)]
}

export const tokens = (input: string, items: ReadonlyArray<Item>): ReadonlyArray<Token> => {
  if (items.length === 0 || !input.includes("@")) return []
  const ordered = [...new Map(items.map((item) => [key(item), item])).values()].toSorted(
    (left, right) => right.label.length - left.label.length,
  )
  const candidates = ordered.flatMap((item) =>
    positions(input, text(item), 0)
      .map((start) => ({ start, end: start + text(item).length, item }))
      .filter(
        (token) =>
          text(item).length >= 4 &&
          (token.start === 0 || space.test(input.charAt(token.start - 1))) &&
          (token.end >= input.length || !word.test(input.charAt(token.end))),
      ),
  )
  return candidates
    .filter(
      (token, index) => !candidates.slice(0, index).some((other) => token.start < other.end && token.end > other.start),
    )
    .toSorted((left, right) => left.start - right.start)
}

export const insert = (input: string, item: Item, start: number, cursor: number) => {
  const before = input.slice(0, start)
  const rest = input.slice(cursor)
  const inserted = text(item) + (rest.startsWith(" ") ? "" : " ")
  return { text: before + inserted + rest, cursor: before.length + inserted.length }
}

export const remove = (
  input: string,
  found: ReadonlyArray<Token>,
  press: { readonly key: string; readonly selectionStart: number; readonly selectionEnd: number },
) => {
  if ((press.key !== "Backspace" && press.key !== "Delete") || press.selectionStart !== press.selectionEnd) return
  const at = press.selectionStart
  const inside = found.find((token) => at > token.start && at < token.end)
  const token = press.key === "Backspace" ? (found.find((item) => item.end === at) ?? inside) : inside
  if (!token) return
  const trailing = input.charAt(token.end) === " " ? 1 : 0
  return { text: input.slice(0, token.start) + input.slice(token.end + trailing), cursor: token.start }
}

export interface Resolved {
  readonly text: string
  readonly agents?: ReadonlyArray<SessionMessage.AgentAttachment>
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly mention: SessionMessage.Mention }>
}

export const resolve = (input: string, found: ReadonlyArray<Token>): Resolved => {
  const built = found.reduce<{
    readonly from: number
    readonly text: string
    readonly mentions: ReadonlyArray<{ readonly item: Item; readonly mention: SessionMessage.Mention }>
  }>(
    (result, token) => {
      const before = result.text + input.slice(result.from, token.start)
      const value = `@${token.item.handle}`
      return {
        from: token.end,
        text: before + value,
        mentions: [
          ...result.mentions,
          { item: token.item, mention: { start: before.length, end: before.length + value.length, text: value } },
        ],
      }
    },
    { from: 0, text: "", mentions: [] },
  )
  const first = (kind: Kind) =>
    built.mentions
      .filter((entry) => entry.item.kind === kind)
      .filter((entry, index, all) => all.findIndex((other) => other.item.id === entry.item.id) === index)
  const agents = first("agent").map((entry) => ({ name: entry.item.id, mention: entry.mention }))
  const skills = first("skill").map((entry) => ({ id: entry.item.id, mention: entry.mention }))
  return {
    text: built.text + input.slice(built.from),
    ...(agents.length > 0 && { agents }),
    ...(skills.length > 0 && { skills }),
  }
}
