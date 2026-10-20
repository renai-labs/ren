import { ChatSession, type Composer } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Toast } from "@ren/ui/toast"
import { useState } from "react"
import { Failure } from "./failure.js"

const refusals: Readonly<Record<ChatSession.QueueRefused["reason"], string>> = {
  reverted: "Restore the undone messages first. Moving a queued message would discard them.",
  control: "A queued compaction or command can’t move. Try again once it has run.",
  changed: "The queue changed while you moved the message. Try again.",
  member: "Another member queued a message after this point. Only they can move it.",
  files: "Messages with files can’t move yet.",
}

const reordered = (queued: ReadonlyArray<Composer.Queued>, from: number, to: number) => {
  const ids = queued.map((item) => item.id)
  const rest = ids.filter((_, index) => index !== from)
  return [...rest.slice(0, to), ...ids.slice(from, from + 1), ...rest.slice(to)]
}

export function ComposerQueue(props: {
  sessionID: Session.ID
  queued: ReadonlyArray<Composer.Queued>
  running: boolean
  moving: boolean
  onMove: (item: Composer.Queued) => void
}) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const [reordering, setReordering] = useState(false)
  const steerInput = ChatReact.useAction(props.sessionID, (opened, id: SessionMessage.ID) => opened.steerInput(id))
  const cancelInput = ChatReact.useAction(props.sessionID, (opened, id: SessionMessage.ID) => opened.cancelInput(id))
  const reorderInput = ChatReact.useAction(props.sessionID, (opened, ids: ReadonlyArray<SessionMessage.ID>) =>
    opened.reorderInput(ids),
  )
  const track = (id: string, work: () => Promise<unknown>) => {
    if (busy.has(id)) return
    setBusy((current) => new Set([...current, id]))
    void work().finally(() => setBusy((current) => new Set([...current].filter((item) => item !== id))))
  }
  const blocked = props.moving || reordering
  const reorder = (from: number, to: number) => {
    if (blocked || from === to) return
    setReordering(true)
    void reorderInput(reordered(props.queued, from, to))
      .catch((error: unknown) =>
        Toast.manager.add({
          type: "error",
          title: "Could not move the queued message",
          description: error instanceof ChatSession.QueueRefused ? refusals[error.reason] : Failure.describe(error),
        }),
      )
      .finally(() => setReordering(false))
  }
  if (props.queued.length === 0) return null
  const last = props.queued.length - 1
  return (
    <ConversationShell.Queue
      label={`${props.queued.length} queued`}
      count={props.queued.length}
      onReorder={blocked || props.queued.length < 2 ? undefined : reorder}
    >
      {props.queued.map((item, index) => (
        <ConversationShell.QueueItem
          key={item.id}
          text={item.text}
          {...(item.attachments > 0 && { detail: item.attachments === 1 ? "1 file" : `${item.attachments} files` })}
          actions={index === 0 && !props.running ? "visible" : "on-hover"}
          busy={blocked || busy.has(item.id)}
          sendLabel={props.running ? "Send now" : "Send"}
          onSend={() =>
            track(item.id, () => steerInput(item.id).catch(Failure.toast("Could not send the queued message")))
          }
          onMove={() => props.onMove(item)}
          onMoveUp={index > 0 ? () => reorder(index, index - 1) : undefined}
          onMoveDown={index < last ? () => reorder(index, index + 1) : undefined}
          onRemove={() =>
            track(item.id, () => cancelInput(item.id).catch(Failure.toast("Could not remove the queued message")))
          }
        />
      ))}
    </ConversationShell.Queue>
  )
}
