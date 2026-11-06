import { useState } from "react"
import type { WebhookDeliveryTested, WebhookInfo, WebhookSignature } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconArrowLeft, IconCheck, IconCode, IconCopy, IconPlus, IconX } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button, buttonVariants } from "@ren/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Tabs, TabsContent } from "@ren/ui/tabs"
import { Textarea } from "@ren/ui/textarea"
import { PageTabsList, PageTabsTrigger, Section } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMembers } from "../../lib/use-members.js"
import { Webhooks } from "../../lib/webhooks.js"
import { WebhookDeliveries } from "./webhook-deliveries.js"
import { parserOf, useWebhookForm, type Draft } from "./use-webhook-form.js"
import { WebhookFormProvider } from "./webhook-form.js"
import { useWebhookActions } from "./use-webhook-actions.js"
import { AgentSelect } from "./webhooks-tab.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/webhooks/$webhookId/")

const masked = (url: string) => `${url.slice(0, url.lastIndexOf("/") + 1)}••••••••`

export function WebhookPage() {
  const { api } = RouterContext.useRouterContext()
  const params = route.useParams()
  const webhook = useQuery(api.webhook.get.queryOptions({ idOrSlug: params.webhookId }))
  if (!webhook.data) return null
  return (
    <WebhookFormProvider key={webhook.data.id} webhook={webhook.data}>
      <WebhookView webhook={webhook.data} spaceId={params.spaceId} />
    </WebhookFormProvider>
  )
}

function WebhookView(props: { webhook: WebhookInfo; spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const form = useWebhookForm()
  const actions = useWebhookActions()
  const update = useMutation(api.webhook.update.mutationOptions())
  const total = useQuery({
    ...api["webhook-delivery"].list.queryOptions({ webhookId: props.webhook.id, page: 1, pageSize: 1 }),
    select: (page) => page.total,
  })
  const webhook = props.webhook
  const live = webhook.mode === "live"
  const save = () => {
    const draft = form.state.draft
    const parser = parserOf(draft)
    const agentId = Webhooks.agentIdOf(draft.agent) ?? null
    update.mutate(
      {
        id: webhook.id,
        ...(draft.message.trim() !== webhook.message && { message: draft.message.trim() }),
        ...(agentId !== webhook.agentId && { agentId }),
        ...(JSON.stringify(parser) !== JSON.stringify(webhook.parser) && { parser }),
      },
      {
        onSuccess: (saved) => {
          form.actions.reset(saved)
          toast.success("Webhook saved")
        },
        onError: (error) => toast.error("Couldn’t save the webhook", { description: errorMessage(error) }),
      },
    )
  }
  return (
    <div className="flex flex-1 flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/spaces/$spaceId/webhooks"
            params={{ spaceId: props.spaceId }}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <IconArrowLeft data-icon="inline-start" />
            Webhooks
          </Link>
          <h2 className="truncate text-base font-medium">{webhook.name}</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden>Listening</span>
            <Switch
              checked={live}
              disabled={!live && !Webhooks.canGoLive(webhook)}
              onCheckedChange={(checked) => void actions.setLive(webhook, { live: checked })}
              aria-label={`Start chats from ${webhook.name}`}
            />
            <span aria-hidden>Live</span>
          </span>
          <Button onClick={save} disabled={!form.state.changed || update.isPending}>
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </div>
      </header>
      {webhook.modeReason ? (
        <p className="text-sm text-muted-foreground">{Webhooks.modeReasons[webhook.modeReason]}</p>
      ) : null}
      <Tabs
        value={search.tab ?? "setup"}
        onValueChange={(tab) =>
          void navigate({ search: (previous) => ({ ...previous, tab: tab === "deliveries" ? "deliveries" : "setup" }) })
        }
      >
        <PageTabsList>
          <PageTabsTrigger value="setup">Setup</PageTabsTrigger>
          <PageTabsTrigger value="deliveries" count={total.data}>
            Deliveries
          </PageTabsTrigger>
        </PageTabsList>
        <TabsContent value="setup" className="pt-4">
          <WebhookSetup webhook={webhook} spaceId={props.spaceId} />
        </TabsContent>
        <TabsContent value="deliveries" className="pt-4">
          <WebhookDeliveries webhook={webhook} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function WebhookSetup(props: { webhook: WebhookInfo; spaceId: string }) {
  const form = useWebhookForm()
  const draft = form.state.draft
  const webhook = props.webhook
  const owner = useMembers().member(webhook.ownerId)?.name ?? "Someone"
  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <UrlSection webhook={webhook} />
      <Section title="Signature" description="How Ren checks that a request comes from the other app.">
        <SignatureFields signature={draft.signature} onChange={(signature) => form.actions.set({ signature })} />
        <SigningSecret webhook={webhook} />
      </Section>
      <Section title="Chats" description="What each request asks, and who runs it.">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="webhook-message">Message</FieldLabel>
            <Textarea
              id="webhook-message"
              value={draft.message}
              onChange={(event) => form.actions.set({ message: event.target.value })}
              className="max-h-60 min-h-20"
            />
          </Field>
          <Field>
            <FieldLabel>Agent</FieldLabel>
            <AgentSelect
              spaceId={props.spaceId}
              value={draft.agent}
              onChange={(agent) => form.actions.set({ agent })}
            />
            <FieldDescription>
              Runs as {owner}. Saving a new message, parser or agent makes you the owner.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </Section>
      <Section title="Parser" description="Which requests start a chat, and which go into the same chat.">
        <ParserFields draft={draft} />
        <TestParser webhook={webhook} />
      </Section>
    </div>
  )
}

function UrlSection(props: { webhook: WebhookInfo }) {
  const actions = useWebhookActions()
  return (
    <Section title="URL" description="Paste it in the other app. It holds a token, so treat it like a password.">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
          {masked(props.webhook.url)}
        </code>
        <Button variant="outline" onClick={() => void actions.copyUrl(props.webhook)}>
          <IconCopy data-icon="inline-start" />
          Copy URL
        </Button>
        <Button variant="ghost" onClick={() => void actions.rotateUrl(props.webhook)}>
          Rotate URL
        </Button>
      </div>
    </Section>
  )
}

const signatureOf = (kind: string, previous: WebhookSignature): WebhookSignature => {
  const header = "header" in previous ? previous.header : "x-ren-secret"
  if (kind === "header") return { kind: "header", header }
  if (kind === "hmac") return { kind: "hmac", header, encoding: "hex" }
  if (kind === "standard") return { kind: "standard" }
  if (kind === "stripe") return { kind: "stripe" }
  return { kind: "none" }
}

function SignatureFields(props: { signature: WebhookSignature; onChange: (signature: WebhookSignature) => void }) {
  const signature = props.signature
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Check</FieldLabel>
        <Select
          items={Webhooks.signatureKinds}
          value={signature.kind}
          onValueChange={(kind) => props.onChange(signatureOf(String(kind), signature))}
        >
          <SelectTrigger aria-label="Check" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {Webhooks.signatureKinds.map((kind) => (
                <SelectItem key={kind.value} value={kind.value}>
                  {kind.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {signature.kind === "header" || signature.kind === "hmac" ? (
        <Field>
          <FieldLabel htmlFor="webhook-header">Header</FieldLabel>
          <Input
            id="webhook-header"
            value={signature.header}
            onChange={(event) => props.onChange({ ...signature, header: event.target.value.toLowerCase() })}
            placeholder="x-hub-signature-256"
          />
        </Field>
      ) : null}
      {signature.kind === "hmac" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>Encoding</FieldLabel>
            <Select
              items={[
                { value: "hex", label: "Hex" },
                { value: "base64", label: "Base64" },
              ]}
              value={signature.encoding}
              onValueChange={(encoding) =>
                props.onChange({ ...signature, encoding: encoding === "base64" ? "base64" : "hex" })
              }
            >
              <SelectTrigger aria-label="Encoding" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="hex">Hex</SelectItem>
                  <SelectItem value="base64">Base64</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="webhook-prefix">Prefix</FieldLabel>
            <Input
              id="webhook-prefix"
              value={signature.prefix ?? ""}
              onChange={(event) => {
                const prefix = event.target.value
                props.onChange(
                  prefix
                    ? { ...signature, prefix }
                    : { kind: "hmac", header: signature.header, encoding: signature.encoding },
                )
              }}
              placeholder="sha256="
            />
          </Field>
        </div>
      ) : null}
    </FieldGroup>
  )
}

function SigningSecret(props: { webhook: WebhookInfo }) {
  const { api } = RouterContext.useRouterContext()
  const reveal = useMutation(api.webhook.revealSigningSecret.mutationOptions())
  const set = useMutation(api.webhook.setSigningSecret.mutationOptions())
  const [shown, setShown] = useState<string>()
  const [replacing, setReplacing] = useState(false)
  const [pasted, setPasted] = useState("")
  const replace = (secret: string | undefined) =>
    set.mutate(
      { id: props.webhook.id, ...(secret && { secret }) },
      {
        onSuccess: (result) => {
          setReplacing(false)
          setPasted("")
          setShown(secret ? undefined : result.secret)
          toast.success(secret ? "Signing secret saved" : "Signing secret made. Copy it into the other app.")
        },
        onError: (error) => toast.error("Couldn’t set the signing secret", { description: errorMessage(error) }),
      },
    )
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Signing secret</span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {props.webhook.hasSigningSecret ? (
          <span className="flex items-center gap-1.5">
            <IconCheck className="size-4" />
            Set
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <IconX className="size-4" />
            Not set
          </span>
        )}
        {props.webhook.hasSigningSecret ? (
          <Button
            variant="outline"
            size="sm"
            disabled={reveal.isPending}
            onClick={() =>
              reveal.mutate(
                { id: props.webhook.id },
                {
                  onSuccess: (result) => setShown(result.secret),
                  onError: (error) => toast.error("Couldn’t show the secret", { description: errorMessage(error) }),
                },
              )
            }
          >
            Reveal
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
          {props.webhook.hasSigningSecret ? "Replace" : "Set secret"}
        </Button>
      </div>
      {shown ? (
        <code className="rounded-md border bg-muted/40 px-3 py-1.5 text-sm break-all select-all">{shown}</code>
      ) : null}
      <Dialog open={replacing} onOpenChange={setReplacing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set the signing secret</DialogTitle>
            <DialogDescription>
              Paste the secret that the other app shows, or let Ren make one to paste there.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="webhook-secret">Secret</FieldLabel>
            <Input
              id="webhook-secret"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder="whsec_…"
              autoComplete="off"
            />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button variant="outline" disabled={set.isPending} onClick={() => replace(undefined)}>
              Make one
            </Button>
            <Button disabled={set.isPending || pasted.trim() === ""} onClick={() => replace(pasted.trim())}>
              Save secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ParserFields(props: { draft: Draft }) {
  const form = useWebhookForm()
  const draft = props.draft
  const conditions = draft.conditions
  const setCondition = (index: number, patch: Partial<Webhooks.Condition>) =>
    form.actions.set({
      conditions: conditions?.map((condition, at) => (at === index ? { ...condition, ...patch } : condition)),
    })
  return (
    <FieldGroup>
      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel>Start a chat when</FieldLabel>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              form.actions.set(
                conditions
                  ? { conditions: undefined, filter: Webhooks.celOf(conditions) }
                  : { conditions: Webhooks.conditionsOf(draft.filter) ?? conditions },
              )
            }
            disabled={!conditions && Webhooks.conditionsOf(draft.filter) === undefined}
          >
            <IconCode data-icon="inline-start" />
            {conditions ? "Edit as CEL" : "Edit as rows"}
          </Button>
        </div>
        {conditions ? (
          <div className="flex flex-col gap-2">
            {conditions.map((condition, index) => (
              <ConditionRow
                key={condition.id}
                condition={condition}
                index={index}
                onChange={(patch) => setCondition(index, patch)}
                onRemove={() => form.actions.set({ conditions: conditions.filter((each) => each.id !== condition.id) })}
              />
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                form.actions.set({
                  conditions: [...conditions, { id: crypto.randomUUID(), path: "", operator: "is", value: "" }],
                })
              }
            >
              <IconPlus data-icon="inline-start" />
              Add condition
            </Button>
          </div>
        ) : (
          <Textarea
            aria-label="Filter as CEL"
            value={draft.filter}
            onChange={(event) => form.actions.set({ filter: event.target.value })}
            className="min-h-16 font-mono text-sm"
            placeholder="has(body.event)"
          />
        )}
      </Field>
      <PathField
        id="webhook-thread-key"
        label="Same chat when"
        value={draft.threadKey}
        placeholder="body.person.properties.email"
        onChange={(threadKey) => form.actions.set({ threadKey })}
      />
      <PathField
        id="webhook-event-id"
        label="Duplicate ID"
        value={draft.eventId}
        placeholder="body.event.uuid"
        onChange={(eventId) => form.actions.set({ eventId })}
      />
      <PathField
        id="webhook-title"
        label="Title"
        value={draft.title}
        placeholder="body.person.properties.email"
        onChange={(title) => form.actions.set({ title })}
      />
      <PathField
        id="webhook-handshake"
        label="Handshake"
        value={draft.handshake}
        placeholder="has(query.validationToken) ? … : null"
        onChange={(handshake) => form.actions.set({ handshake })}
      />
    </FieldGroup>
  )
}

function ConditionRow(props: {
  condition: Webhooks.Condition
  index: number
  onChange: (patch: Partial<Webhooks.Condition>) => void
  onRemove: () => void
}) {
  const condition = props.condition
  const number = props.index + 1
  return (
    <div className="grid grid-cols-[1fr_9rem_1fr_auto] gap-2">
      <Input
        aria-label={`Path ${number}`}
        value={condition.path}
        onChange={(event) => props.onChange({ path: event.target.value })}
        placeholder="body.event.event"
      />
      <Select
        items={Webhooks.operators.map((operator) => ({ value: operator, label: operator }))}
        value={condition.operator}
        onValueChange={(operator) => {
          const found = Webhooks.operators.find((each) => each === operator)
          if (found) props.onChange({ operator: found })
        }}
      >
        <SelectTrigger aria-label={`Operator ${number}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {Webhooks.operators.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {operator}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Input
        aria-label={`Value ${number}`}
        value={condition.value}
        disabled={condition.operator === "exists"}
        onChange={(event) => props.onChange({ value: event.target.value })}
        placeholder={condition.operator === "is one of" ? "opened, ready_for_review" : "user signed up"}
      />
      <Button variant="ghost" size="icon" aria-label={`Remove condition ${number}`} onClick={props.onRemove}>
        <IconX />
      </Button>
    </div>
  )
}

function PathField(props: {
  id: string
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="font-mono text-sm"
      />
    </Field>
  )
}

const summaryOf = (items: ReadonlyArray<WebhookDeliveryTested>) => {
  const broken = items.filter((item) => item.broken).length
  const starts = items.filter((item) => item.outcome === "started" || item.outcome === "continued").length
  const ignored = items.filter((item) => item.outcome === "ignored" && !item.broken).length
  return `${ignored} ignored · ${starts} would start or continue a chat · ${broken} broken`
}

function TestParser(props: { webhook: WebhookInfo }) {
  const { api } = RouterContext.useRouterContext()
  const form = useWebhookForm()
  const test = useMutation(api["webhook-parser"]["webhook-delivery"].test.mutationOptions())
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        disabled={test.isPending}
        onClick={() => test.mutate({ webhookId: props.webhook.id, parser: form.meta.parser })}
      >
        {test.isPending ? <Spinner data-icon="inline-start" /> : null}
        Test on the last 20 requests
      </Button>
      {test.data ? <span className="text-sm text-muted-foreground">{summaryOf(test.data.items)}</span> : null}
      {test.error ? <FieldError>{errorMessage(test.error)}</FieldError> : null}
    </div>
  )
}
