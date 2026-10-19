export * as Composer from "./composer.js"

// oxlint-disable typescript/no-misused-spread -- drafts are plain readonly structs; Struct.assign would widen the optional keys these updates keep

import type { SessionInbox } from "@ren/schema/session-inbox"
import { SessionMessage } from "@ren/schema/session-message"
import { SessionModel } from "@ren/schema/session-model"
import { Option, Schema } from "effect"

export interface Pasted extends Schema.Schema.Type<typeof Pasted> {}
export const Pasted = Schema.Struct({ id: Schema.String, text: Schema.String })

export interface Draft extends Schema.Schema.Type<typeof Draft> {}
export const Draft = Schema.Struct({
  text: Schema.String,
  pasted: Schema.Array(Pasted),
  retry: Schema.optionalKey(Schema.Struct({ id: SessionMessage.ID, text: Schema.String })),
  model: Schema.optionalKey(SessionModel.Ref),
})

export const empty: Draft = { text: "", pasted: [] }

const stored = Schema.fromJsonString(Draft)
const decodeStored = Schema.decodeUnknownOption(stored)
const encodeStored = Schema.encodeSync(stored)

export const message = (draft: Pick<Draft, "text" | "pasted">) =>
  [draft.text, ...draft.pasted.map((item) => item.text)].filter((item) => item.trim().length > 0).join("\n\n")

export const isBlank = (draft: Pick<Draft, "text" | "pasted">) => message(draft) === ""

export const decode = (raw: string | undefined): Draft => Option.getOrElse(decodeStored(raw), () => empty)

export const encode = (draft: Draft) => (isBlank(draft) && !draft.model ? undefined : encodeStored(draft))

export const retryID = (draft: Draft) =>
  draft.retry && draft.retry.text === message(draft) ? draft.retry.id : undefined

export const restore = (current: Draft, sent: Draft, id: SessionMessage.ID): Draft => {
  if (isBlank(current)) return { ...sent, retry: { id, text: message(sent) } }
  return {
    ...current,
    text: [sent.text, current.text].filter((item) => item.trim().length > 0).join("\n\n"),
    pasted: [...sent.pasted, ...current.pasted],
  }
}

export const append = (draft: Draft, text: string): Draft => {
  if (!text) return draft
  if (!draft.text.trim()) return { ...draft, text }
  return { ...draft, text: `${draft.text}\n\n${text}` }
}

export const delivery = (working: boolean, behavior: SessionInbox.Delivery): SessionInbox.Delivery =>
  working ? behavior : "steer"

export const alternate = (working: boolean, behavior: SessionInbox.Delivery): SessionInbox.Delivery | undefined => {
  if (!working) return undefined
  return behavior === "queue" ? "steer" : "queue"
}

export interface Clipboard {
  readonly types: ReadonlyArray<string>
  readonly kinds: ReadonlyArray<string>
  readonly text: string
}

const lineBreak = /\r\n|\r|\n/

export const paste = (clipboard: Clipboard, readClipboardImage: boolean): "attachment" | "block" | "text" => {
  if (clipboard.kinds.includes("file")) return "attachment"
  if (!clipboard.types.some((type) => type.startsWith("text/"))) return readClipboardImage ? "attachment" : "text"
  return clipboard.text.length >= 2000 || clipboard.text.split(lineBreak).length >= 20 ? "block" : "text"
}

export const normalize = (text: string) => text.replaceAll(/\r\n?/g, "\n")

export const insert = (input: string, text: string, cursor: number) => {
  const position = Math.max(0, Math.min(cursor, input.length))
  return { text: input.slice(0, position) + text + input.slice(position), cursor: position + text.length }
}

export interface Queued {
  readonly id: SessionMessage.ID
  readonly text: string
  readonly attachments: number
}

export const queued = (items: ReadonlyArray<SessionInbox.Info>): ReadonlyArray<Queued> =>
  items
    .filter((item): item is SessionInbox.User => item.type === "user" && item.delivery === "queue")
    .map((item) => ({ id: item.id, text: item.payload.text, attachments: item.payload.files?.length ?? 0 }))

const sameModel = (left: SessionModel.Ref, right: SessionModel.Ref | undefined) =>
  Boolean(right) && SessionModel.key(left) === SessionModel.key(right ?? left) && left.variant === right?.variant

export const model = (
  draft: Draft,
  current: SessionModel.Ref | undefined,
  models: ReadonlyArray<SessionModel.Info>,
): SessionModel.Ref | undefined => {
  const listed = (ref: SessionModel.Ref | undefined) =>
    ref && models.some((item) => SessionModel.key(item) === SessionModel.key(ref)) ? ref : undefined
  const first = models.at(0)
  return listed(draft.model) ?? listed(current) ?? (first && { id: first.id, providerID: first.providerID })
}

export const switching = (draft: Draft, current: SessionModel.Ref | undefined) =>
  draft.model && !sameModel(draft.model, current) ? draft.model : undefined

export const withText = (draft: Draft, text: string): Draft => ({ ...draft, text })

export const withModel = (draft: Draft, model: SessionModel.Ref): Draft => ({ ...draft, model })

export const addPasted = (draft: Draft, block: Pasted): Draft => ({
  ...draft,
  pasted: [...draft.pasted, { id: block.id, text: normalize(block.text) }],
})

export const removePasted = (draft: Draft, id: string): Draft => ({
  ...draft,
  pasted: draft.pasted.filter((item) => item.id !== id),
})

export const showPasted = (draft: Draft, id: string, cursor: number) => {
  const block = draft.pasted.find((item) => item.id === id)
  if (!block) return { draft, cursor }
  const inserted = insert(draft.text, block.text, cursor)
  return { draft: { ...removePasted(draft, id), text: inserted.text }, cursor: inserted.cursor }
}

export const fromHistory = (draft: Draft, entry: Pick<Draft, "text" | "pasted">): Draft => ({
  text: entry.text,
  pasted: entry.pasted,
  ...(draft.model && { model: draft.model }),
})

export interface Submission {
  readonly text: string
  readonly delivery: SessionInbox.Delivery
  readonly retry: SessionMessage.ID | undefined
  readonly model?: SessionModel.Ref
  readonly sent: Draft
  readonly next: Draft
}

export const submission = (
  draft: Draft,
  input: {
    readonly working: boolean
    readonly behavior: SessionInbox.Delivery
    readonly alternative: boolean
    readonly queue: boolean
    readonly current: SessionModel.Ref | undefined
  },
): Submission | undefined => {
  if (isBlank(draft)) return undefined
  const other = input.queue ? alternate(input.working, input.behavior) : undefined
  const chosen = input.alternative && other ? other : delivery(input.working, input.behavior)
  const sent = { text: draft.text, pasted: draft.pasted, ...(draft.model && { model: draft.model }) }
  const model = chosen === "steer" ? switching(draft, input.current) : undefined
  return {
    text: message(draft),
    delivery: chosen,
    retry: retryID(draft),
    ...(model && { model }),
    sent,
    next: chosen === "queue" && draft.model ? { ...empty, model: draft.model } : empty,
  }
}
