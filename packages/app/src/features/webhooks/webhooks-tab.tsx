import { useState } from "react"
import type { WebhookInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
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

function LastRequest(props: { webhookId: string; now: number }) {
  const { api } = RouterContext.useRouterContext()
  const latest = useQuery({
    ...api["webhook-delivery"].list.queryOptions({ webhookId: props.webhookId, page: 1, pageSize: 1 }),
    select: (page) => page.items.at(0),
  })
  if (!latest.data) return <span className="text-muted-foreground">—</span>
  return (
    <span className="text-muted-foreground">
      {formatRelative(latest.data.receivedAt, props.now)} · {Webhooks.outcomes[latest.data.outcome].label.toLowerCase()}
      {latest.data.broken ? " · broken" : ""}
    </span>
  )
}

function WebhookRow(props: { webhook: WebhookInfo; spaceId: string; owner: string; now: number }) {
  const actions = useWebhookActions()
  const webhook = props.webhook
  const live = webhook.mode === "live"
  return (
    <TableRow>
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
              className="truncate hover:underline"
            >
              {webhook.name}
            </Link>
            {webhook.modeReason ? (
              <span className="text-xs text-muted-foreground">{Webhooks.modeReasons[webhook.modeReason]}</span>
            ) : null}
          </span>
        </span>
      </TableCell>
      <TableCell>
        <LastRequest webhookId={webhook.id} now={props.now} />
      </TableCell>
      <TableCell className="text-muted-foreground">{props.owner}</TableCell>
      <TableCell>
        <Switch
          checked={live}
          disabled={!live && !Webhooks.canGoLive(webhook)}
          onCheckedChange={(checked) => void actions.setLive(webhook, { live: checked })}
          aria-label={`Start chats from ${webhook.name}`}
          title={Webhooks.canGoLive(webhook) ? undefined : "Set the signing secret first"}
        />
      </TableCell>
      <TableCell>
        <span className="flex justify-end">
          <RowMenu
            label={`${webhook.name} actions`}
            className="flex text-muted-foreground"
            items={[
              { label: "Copy URL", icon: IconCopy, onSelect: () => actions.copyUrl(webhook) },
              {
                label: "Rotate URL",
                icon: IconRefresh,
                onSelect: () => actions.rotateUrl(webhook),
                confirm: {
                  title: `Replace the URL of ${webhook.name}?`,
                  description: "The old URL stops working. Paste the new one in the other app.",
                  action: "Replace URL",
                },
              },
              {
                label: "Archive",
                icon: IconArchive,
                onSelect: () => actions.archive(webhook),
                confirm: {
                  title: `Archive ${webhook.name}?`,
                  description: "Its URL stops working. Chats it started stay.",
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

export function WebhooksTab(props: { spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const webhooks = useQuery(api.webhook.list.queryOptions(Webhooks.listInput(props.spaceId)))
  const members = useMembers()
  const now = useNow()
  const [creating, setCreating] = useState(0)
  const shapeId = useShapeId("webhooks")
  const items = webhooks.data?.items
  const ownerOf = (userId: string) => members.member(userId)?.name ?? "Someone"
  return (
    <div className="flex flex-1 flex-col gap-4">
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
        {items && items.length > 0 ? (
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
                {items.map((webhook) => (
                  <WebhookRow
                    key={webhook.id}
                    webhook={webhook}
                    spaceId={props.spaceId}
                    owner={ownerOf(webhook.ownerId)}
                    now={now}
                  />
                ))}
              </TableBody>
            </Table>
          </TableCard>
        ) : null}
      </Loading>
      <CreateSheet key={creating} open={creating > 0} spaceId={props.spaceId} onClose={() => setCreating(0)} />
    </div>
  )
}

export function AgentSelect(props: { spaceId: string; value: string; onChange: (agentId: string) => void }) {
  const { api } = RouterContext.useRouterContext()
  const agents = useQuery(
    api.agent.list.queryOptions({ page: 1, pageSize: pickerPageSize, isSubagent: false, spaceId: props.spaceId }),
  )
  const options = [
    { value: Webhooks.ren, label: "ren" },
    ...(agents.data?.items ?? [])
      .filter((agent) => agent.organizationId !== null)
      .map((agent) => ({ value: agent.id, label: agent.name })),
  ]
  return (
    <Select items={options} value={props.value} onValueChange={(value) => props.onChange(String(value))}>
      <SelectTrigger aria-label="Agent" className="w-full">
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
  const [agent, setAgent] = useState(Webhooks.ren)
  const [error, setError] = useState("")
  const save = () => {
    if (name.trim() === "") return setError("Name the webhook.")
    if (message.trim() === "") return setError("Write what the agent must do with each request.")
    setError("")
    const agentId = Webhooks.agentIdOf(agent)
    create.mutate(
      { spaceId: props.spaceId, name: name.trim(), message: message.trim(), ...(agentId && { agentId }) },
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
          <SheetDescription>A URL that starts chats in this space when another app sends a request.</SheetDescription>
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
