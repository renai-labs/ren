export * as TranscriptBlocks from "./transcript-blocks.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Option } from "effect"
import { ChannelReply } from "./channel-reply.js"
import { Projection } from "./projection.js"
import { ShownFile } from "./shown-file.js"
import { TimelineRow } from "./timeline-row.js"
import { ToolDisplay } from "./tool-display.js"

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
  | { readonly kind: "row"; readonly key: string; readonly row: TimelineRow.Row }

const streaming = (message: SessionMessage.Info | undefined) => message?.type === "assistant" && !message.time.completed

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
  return refs.flatMap((reference): Step[] => {
    const message = byId.get(reference.messageID)
    const key = `${reference.messageID}:${reference.partID}`
    if (reference.partID === reference.messageID) {
      if (message?.type === "shell") return [{ kind: "shell", key, message }]
      return message ? [{ kind: "notice", key, message }] : []
    }
    const content = Projection.resolveContent(message, reference.partID)
    if (content?.type === "reasoning")
      return [{ kind: "reasoning", key, content, running: streaming(message) && !content.time?.completed }]
    if (content?.type === "tool") return ToolDisplay.hidden(content) ? [] : [{ kind: "tool", key, tool: content }]
    return []
  })
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
  if (content?.type === "tool" && ChannelReply.shown(content))
    return { kind: "reply", key: TimelineRow.key(row), tool: content }
  const shown = content?.type === "tool" ? Option.getOrUndefined(ShownFile.of(content)) : undefined
  return shown && { kind: "file", key: TimelineRow.key(row), file: shown }
}

function pushSteps(blocks: Block[], key: string, turn: string, steps: Step[]) {
  const last = blocks.at(-1)
  if (last?.kind === "steps" && last.turn === turn) last.steps.push(...steps)
  else if (steps.length > 0) blocks.push({ kind: "steps", key, turn, steps })
}

function blocksOf(rows: ReadonlyArray<TimelineRow.Row>, byId: ReadonlyMap<string, SessionMessage.Info>) {
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

function groupTurns(blocks: ReadonlyArray<Block>) {
  const lastSteps = new Map(
    blocks.flatMap((block, index) => (block.kind === "steps" ? [[block.turn, index] as const] : [])),
  )
  return blocks.reduce<Block[]>((grouped, block, index) => {
    if (block.kind !== "steps" && block.kind !== "answer") {
      grouped.push(block)
      return grouped
    }
    if (block.kind === "answer" && (lastSteps.get(block.turn) ?? -1) < index) {
      grouped.push(block)
      return grouped
    }
    const items: Step[] =
      block.kind === "steps"
        ? block.steps
        : [{ kind: "text", key: block.key, text: block.text, streaming: block.streaming }]
    const last = grouped.at(-1)
    if (last?.kind === "steps" && last.turn === block.turn) last.steps.push(...items)
    else grouped.push({ kind: "steps", key: block.key, turn: block.turn, steps: [...items] })
    return grouped
  }, [])
}

export const of = (rows: ReadonlyArray<TimelineRow.Row>, byId: ReadonlyMap<string, SessionMessage.Info>) =>
  groupTurns(blocksOf(rows, byId))
