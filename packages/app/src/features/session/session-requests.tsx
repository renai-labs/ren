import { type ChatState, Family } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Questionnaire } from "@ren/ui/questionnaire"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { useState } from "react"
import type { ReactNode } from "react"
import { FormProgress } from "./form-progress.js"
import { Requests } from "./requests.js"
import { SessionTitle } from "./session-title.js"

const failed = (title: string) => (error: unknown) =>
  Toast.manager.add({ type: "error", title, description: error instanceof Error ? error.message : String(error) })

function Source(props: {
  state: ChatState.State
  sessionID: Session.ID
  viewed: Session.ID
  onOpen: (sessionID: Session.ID) => void
  children: ReactNode
}) {
  if (props.sessionID === props.viewed) return props.children
  const title = SessionTitle.display(Family.childTitle(props.state, props.sessionID, ""), "Subagent")
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 px-1">
        <Icon glyph="Ghost" tone="secondary" />
        <Text purpose="caption" element="span" truncation="single-line">
          {title} needs your input
        </Text>
        <div className="ml-auto">
          <Button appearance="plain" size="small" onClick={() => props.onOpen(props.sessionID)}>
            Open subagent
          </Button>
        </div>
      </div>
      {props.children}
    </div>
  )
}

export function SessionRequests(props: {
  root: Session.ID
  sessionID: Session.ID
  state: ChatState.State
  onOpen: (sessionID: Session.ID) => void
  onAnswered: () => void
}) {
  const [sending, setSending] = useState<string>()
  const permission = Family.permission(props.state, props.sessionID)
  const form = Family.form(props.state, props.sessionID)
  const replyPermission = ChatReact.useAction(props.root, (opened, reply: Parameters<typeof opened.replyPermission>) =>
    opened.replyPermission(...reply),
  )
  const replyForm = ChatReact.useAction(props.root, (opened, reply: Parameters<typeof opened.replyForm>) =>
    opened.replyForm(...reply),
  )
  const cancelForm = ChatReact.useAction(props.root, (opened, cancel: Parameters<typeof opened.cancelForm>) =>
    opened.cancelForm(...cancel),
  )
  const settle = (id: string, request: () => Promise<unknown>, title: string) => {
    if (sending === id) return
    setSending(id)
    void request()
      .then(props.onAnswered, failed(title))
      .finally(() => setSending((current) => (current === id ? undefined : current)))
  }
  if (permission)
    return (
      <Source
        state={props.state}
        sessionID={Session.ID.make(permission.sessionID)}
        viewed={props.sessionID}
        onOpen={props.onOpen}
      >
        <Questionnaire
          resetKey={permission.id}
          questions={[Requests.permissionQuestion(permission)]}
          pending={sending === permission.id}
          submitLabel="Continue"
          onSubmit={(data) => {
            const reply = Requests.readPermissionReply(data)
            if (!reply) return
            settle(
              permission.id,
              () => replyPermission([permission.sessionID, permission.id, reply]),
              "Could not answer the permission request",
            )
          }}
        />
      </Source>
    )
  if (form)
    return (
      <Source
        state={props.state}
        sessionID={Session.ID.make(form.sessionID)}
        viewed={props.sessionID}
        onOpen={props.onOpen}
      >
        <Questionnaire
          resetKey={form.id}
          questions={Requests.formQuestions(form)}
          pending={sending === form.id}
          collapsible
          progress={FormProgress.read(form.id)}
          onProgressChange={(progress) => FormProgress.write(form.id, progress)}
          onDismiss={() =>
            settle(
              form.id,
              () => cancelForm([Session.ID.make(form.sessionID), form.id]),
              "Could not dismiss the question",
            )
          }
          leadingAction={
            <Button
              appearance="plain"
              size="small"
              disabled={sending === form.id}
              onClick={() =>
                settle(
                  form.id,
                  () => cancelForm([Session.ID.make(form.sessionID), form.id]),
                  "Could not dismiss the question",
                )
              }
            >
              Dismiss
            </Button>
          }
          onSubmit={(data) =>
            settle(
              form.id,
              () =>
                replyForm([Session.ID.make(form.sessionID), form.id, Requests.readFormAnswer(form, data)]).then(() =>
                  FormProgress.clear(form.id),
                ),
              "Could not send your answer",
            )
          }
        />
      </Source>
    )
  return null
}
