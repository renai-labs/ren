import { ChatState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { StateMessage } from "@ren/ui/state-message"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { SessionRequests } from "./session-requests.js"
import { SessionTranscript } from "./session-transcript.js"

const failed = (title: string) => (error: unknown) =>
  Toast.manager.add({ type: "error", title, description: error instanceof Error ? error.message : String(error) })

function SessionComposer(props: { sessionID: Session.ID; running: boolean }) {
  const [draft, setDraft] = useState("")
  const prompt = ChatReact.useAction(props.sessionID, (opened, text: string) => opened.prompt({ text }))
  const interrupt = ChatReact.useAction(props.sessionID, (opened) => opened.interrupt)
  const text = draft.trim()
  return (
    <ConversationShell.Composer
      label="Message Ren"
      onSubmit={() => {
        if (!text) return
        setDraft("")
        void prompt(text).catch((error: unknown) => {
          setDraft((current) => current || text)
          failed("Could not send your message")(error)
        })
      }}
      footerTrailing={
        props.running && !text ? (
          <IconButton
            appearance="primary"
            shape="circle"
            size="medium"
            label="Stop"
            onClick={() => void interrupt().catch(failed("Could not stop Ren"))}
          >
            <Icon glyph="Stop" />
          </IconButton>
        ) : (
          <IconButton
            type="submit"
            appearance={text ? "primary" : "secondary"}
            shape="circle"
            size="medium"
            label="Send"
            disabled={!text}
          >
            <Icon glyph="ArrowUp" />
          </IconButton>
        )
      }
    >
      <ConversationShell.ComposerInput
        aria-label="Message"
        placeholder="Summarise the open pull requests"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
    </ConversationShell.Composer>
  )
}

export function SessionChat(props: { sessionID: Session.ID }) {
  const session = ChatReact.useSession(props.sessionID)
  const state = AsyncResult.getOrElse(session.state, () => ChatState.empty)
  const rows = AsyncResult.isSuccess(session.timeline) ? session.timeline.value.rows : []
  const messages = ChatState.messages(state, props.sessionID)
  const reconnecting = AsyncResult.isSuccess(session.status) && session.status.value === "reconnecting"
  return (
    <ConversationShell.Root
      populated={messages.length > 0}
      placeholder={
        AsyncResult.isFailure(session.state) ? (
          <StateMessage state="failed" title="Could not open this chat" />
        ) : undefined
      }
      transcript={<SessionTranscript messages={messages} rows={rows} />}
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
          sessionID={props.sessionID}
          running={ChatState.activity(state, props.sessionID) === "running"}
        />
      }
    />
  )
}
