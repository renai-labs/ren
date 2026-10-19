import { ChatState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { StateMessage } from "@ren/ui/state-message"
import { Text } from "@ren/ui/text"
import { AsyncResult } from "effect/reactivity"
import { SessionComposer } from "./session-composer.js"
import { SessionRequests } from "./session-requests.js"
import { SessionTranscript } from "./session-transcript.js"

export function SessionChat(props: { sessionID: Session.ID }) {
  const session = ChatReact.useSession(props.sessionID)
  const state = AsyncResult.getOrElse(session.state, () => ChatState.empty)
  const timeline = AsyncResult.isSuccess(session.timeline) ? session.timeline.value : undefined
  const messages = ChatState.messages(state, props.sessionID)
  const running = ChatState.activity(state, props.sessionID) === "running"
  const reconnecting = AsyncResult.isSuccess(session.status) && session.status.value === "reconnecting"
  return (
    <ConversationShell.Root
      populated={messages.length > 0}
      placeholder={
        AsyncResult.isFailure(session.state) ? (
          <StateMessage state="failed" title="Could not open this chat" />
        ) : undefined
      }
      transcript={
        <SessionTranscript
          messages={messages}
          rows={timeline?.rows ?? []}
          activeMessageID={timeline?.activeMessageID}
          busy={running}
        />
      }
      interaction={
        <>
          {reconnecting ? (
            <output>
              <Text purpose="caption" tone="secondary">
                Reconnecting
              </Text>
            </output>
          ) : null}
          <SessionRequests sessionID={props.sessionID} state={state} />
        </>
      }
      composer={
        <SessionComposer
          key={props.sessionID}
          sessionID={props.sessionID}
          state={state}
          unavailable={AsyncResult.isFailure(session.state)}
        />
      }
    />
  )
}
