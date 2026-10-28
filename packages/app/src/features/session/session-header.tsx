import type { SessionInfo, SessionPage } from "@ren/client"
import { Family } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionCapabilities } from "@ren/schema/session/capabilities"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@ren/ui/breadcrumb"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { InlineEdit } from "@ren/ui/inline-edit"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import { toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Fragment, useState } from "react"
import { ScheduleDialog } from "../../components/schedule-dialog.js"
import { Chat } from "../../lib/chat.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { Failure } from "./failure.js"

function RunningMenu(props: {
  background: Family.Background
  root: Session.ID
  onOpen: (sessionID: Session.ID) => void
}) {
  const stop = ChatReact.useAction(props.root, (opened, sessionID: Session.ID) => opened.stop(sessionID))
  const move = ChatReact.useAction(props.root, (opened) => opened.background)
  const subagents = props.background.tasks.filter((task) => task.type === "subagent")
  if (props.background.tasks.length === 0 && props.background.blocking.length === 0) return null
  const count = props.background.tasks.length + props.background.blocking.length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Spinner aria-hidden data-icon="inline-start" />
        {count} running
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          {props.background.tasks.map((task) => (
            <DropdownMenuItem
              key={task.id}
              disabled={task.type !== "subagent"}
              onClick={() => props.onOpen(Session.ID.make(task.id))}
            >
              <Icon glyph={task.type === "subagent" ? "Ghost" : "EnvVariable"} />
              {task.label}
            </DropdownMenuItem>
          ))}
          {props.background.blocking.length > 0 ? (
            <DropdownMenuItem
              onClick={() => void move().catch(Failure.notify("Could not move the work to the background"))}
            >
              <Icon glyph="ArrowDown" />
              Move to background
              <DropdownMenuShortcut>Ctrl+B</DropdownMenuShortcut>
            </DropdownMenuItem>
          ) : null}
          {subagents.length > 0 ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                void Promise.all(subagents.map((task) => stop(Session.ID.make(task.id)))).catch(
                  Failure.notify("Could not stop the subagents"),
                )
              }
            >
              <Icon glyph="Stop" />
              Stop subagents
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Actions(props: {
  sessionID: Session.ID
  title: string
  capabilities: SessionCapabilities.Info | undefined
  prompted: boolean
  reverted: boolean
  onUndo: () => void
  onRedo: () => void
  onCompact: () => void
  onArchived: () => void
}) {
  const context = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const write = platform.writeClipboardText
  const archive = useMutation(context.api.session.archive.mutationOptions())
  const [confirming, setConfirming] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const spaceId = useQuery({
    ...context.api.session.get.queryOptions({ idOrSlug: props.sessionID }),
    select: (session) => session.spaceId,
  }).data
  const approval = Chat.useAutoApprove(props.sessionID)
  const revertible = props.capabilities?.revert !== false
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Chat actions" />}
        >
          <Icon glyph="MoreHorizontal" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuGroup>
            {revertible ? (
              <DropdownMenuItem disabled={!props.prompted} onClick={props.onUndo}>
                <Icon glyph="Restore" />
                Undo last message
              </DropdownMenuItem>
            ) : null}
            {revertible ? (
              <DropdownMenuItem disabled={!props.reverted} onClick={props.onRedo}>
                <Icon glyph="Repeat" />
                Restore undone messages
              </DropdownMenuItem>
            ) : null}
            {props.capabilities?.compact === false ? null : (
              <DropdownMenuItem disabled={!props.prompted} onClick={props.onCompact}>
                <Icon glyph="Minimize2" />
                Compact chat
              </DropdownMenuItem>
            )}
            {props.capabilities?.permissions === false ? null : (
              <DropdownMenuCheckboxItem
                checked={approval.enabled}
                onCheckedChange={(enabled) =>
                  void approval.set({ enabled }).catch(Failure.notify("Could not change automatic approval"))
                }
              >
                <Icon glyph="BadgeCheck" />
                Approve every request automatically
              </DropdownMenuCheckboxItem>
            )}
            {write ? (
              <DropdownMenuItem
                onClick={() =>
                  void write(props.sessionID).then(
                    () => toast.add({ type: "success", title: "Chat ID copied", description: props.sessionID }),
                    Failure.notify("Could not copy the chat ID"),
                  )
                }
              >
                <Icon glyph="Copy" />
                Copy chat ID
              </DropdownMenuItem>
            ) : null}
            {spaceId ? (
              <DropdownMenuItem onClick={() => setScheduling(true)}>
                <Icon glyph="Clock" />
                Schedule a message
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
              <Icon glyph="Archive" />
              Archive chat
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {scheduling && spaceId ? (
        <ScheduleDialog chat={{ spaceId, sessionId: props.sessionID }} onClose={() => setScheduling(false)} />
      ) : null}
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Archive “${props.title}”?`}
        description="It leaves your chat list. Only the API can bring it back."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={() => archive.mutateAsync({ id: props.sessionID })}
        onConfirmed={() => {
          toast.add({ type: "success", title: `${props.title} archived` })
          props.onArchived()
        }}
      />
    </>
  )
}

function Title(props: { sessionID: Session.ID; title: string; renamable: boolean }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const rename = ChatReact.useAction(props.sessionID, (opened, title: string) => opened.rename(title))
  if (!props.renamable)
    return (
      <Text purpose="label" truncation="single-line" element="h1">
        {props.title}
      </Text>
    )
  return (
    <InlineEdit
      value={props.title}
      label="Chat title"
      required
      onCommit={async (next) => {
        await rename(next)
        const renamed = (item: SessionInfo) => (item.id === props.sessionID ? { ...item, title: next } : item)
        queryClient.setQueriesData<SessionPage>({ queryKey: context.api.session.list.queryKey() }, (page) =>
          page ? { ...page, items: page.items.map(renamed) } : page,
        )
        queryClient.setQueriesData<SessionInfo>({ queryKey: context.api.session.get.queryKey() }, (info) =>
          info ? renamed(info) : info,
        )
      }}
    />
  )
}

export function SessionHeader(props: {
  sessionID: Session.ID
  title: string
  capabilities: SessionCapabilities.Info | undefined
  prompted: boolean
  reverted: boolean
  background: Family.Background
  onOpen: (sessionID: Session.ID) => void
  onUndo: () => void
  onRedo: () => void
  onCompact: () => void
  onArchived: () => void
}) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <Title sessionID={props.sessionID} title={props.title} renamable={props.capabilities?.rename !== false} />
      </div>
      <RunningMenu background={props.background} root={props.sessionID} onOpen={props.onOpen} />
      <Actions
        sessionID={props.sessionID}
        title={props.title}
        capabilities={props.capabilities}
        prompted={props.prompted}
        reverted={props.reverted}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onCompact={props.onCompact}
        onArchived={props.onArchived}
      />
    </>
  )
}

export function ChildHeader(props: {
  root: Session.ID
  title: string
  ancestors: ReadonlyArray<{ readonly id: string; readonly title: string }>
  running: boolean
  onOpen: (sessionID: Session.ID | undefined) => void
}) {
  const parent = props.ancestors.at(-1)
  const open = (id: string) => props.onOpen(id === props.root ? undefined : Session.ID.make(id))
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={`Back to ${parent?.title ?? ""}`}
        onClick={() => open(parent?.id ?? props.root)}
      >
        <Icon glyph="ArrowLeft" />
      </Button>
      <Breadcrumb aria-label="Breadcrumb" className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {props.ancestors.map((ancestor) => (
            <Fragment key={ancestor.id}>
              <BreadcrumbItem className="min-w-0 shrink-0">
                <BreadcrumbLink
                  className="truncate font-medium text-foreground hover:text-muted-foreground"
                  render={
                    <Link
                      to="/sessions/$sessionId"
                      params={{ sessionId: props.root }}
                      search={ancestor.id === props.root ? {} : { child: Session.ID.make(ancestor.id) }}
                    />
                  }
                >
                  {ancestor.title}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </Fragment>
          ))}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate font-medium">{props.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {props.running ? <Spinner aria-label="Running" className="text-muted-foreground" /> : null}
    </div>
  )
}
