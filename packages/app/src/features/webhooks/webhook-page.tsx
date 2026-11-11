import { useState } from "react"
import type { WebhookInfo, WebhookSignature, WebhookTested } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconArrowLeft, IconCode, IconCopy, IconPlus, IconX } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button, buttonVariants } from "@ren/ui/button"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Field, FieldError, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Tabs, TabsContent } from "@ren/ui/tabs"
import { Textarea } from "@ren/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { formatDate } from "@ren/ui/time"
import { Page, PageTabsList, PageTabsTrigger, Row, Rows, Section } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { Webhooks } from "../../lib/webhooks.js"
import { WebhookRequests } from "./webhook-requests.js"
import { parserOf, useWebhookForm, type Draft } from "./use-webhook-form.js"
import { WebhookFormProvider } from "./webhook-form.js"
import { useWebhookActions } from "./use-webhook-actions.js"
import { AgentSelect } from "./webhooks-tab.js"
import { Equal } from "effect"

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
    ...api["webhook-request"].list.queryOptions({
      webhookId: props.webhook.id,
      page: 1,
      pageSize: 1,
    }),
    select: (page) => page.total,
    refetchInterval: Webhooks.refreshEvery,
  })
  const webhook = props.webhook
  const live = webhook.mode === "live"
  const name = webhook.preset ? `${webhook.preset.appName} · ${webhook.name}` : webhook.name
  const save = () => {
    const draft = form.state.draft
    const parser = parserOf(draft)
    const agentId = Webhooks.agentIdOf(draft.agent) ?? null
    update.mutate(
      {
        id: webhook.id,
        ...((agentId !== webhook.agentId || draft.runAsMe) && { agentId }),
        ...(!webhook.preset && {
          ...(draft.message.trim() !== webhook.message && {
            message: draft.message.trim(),
          }),
          ...(!Equal.equals(parser, webhook.parser) && {
            parser,
          }),
        }),
      },
      {
        onSuccess: (saved) => {
          form.actions.reset(saved)
          toast.success("Webhook saved")
        },
        onError: (error) =>
          toast.error("Couldn’t save the webhook", {
            description: errorMessage(error),
          }),
      },
    )
  }
  return (
    <Page
      title={name}
      description={webhook.modeReason ? Webhooks.modeReasons[webhook.modeReason] : undefined}
      back={
        <Link
          to="/spaces/$spaceId/webhooks"
          params={{ spaceId: props.spaceId }}
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "px-0 text-muted-foreground has-[>svg]:px-0",
          })}
        >
          <IconArrowLeft />
          Back to webhooks
        </Link>
      }
      aside={
        <>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden>Debug</span>
            <Switch
              checked={live}
              disabled={!live && !Webhooks.canGoLive(webhook)}
              onCheckedChange={(checked) => void actions.setLive(webhook, { live: checked })}
              aria-label={`Make ${name} live`}
            />
            <span aria-hidden>Live</span>
          </span>
          <Button onClick={save} disabled={!form.state.changed || update.isPending}>
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </>
      }
    >
      <Tabs
        value={search.tab ?? "setup"}
        onValueChange={(tab) =>
          void navigate({
            search: (previous) => ({
              ...previous,
              tab: tab === "requests" ? "requests" : "setup",
            }),
          })
        }
      >
        <PageTabsList>
          <PageTabsTrigger value="setup">Setup</PageTabsTrigger>
          <PageTabsTrigger value="requests" count={total.data}>
            Requests
          </PageTabsTrigger>
        </PageTabsList>
        <TabsContent value="setup" className="pt-6">
          <WebhookSetup webhook={webhook} spaceId={props.spaceId} />
        </TabsContent>
        <TabsContent value="requests" className="pt-6">
          <WebhookRequests webhook={webhook} />
        </TabsContent>
      </Tabs>
    </Page>
  )
}

function WebhookSetup(props: { webhook: WebhookInfo; spaceId: string }) {
  const form = useWebhookForm()
  const draft = form.state.draft
  const webhook = props.webhook
  const preset = webhook.preset
  return (
    <div className="flex flex-col gap-10">
      <UrlSection webhook={webhook} />
      {preset ? (
        <Section
          title="Setup"
          description={`Updated by ${preset.appName} on ${formatDate(preset.updatedAt)}. The app keeps the message and the parser.`}
        >
          <p className="text-sm whitespace-pre-wrap">{preset.setup ?? "The app no longer has this preset."}</p>
        </Section>
      ) : null}
      <SignatureSection webhook={webhook} />
      <Section title="Message" description="What each new session asks the agent.">
        <Textarea
          aria-label="Message"
          value={draft.message}
          readOnly={Boolean(preset)}
          onChange={(event) => form.actions.set({ message: event.target.value })}
          className="max-h-60 min-h-24"
        />
      </Section>
      <Section title="Sessions" description="Who runs the sessions this webhook starts.">
        <Rows>
          {[
            <Row key="agent" title="Agent">
              <AgentSelect
                spaceId={props.spaceId}
                value={draft.agent}
                onChange={(agent) => form.actions.set({ agent })}
                className="w-56"
              />
            </Row>,
            <RunsAs key="runs-as" webhook={webhook} />,
          ]}
        </Rows>
      </Section>
      <Section title="Parser" description="Which requests start a session, and which continue one.">
        {preset ? (
          <CodeBlock size="sm">
            <CodeBlockContent wrap>{JSON.stringify(webhook.parser, null, 2)}</CodeBlockContent>
          </CodeBlock>
        ) : (
          <ParserFields draft={draft} />
        )}
        <TestParser webhook={webhook} />
      </Section>
    </div>
  )
}

function RunsAs(props: { webhook: WebhookInfo }) {
  const form = useWebhookForm()
  const members = useMembers()
  const me = useMe().user
  const webhook = props.webhook
  const owner = members.member(webhook.ownerId)?.name ?? "Someone"
  const isMine = webhook.ownerId === me.id
  const options = [{ value: "owner", label: owner }, ...(isMine ? [] : [{ value: "me", label: "Use me instead" }])]
  const picker = (
    <Select
      items={options}
      value={form.state.draft.runAsMe ? "me" : "owner"}
      onValueChange={(value) => form.actions.set({ runAsMe: value === "me" })}
      disabled={isMine}
    >
      <SelectTrigger aria-label="Runs as" className="w-56">
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
  return (
    <Row
      title="Runs as"
      description={
        form.state.draft.runAsMe
          ? "Save to run it as you."
          : `If ${owner} leaves the space, the webhook stops and keeps its requests.`
      }
    >
      {isMine ? (
        <Tooltip>
          <TooltipTrigger render={<div />}>{picker}</TooltipTrigger>
          <TooltipContent side="left">You can only set yourself.</TooltipContent>
        </Tooltip>
      ) : (
        picker
      )}
    </Row>
  )
}

function UrlSection(props: { webhook: WebhookInfo }) {
  const actions = useWebhookActions()
  return (
    <Section title="URL" description="Paste it in the other app. It holds a token, so treat it like a password.">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-card px-3 py-1.5 font-mono text-sm">
          {masked(props.webhook.url)}
        </code>
        <Button variant="outline" onClick={() => void actions.copyUrl(props.webhook)}>
          <IconCopy data-icon="inline-start" />
          Copy URL
        </Button>
        <Button variant="outline" onClick={() => void actions.rotateUrl(props.webhook)}>
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

function SignatureSection(props: { webhook: WebhookInfo }) {
  const form = useWebhookForm()
  const webhook = props.webhook
  const signature = form.state.draft.signature
  const set = (next: WebhookSignature) => form.actions.set({ signature: next })
  const label = Webhooks.signatureKinds.find((kind) => kind.value === signature.kind)?.label
  return (
    <Section title="Signature" description="How Ren checks that a request comes from the other app.">
      <Rows>
        {[
          <Row key="check" title="Check">
            {webhook.preset ? (
              <span className="text-sm text-muted-foreground">{label}</span>
            ) : (
              <Select
                items={Webhooks.signatureKinds}
                value={signature.kind}
                onValueChange={(kind) => set(signatureOf(String(kind), signature))}
              >
                <SelectTrigger aria-label="Check" className="w-56">
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
            )}
          </Row>,
          ...(!webhook.preset && (signature.kind === "header" || signature.kind === "hmac")
            ? [
                <Row key="header" title="Header" description="The request header that carries the secret or signature.">
                  <Input
                    aria-label="Header"
                    value={signature.header}
                    onChange={(event) =>
                      set({
                        ...signature,
                        header: event.target.value.toLowerCase(),
                      })
                    }
                    placeholder="x-hub-signature-256"
                    className="w-56 font-mono"
                  />
                </Row>,
              ]
            : []),
          ...(!webhook.preset && signature.kind === "hmac"
            ? [
                <Row key="encoding" title="Encoding">
                  <Select
                    items={[
                      { value: "hex", label: "Hex" },
                      { value: "base64", label: "Base64" },
                    ]}
                    value={signature.encoding}
                    onValueChange={(encoding) =>
                      set({
                        ...signature,
                        encoding: encoding === "base64" ? "base64" : "hex",
                      })
                    }
                  >
                    <SelectTrigger aria-label="Encoding" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="hex">Hex</SelectItem>
                        <SelectItem value="base64">Base64</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Row>,
                <Row key="prefix" title="Prefix" description="Text before the signature in the header.">
                  <Input
                    aria-label="Prefix"
                    value={signature.prefix ?? ""}
                    onChange={(event) => {
                      const prefix = event.target.value
                      set(
                        prefix
                          ? { ...signature, prefix }
                          : {
                              kind: "hmac",
                              header: signature.header,
                              encoding: signature.encoding,
                            },
                      )
                    }}
                    placeholder="sha256="
                    className="w-56 font-mono"
                  />
                </Row>,
              ]
            : []),
          <SigningSecret key="secret" webhook={webhook} />,
        ]}
      </Rows>
    </Section>
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
        onError: (error) =>
          toast.error("Couldn’t set the signing secret", {
            description: errorMessage(error),
          }),
      },
    )
  const status = props.webhook.hasSigningSecret ? "Set" : "Not set"
  return (
    <Row
      title="Signing secret"
      description={shown ? <code className="font-mono break-all text-foreground select-all">{shown}</code> : status}
    >
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
                onError: (error) =>
                  toast.error("Couldn’t show the secret", {
                    description: errorMessage(error),
                  }),
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
    </Row>
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
    <>
      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex min-h-8 items-center justify-between gap-4">
          <span className="text-sm font-medium">Start a session when</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              form.actions.set(
                conditions
                  ? {
                      conditions: undefined,
                      filter: Webhooks.celOf(conditions),
                    }
                  : {
                      conditions: Webhooks.conditionsOf(draft.filter) ?? conditions,
                    },
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
            {conditions.length === 0 ? (
              <p className="text-xs text-muted-foreground">Every request starts or continues a session.</p>
            ) : null}
            {conditions.map((condition, index) => (
              <ConditionRow
                key={condition.id}
                condition={condition}
                index={index}
                onChange={(patch) => setCondition(index, patch)}
                onRemove={() =>
                  form.actions.set({
                    conditions: conditions.filter((each) => each.id !== condition.id),
                  })
                }
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                form.actions.set({
                  conditions: [
                    ...conditions,
                    {
                      id: crypto.randomUUID(),
                      path: "",
                      operator: "is",
                      value: "",
                    },
                  ],
                })
              }
            >
              <IconPlus data-icon="inline-start" />
              Add condition
            </Button>
          </div>
        ) : (
          <Textarea
            aria-label="Start a session when, as CEL"
            value={draft.filter}
            onChange={(event) => form.actions.set({ filter: event.target.value })}
            className="min-h-16 font-mono text-sm"
            placeholder="has(body.event)"
          />
        )}
      </div>
      <Rows>
        {[
          <PathRow
            key="thread-key"
            title="Session continuation key"
            description="Requests with the same value go into one session."
            value={draft.threadKey}
            placeholder="body.person.properties.email"
            onChange={(threadKey) => form.actions.set({ threadKey })}
          />,
          <PathRow
            key="event-id"
            title="Event identifier"
            description="Ren skips a request whose identifier it has already seen."
            value={draft.eventId}
            placeholder="body.event.uuid"
            onChange={(eventId) => form.actions.set({ eventId })}
          />,
          <PathRow
            key="title"
            title="Session title"
            value={draft.title}
            placeholder="body.person.properties.email"
            onChange={(title) => form.actions.set({ title })}
          />,
          <PathRow
            key="handshake"
            title="Verification reply"
            description="The answer for apps that check the URL before they send events."
            value={draft.handshake}
            placeholder="has(query.validationToken) ? … : null"
            onChange={(handshake) => form.actions.set({ handshake })}
          />,
        ]}
      </Rows>
    </>
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
        items={Webhooks.operators.map((operator) => ({
          value: operator,
          label: operator,
        }))}
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

function PathRow(props: {
  title: string
  description?: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <Row title={props.title} description={props.description}>
      <Input
        aria-label={props.title}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="w-72 font-mono"
      />
    </Row>
  )
}

const summaryOf = (items: ReadonlyArray<WebhookTested>) => {
  const broken = items.filter((item) => item.broken).length
  const passed = items.filter((item) => item.outcome === "passed").length
  const ignored = items.filter((item) => item.outcome === "ignored" && !item.broken).length
  return `${ignored} ignored · ${passed} would start a session · ${broken} broken`
}

function TestParser(props: { webhook: WebhookInfo }) {
  const { api } = RouterContext.useRouterContext()
  const form = useWebhookForm()
  const test = useMutation(api.webhook.test.mutationOptions())
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        disabled={test.isPending}
        onClick={() =>
          test.mutate({
            id: props.webhook.id,
            ...(!props.webhook.preset && { parser: form.meta.parser }),
          })
        }
      >
        {test.isPending ? <Spinner data-icon="inline-start" /> : null}
        Test on the last 20 requests
      </Button>
      {test.data ? <span className="text-sm text-muted-foreground">{summaryOf(test.data.items)}</span> : null}
      {test.error ? <FieldError>{errorMessage(test.error)}</FieldError> : null}
    </div>
  )
}
