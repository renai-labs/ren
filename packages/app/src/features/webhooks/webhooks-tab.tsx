import { useState } from "react"
import type { AppInfo, WebhookInfo } from "@ren/client"
import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { IconAlertTriangle, IconArchive, IconCopy, IconPlus, IconRefresh, IconWebhook } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Loading } from "@ren/ui/loading"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@ren/ui/sheet"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Textarea } from "@ren/ui/textarea"
import { formatRelative } from "@ren/ui/time"
import { EmptyState } from "../../components/empty-state.js"
import { TableCard, TableSample, useShapeId } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { errorMessage } from "../../lib/errors.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMembers } from "../../lib/use-members.js"
import { useNow } from "../../lib/use-now.js"
import { Webhooks } from "../../lib/webhooks.js"
import { useWebhookActions } from "./use-webhook-actions.js"

const nameOf = (webhook: WebhookInfo) => (webhook.preset ? `${webhook.preset.appName} · ${webhook.name}` : webhook.name)

function LastRequest(props: { webhook: WebhookInfo; now: number }) {
  const last = props.webhook.lastRequest
  if (!last) return <span className="text-muted-foreground">—</span>
  return (
    <span className="text-muted-foreground">
      {formatRelative(last.receivedAt, props.now)} · {Webhooks.outcomes[last.outcome].label.toLowerCase()}
      {last.broken ? " · broken" : ""}
    </span>
  )
}

function WebhookRow(props: { webhook: WebhookInfo; spaceId: string; owner: string; now: number }) {
  const actions = useWebhookActions()
  const webhook = props.webhook
  const live = webhook.mode === "live"
  const name = nameOf(webhook)
  return (
    <TableRow className="relative cursor-pointer">
      <TableCell className="max-w-80">
        <span className="flex min-w-0 items-start gap-2.5">
          {webhook.modeReason ? (
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Needs attention" />
          ) : (
            <IconWebhook className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex min-w-0 flex-col gap-0.5">
            <Link
              to="/spaces/$spaceId/webhooks/$webhookId"
              params={{ spaceId: props.spaceId, webhookId: webhook.id }}
              className="truncate outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
            >
              {name}
            </Link>
            {webhook.modeReason ? (
              <span className="text-xs text-muted-foreground">{Webhooks.modeReasons[webhook.modeReason]}</span>
            ) : null}
          </span>
        </span>
      </TableCell>
      <TableCell>
        <LastRequest webhook={webhook} now={props.now} />
      </TableCell>
      <TableCell className="text-muted-foreground">{props.owner}</TableCell>
      <TableCell>
        <Switch
          checked={live}
          disabled={!live && !Webhooks.canGoLive(webhook)}
          onCheckedChange={(checked) => void actions.setLive(webhook, { live: checked })}
          aria-label={`Make ${name} live`}
          title={Webhooks.canGoLive(webhook) ? undefined : "Set the signing secret first"}
          className="relative"
        />
      </TableCell>
      <TableCell>
        <span className="relative flex justify-end">
          <RowMenu
            label={`${name} actions`}
            className="flex text-muted-foreground"
            items={[
              { label: "Copy URL", icon: IconCopy, onSelect: () => actions.copyUrl(webhook) },
              {
                label: "Rotate URL",
                icon: IconRefresh,
                onSelect: () => actions.rotateUrl(webhook),
                confirm: {
                  title: `Replace the URL of ${name}?`,
                  description: "The old URL stops working. Paste the new one in the other app.",
                  action: "Replace URL",
                },
              },
              {
                label: "Archive",
                icon: IconArchive,
                onSelect: () => actions.archive(webhook),
                confirm: {
                  title: `Archive ${name}?`,
                  description: "Its URL stops working. Sessions it started stay.",
                  action: "Archive",
                },
              },
            ]}
          />
        </span>
      </TableCell>
    </TableRow>
  )
}

function PresetRow(props: { app: AppInfo; preset: string; turnedOn: WebhookInfo | undefined; spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const create = useMutation(api.webhook.create.mutationOptions())
  const actions = useWebhookActions()
  const found = props.app.webhooks?.[props.preset]
  if (!found) return null
  const label = `${props.app.name} · ${found.name}`
  const turnOn = () =>
    create.mutate(
      { spaceId: props.spaceId, source: { _tag: "preset", appId: props.app.id, preset: props.preset } },
      {
        onSuccess: (created) =>
          void navigate({
            to: "/spaces/$spaceId/webhooks/$webhookId",
            params: { spaceId: props.spaceId, webhookId: created.id },
          }),
        onError: (error) => toast.error(`Couldn’t turn on ${label}`, { description: errorMessage(error) }),
      },
    )
  return (
    <TableRow className={props.turnedOn ? "relative cursor-pointer" : undefined}>
      <TableCell className="max-w-64 truncate">
        {props.turnedOn ? (
          <Link
            to="/spaces/$spaceId/webhooks/$webhookId"
            params={{ spaceId: props.spaceId, webhookId: props.turnedOn.id }}
            className="outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            {label}
          </Link>
        ) : (
          label
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{found.description}</TableCell>
      <TableCell>
        <span className="relative flex items-center justify-end gap-2">
          <Switch
            checked={Boolean(props.turnedOn)}
            disabled={create.isPending}
            onCheckedChange={(checked) => {
              if (checked) return turnOn()
              if (props.turnedOn) void actions.archive(props.turnedOn)
            }}
            aria-label={`Turn on ${label}`}
          />
        </span>
      </TableCell>
    </TableRow>
  )
}

function FromApps(props: { spaceId: string; webhooks: ReadonlyArray<WebhookInfo> }) {
  const { api } = RouterContext.useRouterContext()
  const profiles = useQuery(
    api["app-profile"].list.queryOptions({ spaceId: props.spaceId, page: 1, pageSize: pickerPageSize }),
  )
  const appIds = [...new Set((profiles.data?.items ?? []).map((profile) => profile.appId))]
  const apps = useQueries({ queries: appIds.map((id) => api.app.get.queryOptions({ idOrSlug: id })) })
  const presets = apps.flatMap((result) =>
    result.data ? Object.keys(result.data.webhooks ?? {}).map((preset) => ({ app: result.data, preset })) : [],
  )
  const turnedOn = new Map(
    props.webhooks.flatMap((webhook) =>
      webhook.preset ? [[`${webhook.preset.appId}/${webhook.preset.preset}`, webhook] as const] : [],
    ),
  )
  if (presets.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">From apps</h2>
      <TableCard>
        <Table>
          <TableBody>
            {presets.map((entry) => (
              <PresetRow
                key={`${entry.app.id}/${entry.preset}`}
                app={entry.app}
                preset={entry.preset}
                spaceId={props.spaceId}
                turnedOn={turnedOn.get(`${entry.app.id}/${entry.preset}`)}
              />
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  )
}

function WebhookTable(props: { webhooks: ReadonlyArray<WebhookInfo>; spaceId: string }) {
  const members = useMembers()
  const now = useNow()
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Last request</TableHead>
            <TableHead>Runs as</TableHead>
            <TableHead>Live</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              webhook={webhook}
              spaceId={props.spaceId}
              owner={members.member(webhook.ownerId)?.name ?? "Someone"}
              now={now}
            />
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

export function WebhooksTab(props: { spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const webhooks = useQuery({
    ...api.webhook.list.queryOptions(Webhooks.listInput(props.spaceId)),
    refetchInterval: Webhooks.refreshEvery,
  })
  const [creating, setCreating] = useState(0)
  const shapeId = useShapeId("webhooks")
  const items = webhooks.data?.items
  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-end gap-1">
          <Button onClick={() => setCreating((previous) => previous + 1)}>
            <IconPlus data-icon="inline-start" />
            Create webhook
          </Button>
        </div>
        <Loading id={shapeId} loading={!items} label="Loading webhooks">
          {items ? null : <TableSample columns={["Name", "Last request", "Runs as", "Live", ""]} />}
          {items?.length === 0 ? (
            <EmptyState title="No webhooks yet">Create one, or ask Ren to connect an app.</EmptyState>
          ) : null}
          {items && items.length > 0 ? <WebhookTable webhooks={items} spaceId={props.spaceId} /> : null}
        </Loading>
      </div>
      {items ? <FromApps spaceId={props.spaceId} webhooks={items} /> : null}
      <CreateSheet key={creating} open={creating > 0} spaceId={props.spaceId} onClose={() => setCreating(0)} />
    </div>
  )
}

export function AgentSelect(props: {
  spaceId: string
  value: string
  onChange: (agentId: string) => void
  className?: string
}) {
  const { api } = RouterContext.useRouterContext()
  const agents = useQuery(
    api.agent.list.queryOptions({ page: 1, pageSize: pickerPageSize, isSubagent: false, spaceId: props.spaceId }),
  )
  const options = [
    { value: Webhooks.defaultAgent, label: "Space default" },
    ...(agents.data?.items ?? [])
      .filter((agent) => agent.organizationId !== null)
      .map((agent) => ({ value: agent.id, label: agent.name })),
  ]
  return (
    <Select items={options} value={props.value} onValueChange={(value) => props.onChange(String(value))}>
      <SelectTrigger aria-label="Agent" className={props.className ?? "w-full"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function CreateSheet(props: { open: boolean; spaceId: string; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const create = useMutation(api.webhook.create.mutationOptions())
  const [name, setName] = useState("")
  const [message, setMessage] = useState("")
  const [agent, setAgent] = useState(Webhooks.defaultAgent)
  const [error, setError] = useState("")
  const save = () => {
    if (name.trim() === "") return setError("Name the webhook.")
    if (message.trim() === "") return setError("Write what the agent must do with each request.")
    setError("")
    const agentId = Webhooks.agentIdOf(agent)
    create.mutate(
      {
        spaceId: props.spaceId,
        source: { _tag: "custom", name: name.trim(), message: message.trim() },
        ...(agentId && { agentId }),
      },
      {
        onSuccess: (created) => {
          props.onClose()
          toast.success("Webhook created. It records requests until you turn it on.")
          void navigate({
            to: "/spaces/$spaceId/webhooks/$webhookId",
            params: { spaceId: props.spaceId, webhookId: created.id },
          })
        },
        onError: (failure) => setError(errorMessage(failure)),
      },
    )
  }
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create webhook</SheetTitle>
          <SheetDescription>
            A URL that starts sessions in this space when another app sends a request.
          </SheetDescription>
        </SheetHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <FieldGroup className="flex-1 gap-6 overflow-y-auto overscroll-contain px-4 pb-4">
            <Field>
              <FieldLabel htmlFor="webhook-name">Name</FieldLabel>
              <Input
                id="webhook-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="PostHog signups"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="webhook-message">Message</FieldLabel>
              <Textarea
                id="webhook-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Research this person’s company and post a summary."
                className="max-h-60 min-h-24"
              />
            </Field>
            <Field>
              <FieldLabel>Agent</FieldLabel>
              <AgentSelect spaceId={props.spaceId} value={agent} onChange={setAgent} />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <SheetFooter>
            <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              Create webhook
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
