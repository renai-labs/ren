export * as Composer from "./composer.js"

// oxlint-disable typescript/no-misused-spread -- drafts are plain readonly structs; Struct.assign would widen the optional keys these updates keep

import { Session } from "@ren/schema/session"
import type { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionInbox } from "@ren/schema/session/inbox"
import { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { Option, Schema, Struct } from "effect"
import { ClientCommand } from "./client-command.js"

export interface Pasted extends Schema.Schema.Type<typeof Pasted> {}
export const Pasted = Schema.Struct({ id: Schema.String, text: Schema.String })

export interface MentionedApp extends Schema.Schema.Type<typeof MentionedApp> {}
export const MentionedApp = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  icon: Schema.NullOr(Schema.String),
  brandColor: Schema.NullOr(Schema.String),
})

export interface Quote extends Schema.Schema.Type<typeof Quote> {}
export const Quote = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  comment: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String),
})

export const quoteLimit = 20_000

export interface Draft extends Schema.Schema.Type<typeof Draft> {}
export const Draft = Schema.Struct({
  text: Schema.String,
  pasted: Schema.Array(Pasted),
  retry: Schema.optionalKey(Schema.Struct({ id: SessionMessage.ID, text: Schema.String })),
  model: Schema.optionalKey(SessionModel.Ref),
  messageId: Schema.optionalKey(SessionMessage.ID),
  files: Schema.optionalKey(Schema.Array(SessionMessage.DriveFile)),
  chat: Schema.optionalKey(Schema.Struct({ sessionId: Session.ID, spaceId: Schema.String })),
  mentions: Schema.optionalKey(Schema.Array(MentionedApp)),
  mode: Schema.optionalKey(Schema.Literals(["prompt", "shell"])),
  quotes: Schema.optionalKey(Schema.Array(Quote)),
})

export const empty: Draft = { text: "", pasted: [] }

export const emptyShell: Draft = { ...empty, mode: "shell" }

const stored = Schema.fromJsonString(Draft)
const decodeStored = Schema.decodeUnknownOption(stored)
const encodeStored = Schema.encodeSync(stored)

export const message = (draft: Pick<Draft, "text" | "pasted">) =>
  [draft.text, ...draft.pasted.map((item) => item.text)].filter((item) => item.trim().length > 0).join("\n\n")

export const quotes = (draft: Pick<Draft, "quotes">) => draft.quotes ?? []

export const isBlank = (draft: Pick<Draft, "text" | "pasted" | "quotes">) =>
  message(draft) === "" && quotes(draft).length === 0

export const formatQuoteComment = (quote: SessionMessage.Quote) => {
  const quoted = `The user quoted the following from ${quote.source ?? "earlier in the conversation"}:\n${quote.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`
  return quote.comment
    ? `${quoted}\n\nThe user made the following comment regarding this quote: ${quote.comment}`
    : quoted
}

export const quoteComment = (item: Quote): SessionMessage.Quote => {
  const comment = item.comment?.trim()
  return {
    type: "quote",
    text: item.text,
    ...(comment && { comment }),
    ...(item.source && { source: item.source }),
  }
}

export const commentContextItem = (comment: SessionMessage.Quote, id: string): Quote => ({
  id,
  text: comment.text,
  ...(comment.comment && { comment: comment.comment }),
  ...(comment.source && { source: comment.source }),
})

export const request = (draft: Pick<Draft, "text" | "pasted" | "quotes">) => {
  const words = message(draft)
  const comments = quotes(draft).map(quoteComment)
  return {
    text: [...(words ? [words] : []), ...comments.map(formatQuoteComment)].join("\n"),
    ...(comments.length > 0 && { presentation: { displayText: words, comments } }),
  }
}

export const copyText = (message: { readonly text: string; readonly presentation?: SessionMessage.Presentation }) => {
  if (!message.presentation) return message.text
  return [
    ...(message.presentation.displayText ? [message.presentation.displayText] : []),
    ...message.presentation.comments.map((quote) =>
      [
        quote.text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
        quote.comment,
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
  ].join("\n\n")
}

export const fromMessage = (message: {
  readonly text: string
  readonly presentation?: SessionMessage.Presentation
}): Pick<Draft, "text" | "pasted" | "quotes"> => ({
  text: message.presentation?.displayText ?? message.text,
  pasted: [],
  ...(message.presentation && {
    quotes: message.presentation.comments.map((comment) => commentContextItem(comment, crypto.randomUUID())),
  }),
})

export const withQuote = (draft: Draft, quote: Quote): Draft => ({ ...draft, quotes: [...quotes(draft), quote] })

export const withoutQuote = (draft: Draft, id: string): Draft => {
  const kept = quotes(draft).filter((item) => item.id !== id)
  return kept.length > 0 ? { ...draft, quotes: kept } : Struct.omit(draft, ["quotes"])
}

export const files = (draft: Draft) => draft.files ?? []

export const mentions = (draft: Draft) => draft.mentions ?? []

export const withMention = (draft: Draft, app: MentionedApp): Draft => ({
  ...draft,
  mentions: [...mentions(draft).filter((item) => item.id !== app.id), app],
})

export const decode = (raw: string | undefined): Draft => Option.getOrElse(decodeStored(raw), () => empty)

export const isShell = (draft: Draft) => draft.mode === "shell"

export const withMode = (draft: Draft, mode: "prompt" | "shell"): Draft =>
  mode === "shell" ? { ...draft, mode } : Struct.omit(draft, ["mode"])

export const encode = (draft: Draft) =>
  isBlank(draft) && !draft.model && !isShell(draft) && files(draft).length === 0 ? undefined : encodeStored(draft)

export const retryID = (draft: Draft) =>
  draft.retry && draft.retry.text === request(draft).text ? draft.retry.id : undefined

export const messageID = (draft: Draft) => (draft.retry ? retryID(draft) : draft.messageId)

export const restore = (current: Draft, sent: Draft, id: SessionMessage.ID): Draft => {
  if (isBlank(current) && files(current).length === 0) return { ...sent, retry: { id, text: request(sent).text } }
  const merged = [...files(sent), ...files(current)]
  const apps = [...mentions(sent), ...mentions(current)]
  const quoted = [...quotes(sent), ...quotes(current)]
  const messageId = current.messageId ?? sent.messageId
  const chat = current.chat ?? sent.chat
  return {
    ...current,
    text: [sent.text, current.text].filter((item) => item.trim().length > 0).join("\n\n"),
    pasted: [...sent.pasted, ...current.pasted],
    ...(merged.length > 0 && { files: merged }),
    ...(apps.length > 0 && { mentions: apps }),
    ...(quoted.length > 0 && { quotes: quoted }),
    ...(messageId && { messageId }),
    ...(chat && { chat }),
  }
}

export const withFile = (draft: Draft, file: SessionMessage.DriveFile): Draft => ({
  ...draft,
  files: [...files(draft).filter((item) => item.path !== file.path), file],
})

export const withMessageID = (draft: Draft, messageId: SessionMessage.ID): Draft =>
  draft.messageId ? draft : { ...draft, messageId }

export const withChat = (draft: Draft, chat: NonNullable<Draft["chat"]>): Draft => ({ ...draft, chat })

export const withoutFile = (draft: Draft, path: string): Draft => {
  const kept = files(draft).filter((item) => item.path !== path)
  return kept.length > 0 ? { ...draft, files: kept } : Struct.omit(draft, ["files", "chat"])
}

export const append = (draft: Draft, text: string): Draft => {
  if (!text) return draft
  if (!draft.text.trim()) return { ...draft, text }
  return { ...draft, text: `${draft.text}\n\n${text}` }
}

export const recall = (
  draft: Draft,
  entry: {
    readonly text: string
    readonly presentation?: SessionMessage.Presentation
    readonly files?: ReadonlyArray<SessionMessage.DriveFile> | undefined
  },
): Draft => {
  const restored = fromMessage(entry)
  return (entry.files ?? []).reduce(withFile, quotes(restored).reduce(withQuote, append(draft, restored.text)))
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
    .map((item) => ({
      id: item.id,
      text: copyText(item.payload),
      attachments: (item.payload.files?.length ?? 0) + (item.payload.uploads?.length ?? 0),
    }))

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

export const fromHistory = (draft: Draft, entry: Pick<Draft, "text" | "pasted" | "quotes">): Draft => ({
  text: entry.text,
  pasted: entry.pasted,
  ...(entry.quotes && { quotes: entry.quotes }),
  ...(draft.model && { model: draft.model }),
  ...(draft.mode && { mode: draft.mode }),
})

export interface Submission {
  readonly text: string
  readonly presentation?: SessionMessage.Presentation
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
  const sent = {
    text: draft.text,
    pasted: draft.pasted,
    ...(draft.quotes && { quotes: draft.quotes }),
    ...(draft.model && { model: draft.model }),
  }
  const model = chosen === "steer" ? switching(draft, input.current) : undefined
  return {
    ...request(draft),
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
