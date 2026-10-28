import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@ren/ui/sheet"
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
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-240">
        <SheetHeader>
          <SheetTitle>Task session</SheetTitle>
          <SheetDescription>Chat with the agent working on this task.</SheetDescription>
        </SheetHeader>
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
      </SheetContent>
    </Sheet>
  )
}
