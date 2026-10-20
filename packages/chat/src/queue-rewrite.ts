export * as QueueRewrite from "./queue-rewrite.js"

import type { SessionInbox } from "@ren/schema/session/inbox"
import type { SessionMessage } from "@ren/schema/session/message"

export type Refusal = "control" | "changed" | "member" | "files"

export type Plan =
  | { readonly _tag: "Unchanged" }
  | {
      readonly _tag: "Rewrite"
      readonly readmit: ReadonlyArray<SessionInbox.User>
      readonly cancel: ReadonlyArray<SessionMessage.ID>
    }
  | { readonly _tag: "Refused"; readonly reason: Refusal }

export const plan = (
  pending: ReadonlyArray<SessionInbox.Info>,
  inboxIDs: ReadonlyArray<SessionMessage.ID>,
  sender: SessionMessage.Sender | undefined,
): Plan => {
  if (pending.some((item) => item.delivery === "queue" && item.type !== "user"))
    return { _tag: "Refused", reason: "control" }
  const current = pending.filter((item): item is SessionInbox.User => item.type === "user" && item.delivery === "queue")
  const ordered = inboxIDs.flatMap((id) => current.filter((item) => item.id === id))
  if (ordered.length !== current.length) return { _tag: "Refused", reason: "changed" }
  const changed = ordered.findIndex((item, index) => item.id !== current[index]?.id)
  if (changed < 0) return { _tag: "Unchanged" }
  const readmit = ordered.slice(changed)
  if (readmit.some((item) => item.payload.sender && item.payload.sender.userId !== sender?.userId))
    return { _tag: "Refused", reason: "member" }
  if (readmit.some((item) => item.payload.files?.length)) return { _tag: "Refused", reason: "files" }
  return { _tag: "Rewrite", readmit, cancel: current.slice(changed).map((item) => item.id) }
}
