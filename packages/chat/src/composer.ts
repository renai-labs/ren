export * as Composer from "./composer.js"

// oxlint-disable typescript/no-misused-spread -- drafts are plain readonly structs; Struct.assign would widen the optional keys these updates keep

import type { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionInbox } from "@ren/schema/session/inbox"
import { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { Option, Schema } from "effect"
import { ClientCommand } from "./client-command.js"

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

export const delivery = (
  behavior: SessionInbox.Delivery,
  session: { readonly working: boolean },
): SessionInbox.Delivery => (session.working ? behavior : "steer")

export const alternate = (
  behavior: SessionInbox.Delivery,
  session: { readonly working: boolean },
): SessionInbox.Delivery | undefined => {
  if (!session.working) return undefined
  return behavior === "queue" ? "steer" : "queue"
}

export interface Clipboard {
  readonly types: ReadonlyArray<string>
  readonly kinds: ReadonlyArray<string>
  readonly text: string
}

const lineBreak = /\r\n|\r|\n/

export const paste = (
  clipboard: Clipboard,
  options: { readonly readClipboardImage: boolean },
): "attachment" | "block" | "text" => {
  if (clipboard.kinds.includes("file")) return "attachment"
  if (!clipboard.types.some((type) => type.startsWith("text/")))
    return options.readClipboardImage ? "attachment" : "text"
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
  models: ReadonlyArray<SessionModel.Choice>,
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
  const other = input.queue ? alternate(input.behavior, input) : undefined
  const chosen = input.alternative && other ? other : delivery(input.behavior, input)
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

export const hidden: { readonly skills: ReadonlyArray<string>; readonly commands: ReadonlyArray<string> } = {
  skills: ["opencode", "report"],
  commands: ["init", "review"],
}

export const offeredSkills = (skills: ReadonlyArray<SessionCatalog.Skill>) =>
  skills.filter((skill) => !hidden.skills.includes(skill.id))

export const offeredCommands = (commands: ReadonlyArray<SessionCatalog.Command>) =>
  commands.filter((command) => !hidden.commands.includes(command.name))

export type Trigger =
  | { readonly kind: "mention"; readonly start: number; readonly query: string }
  | { readonly kind: "command"; readonly query: string }

const mentionTrigger = /(?:^|\s)@([^\s@]*)$/
const commandTrigger = /^\/(\S*)$/

export const trigger = (text: string, cursor: number): Trigger | undefined => {
  const mention = mentionTrigger.exec(text.slice(0, cursor))
  if (mention) {
    const query = mention.at(1) ?? ""
    return { kind: "mention", start: cursor - query.length - 1, query }
  }
  const command = commandTrigger.exec(text)
  return command ? { kind: "command", query: command.at(1) ?? "" } : undefined
}

export const slash = (text: string, commands: ReadonlyArray<SessionCatalog.Command>) => {
  const parsed = ClientCommand.parseSlashCommand(text)
  if (!parsed || !commands.some((command) => command.name === parsed.name)) return
  return { name: parsed.name, text: parsed.input }
}

export interface SuggestionPress {
  readonly key: string
  readonly ctrlKey: boolean
  readonly isComposing: boolean
}

export type SuggestionKey =
  | { readonly type: "close" }
  | { readonly type: "select"; readonly id: string }
  | { readonly type: "move"; readonly active: string }

export const activeSuggestion = (ids: ReadonlyArray<string>, active: string | undefined) =>
  active && ids.includes(active) ? active : ids.at(0)

const suggestionActions: Readonly<Record<string, "close" | "select">> = {
  Escape: "close",
  "Ctrl+g": "close",
  Tab: "select",
  Enter: "select",
}

const suggestionMoves: Readonly<Record<string, 1 | -1>> = {
  ArrowDown: 1,
  ArrowUp: -1,
  "Ctrl+n": 1,
  "Ctrl+p": -1,
}

export const suggestionKey = (
  press: SuggestionPress,
  ids: ReadonlyArray<string>,
  active: string | undefined,
): SuggestionKey | undefined => {
  if (press.isComposing) return
  const chord = press.ctrlKey ? `Ctrl+${press.key.toLowerCase()}` : press.key
  const action = suggestionActions[chord] ?? suggestionActions[press.key]
  if (action === "close") return { type: "close" }
  if (action === "select") return active ? { type: "select", id: active } : undefined
  const direction = suggestionMoves[chord] ?? suggestionMoves[press.key]
  if (!direction) return
  const next = ids.at(moved(active ? ids.indexOf(active) : -1, direction, ids.length))
  return next ? { type: "move", active: next } : undefined
}

const moved = (current: number, direction: 1 | -1, length: number) => {
  if (current < 0) return direction === 1 ? 0 : length - 1
  return (current + direction + length) % length
}
