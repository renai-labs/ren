import { useDeferredValue, useId, useState } from "react"
import type { AgentInfo, SpaceInfo } from "@ren/client"
import type { Infra } from "@ren/schema/infra"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Composer } from "@ren/chat"
import { IconAlertTriangle, IconSparkles } from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Loading } from "@ren/ui/loading"
import { toast } from "@ren/ui/sonner"
import { Tabs } from "@ren/ui/tabs"
import { Textarea } from "@ren/ui/textarea"
import { MermaidDiagram } from "../../components/mermaid-diagram.js"
import { PageActions, PageTabsList, PageTabsTrigger, useShapeId } from "../../components/page.js"
import { FactorySample } from "../../components/route-skeleton.js"
import { Drafts } from "../../lib/drafts.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { FactorySpec } from "./factory-spec.js"
import { spaceAgentsOptions, useSpace } from "./use-space.js"

export type FactoryView = "flow" | "spec"

type DraftState = "saved" | "unsaved" | "invalid" | "saving"

function EditWithRen(props: { space: SpaceInfo }) {
  const navigate = useNavigate()
  const write = Drafts.useWrite()
  return (
    <PageActions>
      <Button
        variant="outline"
        onClick={() => {
          write(
            Drafts.space(props.space.id),
            Composer.withText(Composer.empty, `Edit the factory of the ${props.space.name} space: `),
          )
          void navigate({ to: "/", search: { spaceId: props.space.id } })
        }}
      >
        <IconSparkles data-icon="inline-start" />
        Edit with Ren
      </Button>
    </PageActions>
  )
}

function SpecActions(props: { state: DraftState; onDiscard: () => void; onSave: () => void }) {
  return (
    <div className="flex items-center gap-1">
      {props.state === "saved" ? null : (
        <Button variant="ghost" size="sm" disabled={props.state === "saving"} onClick={props.onDiscard}>
          Discard
        </Button>
      )}
      <Button size="sm" disabled={props.state !== "unsaved"} onClick={props.onSave}>
        {props.state === "saving" ? "Saving…" : "Save"}
      </Button>
    </div>
  )
}

function FlowStatus(props: { state: DraftState }) {
  if (props.state === "invalid")
    return <span className="text-xs text-muted-foreground">Showing the saved factory. Fix spec.yaml to update it.</span>
  if (props.state === "saved") return null
  return <Badge variant="secondary">Unsaved</Badge>
}

function SpecEditor(props: {
  text: string
  problems: ReadonlyArray<string> | undefined
  onChange?: ((text: string) => void) | undefined
  onSave: () => void
}) {
  const problemsId = useId()
  const change = props.onChange
  return (
    <>
      <div className="flex min-h-0 flex-1 scrollbar-thin overflow-auto overscroll-contain">
        <div
          aria-hidden
          className="shrink-0 py-3 ps-4 pe-3 text-end font-mono text-sm/6 text-muted-foreground tabular-nums select-none"
        >
          {props.text.split("\n").map((_, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a line number is its position
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <Textarea
          aria-label="Factory spec"
          aria-invalid={props.problems && true}
          aria-describedby={props.problems && problemsId}
          value={props.text}
          readOnly={!change}
          spellCheck={false}
          wrap="off"
          onChange={(event) => change?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) props.onSave()
          }}
          className="min-h-full flex-1 resize-none self-start overflow-hidden rounded-none border-0 bg-transparent py-3 ps-0 pe-4 font-mono text-sm/6 aria-invalid:ring-0 md:text-sm/6 dark:bg-transparent"
        />
      </div>
      {props.problems ? (
        <ul id={problemsId} className="flex flex-col gap-1 border-t px-4 py-3 text-xs text-destructive">
          {props.problems.map((problem) => (
            <li key={problem} className="flex items-start gap-1.5">
              <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function FactoryFlow(props: { declaration: Infra.FactoryDeclaration }) {
  const chart = useDeferredValue(FactorySpec.diagram(props.declaration))
  if (props.declaration.agents.length === 0)
    return <p className="m-auto text-sm text-muted-foreground">Add an agent to spec.yaml to see how tasks move.</p>
  return <MermaidDiagram chart={chart} label="How tasks move between the agents" />
}

function useFactoryDraft(space: SpaceInfo, agents: ReadonlyArray<AgentInfo>) {
  const { api } = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const update = useMutation(api.space.update.mutationOptions())
  const [draft, setDraft] = useState<string>()
  const ids = new Map(agents.map((agent) => [agent.name, agent.id]))
  const saved = FactorySpec.write(space.factory, new Map(agents.map((agent) => [agent.id, agent.name])))
  const text = draft ?? saved
  const parsed = FactorySpec.read(text, new Set(ids.keys()))
  const shown = [parsed, FactorySpec.read(saved, new Set(ids.keys()))].find((each) => each._tag === "valid")
  let state: DraftState = text === saved ? "saved" : "unsaved"
  if (parsed._tag === "invalid") state = "invalid"
  if (update.isPending) state = "saving"
  return {
    text,
    state,
    problems: parsed._tag === "invalid" ? parsed.problems : undefined,
    declaration: shown?._tag === "valid" ? shown.declaration : { maxHandoffs: 0, agents: [] },
    change: setDraft,
    discard: () => setDraft(undefined),
    save: () => {
      if (parsed._tag === "valid" && state === "unsaved")
        update.mutate(
          { id: space.id, factory: FactorySpec.toInfo(parsed.declaration, ids) },
          {
            onSuccess: (updated) => {
              queryClient.setQueryData(api.space.get.queryOptions({ idOrSlug: space.id }).queryKey, updated)
              setDraft(undefined)
            },
            onError: (error) => toast.error("Couldn’t save the factory", { description: errorMessage(error) }),
          },
        )
    },
  }
}

function FactoryCard(props: {
  space: SpaceInfo
  agents: ReadonlyArray<AgentInfo>
  view: FactoryView
  onView: (view: FactoryView) => void
}) {
  const draft = useFactoryDraft(props.space, props.agents)
  return (
    <Card className="mt-4 min-h-120 flex-1 gap-0 py-0 contain-size has-[textarea:focus-visible]:ring-ring">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-2">
        <Tabs value={props.view} onValueChange={(value: string) => props.onView(value === "spec" ? "spec" : "flow")}>
          <PageTabsList>
            <PageTabsTrigger value="flow">Flow</PageTabsTrigger>
            <PageTabsTrigger value="spec">spec.yaml</PageTabsTrigger>
          </PageTabsList>
        </Tabs>
        {props.view === "flow" ? <FlowStatus state={draft.state} /> : null}
        {props.view === "spec" && props.space.canUpdate ? (
          <SpecActions state={draft.state} onDiscard={draft.discard} onSave={draft.save} />
        ) : null}
      </div>
      {props.view === "flow" ? (
        <FactoryFlow declaration={draft.declaration} />
      ) : (
        <SpecEditor
          text={draft.text}
          problems={draft.problems}
          onChange={props.space.canUpdate ? draft.change : undefined}
          onSave={draft.save}
        />
      )}
    </Card>
  )
}

export function SpaceFactory(props: { view: FactoryView; onView: (view: FactoryView) => void }) {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const agents = useQuery(spaceAgentsOptions(api, space.id))
  const shapeId = useShapeId("factory")
  return (
    <>
      {space.canUpdate ? <EditWithRen space={space} /> : null}
      <Loading id={shapeId} loading={agents.isPending} label="Loading factory" className="flex flex-1 flex-col">
        {agents.data ? (
          <FactoryCard space={space} agents={agents.data.items} view={props.view} onView={props.onView} />
        ) : (
          <FactorySample />
        )}
      </Loading>
    </>
  )
}
