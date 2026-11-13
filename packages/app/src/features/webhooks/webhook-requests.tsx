import type { WebhookInfo, WebhookRequestInfo, WebhookRequestOutcome } from "@ren/client"
import { keepPreviousData, useMutation, useQueries, useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconAlertTriangle } from "@tabler/icons-react"
import { Schema } from "effect"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { formatDateTime } from "@ren/ui/time"
import { cn } from "cn"
import { EmptyState } from "../../components/empty-state.js"
import { TableCard } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Webhooks } from "../../lib/webhooks.js"
import { useWebhookForm } from "./use-webhook-form.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/automations/webhooks/$webhookId/")

const any = "any"

const pageSize = 50

const outcomeItems = [
  { value: any, label: "Any outcome" },
  ...Object.entries(Webhooks.outcomes).map((entry) => ({ value: entry[0], label: entry[1].label })),
]

const fromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export function WebhookRequests(props: { webhook: WebhookInfo }) {
  const { api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const outcome = Webhooks.isOutcome(search.outcome) ? search.outcome : undefined
  const requests = useQuery({
    ...api["webhook-request"].list.queryOptions({
      webhookId: props.webhook.id,
      page: 1,
      pageSize,
      ...(outcome && { outcome }),
    }),
    placeholderData: keepPreviousData,
    refetchInterval: Webhooks.refreshEvery,
  })
  const items = requests.data?.items ?? []
  const selected = items.find((item) => item.id === search.request)
  const rejectedRun = items.findIndex((item) => item.outcome !== "rejected")
  const rejected = rejectedRun === -1 ? items.length : rejectedRun
  return (
    <div className="flex flex-col gap-4">
      <RequestsToolbar webhook={props.webhook} outcome={outcome} />
      {rejected >= 3 ? (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <IconAlertTriangle className="size-4" />
          {rejected} requests in a row had a wrong signature. Replace the signing secret.
        </p>
      ) : null}
      {requests.data && items.length === 0 ? (
        <EmptyState title="Waiting for the first request">
          Paste the URL in the other app and send a test request.
        </EmptyState>
      ) : null}
      {items.length > 0 ? (
        <TableCard className={cn("transition-opacity", requests.isPlaceholderData && "opacity-60")}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Session</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <RequestRow
                  key={item.id}
                  request={item}
                  selected={item.id === search.request}
                  onSelect={() =>
                    void navigate({
                      search: (previous) => ({
                        ...previous,
                        request: item.id === previous.request ? undefined : item.id,
                      }),
                      replace: true,
                    })
                  }
                />
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
      {selected ? <RequestDetail request={selected} editable={!props.webhook.preset} /> : null}
    </div>
  )
}

function RequestsToolbar(props: { webhook: WebhookInfo; outcome: WebhookRequestOutcome | undefined }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = route.useNavigate()
  const counts = useQueries({
    queries: Webhooks.replayable.map((outcome) => ({
      ...api["webhook-request"].list.queryOptions({ webhookId: props.webhook.id, outcome, page: 1, pageSize: 1 }),
      select: (page: { readonly total: number }) => page.total,
      refetchInterval: Webhooks.refreshEvery,
    })),
  })
  const replay = useMutation(api.webhook.replay.mutationOptions())
  const waiting = counts.reduce((sum, count) => sum + (count.data ?? 0), 0)
  const live = props.webhook.mode === "live"
  const replayAll = (total: number): Promise<number> =>
    replay
      .mutateAsync({ id: props.webhook.id })
      .then((result) =>
        result.remaining > 0 && result.replayed > 0 ? replayAll(total + result.replayed) : total + result.replayed,
      )
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select
        items={outcomeItems}
        value={props.outcome ?? any}
        onValueChange={(value) =>
          void navigate({
            search: (previous) => ({ ...previous, outcome: value === any ? undefined : String(value) }),
            replace: true,
          })
        }
      >
        <SelectTrigger aria-label="Outcome" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {outcomeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        disabled={waiting === 0 || !live || replay.isPending}
        title={live ? undefined : "Turn the webhook on to replay"}
        onClick={() =>
          void replayAll(0).then(
            (replayed) => toast.success(`${replayed} requests went to their sessions`),
            (error: unknown) => toast.error("Couldn’t replay the requests", { description: errorMessage(error) }),
          )
        }
      >
        Replay {waiting}
      </Button>
    </div>
  )
}

function RequestRow(props: { request: WebhookRequestInfo; selected: boolean; onSelect: () => void }) {
  const delivery = props.request
  const outcome = Webhooks.outcomes[delivery.outcome]
  const OutcomeIcon = delivery.broken ? IconAlertTriangle : outcome.icon
  return (
    <TableRow data-state={props.selected ? "selected" : undefined} className="relative cursor-pointer">
      <TableCell className="tabular-nums">
        <Button
          variant="ghost"
          aria-expanded={props.selected}
          onClick={props.onSelect}
          className="block h-auto min-w-0 justify-start rounded-none border-0 p-0 text-left font-normal after:absolute after:inset-0 hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-none"
        >
          {formatDateTime(delivery.receivedAt)}
        </Button>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <OutcomeIcon className="size-4 text-muted-foreground" />
          {delivery.broken ? `${outcome.label}, broken` : outcome.label}
        </span>
      </TableCell>
      <TableCell className="max-w-72 truncate text-muted-foreground" title={delivery.reason ?? undefined}>
        {delivery.reason ?? "—"}
      </TableCell>
      <TableCell>
        {delivery.sessionId ? (
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: delivery.sessionId }}
            className="relative hover:underline"
          >
            Open session
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

function RequestDetail(props: { request: WebhookRequestInfo; editable: boolean }) {
  const { client } = RouterContext.useRouterContext()
  const detail = useQuery(Webhooks.requestOptions(client, props.request.id))
  const body = detail.data?.body ?? null
  const headers = detail.data?.headers ?? {}
  const parsed = body === null ? undefined : fromJson(body)
  return (
    <div className="grid gap-6 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-medium">Headers</span>
        <dl className="flex flex-col gap-1 font-mono text-xs">
          {Object.keys(headers).map((name) => (
            <div key={name} className="flex min-w-0 gap-1">
              <dt className="shrink-0 text-muted-foreground">{name}:</dt>
              <dd className="truncate" title={headers[name]}>
                {headers[name]}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-medium">Body · {Webhooks.sizeOf(props.request.bodyBytes)}</span>
        <div className="max-h-96 overflow-auto overscroll-contain font-mono text-xs">
          {parsed && parsed._tag === "Some" ? (
            <JsonValue value={parsed.value} keys={[]} editable={props.editable} />
          ) : (
            <CodeBlock size="sm">
              <CodeBlockContent wrap>{detail.data ? (body ?? "(not kept)") : "…"}</CodeBlockContent>
            </CodeBlock>
          )}
        </div>
      </div>
    </div>
  )
}

function JsonValue(props: { value: unknown; keys: ReadonlyArray<string>; editable: boolean }) {
  const value = props.value
  if (Array.isArray(value) || (typeof value === "object" && value !== null))
    return (
      <ul className="flex flex-col gap-0.5 border-l pl-3">
        {Object.entries(value).map((entry) => (
          <li key={entry[0]} className="flex min-w-0 flex-col">
            <span className="text-muted-foreground">{entry[0]}</span>
            <JsonValue value={entry[1]} keys={[...props.keys, entry[0]]} editable={props.editable} />
          </li>
        ))}
      </ul>
    )
  const text = typeof value === "string" ? value : JSON.stringify(value)
  if (!props.editable) return <span className="px-1">{text}</span>
  return <JsonLeaf text={text} path={Webhooks.pathOf(props.keys)} />
}

function JsonLeaf(props: { text: string; path: string }) {
  const form = useWebhookForm()
  const text = props.text
  const added = (what: string) => toast.success(`${what}. Save it on the Setup tab.`)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-auto justify-start px-1 py-0 font-mono text-xs" />}
      >
        {text}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              form.actions.addCondition({ id: crypto.randomUUID(), path: props.path, operator: "is", value: text })
              added("Condition added")
            }}
          >
            Add as condition
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              form.actions.set({ threadKey: props.path })
              added("Session continuation key set")
            }}
          >
            Use as session continuation key
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              form.actions.set({ title: props.path })
              added("Session title set")
            }}
          >
            Use as session title
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
