export * as WorkspacePage from "./workspace-page.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Option } from "effect"
import { ToolState } from "./tool-state.js"

const pagePath = /^(?:.*\/)?(\.ren\/pages\/[^/]+\.html)$/iu

export const of = (content: SessionMessage.Tool): Option.Option<string> => {
  if ((content.name !== "write" && content.name !== "edit") || content.state.status !== "completed")
    return Option.none()
  const input = ToolState.input(content)
  const file = input.filePath ?? input.path
  const match = typeof file === "string" ? pagePath.exec(file.replace(/^\.\//u, "")) : null
  return Option.fromNullishOr(match?.at(1))
}
