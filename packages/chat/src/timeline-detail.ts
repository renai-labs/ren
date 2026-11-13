export * as TimelineDetail from "./timeline-detail.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Schema } from "effect"
import { ToolState } from "./tool-state.js"

export const categories = ["shell", "edit", "thinking", "subagents", "notices", "tools", "commentary"] as const

export type Category = (typeof categories)[number]

export const Placement = Schema.Literals(["separate", "grouped", "hidden"])

export type Placement = typeof Placement.Type

export const Expansion = Schema.Literals(["collapsed", "expanded"])

export type Expansion = typeof Expansion.Type

const Expandable = Schema.Struct({ placement: Placement, details: Expansion })

const Placed = Schema.Struct({ placement: Placement })

export const Detail = Schema.Struct({
  shell: Expandable,
  edit: Expandable,
  thinking: Expandable,
  subagents: Placed,
  notices: Placed,
  tools: Placed,
  commentary: Placed,
})

export type Detail = typeof Detail.Type

export const presets = [
  {
    id: "everything",
    value: {
      shell: { placement: "separate", details: "expanded" },
      edit: { placement: "separate", details: "expanded" },
      thinking: { placement: "separate", details: "expanded" },
      subagents: { placement: "separate" },
      notices: { placement: "separate" },
      tools: { placement: "separate" },
      commentary: { placement: "separate" },
    },
  },
  {
    id: "detailed",
    value: {
      shell: { placement: "separate", details: "expanded" },
      edit: { placement: "separate", details: "expanded" },
      thinking: { placement: "grouped", details: "collapsed" },
      subagents: { placement: "separate" },
      notices: { placement: "grouped" },
      tools: { placement: "grouped" },
      commentary: { placement: "separate" },
    },
  },
  {
    id: "compact",
    value: {
      shell: { placement: "grouped", details: "collapsed" },
      edit: { placement: "grouped", details: "collapsed" },
      thinking: { placement: "grouped", details: "collapsed" },
      subagents: { placement: "separate" },
      notices: { placement: "grouped" },
      tools: { placement: "grouped" },
      commentary: { placement: "separate" },
    },
  },
  {
    id: "quiet",
    value: {
      shell: { placement: "hidden", details: "collapsed" },
      edit: { placement: "grouped", details: "collapsed" },
      thinking: { placement: "hidden", details: "collapsed" },
      subagents: { placement: "separate" },
      notices: { placement: "hidden" },
      tools: { placement: "hidden" },
      commentary: { placement: "separate" },
    },
  },
  {
    id: "text-only",
    value: {
      shell: { placement: "hidden", details: "collapsed" },
      edit: { placement: "hidden", details: "collapsed" },
      thinking: { placement: "hidden", details: "collapsed" },
      subagents: { placement: "hidden" },
      notices: { placement: "hidden" },
      tools: { placement: "hidden" },
      commentary: { placement: "separate" },
    },
  },
] as const satisfies ReadonlyArray<{ readonly id: string; readonly value: Detail }>

export const preset = (value: Detail) =>
  presets.find((candidate) =>
    categories.every((category) => {
      const current = value[category]
      const expected = candidate.value[category]
      return (
        current.placement === expected.placement &&
        (current.placement === "hidden" ||
          !("details" in current) ||
          ("details" in expected && current.details === expected.details))
      )
    }),
  )

export const category = (content: SessionMessage.Content): Category | undefined => {
  if (content.type === "text") return undefined
  if (content.type === "reasoning") return "thinking"
  if (["shell", "execute", "bash"].includes(content.name)) return "shell"
  if (["edit", "write", "patch", "apply_patch"].includes(content.name)) return "edit"
  if (["subagent", "task"].includes(content.name)) return "subagents"
  return "tools"
}

export const noticePlacement = (message: SessionMessage.Info, detail: Detail): Placement => {
  const source = message.type === "synthetic" ? message.metadata?.source : undefined
  const placement = source === "subagent" ? detail.subagents.placement : detail.notices.placement
  if (placement === "hidden") return noticeRequired(message) ? "separate" : "hidden"
  return source === "subagent" || source === "shell" ? "separate" : placement
}

export const noticeRequired = (message: SessionMessage.Info) => {
  if (message.type === "compaction") return message.status !== "completed"
  if (message.type !== "synthetic") return false
  const metadata = message.metadata
  return (
    metadata?.state === "error" ||
    (metadata?.source === "shell" && metadata.state === "completed" && ToolState.shellFailed(metadata))
  )
}
