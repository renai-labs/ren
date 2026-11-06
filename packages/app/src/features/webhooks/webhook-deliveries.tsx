import type { WebhookDeliveryInfo, WebhookDeliveryOutcome, WebhookInfo } from "@ren/client"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
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

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/webhooks/$webhookId/")

const any = "any"

const pageSize = 50

// oxlint-disable-next-line ren/no-comments -- Requests arrive from outside Ren with no push to the app, so the list reads them again while it is open.
const refreshEvery = 5_000

const outcomeItems = [
  { value: any, label: "Any outcome" },
  ...Object.entries(Webhooks.outcomes).map((entry) => ({ value: entry[0], label: entry[1].label })),
]

const fromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export function WebhookDeliveries(props: { webhook: WebhookInfo }) {
  const { api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const outcome = Webhooks.isOutcome(search.outcome) ? search.outcome : undefined
  const deliveries = useQuery({
    ...api["webhook-delivery"].list.queryOptions({
      webhookId: props.webhook.id,
      page: 1,
      pageSize,
      ...(outcome && { outcome }),
    }),
    placeholderData: keepPreviousData,
    refetchInterval: refreshEvery,
  })
  const items = deliveries.data?.items ?? []
  const selected = items.find((item) => item.id === search.delivery)
  const rejectedRun = items.findIndex((item) => item.outcome !== "rejected")
  const rejected = rejectedRun === -1 ? items.length : rejectedRun
  return (
    <div className="flex flex-col gap-4">
      <DeliveriesToolbar webhook={props.webhook} outcome={outcome} />
      {rejected >= 3 ? (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <IconAlertTriangle className="size-4" />
          {rejected} requests in a row had a wrong signature. Replace the signing secret.
        </p>
      ) : null}
      {deliveries.data && items.length === 0 ? (
        <EmptyState title="Waiting for the first request">
          Paste the URL in the other app and send a test request.
        </EmptyState>
      ) : null}
      {items.length > 0 ? (
        <TableCard className={cn("transition-opacity", deliveries.isPlaceholderData && "opacity-60")}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Chat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <DeliveryRow
                  key={item.id}
                  delivery={item}
                  selected={item.id === search.delivery}
                  onSelect={() =>
                    void navigate({
                      search: (previous) => ({
                        ...previous,
                        delivery: item.id === previous.delivery ? undefined : item.id,
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
      {selected ? <DeliveryDetail delivery={selected} /> : null}
    </div>
  )
}

function DeliveriesToolbar(props: { webhook: WebhookInfo; outcome: WebhookDeliveryOutcome | undefined }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = route.useNavigate()
  const count = (outcome: WebhookDeliveryOutcome) => ({
    ...api["webhook-delivery"].list.queryOptions({ webhookId: props.webhook.id, outcome, page: 1, pageSize: 1 }),
    select: (page: { readonly total: number }) => page.total,
    refetchInterval: refreshEvery,
  })
  const recorded = useQuery(count("recorded"))
  const throttled = useQuery(count("throttled"))
  const replay = useMutation(api["webhook-parser"]["webhook-delivery"].replay.mutationOptions())
  const waiting = (recorded.data ?? 0) + (throttled.data ?? 0)
  const live = props.webhook.mode === "live"
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
          replay.mutate(
            { webhookId: props.webhook.id },
            {
              onSuccess: (result) => toast.success(`${result.replayed} requests started their chats`),
              onError: (error) => toast.error("Couldn’t replay the requests", { description: errorMessage(error) }),
            },
          )
        }
      >
        Replay {waiting} recorded
      </Button>
    </div>
  )
}

function DeliveryRow(props: { delivery: WebhookDeliveryInfo; selected: boolean; onSelect: () => void }) {
  const delivery = props.delivery
  const outcome = Webhooks.outcomes[delivery.outcome]
  const OutcomeIcon = delivery.broken ? IconAlertTriangle : outcome.icon
  return (
    <TableRow data-state={props.selected ? "selected" : undefined}>
      <TableCell className="tabular-nums">
        <Button variant="link" className="h-auto p-0 font-normal" onClick={props.onSelect}>
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
          <Link to="/sessions/$sessionId" params={{ sessionId: delivery.sessionId }} className="hover:underline">
            Open chat
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

function DeliveryDetail(props: { delivery: WebhookDeliveryInfo }) {
  const body = props.delivery.body
  const parsed = body === null ? undefined : fromJson(body)
  return (
    <div className="grid gap-6 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-medium">Headers</span>
        <dl className="flex flex-col gap-1 font-mono text-xs">
          {Object.keys(props.delivery.headers).map((name) => (
            <div key={name} className="flex min-w-0 gap-1">
              <dt className="shrink-0 text-muted-foreground">{name}:</dt>
              <dd className="truncate" title={props.delivery.headers[name]}>
                {props.delivery.headers[name]}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-medium">Body · {Webhooks.sizeOf(body)}</span>
        <div className="max-h-96 overflow-auto overscroll-contain font-mono text-xs">
          {parsed && parsed._tag === "Some" ? (
            <JsonValue value={parsed.value} keys={[]} />
          ) : (
            <CodeBlock size="sm">
              <CodeBlockContent wrap>{body ?? "(not kept)"}</CodeBlockContent>
            </CodeBlock>
          )}
        </div>
      </div>
    </div>
  )
}

function JsonValue(props: { value: unknown; keys: ReadonlyArray<string> }) {
  const value = props.value
  if (Array.isArray(value) || (typeof value === "object" && value !== null))
    return (
      <ul className="flex flex-col gap-0.5 border-l pl-3">
        {Object.entries(value).map((entry) => (
          <li key={entry[0]} className="flex min-w-0 flex-col">
            <span className="text-muted-foreground">{entry[0]}</span>
            <JsonValue value={entry[1]} keys={[...props.keys, entry[0]]} />
          </li>
        ))}
      </ul>
    )
  return <JsonLeaf value={value} path={Webhooks.pathOf(props.keys)} />
}

// oxlint-disable-next-line ren/no-comments -- W41: a click on a value of a request offers to fill the Setup form with its path.
function JsonLeaf(props: { value: unknown; path: string }) {
  const form = useWebhookForm()
  const text = typeof props.value === "string" ? props.value : JSON.stringify(props.value)
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
              added("Same-chat key set")
            }}
          >
            Use as same-chat key
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              form.actions.set({ title: props.path })
              added("Title set")
            }}
          >
            Use as title
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
