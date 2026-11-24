import type { PullRequestInfo, TaskInfo } from "@ren/client"
import { useId, useState, type ComponentType } from "react"
import { TaskLink } from "@ren/schema/task-link"
import { IconPlus, IconWorld, IconX } from "@tabler/icons-react"
import { Task } from "@ren/schema/task"
import { Button } from "@ren/ui/button"
import { Field, FieldError, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { GitHubMark, LinearMark, SlackMark } from "../../icons/brands.js"
import { PullRequestIcon, pullRequestStateLabel } from "../../components/pull-request-icon.js"
import { Link } from "@ren/ui/link"
import { TaskLayout } from "../../components/task-layout.js"
import { cn } from "cn"

type LinkInfo = TaskInfo["links"][number]

type Mark = ComponentType<{ className?: string }>

const marks: Record<LinkInfo["kind"], Mark> = {
  github_pr: GitHubMark,
  github_issue: GitHubMark,
  linear_issue: LinearMark,
  slack_thread: SlackMark,
  url: IconWorld,
}

const describe = (link: LinkInfo): { mark: Mark; label: string } => ({
  mark: URL.canParse(link.url) ? marks[link.kind] : IconWorld,
  label: TaskLink.label(link),
})

function LinkMark(props: { link: LinkInfo; shown: ReturnType<typeof describe>; pull?: PullRequestInfo | undefined }) {
  return (
    <span className="flex shrink-0">
      {props.link.kind === "github_pr" ? (
        <PullRequestIcon state={props.pull?.state} className="size-3.5" />
      ) : (
        <props.shown.mark className="size-3.5 text-foreground" />
      )}
    </span>
  )
}

export function LinkChip(props: { link: LinkInfo }) {
  const shown = describe(props.link)
  return (
    <span
      title={props.link.url}
      className="flex h-5 max-w-28 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium tabular-nums ring-1 ring-border"
    >
      <LinkMark link={props.link} shown={shown} />
      <span className="truncate">{TaskLink.shortLabel(props.link)}</span>
    </span>
  )
}

const kindOrder: ReadonlyArray<LinkInfo["kind"]> = ["github_pr", "github_issue", "linear_issue", "slack_thread", "url"]

const kindNames: Record<LinkInfo["kind"], { name: string; add: string }> = {
  github_pr: { name: "GitHub pull request", add: "Link pull request" },
  github_issue: { name: "GitHub issue", add: "Link issue" },
  linear_issue: { name: "Linear issue", add: "Link issue" },
  slack_thread: { name: "Slack thread", add: "Link thread" },
  url: { name: "Link", add: "Add link" },
}

const isWebUrl = (value: string) => {
  const url = URL.parse(value)
  return url !== null && ["http:", "https:"].includes(url.protocol)
}

const problem = (value: string, links: ReadonlyArray<LinkInfo>) => {
  if (!value) return "Paste a link."
  if (!isWebUrl(value)) return "Use a link that starts with https://."
  const key = TaskLink.classify(value).key
  if (links.some((link) => TaskLink.classify(link.url).key === key)) return "This task already has this link."
  if (links.length >= Task.maximumLinks) return `A task has at most ${Task.maximumLinks} links.`
  return
}

function Detected(props: { url: string }) {
  const kind = TaskLink.classify(props.url).kind
  const Mark = marks[kind]
  const name = kindNames[kind].name
  const label = TaskLink.label({ kind, url: props.url })
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      <Mark className="size-3.5 shrink-0 text-foreground" />
      <span className="truncate">{label === name ? name : `${name} · ${label}`}</span>
    </p>
  )
}

function AddLink(props: { links: ReadonlyArray<LinkInfo>; onAdd: (url: string) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string>()
  const id = useId()
  const url = value.trim()
  const kind = isWebUrl(url) ? TaskLink.classify(url).kind : "url"
  const submit = () => {
    const found = problem(url, props.links)
    if (found) return setError(found)
    props.onAdd(url)
    setOpen(false)
    setValue("")
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setError(undefined)
      }}
    >
      <PopoverTrigger render={<Button variant="ghost" className={cn(TaskLayout.property, "text-muted-foreground")} />}>
        <IconPlus />
        Add link
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-3">
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`${id}-url`}>Link</FieldLabel>
            <Input
              id={`${id}-url`}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={value}
              placeholder="Paste a pull request, issue, Slack thread or any link"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                setValue(event.target.value)
                setError(undefined)
              }}
            />
            {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
            {!error && isWebUrl(url) ? <Detected url={url} /> : null}
          </Field>
          <Button type="submit" size="sm" className="self-end">
            {kindNames[kind].add}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function LinkRow(props: { link: LinkInfo; pull: PullRequestInfo | undefined; onRemove: (() => void) | undefined }) {
  const shown = describe(props.link)
  const label = props.pull?.title ?? shown.label
  return (
    <div className="group/link -ml-2.5 flex h-8 max-w-full min-w-0 items-center gap-2 rounded-full pr-1 pl-2.5 hover:bg-muted">
      <LinkMark link={props.link} shown={shown} pull={props.pull} />
      <Link
        href={props.link.url}
        external
        appearance="plain"
        title={props.link.url}
        className="min-w-0 flex-1 truncate text-sm"
      >
        {label}
        {props.pull?.state ? <span className="sr-only">, {pullRequestStateLabel(props.pull.state)}</span> : null}
      </Link>
      {props.onRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${label}`}
          className="shrink-0 rounded-full text-muted-foreground opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          onClick={props.onRemove}
        >
          <IconX />
        </Button>
      ) : null}
    </div>
  )
}

const order = (link: LinkInfo) => kindOrder.indexOf(link.kind)

export function TaskLinkSections(props: {
  links: TaskInfo["links"]
  pullRequests: ReadonlyArray<PullRequestInfo> | undefined
  edit: { onAdd: (url: string) => void; onRemove: (link: LinkInfo) => void } | undefined
}) {
  const edit = props.edit
  const pulls = new Map(props.pullRequests?.map((pull) => [pull.url, pull]))
  if (props.links.length === 0 && !edit) return null
  return (
    <section className="flex flex-col">
      <h2 className={TaskLayout.sectionTitle}>Links</h2>
      {props.links
        .toSorted((a, b) => order(a) - order(b))
        .map((link) => (
          <LinkRow
            key={link.id}
            link={link}
            pull={pulls.get(link.url)}
            onRemove={edit && (() => edit.onRemove(link))}
          />
        ))}
      {edit ? <AddLink links={props.links} onAdd={edit.onAdd} /> : null}
    </section>
  )
}
