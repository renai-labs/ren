import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Button } from "@ren/ui/button"
import { Notice } from "@ren/ui/notice"
import { TaskTurn } from "@ren/ui/task-turn"
import type { ReactNode } from "react"
import { useRouteContext } from "@tanstack/react-router"
import { Chat } from "../../lib/chat.js"
import { ChatView } from "./chat-view.js"

export function SessionAttention(props: { sessionId: string; onOpen: () => void; children: ReactNode }) {
  const context = useRouteContext({ from: "/_authed" })
  const chat = Chat.forUser(context.platform, context.me.user.id)
  return (
    <RegistryContext value={chat.registry}>
      <ChatReact.Provider atoms={chat.atoms}>
        <Attention sessionId={Session.ID.make(props.sessionId)} onOpen={props.onOpen}>
          {props.children}
        </Attention>
      </ChatReact.Provider>
    </RegistryContext>
  )
}

function Attention(props: { sessionId: Session.ID; onOpen: () => void; children: ReactNode }) {
  const view = ChatView.useRoot(props.sessionId, undefined)
  if (view.requests.form)
    return (
      <div className="flex flex-col gap-3">
        <TaskTurn state="needs_you" reason={view.requests.form.title} />
        <Notice tone="warning" title="Needs you" action={<Button onClick={props.onOpen}>Answer</Button>}>
          {view.requests.form.title}
        </Notice>
      </div>
    )
  if (view.requests.permission)
    return (
      <div className="flex flex-col gap-3">
        <TaskTurn state="needs_you" reason="Permission needed" />
        <Notice
          tone="warning"
          title="Permission needed"
          action={<Button onClick={props.onOpen}>Review permission</Button>}
        >
          {view.requests.permission.message ?? view.requests.permission.action}
        </Notice>
      </div>
    )
  return props.children
}
