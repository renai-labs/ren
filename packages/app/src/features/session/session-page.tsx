import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { useNavigate, useParams, useRouteContext, useSearch } from "@tanstack/react-router"
import { Chat } from "../../lib/chat.js"
import { SessionChat } from "./session-chat.js"
import type { ComposerRepositories } from "./composer-repositories.js"

const from = "/_authed/_shell/sessions/$sessionId/"

export function SessionPage(props: { addRepositories?: ComposerRepositories.Dialog }) {
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
          viewer={context.me.user.id}
          organizationId={context.me.organization?.id}
          detail={chat.detail}
          message={search.message}
          part={search.part}
          child={search.child}
          onFollow={() => {
            if (search.message || search.part)
              void navigate({ search: (previous) => (previous.child ? { child: previous.child } : {}), replace: true })
          }}
          onChild={(child) => void navigate({ search: child ? { child } : {} })}
          onArchived={() => void navigate({ to: "/" })}
          onNavigate={(sessionID) =>
            void navigate({ to: "/sessions/$sessionId", params: { sessionId: sessionID }, search: {} })
          }
          addRepositories={props.addRepositories}
        />
      </ChatReact.Provider>
    </RegistryContext>
  )
}
