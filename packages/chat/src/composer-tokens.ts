export * as ComposerTokens from "./composer-tokens.js"

import { Option, Schema, Struct } from "effect"
import type { Composer } from "./composer.js"
import { Mentions } from "./mentions.js"

export interface Token {
  readonly type: string
  readonly value: string
  readonly label: string
  readonly id?: string
  readonly data?: Readonly<Record<string, unknown>>
}

export type Segment = string | Token

export type Value = ReadonlyArray<Segment>

const decodeItem = Schema.decodeUnknownOption(Mentions.Item)

export const fromItem = (item: Mentions.Item): Token => ({
  type: item.kind,
  value: item.id,
  label: item.label,
  data: { item },
})

export const itemOf = (token: Token): Mentions.Item | undefined => Option.getOrUndefined(decodeItem(token.data?.item))

export const toValue = (text: string, found: ReadonlyArray<Mentions.Token>): Value => {
  const built = found.reduce<{ readonly from: number; readonly value: Value }>(
    (all, token) => {
      const before = text.slice(all.from, token.start)
      return { from: token.end, value: [...all.value, ...(before ? [before] : []), fromItem(token.item)] }
    },
    { from: 0, value: [] },
  )
  const rest = text.slice(built.from)
  return rest ? [...built.value, rest] : built.value
}

const written = (value: Value) =>
  value.reduce<{ readonly text: string; readonly picked: ReadonlyArray<Mentions.Token> }>(
    (all, segment) => {
      if (typeof segment === "string") return { ...all, text: all.text + segment }
      const item = itemOf(segment)
      if (!item) return { ...all, text: all.text + segment.label }
      const piece = Mentions.text(item)
      const start = all.text.length
      return { text: all.text + piece, picked: [...all.picked, { start, end: start + piece.length, item }] }
    },
    { text: "", picked: [] },
  )

export const textOf = (value: Value) => written(value).text

export const toDraft = (draft: Composer.Draft, value: Value): Composer.Draft => {
  const next = written(value)
  return next.picked.length > 0
    ? { ...draft, text: next.text, picked: next.picked }
    : { ...Struct.omit(draft, ["picked"]), text: next.text }
}

export const length = (value: Value) =>
  value.reduce((total, segment) => total + (typeof segment === "string" ? segment.length : 1), 0)
