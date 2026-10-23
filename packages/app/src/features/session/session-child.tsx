import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Button } from "@ren/ui/button"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Notice } from "@ren/ui/notice"
import { StateMessage } from "@ren/ui/state-message"
import { Toast } from "@ren/ui/toast"
import { useRef } from "react"
import { Chat } from "../../lib/chat.js"
import { ChatView } from "./chat-view.js"
import { ChildHeader } from "./session-header.js"
import { SessionRequests } from "./session-requests.js"
import { useTranscriptRows } from "./transcript-rows.js"

export function SessionChild(props: {
  root: Session.ID
  sessionID: Session.ID
  rootTitle: string
  onOpen: (sessionID: Session.ID | undefined) => void
}) {
  const chat = ChatView.useChild(props.root, props.sessionID, props.rootTitle)
  const scroller = useRef<ConversationShell.TimelineHandle>(null)
  const retry = Chat.useRetry(props.root)
  const loadMore = ChatReact.useAction(props.root, (opened) => opened.loadMore(props.sessionID))
  const back = () => props.onOpen(chat.parent === props.root ? undefined : Session.ID.make(chat.parent))
  const transcript = useTranscriptRows({
    view: { root: props.root, sessionID: props.sessionID },
    statuses: chat.statuses,
    messages: chat.messages,
    rows: chat.rows,
    activeMessageID: chat.activeMessageID,
    busy: chat.running,
    working: chat.working,
    onOpenChild: props.onOpen,
  })

  return (
    <section aria-label={`${chat.title} subagent`} className="flex min-h-0 flex-1 flex-col">
      <ConversationShell.Root
        mode="read-only"
        populated={chat.messages.length > 0}
        placeholder={
          chat.failed ? (
            <StateMessage state="failed" title="Could not load this subagent" onRetry={retry} />
          ) : (
            <StateMessage state="empty" title="No messages yet" />
          )
        }
        header={
          <ChildHeader
            root={props.root}
            title={chat.title}
            ancestors={chat.ancestors}
            running={chat.running}
            onOpen={props.onOpen}
          />
        }
        timeline={
          <ConversationShell.Timeline
            ref={scroller}
            label={`${chat.title} transcript`}
            history={{
              more: chat.more,
              loading: chat.loadingHistory,
              onLoadOlder: () =>
                void loadMore().catch(() =>
                  Toast.manager.add({ type: "error", title: "Could not load earlier messages" }),
                ),
            }}
            {...transcript}
          />
        }
        interaction={
          <>
            <SessionRequests
              root={props.root}
              sessionID={props.sessionID}
              permission={chat.requests.permission}
              permissionTitle={chat.requests.permissionTitle}
              form={chat.requests.form}
              formTitle={chat.requests.formTitle}
              formExpired={chat.requests.formExpired}
              connection={chat.requests.connection}
              onOpen={props.onOpen}
              onAnswered={() => scroller.current?.resume()}
            />
            {(chat.requests.permission ?? chat.requests.form) ? null : (
              <Notice tone="neutral" placement="banner" layout="inline">
                Subagent sessions cannot be prompted.{" "}
                <Button appearance="link" onClick={back}>
                  Back to {chat.parentTitle}
                </Button>
              </Notice>
            )}
          </>
        }
      />
    </section>
  )
}
