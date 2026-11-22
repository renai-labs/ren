export * as Mentions from "./mentions.js"

import type { FileSystem } from "@ren/schema/file-system"
import type { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionMessage } from "@ren/schema/session/message"
import { Schema } from "effect"

export type Kind = typeof Kind.Type
export const Kind = Schema.Literals(["agent", "skill", "file", "app", "repository", "task", "chat", "ren-agent"])

export interface Item extends Schema.Schema.Type<typeof Item> {}
export const Item = Schema.Struct({
  kind: Kind,
  id: Schema.String,
  label: Schema.String,
  handle: Schema.String,
  description: Schema.optional(Schema.String),
  sent: Schema.optional(Schema.String),
})

export interface Token extends Schema.Schema.Type<typeof Token> {}
export const Token = Schema.Struct({ start: Schema.Number, end: Schema.Number, item: Item })

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

export const fromFile = (file: FileSystem.Entry, description?: string): Item => ({
  kind: "file",
  id: file.path,
  label: file.path,
  handle: file.path,
  ...(description && { description }),
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

// oxlint-disable-next-line ren/no-comments -- The path after the host, as owner/repo; a nested path (GitLab groups) stays whole.
export const repositoryName = (repository: string) => repository.replace(/^https:\/\/[^/]+\//u, "")

export const fromRepository = (reference: {
  readonly alias: string
  readonly repository: string
  readonly description: string
}): Item => ({
  kind: "repository",
  id: reference.alias,
  label: repositoryName(reference.repository),
  handle: reference.alias,
  description: reference.description || reference.repository,
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

const closeness = (item: Item, query: string) => {
  const names = [item.label, item.handle].map((value) => value.toLowerCase())
  const wanted = query.toLowerCase()
  if (names.includes(wanted)) return 0
  if (names.some((name) => name.startsWith(wanted))) return 1
  if (names.some((name) => name.split(/[\s/_.-]+/u).some((word) => word.startsWith(wanted)))) return 2
  return names.some((name) => name.includes(wanted)) ? 3 : 4
}

// oxlint-disable-next-line ren/no-comments -- A search can match a chat or a task by its content, so a name that matches the query goes above it.
export const rank = <A>(entries: ReadonlyArray<A>, itemOf: (entry: A) => Item, query: string): ReadonlyArray<A> =>
  query === ""
    ? entries
    : entries
        .map((entry) => ({ entry, score: closeness(itemOf(entry), query) }))
        .toSorted((left, right) => left.score - right.score)
        .map((ranked) => ranked.entry)

const groupSize = 5

export type Group = "Apps" | "Repositories" | "Files"

export const group = (
  query: string,
  lists: {
    readonly apps: ReadonlyArray<Item>
    readonly repositories: ReadonlyArray<Item>
    readonly files: ReadonlyArray<Item>
  },
): ReadonlyArray<{ readonly item: Item; readonly group: Group }> => {
  const listed = (items: ReadonlyArray<Item>) => items.filter((item) => named(item, query)).slice(0, groupSize)
  return [
    ...listed(lists.apps).map((item) => ({ item, group: "Apps" as const })),
    ...listed(lists.repositories).map((item) => ({ item, group: "Repositories" as const })),
    ...lists.files.slice(0, groupSize).map((item) => ({ item, group: "Files" as const })),
  ]
}

export const fileDragType = "application/x-ren-file"

export const text = (item: Pick<Item, "label">) => `@  ${item.label}`

const space = /\s/
const word = /[\p{L}\p{N}_]/u

const positions = (input: string, needle: string, from: number): ReadonlyArray<number> => {
  const at = input.indexOf(needle, from)
  return at === -1 ? [] : [at, ...positions(input, needle, at + 1)]
}

const common = (left: string, right: string) => {
  const limit = Math.min(left.length, right.length)
  return Array.from({ length: limit }, (_, index) => index).find((index) => left[index] !== right[index]) ?? limit
}

const reversed = (input: string) => input.split("").toReversed().join("")

export const shift = (picked: ReadonlyArray<Token>, before: string, after: string): ReadonlyArray<Token> => {
  const prefix = common(before, after)
  const suffix = Math.min(common(reversed(before), reversed(after)), Math.min(before.length, after.length) - prefix)
  const moved = after.length - before.length
  return picked.flatMap((token) => {
    if (token.end <= prefix) return [token]
    if (token.start < before.length - suffix) return []
    return [{ start: token.start + moved, end: token.end + moved, item: token.item }]
  })
}

const sent = (item: Item) => item.sent ?? `@${item.handle}`

const located = (
  input: string,
  items: ReadonlyArray<Item>,
  picked: ReadonlyArray<Token>,
  form: (item: Item) => string,
): ReadonlyArray<Token> => {
  if (!input.includes("@")) return []
  const ordered = [...new Map(items.map((item) => [key(item), item])).values()].toSorted(
    (left, right) => form(right).length - form(left).length,
  )
  const candidates = [
    ...picked.filter((token) => input.slice(token.start, token.end) === form(token.item)),
    ...ordered.flatMap((item) =>
      positions(input, form(item), 0).map((start) => ({ start, end: start + form(item).length, item })),
    ),
  ].filter(
    (token) =>
      form(token.item).length >= 4 &&
      (token.start === 0 || space.test(input.charAt(token.start - 1))) &&
      (token.end >= input.length || !word.test(input.charAt(token.end))),
  )
  return candidates
    .filter(
      (token, index) => !candidates.slice(0, index).some((other) => token.start < other.end && token.end > other.start),
    )
    .toSorted((left, right) => left.start - right.start)
}

export const tokens = (
  input: string,
  items: ReadonlyArray<Item>,
  picked: ReadonlyArray<Token> = [],
): ReadonlyArray<Token> => located(input, items, picked, text)

// oxlint-disable-next-line ren/no-comments -- The mentions in a message as it was sent: each item by the text the composer sent for it.
export const sentTokens = (input: string, items: ReadonlyArray<Item>) => located(input, items, [], sent)

const filePill = /(?<=^|\s)@ {2}([^\s@]*[./][^\s@]*)/g

export const scan = (input: string, items: ReadonlyArray<Item>) =>
  tokens(input, [
    ...items,
    ...Array.from(input.matchAll(filePill), (match) => fromFile({ path: match.at(1) ?? "", type: "file" })),
  ])

export const insert = (input: string, item: Item, start: number, cursor: number) => {
  const before = input.slice(0, start)
  const rest = input.slice(cursor)
  const inserted = text(item) + (rest.startsWith(" ") ? "" : " ")
  return { text: before + inserted + rest, cursor: before.length + inserted.length }
}

export const insertAt = (input: string, item: Item, cursor: number) => {
  const padded = cursor > 0 && !space.test(input.charAt(cursor - 1))
  const at = padded ? cursor + 1 : cursor
  return insert(padded ? `${input.slice(0, cursor)} ${input.slice(cursor)}` : input, item, at, at)
}

export const insertFile = (input: string, path: string, cursor: number) =>
  insertAt(input, fromFile({ path, type: "file" }), cursor)

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

export const unmention = (previous: string, next: string, found: ReadonlyArray<Token>) => {
  if (next.length >= previous.length) return
  const prefix = Array.from({ length: next.length }, (_, index) => next.charAt(index)).findIndex(
    (character, index) => character !== previous.charAt(index),
  )
  const start = prefix === -1 ? next.length : prefix
  const suffix = Array.from({ length: next.length - start }, (_, index) =>
    next.charAt(next.length - 1 - index),
  ).findIndex((character, index) => character !== previous.charAt(previous.length - 1 - index))
  const end = previous.length - (suffix === -1 ? next.length - start : suffix)
  if (start + (previous.length - end) !== next.length) return
  const token = found.find((each) => start < each.end && end > each.start)
  if (!token) return
  const from = Math.min(start, token.start)
  const to = Math.max(end, token.end + (previous.charAt(token.end) === " " ? 1 : 0))
  return { text: previous.slice(0, from) + previous.slice(to), cursor: from }
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
      const value = sent(token.item)
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
