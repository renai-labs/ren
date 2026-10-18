export * as TimelineDetail from "./timeline-detail.js"

import type { SessionMessage } from "@ren/schema/session-message"

export const categories = ["shell", "edit", "thinking", "subagents", "notices", "tools"] as const

export type Category = (typeof categories)[number]

export type Placement = "separate" | "grouped" | "hidden"

export type Expansion = "collapsed" | "expanded"

export interface Detail {
  readonly shell: { readonly placement: Placement; readonly details: Expansion }
  readonly edit: { readonly placement: Placement; readonly details: Expansion }
  readonly thinking: { readonly placement: Placement; readonly details: Expansion }
  readonly subagents: { readonly placement: Placement }
  readonly notices: { readonly placement: Placement }
  readonly tools: { readonly placement: Placement }
}

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
    },
  },
  {
    id: "compact",
    value: {
      shell: { placement: "grouped", details: "collapsed" },
      edit: { placement: "grouped", details: "collapsed" },
      thinking: { placement: "grouped", details: "collapsed" },
      subagents: { placement: "grouped" },
      notices: { placement: "grouped" },
      tools: { placement: "grouped" },
    },
  },
  {
    id: "quiet",
    value: {
      shell: { placement: "hidden", details: "collapsed" },
      edit: { placement: "grouped", details: "collapsed" },
      thinking: { placement: "hidden", details: "collapsed" },
      subagents: { placement: "grouped" },
      notices: { placement: "hidden" },
      tools: { placement: "hidden" },
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

export const noticeRequired = (message: SessionMessage.Info) =>
  message.type === "compaction" && message.status !== "completed"
