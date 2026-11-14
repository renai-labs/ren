import { createContext, use, useRef, useState, type ReactNode } from "react"
import type { AgentInfo, SettingsInfo } from "@ren/client"
import { Agent } from "@ren/schema/agent"
import { Session } from "@ren/schema/session"
import { Settings } from "@ren/schema/settings"
import type { SessionModel } from "@ren/schema/session/model"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { IconArchive, IconArrowLeft } from "@tabler/icons-react"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Textarea } from "@ren/ui/textarea"
import { formatDate } from "@ren/ui/time"
import { Equal, Result, Schema, Struct } from "effect"
import { ModelPicker, modelRef, modelSetting, pickModel } from "../../components/model-picker.js"
import { Page, Row, Rows, Section } from "../../components/page.js"
import { PermissionRules } from "../../components/permission-rules.js"
import { RowMenu } from "../../components/row-menu.js"
import { Agents } from "../../lib/agents.js"
import { errorMessage, errorStatus } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Seed } from "../../lib/seed.js"
import { useMe } from "../../lib/use-me.js"
import { useSpaces } from "../../lib/use-spaces.js"

const editRoute = getRouteApi("/_authed/_shell/spaces/$spaceId/agents/$agentId/")
const newRoute = getRouteApi("/_authed/_shell/spaces/$spaceId/agents/new")

const modelsProbe = Session.ID.create()

type Draft = {
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly kind: "agent" | "subagent"
  readonly model: SessionModel.Ref | undefined
  readonly steps: string
}

const fields = ["name", "description", "steps"] as const

type Problems = Partial<Record<(typeof fields)[number], string>>

const emptyDraft: Draft = {
  name: "",
  description: "",
  instructions: "",
  kind: "agent",
  model: undefined,
  steps: "",
}

const draftOf = (agent: AgentInfo): Draft => ({
  name: agent.name,
  description: agent.description ?? "",
  instructions: agent.settings.instructions ?? "",
  kind: agent.isSubagent ? "subagent" : "agent",
  model: agent.settings.model && modelRef(agent.settings.model),
  steps: agent.settings.steps === undefined ? "" : String(agent.settings.steps),
})

const nameProblem = (name: string) => {
  if (name === "") return "Name the agent."
  const decoded = Schema.decodeUnknownResult(Agent.Name)(name)
  if (Result.isFailure(decoded)) return decoded.failure.message
  return Agent.reserved.has(name) ? `${name} is reserved. Choose another name.` : undefined
}

const problemsOf = (draft: Draft): Problems => {
  const name = nameProblem(draft.name)
  const steps = Schema.decodeUnknownResult(Settings.Steps)(Number(draft.steps))
  return {
    ...(name !== undefined && { name }),
    ...(draft.kind === "subagent" &&
      draft.description.trim() === "" && { description: "Describe when other agents should use this subagent." }),
    ...(draft.steps.trim() !== "" && Result.isFailure(steps) && { steps: steps.failure.message }),
  }
}

const settingsOf = (base: SettingsInfo, draft: Draft): SettingsInfo => ({
  ...Struct.omit(base, ["instructions", "model", "steps"]),
  ...(draft.instructions.trim() !== "" && { instructions: draft.instructions }),
  ...(draft.model && { model: modelSetting(draft.model) }),
  ...(draft.steps.trim() !== "" && { steps: Number(draft.steps) }),
})

const rejectedField = (error: unknown) => {
  const message = errorMessage(error, "")
  if (errorStatus(error) === 409 && /name/iu.test(message)) return "name"
  return errorStatus(error) === 400 && /description/iu.test(message) ? "description" : undefined
}

type AgentFormContext = {
  readonly state: {
    readonly draft: Draft
    readonly problems: Problems
    readonly readOnly: boolean
    readonly spaceId: string
  }
  readonly actions: {
    readonly set: (patch: Partial<Draft>) => void
    readonly validate: () => boolean
    readonly failed: (error: unknown, fallback: string) => void
  }
}

const AgentForm = createContext<AgentFormContext | null>(null)

const useAgentForm = () => {
  const context = use(AgentForm)
  if (!context) throw new Error("useAgentForm needs an AgentFormProvider")
  return context
}

function AgentFormProvider(props: { initial: Draft; readOnly: boolean; spaceId: string; children: ReactNode }) {
  const [draft, setDraft] = useState(props.initial)
  const [submitted, setSubmitted] = useState(false)
  const [rejected, setRejected] = useState<{
    readonly field: "name" | "description"
    readonly value: string
    readonly message: string
  }>()
  const root = useRef<HTMLDivElement>(null)
  const focus = (field: keyof Problems) => root.current?.querySelector<HTMLElement>(`#agent-${field}`)?.focus()
  const problems: Problems = {
    ...(rejected && rejected.value === draft[rejected.field] && { [rejected.field]: rejected.message }),
    ...problemsOf(draft),
  }
  return (
    <AgentForm
      value={{
        state: { draft, problems: submitted ? problems : {}, readOnly: props.readOnly, spaceId: props.spaceId },
        actions: {
          set: (patch) => setDraft((previous) => ({ ...previous, ...patch })),
          validate: () => {
            setSubmitted(true)
            const first = fields.find((field) => problems[field])
            if (first) focus(first)
            return first === undefined
          },
          failed: (error, fallback) => {
            const field = rejectedField(error)
            if (!field) return void toast.error(fallback, { description: errorMessage(error) })
            setRejected({ field, value: draft[field], message: errorMessage(error) })
            setSubmitted(true)
            focus(field)
          },
        },
      }}
    >
      <div ref={root} className="contents">
        {props.children}
      </div>
    </AgentForm>
  )
}

function AgentFormFrame(props: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      {props.children}
    </form>
  )
}

function AgentFields() {
  const form = useAgentForm()
  const spaces = useSpaces()
  const draft = form.state.draft
  const problems = form.state.problems
  const readOnly = form.state.readOnly
  return (
    <FieldGroup className="gap-6">
      <Field data-invalid={problems.name ? true : undefined}>
        <FieldLabel htmlFor="agent-name">Name</FieldLabel>
        <Input
          id="agent-name"
          value={draft.name}
          readOnly={readOnly}
          aria-invalid={problems.name ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="code-reviewer"
          onChange={(event) => form.actions.set({ name: event.target.value })}
          className="max-w-md font-mono"
        />
        {problems.name ? (
          <FieldError>{problems.name}</FieldError>
        ) : (
          <FieldDescription>Lowercase letters and digits, joined by dashes.</FieldDescription>
        )}
      </Field>
      <Field data-invalid={problems.description ? true : undefined}>
        <FieldLabel htmlFor="agent-description">
          Description
          {draft.kind === "subagent" ? null : <span className="font-normal text-muted-foreground">Optional</span>}
        </FieldLabel>
        <Textarea
          id="agent-description"
          value={draft.description}
          readOnly={readOnly}
          aria-invalid={problems.description ? true : undefined}
          placeholder="Reviews pull requests for security and style."
          onChange={(event) => form.actions.set({ description: event.target.value })}
          className="max-h-40 min-h-16"
        />
        {problems.description ? (
          <FieldError>{problems.description}</FieldError>
        ) : (
          <FieldDescription>Other agents read this to decide when to use it.</FieldDescription>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="agent-instructions">Instructions</FieldLabel>
        <Textarea
          id="agent-instructions"
          value={draft.instructions}
          readOnly={readOnly}
          placeholder={"# Code reviewer\n\n- Flag any secret or token in the diff.\n- Keep each comment to one point."}
          onChange={(event) => form.actions.set({ instructions: event.target.value })}
          className="min-h-48 font-mono"
        />
        <FieldDescription>
          Added after {spaces.space(form.state.spaceId)?.name ?? "the space"}’s instructions.
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}

function ModelRow() {
  const { api } = RouterContext.useRouterContext()
  const form = useAgentForm()
  const models = useQuery(api.chat.models.queryOptions({ id: modelsProbe }))
  const space = useQuery(api["space-settings"].get.queryOptions({ idOrSlug: form.state.spaceId }))
  const organization = useQuery(api["organization-settings"].get.queryOptions({ idOrSlug: useMe().organization.id }))
  const choices = models.data ?? []
  const fallback = pickModel(
    choices,
    [space.data?.settings.model, organization.data?.settings.model].map((model) => model && modelRef(model)),
  )
  const model = form.state.draft.model
  const inherited = form.state.draft.kind === "subagent" ? "Parent agent’s model" : "Space default"
  return (
    <Row title="Model" description={model ? undefined : inherited}>
      <ModelPicker
        models={choices}
        loading={models.isPending}
        value={model ?? fallback}
        disabled={form.state.readOnly}
        onChange={(next) => form.actions.set({ model: Equal.equals(next, fallback) ? undefined : next })}
      />
    </Row>
  )
}

function AgentSettings() {
  const form = useAgentForm()
  const draft = form.state.draft
  const readOnly = form.state.readOnly
  const steps = form.state.problems.steps
  return (
    <Rows>
      {[
        <ModelRow key="model" />,
        <Row key="subagent" title="Subagent" description="Only other agents call it. It doesn’t take chats or tasks.">
          <Switch
            aria-label="Subagent"
            checked={draft.kind === "subagent"}
            disabled={readOnly}
            onCheckedChange={(checked) => form.actions.set({ kind: checked ? "subagent" : "agent" })}
          />
        </Row>,
        <Row
          key="steps"
          title="Max steps"
          description={
            steps ? (
              <span className="text-destructive">{steps}</span>
            ) : (
              "Model iterations in one run before it must answer."
            )
          }
        >
          <Input
            id="agent-steps"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            value={draft.steps}
            readOnly={readOnly}
            aria-label="Max steps"
            aria-invalid={steps ? true : undefined}
            placeholder={String(Settings.defaultSteps)}
            onChange={(event) => form.actions.set({ steps: event.target.value })}
            className="w-24"
          />
        </Row>,
      ]}
    </Rows>
  )
}

function BackLink(props: { spaceId: string }) {
  return (
    <Link
      to="/spaces/$spaceId/agents"
      params={{ spaceId: props.spaceId }}
      className={buttonVariants({
        variant: "ghost",
        size: "sm",
        className: "px-0 text-muted-foreground has-[>svg]:px-0",
      })}
    >
      <IconArrowLeft />
      Back to agents
    </Link>
  )
}

export function NewAgentPage() {
  const spaceId = newRoute.useParams().spaceId
  return (
    <AgentFormProvider initial={emptyDraft} readOnly={false} spaceId={spaceId}>
      <NewAgentView spaceId={spaceId} />
    </AgentFormProvider>
  )
}

function NewAgentView(props: { spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const form = useAgentForm()
  const create = useMutation(api.agent.create.mutationOptions())
  const spaceId = props.spaceId
  const submit = () => {
    if (!form.actions.validate()) return
    const draft = form.state.draft
    create.mutate(
      {
        ownerSpaceId: spaceId,
        name: draft.name,
        isSubagent: draft.kind === "subagent",
        ...(draft.description.trim() !== "" && { description: draft.description.trim() }),
        settings: settingsOf({ permissions: [], references: [] }, draft),
      },
      {
        onSuccess: (created) => {
          toast.success(`${created.name} created`)
          void navigate({
            to: "/spaces/$spaceId/agents/$agentId",
            params: { spaceId, agentId: created.id },
            replace: true,
          })
        },
        onError: (error) => form.actions.failed(error, "Couldn’t create the agent"),
      },
    )
  }
  return (
    <Page title="New agent" back={<BackLink spaceId={spaceId} />}>
      <AgentFormFrame onSubmit={submit}>
        <AgentFields />
        <AgentSettings />
        <div className="flex justify-end">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Spinner data-icon="inline-start" /> : null}
            Create agent
          </Button>
        </div>
      </AgentFormFrame>
    </Page>
  )
}

export function AgentPage() {
  const { api, queryClient } = RouterContext.useRouterContext()
  const params = editRoute.useParams()
  const agent = useSuspenseQuery({
    ...api.agent.get.queryOptions({ idOrSlug: params.agentId }),
    ...Seed.fromList<AgentInfo>(queryClient, [api.agent.list.queryKey()], params.agentId),
  }).data
  return (
    <AgentFormProvider key={agent.id} initial={draftOf(agent)} readOnly={!agent.canUpdate} spaceId={params.spaceId}>
      <AgentView agent={agent} spaceId={params.spaceId} />
    </AgentFormProvider>
  )
}

function ReadOnlyNotice(props: { agent: AgentInfo }) {
  const spaces = useSpaces()
  const ownerSpaceId = props.agent.ownerSpaceId
  return (
    <Alert>
      <AlertDescription>
        {ownerSpaceId === null
          ? "Built-in. Change how Ren behaves in this space under Instructions."
          : `Edit it in ${spaces.space(ownerSpaceId)?.name ?? "its owner space"}.`}
      </AlertDescription>
    </Alert>
  )
}

function ArchiveMenu(props: { agent: AgentInfo; spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const archive = useMutation(api.agent.archive.mutationOptions())
  const agent = props.agent
  return (
    <RowMenu
      label={`${agent.name} actions`}
      className="flex text-muted-foreground"
      items={[
        {
          label: "Archive",
          icon: IconArchive,
          onSelect: () =>
            archive.mutateAsync(
              { id: agent.id },
              {
                onSuccess: () => {
                  toast.success(`${agent.name} archived`)
                  void navigate({ to: "/spaces/$spaceId/agents", params: { spaceId: props.spaceId }, replace: true })
                },
                onError: (error) => toast.error("Couldn’t archive the agent", { description: errorMessage(error) }),
              },
            ),
          confirm: Agents.archiveConfirmation(agent),
        },
      ]}
    />
  )
}

function AgentView(props: { agent: AgentInfo; spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const form = useAgentForm()
  const spaces = useSpaces()
  const update = useMutation(api.agent.update.mutationOptions())
  const agent = props.agent
  const save = () => {
    if (!form.actions.validate()) return
    const draft = form.state.draft
    update.mutate(
      {
        id: agent.id,
        name: draft.name,
        description: draft.description.trim() === "" ? null : draft.description.trim(),
        isSubagent: draft.kind === "subagent",
        settings: settingsOf(agent.settings, draft),
      },
      {
        onSuccess: () => toast.success("Agent saved"),
        onError: (error) => form.actions.failed(error, "Couldn’t save the agent"),
      },
    )
  }
  return (
    <Page
      title={agent.name}
      back={<BackLink spaceId={props.spaceId} />}
      aside={agent.canUpdate ? <ArchiveMenu agent={agent} spaceId={props.spaceId} /> : undefined}
      footer={
        <p className="text-xs text-muted-foreground">
          {Agents.source(agent, props.spaceId, (id) => spaces.space(id)?.name)} · Created {formatDate(agent.createdAt)}{" "}
          · Updated {formatDate(agent.updatedAt)}
        </p>
      }
    >
      {agent.canUpdate ? null : <ReadOnlyNotice agent={agent} />}
      <AgentFormFrame onSubmit={save}>
        <AgentFields />
        <AgentSettings />
        {agent.canUpdate ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={update.isPending || Equal.equals(form.state.draft, draftOf(agent))}>
              {update.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save agent
            </Button>
          </div>
        ) : null}
      </AgentFormFrame>
      <AgentPermissions agent={agent} spaceId={props.spaceId} />
    </Page>
  )
}

function AgentPermissions(props: { agent: AgentInfo; spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const update = useMutation(api.agent.update.mutationOptions())
  const organization = useQuery(api["organization-settings"].get.queryOptions({ idOrSlug: useMe().organization.id }))
  const space = useQuery(
    api["space-settings"].get.queryOptions({ idOrSlug: props.agent.ownerSpaceId ?? props.spaceId }),
  )
  const agent = props.agent
  return (
    <Section
      title="Permissions"
      description="Rules for this agent, on top of your organization’s and the space’s where a chat runs."
    >
      <PermissionRules
        rules={agent.settings.permissions ?? []}
        inherited={[
          { source: "Organization", rules: organization.data?.settings.permissions ?? [] },
          { source: "Space", rules: space.data?.settings.permissions ?? [] },
        ]}
        scopeName="This agent"
        readOnly={!agent.canUpdate}
        saving={update.isPending}
        onSave={(permissions) =>
          update.mutateAsync(
            { id: agent.id, settings: { ...agent.settings, permissions: [...permissions] } },
            { onError: (error) => toast.error("Couldn’t save the permissions", { description: errorMessage(error) }) },
          )
        }
      />
    </Section>
  )
}
