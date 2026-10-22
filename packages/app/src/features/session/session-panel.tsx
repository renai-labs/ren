import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Dialog } from "@ren/ui/dialog"
import { useRouteContext } from "@tanstack/react-router"
import { Chat } from "../../lib/chat.js"
import { SessionChat } from "./session-chat.js"

export function SessionPanel(props: {
  sessionId: string
  child: Session.ID | undefined
  onChild: (id: Session.ID | undefined) => void
  onClose: () => void
  onNavigate: (id: string) => void
}) {
  const context = useRouteContext({ from: "/_authed" })
  const chat = Chat.forUser(context.platform, context.me.user.id)
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Dialog.Content presentation="side" size="extra-large">
        <Dialog.Header>
          <Dialog.Title>Task session</Dialog.Title>
          <Dialog.Description>Chat with the agent working on this task.</Dialog.Description>
        </Dialog.Header>
        <div className="flex min-h-0 flex-1 flex-col">
          <RegistryContext value={chat.registry}>
            <ChatReact.Provider atoms={chat.atoms}>
              <SessionChat
                key={props.sessionId}
                sessionID={Session.ID.make(props.sessionId)}
                viewer={context.me.user.id}
                organizationId={context.me.organization?.id}
                detail={chat.detail}
                message={undefined}
                part={undefined}
                child={props.child}
                onChild={props.onChild}
                onFollow={() => undefined}
                onArchived={props.onClose}
                onNavigate={props.onNavigate}
              />
            </ChatReact.Provider>
          </RegistryContext>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}
