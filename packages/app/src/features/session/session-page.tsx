import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { useParams, useRouteContext } from "@tanstack/react-router"
import { Chat } from "../../lib/chat.js"
import { SessionChat } from "./session-chat.js"

export function SessionPage() {
  const context = useRouteContext({ from: "/_authed" })
  const params = useParams({ from: "/_authed/_shell/sessions/$sessionId/" })
  const chat = Chat.forUser(context.platform, context.me.user.id)
  return (
    <RegistryContext value={chat.registry}>
      <ChatReact.Provider atoms={chat.atoms}>
        <SessionChat key={params.sessionId} sessionID={Session.ID.make(params.sessionId)} />
      </ChatReact.Provider>
    </RegistryContext>
  )
}
