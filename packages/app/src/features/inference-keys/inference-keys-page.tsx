import { useState } from "react"
import type { RenInferenceKey, RenInferenceKeyStatus, RenInferenceKeyUsage } from "@ren/client"
import { RenInference } from "@ren/schema/ren-inference"
import { Session } from "@ren/schema/session"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconArrowLeft, IconChevronRight, IconKey, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react"
import { Button, buttonVariants } from "@ren/ui/button"
import { formatUsd } from "@ren/ui/format"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { toast } from "@ren/ui/sonner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs } from "@ren/ui/tabs"
import { formatRelative, formatShortDate } from "@ren/ui/time"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { cn } from "cn"
import { Schema } from "effect"
import { EmptyState } from "../../components/empty-state.js"
import { Page, PageTabsList, PageTabsTrigger, TableCard, TableEmpty } from "../../components/page.js"
import { RowMenu, type RowMenuItem } from "../../components/row-menu.js"
import { StatusBadge, type StatusTone } from "../../components/status-badge.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { errorMessage } from "../../lib/errors.js"
import { Loader } from "../../lib/loader.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useNow } from "../../lib/use-now.js"
import { useCanAdminister } from "../../lib/use-organization.js"
import { CreateKeyDialog } from "./create-key-dialog.js"
import { KeyUsage } from "./key-usage.js"
import { dollars, periods } from "./periods.js"

const route = getRouteApi("/_authed/_shell/settings/providers/keys")

const isPeriod = Schema.is(RenInference.Period)

const modelsProbe = Session.ID.create()

const statuses: Record<RenInferenceKeyStatus, { label: string; tone: StatusTone; hint?: string }> = {
  active: { label: "Active", tone: "ok" },
  revoke_pending: {
    label: "Revoking",
    tone: "warn",
    hint: "Ren couldn’t revoke the key yet, so it still works. Ren tries again every 5 minutes.",
  },
  revoked: { label: "Revoked", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
}

const isLive = (key: RenInferenceKey) => key.status === "active" || key.status === "revoke_pending"

const sampleKeys: ReadonlyArray<RenInferenceKey> = Array.from({ length: 3 }, (_, index) => ({
  id: `sample-${index}`,
  name: "Work laptop",
  prefix: "sk-ren-0000",
  status: "active",
  owner: { memberId: "mem_sample", name: "Member" },
  expiresAt: null,
  lastUsedAt: null,
  createdAt: new Date(0).toISOString(),
  canRevoke: false,
}))

function Expires(props: { expiresAt: string | null; now: number }) {
  if (!props.expiresAt) return <span className="text-muted-foreground">Never</span>
  if (Date.parse(props.expiresAt) <= props.now)
    return <span className="text-muted-foreground">{formatShortDate(props.expiresAt)}</span>
  return (
    <span title={formatShortDate(props.expiresAt)} className="text-muted-foreground">
      {formatRelative(props.expiresAt, props.now)}
    </span>
  )
}

function Status(props: { status: RenInferenceKeyStatus }) {
  const status = statuses[props.status]
  if (!status.hint) return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="sm" className="relative z-10 h-auto p-0" />}>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{status.hint}</TooltipContent>
    </Tooltip>
  )
}

function KeyName(props: { keyInfo: RenInferenceKey; open: boolean; onToggle: () => void }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <IconChevronRight
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
          props.open && "rotate-90",
        )}
      />
      <IconKey className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col">
        <Button
          variant="link"
          aria-expanded={props.open}
          aria-controls={`usage-${props.keyInfo.id}`}
          title={props.keyInfo.name}
          onClick={props.onToggle}
          className="block h-auto max-w-full min-w-0 truncate p-0 text-left font-normal text-foreground after:absolute after:inset-0 hover:no-underline focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-none"
        >
          {props.keyInfo.name}
        </Button>
        <span className="truncate font-mono text-xs text-muted-foreground">{props.keyInfo.prefix}…</span>
      </span>
    </span>
  )
}

function actionsFor(key: RenInferenceKey, onRevoke: () => Promise<unknown>): ReadonlyArray<RowMenuItem> {
  if (!key.canRevoke) return []
  if (key.status === "revoke_pending") return [{ label: "Retry revoke", icon: IconRefresh, onSelect: onRevoke }]
  return [
    {
      label: "Revoke",
      icon: IconTrash,
      onSelect: onRevoke,
      confirm: {
        title: `Revoke ${key.name}?`,
        description: `Anything that uses ${key.name} stops working at once. You can’t undo this.`,
        action: "Revoke",
      },
    },
  ]
}

function Charged(props: { usage: RenInferenceKeyUsage | undefined }) {
  const charged = props.usage?.charged ?? 0
  if (charged === 0) return <span className="text-muted-foreground">$0.00</span>
  return <>{formatUsd(dollars(charged))}</>
}

function KeyRow(props: {
  keyInfo: RenInferenceKey
  usage: RenInferenceKeyUsage | undefined
  owner: string | undefined
  open: boolean
  now: number
  onToggle: () => void
  onRevoke: () => Promise<unknown>
}) {
  const key = props.keyInfo
  return (
    <TableRow
      data-state={props.open ? "selected" : undefined}
      className={cn("relative cursor-pointer", props.open && "hover:bg-muted/50")}
    >
      <TableCell>
        <KeyName keyInfo={key} open={props.open} onToggle={props.onToggle} />
      </TableCell>
      {props.owner === undefined ? null : (
        <TableCell className="truncate text-muted-foreground">{props.owner}</TableCell>
      )}
      <TableCell className="text-muted-foreground">
        {key.lastUsedAt ? formatRelative(key.lastUsedAt, props.now) : "Never used"}
      </TableCell>
      <TableCell>
        <Expires expiresAt={key.expiresAt} now={props.now} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <Charged usage={props.usage} />
      </TableCell>
      <TableCell>
        <Status status={key.status} />
      </TableCell>
      <TableCell className="relative z-10">
        <RowMenu label={`${key.name} actions`} items={actionsFor(key, props.onRevoke)} />
      </TableCell>
    </TableRow>
  )
}

function NoRows(props: { columns: number; query: string; onClear: () => void }) {
  return (
    <TableEmpty columns={props.columns}>
      {props.query ? (
        <span className="flex flex-col items-center gap-2">
          No keys match “{props.query}”.
          <Button variant="outline" size="sm" onClick={props.onClear}>
            Clear search
          </Button>
        </span>
      ) : (
        "No active keys. Switch to All to see revoked and expired keys."
      )}
    </TableEmpty>
  )
}

function PeriodSelect(props: { value: RenInference.Period; onChange: (value: RenInference.Period) => void }) {
  return (
    <Select
      items={periods}
      value={props.value}
      onValueChange={(value) => {
        if (isPeriod(value)) props.onChange(value)
      }}
    >
      <SelectTrigger aria-label="Usage period" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {periods.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function useKeyData(period: RenInference.Period) {
  const { api } = RouterContext.useRouterContext()
  const list = useQuery({
    ...api["ren-inference"].key.list.queryOptions(),
    ...Loader.required,
  })
  const usage = useQuery({
    ...api["ren-inference"].key.usage.queryOptions({ period }),
    placeholderData: keepPreviousData,
  })
  const models = useQuery(api.chat.models.queryOptions({ id: modelsProbe }))
  const revoke = useMutation(api["ren-inference"].key.revoke.mutationOptions())
  return {
    list,
    usage: new Map((usage.data ?? []).map((each) => [each.keyId, each])),
    modelNames: new Map(
      (models.data ?? []).flatMap((model) => [
        [model.id, model.name],
        [`${model.providerID}/${model.id}`, model.name],
      ]),
    ),
    revoke: (key: RenInferenceKey) =>
      revoke.mutateAsync(
        { id: key.id },
        {
          onSuccess: () => toast.success(`${key.name} revoked`),
          onError: (error) => {
            toast.error(`Couldn’t revoke ${key.name}`, {
              description: errorMessage(error),
            })
            void list.refetch()
          },
        },
      ),
  }
}

function KeyEntry(props: {
  keyInfo: RenInferenceKey
  data: ReturnType<typeof useKeyData>
  owner: string | undefined
  open: boolean
  columns: number
  period: RenInference.Period
  now: number
  onToggle: () => void
}) {
  const key = props.keyInfo
  return (
    <>
      <KeyRow
        keyInfo={key}
        usage={props.data.usage.get(key.id)}
        owner={props.owner}
        open={props.open}
        now={props.now}
        onToggle={props.onToggle}
        onRevoke={() => props.data.revoke(key)}
      />
      {props.open ? (
        <TableRow className="hover:bg-transparent">
          <TableCell id={`usage-${key.id}`} colSpan={props.columns} className="pt-0 whitespace-normal">
            <KeyUsage usage={props.data.usage.get(key.id)} period={props.period} modelNames={props.data.modelNames} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function KeysTable(props: {
  keys: ReadonlyArray<RenInferenceKey>
  data: ReturnType<typeof useKeyData>
  ownerOf: ((key: RenInferenceKey) => string) | undefined
  openKey: string | undefined
  query: string
  period: RenInference.Period
  now: number
  onToggle: (key: RenInferenceKey) => void
  onClear: () => void
}) {
  const columns = props.ownerOf ? 7 : 6
  return (
    <TableCard>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Key</TableHead>
            {props.ownerOf ? <TableHead className="w-36">Owner</TableHead> : null}
            <TableHead className="w-32">Last used</TableHead>
            <TableHead className="w-28">Expires</TableHead>
            <TableHead className="w-28 text-right">Charged</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-15" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.keys.length === 0 ? <NoRows columns={columns} query={props.query} onClear={props.onClear} /> : null}
          {props.keys.map((key) => (
            <KeyEntry
              key={key.id}
              keyInfo={key}
              data={props.data}
              owner={props.ownerOf?.(key)}
              open={props.openKey === key.id}
              columns={columns}
              period={props.period}
              now={props.now}
              onToggle={() => props.onToggle(key)}
            />
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

function filtered(
  keys: ReadonlyArray<RenInferenceKey>,
  filters: {
    status: "active" | "all"
    query: string
    ownerOf: ((key: RenInferenceKey) => string) | undefined
  },
) {
  const needle = filters.query.toLowerCase()
  return keys.filter(
    (key) =>
      (filters.status === "all" || isLive(key)) &&
      `${key.name} ${key.prefix} ${filters.ownerOf?.(key) ?? ""}`.toLowerCase().includes(needle),
  )
}

function useOwnerOf() {
  const me = useMe()
  const self = useMembers().members.find((member) => member.id === me.user.id)?.memberId
  const isAdmin = useCanAdminister()
  return isAdmin ? (key: RenInferenceKey) => (key.owner.memberId === self ? "You" : (key.owner.name ?? "—")) : undefined
}

export function InferenceKeysPage() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const ownerOf = useOwnerOf()
  const now = useNow()
  const [creating, setCreating] = useState(false)
  const period = search.period ?? "30d"
  const status = search.status ?? "active"
  const query = search.q?.trim() ?? ""
  const data = useKeyData(period)
  const update = (next: {
    key?: string | undefined
    status?: "active" | "all"
    period?: RenInference.Period
    q?: string | undefined
  }) =>
    void navigate({
      search: (previous) => ({ ...previous, ...next }),
      replace: true,
    })
  const keys = data.list.data?.keys ?? sampleKeys
  const live = keys.filter(isLive)
  return (
    <Page
      title="Inference keys"
      description="Call Ren’s models from Claude Code, Codex, scripts and other tools."
      width="wide"
      loading={data.list.isPending}
      back={
        <Link
          to="/settings/providers"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "px-0 text-muted-foreground has-[>svg]:px-0",
          })}
        >
          <IconArrowLeft />
          Back to providers
        </Link>
      }
      aside={
        <Button onClick={() => setCreating(true)}>
          <IconPlus />
          Create key
        </Button>
      }
      leading={
        <Tabs value={status} onValueChange={(value: string) => update({ status: value === "all" ? "all" : "active" })}>
          <PageTabsList aria-label="Key status">
            <PageTabsTrigger value="active" count={live.length}>
              Active
            </PageTabsTrigger>
            <PageTabsTrigger value="all" count={keys.length}>
              All
            </PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      }
      actions={
        <>
          <ToolbarSearch
            label={ownerOf ? "Search keys or owners" : "Search keys"}
            value={search.q ?? ""}
            onChange={(value) => update({ q: value || undefined })}
          />
          <PeriodSelect value={period} onChange={(value) => update({ period: value })} />
        </>
      }
    >
      {keys.length === 0 ? (
        <EmptyState
          title="No inference keys yet"
          action={
            <Button variant="outline" onClick={() => setCreating(true)}>
              <IconPlus />
              Create key
            </Button>
          }
        >
          Create a key to call Ren’s models from Claude Code, Codex or a script.
        </EmptyState>
      ) : (
        <KeysTable
          keys={filtered(keys, { status, query, ownerOf })}
          data={data}
          ownerOf={ownerOf}
          openKey={search.key}
          query={query}
          period={period}
          now={now}
          onToggle={(key) => update({ key: search.key === key.id ? undefined : key.id })}
          onClear={() => update({ q: undefined })}
        />
      )}
      {creating ? <CreateKeyDialog onClose={() => setCreating(false)} /> : null}
    </Page>
  )
}
