import type { SessionInfo, SessionPage } from "@ren/client"
import { ChatState, Family } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionCapabilities } from "@ren/schema/session/capabilities"
import { Breadcrumbs } from "@ren/ui/breadcrumbs"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { InlineEdit } from "@ren/ui/inline-edit"
import { Menu } from "@ren/ui/menu"
import { ProgressIndicator } from "@ren/ui/progress-indicator"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { Chat } from "../../lib/chat.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { Failure } from "./failure.js"
import { SessionTitle } from "./session-title.js"

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
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button appearance="secondary" size="small">
            <ProgressIndicator size="extra-small" announcement="none" />
            {count} running
          </Button>
        }
      />
      <Menu.Popup alignment="end">
        {props.background.tasks.map((task) => (
          <Menu.Item
            key={task.id}
            icon={<Icon glyph={task.type === "subagent" ? "Ghost" : "EnvVariable"} />}
            disabled={task.type !== "subagent"}
            onSelect={() => props.onOpen(Session.ID.make(task.id))}
          >
            {task.label}
          </Menu.Item>
        ))}
        {props.background.blocking.length > 0 ? (
          <Menu.Item
            icon={<Icon glyph="ArrowDown" />}
            shortcut="Ctrl+B"
            onSelect={() => void move().catch(Failure.toast("Could not move the work to the background"))}
          >
            Move to background
          </Menu.Item>
        ) : null}
        {subagents.length > 0 ? (
          <Menu.Item
            tone="danger"
            icon={<Icon glyph="Stop" />}
            onSelect={() =>
              void Promise.all(subagents.map((task) => stop(Session.ID.make(task.id)))).catch(
                Failure.toast("Could not stop the subagents"),
              )
            }
          >
            Stop subagents
          </Menu.Item>
        ) : null}
      </Menu.Popup>
    </Menu.Root>
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
  const queryClient = useQueryClient()
  const write = platform.writeClipboardText
  const archive = useMutation(context.api.session.archive.mutationOptions())
  const [confirming, setConfirming] = useState(false)
  const approval = Chat.useAutoApprove(props.sessionID)
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton label="Chat actions">
              <Icon glyph="MoreHorizontal" />
            </IconButton>
          }
        />
        <Menu.Popup alignment="end">
          {props.capabilities?.revert === false ? null : (
            <>
              <Menu.Item icon={<Icon glyph="Restore" />} disabled={!props.prompted} onSelect={props.onUndo}>
                Undo last message
              </Menu.Item>
              <Menu.Item icon={<Icon glyph="Repeat" />} disabled={!props.reverted} onSelect={props.onRedo}>
                Restore undone messages
              </Menu.Item>
            </>
          )}
          {props.capabilities?.compact === false ? null : (
            <Menu.Item icon={<Icon glyph="Minimize2" />} disabled={!props.prompted} onSelect={props.onCompact}>
              Compact chat
            </Menu.Item>
          )}
          {props.capabilities?.permissions === false ? null : (
            <Menu.CheckboxItem
              icon={<Icon glyph="BadgeCheck" />}
              checked={approval.enabled}
              onCheckedChange={(enabled) =>
                void approval.set({ enabled }).catch(Failure.toast("Could not change automatic approval"))
              }
            >
              Approve every request automatically
            </Menu.CheckboxItem>
          )}
          {write ? (
            <Menu.Item
              icon={<Icon glyph="Copy" />}
              onSelect={() =>
                void write(props.sessionID).then(
                  () => Toast.manager.add({ type: "success", title: "Chat ID copied", description: props.sessionID }),
                  Failure.toast("Could not copy the chat ID"),
                )
              }
            >
              Copy chat ID
            </Menu.Item>
          ) : null}
          <Menu.Separator />
          <Menu.Item tone="danger" icon={<Icon glyph="Archive" />} onSelect={() => setConfirming(true)}>
            Archive chat
          </Menu.Item>
        </Menu.Popup>
      </Menu.Root>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Archive “${props.title}”?`}
        description="It leaves your chat list. Only the API can bring it back."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={async () => {
          await archive.mutateAsync({ id: props.sessionID })
          queryClient.setQueriesData<SessionPage>({ queryKey: context.api.session.list.queryKey() }, (page) =>
            page ? { ...page, items: page.items.filter((item) => item.id !== props.sessionID) } : page,
          )
          await queryClient.invalidateQueries({ queryKey: context.api.session.list.queryKey() })
        }}
        onConfirmed={() => {
          Toast.manager.add({ type: "success", title: `${props.title} archived` })
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
  state: ChatState.State
  root: Session.ID
  sessionID: Session.ID
  rootTitle: string
  onOpen: (sessionID: Session.ID | undefined) => void
}) {
  const ancestors = Family.ancestors(props.state, props.sessionID)
  const name = (id: string) =>
    id === props.root ? props.rootTitle : SessionTitle.display(Family.childTitle(props.state, id, ""), "Subagent")
  const parent = ancestors.at(-1) ?? props.root
  const running = ChatState.activity(props.state, props.sessionID) === "running"
  const open = (id: string) => props.onOpen(id === props.root ? undefined : Session.ID.make(id))
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <IconButton label={`Back to ${name(parent)}`} size="small" onClick={() => open(parent)}>
        <Icon glyph="ArrowLeft" />
      </IconButton>
      <Breadcrumbs.Root>
        {(ancestors.length > 0 ? ancestors : [props.root]).map((id) => (
          <Breadcrumbs.Link
            key={id}
            render={
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: props.root }}
                search={id === props.root ? {} : { child: Session.ID.make(id) }}
              />
            }
          >
            {name(id)}
          </Breadcrumbs.Link>
        ))}
        <Breadcrumbs.Page>{name(props.sessionID)}</Breadcrumbs.Page>
      </Breadcrumbs.Root>
      {running ? <ProgressIndicator size="small" label="Running" /> : null}
    </div>
  )
}
