import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { MessageScrollerProvider } from "@ren/ui/message-scroller"
import { toast } from "@ren/ui/toast"
import { IconAlertCircle, IconInfoCircle } from "@tabler/icons-react"
import type { ReactNode } from "react"
import { Chat } from "../../lib/chat.js"
import { ChatView } from "./chat-view.js"
import { ChildHeader } from "./session-header.js"
import { SessionRequests } from "./session-requests.js"
import { Transcript } from "./transcript.js"

function ChildBody(props: { failed: boolean; empty: boolean; onRetry: () => void; transcript: ReactNode }) {
  if (props.failed)
    return (
      <Empty role="alert" className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertCircle className="text-destructive" />
          </EmptyMedia>
          <EmptyTitle>Could not load this subagent</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    )
  if (props.empty)
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>No messages yet</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  return props.transcript
}

export function SessionChild(props: {
  root: Session.ID
  sessionID: Session.ID
  rootTitle: string
  onOpen: (sessionID: Session.ID | undefined) => void
}) {
  const chat = ChatView.useChild(props.root, props.sessionID, props.rootTitle)
  const retry = Chat.useRetry(props.root)
  const loadMore = ChatReact.useAction(props.root, (opened) => opened.loadMore(props.sessionID))
  const back = () => props.onOpen(chat.parent === props.root ? undefined : Session.ID.make(chat.parent))
  const empty = chat.messages.length === 0 && !chat.more && !chat.loadingHistory
  return (
    <MessageScrollerProvider autoScroll>
      <section aria-label={`${chat.title} subagent`} className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 px-3 pt-2 pl-12 md:pl-3">
          <ChildHeader
            root={props.root}
            title={chat.title}
            ancestors={chat.ancestors}
            running={chat.running}
            onOpen={props.onOpen}
          />
        </header>
        <ChildBody
          failed={chat.failed}
          empty={empty}
          onRetry={retry}
          transcript={
            <Transcript
              label={`${chat.title} transcript`}
              view={{ root: props.root, sessionID: props.sessionID }}
              statuses={chat.statuses}
              messages={chat.messages}
              rows={chat.rows}
              activeMessageID={chat.activeMessageID}
              busy={chat.running}
              working={chat.working}
              history={{
                more: chat.more,
                loading: chat.loadingHistory,
                onLoadOlder: () =>
                  void loadMore().catch(() => toast.add({ type: "error", title: "Could not load earlier messages" })),
              }}
              onOpenChild={props.onOpen}
            />
          }
        />
        <div className="shrink-0 px-4 pb-4 md:px-6">
          <div className="mx-auto flex w-full max-w-192 flex-col gap-2">
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
            />
            {(chat.requests.permission ?? chat.requests.form) ? null : (
              <Alert>
                <IconInfoCircle />
                <AlertDescription>
                  Subagent sessions cannot be prompted.{" "}
                  <Button variant="link" className="h-auto p-0" onClick={back}>
                    Back to {chat.parentTitle}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </section>
    </MessageScrollerProvider>
  )
}
