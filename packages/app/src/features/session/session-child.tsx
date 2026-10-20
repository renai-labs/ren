import { ChatState, Family, Working } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Button } from "@ren/ui/button"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Notice } from "@ren/ui/notice"
import { StateMessage } from "@ren/ui/state-message"
import { Toast } from "@ren/ui/toast"
import { AsyncResult } from "effect/reactivity"
import { useRef } from "react"
import { Chat } from "../../lib/chat.js"
import { ChildHeader } from "./session-header.js"
import { SessionRequests } from "./session-requests.js"
import { SessionTitle } from "./session-title.js"
import { transcriptRows } from "./transcript-rows.js"

const childName = (state: ChatState.State, sessionID: string) =>
  SessionTitle.display(Family.childTitle(state, sessionID, ""), "Subagent")

export function SessionChild(props: {
  root: Session.ID
  sessionID: Session.ID
  state: ChatState.State
  rootTitle: string
  onOpen: (sessionID: Session.ID | undefined) => void
}) {
  const result = ChatReact.useChild(props.root, props.sessionID)
  const timeline = AsyncResult.isSuccess(result) ? result.value : undefined
  const scroller = useRef<ConversationShell.TimelineHandle>(null)
  const retry = Chat.useRetry(props.root)
  const loadMore = ChatReact.useAction(props.root, (opened) => opened.loadMore(props.sessionID))
  const messages = ChatState.messages(props.state, props.sessionID)
  const title = childName(props.state, props.sessionID)
  const parent = props.state.info[props.sessionID]?.parentID ?? props.root
  const parentTitle =
    parent === props.root
      ? props.rootTitle
      : SessionTitle.display(Family.childTitle(props.state, parent, ""), "Subagent")
  const asking = Family.permission(props.state, props.sessionID) ?? Family.form(props.state, props.sessionID)
  const back = () => props.onOpen(parent === props.root ? undefined : Session.ID.make(parent))
  return (
    <section aria-label={`${title} subagent`} className="flex min-h-0 flex-1 flex-col">
      <ConversationShell.Root
        mode="read-only"
        populated={messages.length > 0}
        placeholder={
          AsyncResult.isFailure(result) ? (
            <StateMessage state="failed" title="Could not load this subagent" onRetry={retry} />
          ) : (
            <StateMessage state="empty" title="No messages yet" />
          )
        }
        header={
          <ChildHeader
            state={props.state}
            root={props.root}
            sessionID={props.sessionID}
            rootTitle={props.rootTitle}
            onOpen={props.onOpen}
          />
        }
        timeline={
          <ConversationShell.Timeline
            ref={scroller}
            label={`${title} transcript`}
            history={{
              more: ChatState.more(props.state, props.sessionID),
              loading: ChatState.loadingHistory(props.state, props.sessionID),
              onLoadOlder: () =>
                void loadMore().catch(() =>
                  Toast.manager.add({ type: "error", title: "Could not load earlier messages" }),
                ),
            }}
            {...transcriptRows({
              view: { root: props.root, sessionID: props.sessionID },
              state: props.state,
              messages,
              rows: timeline?.rows ?? [],
              activeMessageID: timeline?.activeMessageID,
              busy: ChatState.activity(props.state, props.sessionID) === "running",
              working: timeline ? Working.show(props.state, props.sessionID, timeline, parent) : false,
              onOpenChild: props.onOpen,
            })}
          />
        }
        interaction={
          <>
            <SessionRequests
              root={props.root}
              sessionID={props.sessionID}
              state={props.state}
              onOpen={props.onOpen}
              onAnswered={() => scroller.current?.resume()}
            />
            {asking ? null : (
              <Notice tone="neutral" placement="banner" layout="inline">
                Subagent sessions cannot be prompted.{" "}
                <Button appearance="link" onClick={back}>
                  Back to {parentTitle}
                </Button>
              </Notice>
            )}
          </>
        }
      />
    </section>
  )
}
