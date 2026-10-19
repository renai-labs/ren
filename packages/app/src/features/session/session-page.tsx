import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { useNavigate, useParams, useRouteContext, useSearch } from "@tanstack/react-router"
import { Chat } from "../../lib/chat.js"
import { SessionChat } from "./session-chat.js"

const from = "/_authed/_shell/sessions/$sessionId/"

export function SessionPage() {
  const context = useRouteContext({ from: "/_authed" })
  const params = useParams({ from })
  const search = useSearch({ from })
  const navigate = useNavigate({ from: "/sessions/$sessionId/" })
  const chat = Chat.forUser(context.platform, context.me.user.id)
  return (
    <RegistryContext value={chat.registry}>
      <ChatReact.Provider atoms={chat.atoms}>
        <SessionChat
          key={params.sessionId}
          sessionID={Session.ID.make(params.sessionId)}
          message={search.message}
          child={search.child}
          onFollow={() => {
            if (search.message)
              void navigate({ search: (previous) => (previous.child ? { child: previous.child } : {}), replace: true })
          }}
          onChild={(child) => void navigate({ search: child ? { child } : {} })}
          onArchived={() => void navigate({ to: "/" })}
        />
      </ChatReact.Provider>
    </RegistryContext>
  )
}
