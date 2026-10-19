export * as TimelineOpen from "./timeline-open.js"

import type { SessionMessage } from "@ren/schema/session-message"
import { TimelineDetail } from "./timeline-detail.js"
import { ToolState } from "./tool-state.js"

export const defaultOpen = (content: SessionMessage.Content, detail: TimelineDetail.Detail | undefined) => {
  const category = TimelineDetail.category(content)
  if (detail && category) {
    if (detail[category].placement === "hidden" && content.type === "tool" && ToolState.failed(content)) return true
    if (category === "shell" || category === "edit" || category === "thinking")
      return detail[category].details === "expanded"
  }
  if (content.type === "reasoning") return false
  return ToolState.defaultOpen(content, false, false) ?? false
}
