export * as TranscriptBlocks from "./transcript-blocks.js"

import { Option } from "effect"
import { AppConnect, ChannelReply, Projection, ShownFile, TimelineRow, ToolDisplay } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"

export type Step =
  | {
      readonly kind: "reasoning"
      readonly key: string
      readonly content: SessionMessage.Reasoning
      readonly running: boolean
    }
  | { readonly kind: "tool"; readonly key: string; readonly tool: SessionMessage.Tool }
  | { readonly kind: "shell"; readonly key: string; readonly message: SessionMessage.Shell }
  | { readonly kind: "notice"; readonly key: string; readonly message: SessionMessage.Info }
  | { readonly kind: "text"; readonly key: string; readonly text: string; readonly streaming: boolean }
  | {
      readonly kind: "group"
      readonly key: string
      readonly type: "context" | "file" | "read"
      readonly steps: ReadonlyArray<Step>
    }

export type Block =
  | { readonly kind: "user"; readonly key: string; readonly message: SessionMessage.User }
  | { readonly kind: "steps"; readonly key: string; readonly turn: string; readonly steps: Step[] }
  | {
      readonly kind: "answer"
      readonly key: string
      readonly turn: string
      readonly text: string
      readonly streaming: boolean
    }
  | { readonly kind: "reply"; readonly key: string; readonly tool: SessionMessage.Tool }
  | { readonly kind: "file"; readonly key: string; readonly file: SessionMessage.DriveFile }
  | {
      readonly kind: "connect"
      readonly key: string
      readonly connects: ReadonlyArray<{ readonly appId: string; readonly spaceId: string }>
    }
  | { readonly kind: "row"; readonly key: string; readonly row: TimelineRow.Row }
  | { readonly kind: "empty"; readonly key: string; readonly turn: string }

const streaming = (message: SessionMessage.Info | undefined) => message?.type === "assistant" && !message.time.completed

function contentStep(content: SessionMessage.Content, message: SessionMessage.Info | undefined, key: string): Step[] {
  if (content.type === "reasoning")
    return [{ kind: "reasoning", key, content, running: streaming(message) && !content.time?.completed }]
  if (content.type === "tool") return ToolDisplay.hidden(content) ? [] : [{ kind: "tool", key, tool: content }]
  return [{ kind: "text", key, text: content.text, streaming: streaming(message) }]
}

function refSteps(reference: TimelineRow.PartRef, byId: ReadonlyMap<string, SessionMessage.Info>): Step[] {
  const message = byId.get(reference.messageID)
  const key = `${reference.messageID}:${reference.partID}`
  if (reference.partID === reference.messageID) {
    if (message?.type === "shell") return [{ kind: "shell", key, message }]
    return message ? [{ kind: "notice", key, message }] : []
  }
  const content = Projection.resolveContent(message, reference.partID)
  return content ? contentStep(content, message, key) : []
}

function stepsOf(row: TimelineRow.Row, byId: ReadonlyMap<string, SessionMessage.Info>): Step[] | undefined {
  if (row._tag === "Thinking") {
    const content = Projection.resolveContent(byId.get(row.ref.messageID), row.ref.partID)
    return content?.type === "reasoning"
      ? [{ kind: "reasoning", key: TimelineRow.key(row), content, running: true }]
      : []
  }
  if (row._tag === "Shell") {
    const message = byId.get(row.messageID)
    return message?.type === "shell" ? [{ kind: "shell", key: TimelineRow.key(row), message }] : []
  }
  if (row._tag !== "AssistantPart") return undefined
  const group = row.group
  const refs = group.type === "part" ? [group.ref] : group.refs
  const steps = refs.flatMap((reference) => refSteps(reference, byId))
  if (group.type === "part") return steps
  return steps.length > 0 ? [{ kind: "group", key: TimelineRow.key(row), type: group.type, steps }] : []
}

function partBlock(row: TimelineRow.Row, byId: ReadonlyMap<string, SessionMessage.Info>): Block | undefined {
  if (row._tag !== "AssistantPart" || row.group.type !== "part") return undefined
  const message = byId.get(row.group.ref.messageID)
  const content = Projection.resolveContent(message, row.group.ref.partID)
  if (content?.type === "text")
    return {
      kind: "answer",
      key: TimelineRow.key(row),
      turn: row.userMessageID,
      text: content.text,
      streaming: streaming(message),
    }
  return content?.type === "tool" ? toolBlock(content, TimelineRow.key(row)) : undefined
}

function toolBlock(content: SessionMessage.Tool, key: string): Block | undefined {
  if (ChannelReply.shown(content)) return { kind: "reply", key, tool: content }
  const connects = AppConnect.of(content)
  if (connects.length > 0) return { kind: "connect", key, connects }
  const shown = Option.getOrUndefined(ShownFile.of(content))
  return shown && { kind: "file", key, file: shown }
}

function pushSteps(blocks: Block[], key: string, turn: string, steps: Step[]) {
  const last = blocks.at(-1)
  if (last?.kind === "steps" && last.turn === turn) last.steps.push(...steps)
  else if (steps.length > 0) blocks.push({ kind: "steps", key, turn, steps })
}

export function blocksOf(rows: ReadonlyArray<TimelineRow.Row>, byId: ReadonlyMap<string, SessionMessage.Info>) {
  return rows.reduce<Block[]>((blocks, row) => {
    if (row._tag === "TurnGap") return blocks
    if (row._tag === "UserMessage") {
      const message = byId.get(row.userMessageID)
      if (message?.type === "user") blocks.push({ kind: "user", key: TimelineRow.key(row), message })
      return blocks
    }
    const part = partBlock(row, byId)
    const steps = part ? undefined : stepsOf(row, byId)
    if (part) blocks.push(part)
    else if (steps) pushSteps(blocks, TimelineRow.key(row), row.userMessageID, steps)
    else blocks.push({ kind: "row", key: TimelineRow.key(row), row })
    return blocks
  }, [])
}

export function groupTurns(blocks: ReadonlyArray<Block>, options: { live: (turn: string) => boolean; fold: boolean }) {
  if (!options.fold) return blocks
  const live = options.live
  const lastSteps = new Map(
    blocks.flatMap((block, index) => (block.kind === "steps" ? [[block.turn, index] as const] : [])),
  )
  return blocks.reduce<Block[]>((grouped, block, index) => {
    if (block.kind !== "steps" && block.kind !== "answer") {
      grouped.push(block)
      return grouped
    }
    if (block.kind === "answer" && (live(block.turn) || (lastSteps.get(block.turn) ?? -1) < index)) {
      grouped.push(block)
      return grouped
    }
    const items: Step[] =
      block.kind === "steps"
        ? block.steps
        : [{ kind: "text", key: block.key, text: block.text, streaming: block.streaming }]
    const group = live(block.turn)
      ? grouped.find((each) => each.kind === "steps" && each.turn === block.turn)
      : grouped.at(-1)
    if (group?.kind === "steps" && group.turn === block.turn) group.steps.push(...items)
    else grouped.push({ kind: "steps", key: block.key, turn: block.turn, steps: [...items] })
    return grouped
  }, [])
}

export function withEmptyReplies(
  blocks: ReadonlyArray<Block>,
  turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>,
  activeTurn: string | undefined,
) {
  const spans = blocks.reduce<Block[][]>((all, block) => {
    const last = all.at(-1)
    if (block.kind === "user" || !last) all.push([block])
    else last.push(block)
    return all
  }, [])
  return spans.flatMap((span) => {
    const user = span[0]
    if (user?.kind !== "user" || user.message.id === activeTurn) return span
    const assistants = turns.get(user.message.id) ?? []
    if (assistants.length === 0 || assistants.some((message) => !message.time.completed)) return span
    const silent = span.slice(1).every((block) => {
      if (block.kind === "steps") return block.steps.every((step) => step.kind === "notice")
      return block.kind === "row" && !["Error", "Retry", "TurnDivider"].includes(block.row._tag)
    })
    if (silent) span.push({ kind: "empty", key: `empty:${user.message.id}`, turn: user.message.id })
    return span
  })
}

export const leaves = (steps: ReadonlyArray<Step>): ReadonlyArray<Step> =>
  steps.flatMap((step) => (step.kind === "group" ? leaves(step.steps) : [step]))
