import { useState, type ReactNode } from "react"
import type { Session } from "@ren/schema/session"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { IconArchive, IconChecklist, IconDots, IconLink } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { toast } from "@ren/ui/sonner"
import { ChannelMark } from "../../components/channel-mark.js"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { PullRequestIcon } from "../../components/pull-request-icon.js"
import { GitHubMark, LinearMark } from "../../icons/brands.js"
import { Channels } from "../../lib/channels.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"

const repositoryOf = (url: string) => URL.parse(url)?.pathname.split("/").slice(1, 3).join("/") ?? url

const linearKeyOf = (url: string) =>
  URL.parse(url)
    ?.pathname.split("/")
    .find((part) => /^[A-Z][A-Z0-9]*-\d+$/u.test(part)) ?? "Linear issue"

type LinkRow = { key: string; icon: ReactNode; label: string; shortcut: string; onClick: () => void }

function LinkGroup(props: { label: string; rows: ReadonlyArray<LinkRow> }) {
  if (props.rows.length === 0) return null
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{props.label}</DropdownMenuLabel>
        {props.rows.map((row) => (
          <DropdownMenuItem key={row.key} onClick={row.onClick}>
            {row.icon}
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <DropdownMenuShortcut>{row.shortcut}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
    </>
  )
}

export function ChatActions(props: { sessionId: Session.ID; title: string; onArchive: () => Promise<unknown> }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const platform = Platform.usePlatform()
  const [opened, setOpened] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const links = useQuery({ ...api.link.session.links.queryOptions({ id: props.sessionId }), enabled: opened }).data
  const write = platform.writeClipboardText
  const copyLink = () =>
    void write?.(window.location.href).then(
      () => toast.success("Link copied", { description: window.location.href }),
      (error: unknown) => toast.error("Could not copy the link", { description: errorMessage(error) }),
    )
  return (
    <>
      <DropdownMenu onOpenChange={(open) => (open ? setOpened(true) : undefined)}>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Chat actions" />}
        >
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <LinkGroup
            label="Tasks"
            rows={(links?.tasks ?? []).map((task) => ({
              key: task.id,
              icon: <IconChecklist />,
              label: task.title,
              shortcut: task.identifier,
              onClick: () => void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } }),
            }))}
          />
          <LinkGroup
            label="Pull requests"
            rows={(links?.pullRequests ?? []).map((pull) => ({
              key: pull.url,
              icon: <PullRequestIcon state={pull.state} />,
              label: pull.title ?? repositoryOf(pull.url),
              shortcut: `#${pull.number}`,
              onClick: () => platform.openExternal(pull.url),
            }))}
          />
          <LinkGroup
            label="Issues"
            rows={(links?.issues ?? []).map((issue) =>
              issue.kind === "github_issue"
                ? {
                    key: issue.url,
                    icon: <GitHubMark className="text-foreground" />,
                    label: repositoryOf(issue.url),
                    shortcut: `#${URL.parse(issue.url)?.pathname.split("/").at(4) ?? ""}`,
                    onClick: () => platform.openExternal(issue.url),
                  }
                : {
                    key: issue.url,
                    icon: <LinearMark className="text-foreground" />,
                    label: linearKeyOf(issue.url),
                    shortcut: "Linear",
                    onClick: () => platform.openExternal(issue.url),
                  },
            )}
          />
          <LinkGroup
            label="Threads"
            rows={(links?.threads ?? []).map((thread) => ({
              key: thread.url,
              icon: <ChannelMark provider={thread.provider} className="text-foreground" />,
              label: thread.place
                ? Channels.label(thread.provider, thread.place)
                : `${Channels.byId[thread.provider].title} thread`,
              shortcut: Channels.byId[thread.provider].title,
              onClick: () => platform.openExternal(thread.url),
            }))}
          />
          {write ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={copyLink}>
                  <IconLink />
                  Copy link
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setArchiving(true)}>
              <IconArchive />
              Archive chat
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        confirmation={{
          title: `Archive “${props.title}”?`,
          description: "It leaves your chat list. Only the API can bring it back.",
          action: "Archive",
        }}
        onConfirm={props.onArchive}
      />
    </>
  )
}
