import type { ChatState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Button } from "@ren/ui/button"
import { Questionnaire } from "@ren/ui/questionnaire"
import { Toast } from "@ren/ui/toast"
import { useState } from "react"
import { Requests } from "./requests.js"

const failed = (title: string) => (error: unknown) =>
  Toast.manager.add({ type: "error", title, description: error instanceof Error ? error.message : String(error) })

export function SessionRequests(props: { sessionID: Session.ID; state: ChatState.State }) {
  const [sending, setSending] = useState(false)
  const permission = Object.values(props.state.permissions).flat().at(0)
  const form = Object.values(props.state.forms).flat().at(0)
  const replyPermission = ChatReact.useAction(
    props.sessionID,
    (opened, reply: Parameters<typeof opened.replyPermission>) => opened.replyPermission(...reply),
  )
  const replyForm = ChatReact.useAction(props.sessionID, (opened, reply: Parameters<typeof opened.replyForm>) =>
    opened.replyForm(...reply),
  )
  const cancelForm = ChatReact.useAction(props.sessionID, (opened, cancel: Parameters<typeof opened.cancelForm>) =>
    opened.cancelForm(...cancel),
  )
  const settle = (request: Promise<unknown>, title: string) => {
    setSending(true)
    void request.catch(failed(title)).finally(() => setSending(false))
  }
  if (permission)
    return (
      <Questionnaire
        resetKey={permission.id}
        questions={[Requests.permissionQuestion(permission)]}
        pending={sending}
        submitLabel="Continue"
        onSubmit={(data) => {
          const reply = Requests.readPermissionReply(data)
          if (!reply) return
          settle(
            replyPermission([permission.sessionID, permission.id, reply]),
            "Could not answer the permission request",
          )
        }}
      />
    )
  if (form)
    return (
      <Questionnaire
        resetKey={form.id}
        questions={Requests.formQuestions(form)}
        pending={sending}
        leadingAction={
          <Button
            appearance="plain"
            size="small"
            disabled={sending}
            onClick={() =>
              settle(cancelForm([Session.ID.make(form.sessionID), form.id]), "Could not dismiss the question")
            }
          >
            Dismiss
          </Button>
        }
        onSubmit={(data) =>
          settle(
            replyForm([Session.ID.make(form.sessionID), form.id, Requests.readFormAnswer(form, data)]),
            "Could not send your answer",
          )
        }
      />
    )
  return null
}
