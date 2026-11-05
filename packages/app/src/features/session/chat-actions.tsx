import { useState, type ReactNode } from "react"
import type { SessionLinksInfo, SessionLinksIssue } from "@ren/client"
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

const issueRow = (issue: SessionLinksIssue, open: (url: string) => void): LinkRow => ({
  key: issue.url,
  onClick: () => open(issue.url),
  ...(issue.kind === "github_issue"
    ? {
        icon: <GitHubMark className="text-foreground" />,
        label: repositoryOf(issue.url),
        shortcut: `#${URL.parse(issue.url)?.pathname.split("/").at(4) ?? ""}`,
      }
    : { icon: <LinearMark className="text-foreground" />, label: linearKeyOf(issue.url), shortcut: "Linear" }),
})

const noLinks: SessionLinksInfo = { tasks: [], pullRequests: [], issues: [], threads: [] }

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

function ChatLinks(props: { sessionId: Session.ID; open: boolean }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const platform = Platform.usePlatform()
  const links =
    useQuery({
      ...api.link.session.links.queryOptions({ id: props.sessionId }),
      enabled: props.open,
      staleTime: 0,
    }).data ?? noLinks
  const pullRequests = useQuery({
    ...api.link.session.pullRequests.queryOptions({ id: props.sessionId }),
    enabled: props.open && links.pullRequests.length > 0,
    staleTime: 0,
  }).data
  const pulls = new Map(pullRequests?.map((pull) => [pull.url, pull]))
  return (
    <>
      <LinkGroup
        label="Tasks"
        rows={links.tasks.map((task) => ({
          key: task.id,
          icon: <IconChecklist />,
          label: task.title,
          shortcut: task.identifier,
          onClick: () => void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } }),
        }))}
      />
      <LinkGroup
        label="Pull requests"
        rows={links.pullRequests.map((pull) => ({
          key: pull.url,
          icon: <PullRequestIcon state={pulls.get(pull.url)?.state} />,
          label: pulls.get(pull.url)?.title ?? repositoryOf(pull.url),
          shortcut: `#${pull.number}`,
          onClick: () => platform.openExternal(pull.url),
        }))}
      />
      <LinkGroup label="Issues" rows={links.issues.map((issue) => issueRow(issue, platform.openExternal))} />
      <LinkGroup
        label="Threads"
        rows={links.threads.map((thread) => ({
          key: thread.url,
          icon: <ChannelMark provider={thread.provider} className="text-foreground" />,
          label: thread.place
            ? Channels.label(thread.provider, thread.place)
            : `${Channels.byId[thread.provider].title} thread`,
          shortcut: Channels.byId[thread.provider].title,
          onClick: () => platform.openExternal(thread.url),
        }))}
      />
    </>
  )
}

export function ChatActions(props: {
  sessionId: Session.ID
  archive: { readonly title: string; readonly onArchive: () => Promise<unknown> } | undefined
}) {
  const [open, setOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const write = Platform.usePlatform().writeClipboardText
  const copyLink = () =>
    void write?.(window.location.href).then(
      () => toast.success("Link copied", { description: window.location.href }),
      (error: unknown) => toast.error("Could not copy the link", { description: errorMessage(error) }),
    )
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Chat actions" />}
        >
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <ChatLinks sessionId={props.sessionId} open={open} />
          {write ? (
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={copyLink}>
                <IconLink />
                Copy link
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
          {props.archive ? (
            <>
              {write ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onClick={() => setArchiving(true)}>
                  <IconArchive />
                  Archive chat
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {props.archive ? (
        <ConfirmDialog
          open={archiving}
          onOpenChange={setArchiving}
          confirmation={{
            title: `Archive “${props.archive.title}”?`,
            description: "It leaves your chat list. Only the API can bring it back.",
            action: "Archive",
          }}
          onConfirm={props.archive.onArchive}
        />
      ) : null}
    </>
  )
}
