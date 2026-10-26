import type { TaskInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { LoadingMessage } from "@ren/ui/loading-message"
import { PageShell } from "@ren/ui/page-shell"
import { StateMessage } from "@ren/ui/state-message"
import { Select } from "@ren/ui/select"
import { Toolbar } from "@ren/ui/toolbar"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useRouteContext, useSearch } from "@tanstack/react-router"
import { useDeferredValue, useState } from "react"
import type { ReactNode } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { ArchiveTasksDialog } from "./archive-tasks-dialog.js"
import { BulkActionBar } from "./task-bulk-bar.js"
import { TaskCreateDialog } from "./task-create-dialog.js"
import type { Preset } from "./task-create-dialog.js"
import { TaskList } from "./task-list.js"
import { TaskBoard } from "./task-board.js"
import { TaskSearch } from "./task-search.js"
import { TaskQueries } from "./task-queries.js"
import { TaskView } from "./task-view.js"
import { Tasks } from "./tasks.js"
import { ActiveFilters, TasksToolbar } from "./tasks-toolbar.js"

type Dialog =
  | { readonly kind: "create"; readonly preset: Preset }
  | { readonly kind: "archive"; readonly tasks: ReadonlyArray<TaskInfo> }
  | null

const from = "/_authed/_shell/tasks/"

export function TasksPage() {
  const context = useRouteContext({ from: "/_authed" })
  const search = useSearch({ from })
  const navigate = useNavigate({ from: "/tasks/" })
  const organization = context.me.organization
  if (organization === null) return null
  const saved = TaskSearch.savedFilters(context.me.user.id, organization.id)
  return (
    <Page
      key={organization.id}
      view={TaskView.resolve(search, saved.read(context.platform.storage))}
      userId={context.me.user.id}
      organizationId={organization.id}
      onViewChange={(next) => {
        saved.write(context.platform.storage, next.filters)
        void navigate({ search: TaskView.toSearch(next), replace: true })
      }}
    />
  )
}

function Page(props: {
  view: TaskView.View
  onViewChange: (view: TaskView.View) => void
  userId: string
  organizationId: string
}) {
  const context = RouterContext.useRouterContext()
  const catalog = Tasks.useCatalog(props.organizationId)
  const actions = Tasks.useTaskActions()
  const navigate = useNavigate()
  const list = useQuery(TaskQueries.listOptions(context.api, props.view.filters))
  const spaceId = TaskView.preferredSpace(props.view.filters)
  const query = useDeferredValue(props.view.query)
  const [dialog, setDialog] = useState<Dialog>(null)
  const selected = new Set(props.view.selected)
  const setSelected = (next: ReadonlySet<string>) => props.onViewChange({ ...props.view, selected: [...next] })
  const [busy, setBusy] = useState(false)
  const tasks = list.data?.items ?? []
  const view = { ...props.view, query }
  const TaskCollection = view.layout === "board" ? TaskBoard : TaskList
  const rows = TaskView.visible(tasks, view)
  const options = TaskView.filterOptions({ tasks, catalog })
  const selectedRows = rows.filter((task) => selected.has(task.id))
  const creatable = catalog.spaces.filter((space) => space.membershipId !== null)
  const hasSpaces = creatable.length > 0
  const openCreate = (preset: Preset) => setDialog({ kind: "create", preset })
  Tasks.useCreateHotkey(() => openCreate({}), { enabled: hasSpaces && dialog === null })
  const runBulk = async (targets: ReadonlyArray<TaskInfo>, operation: Tasks.BulkOperation) => {
    if (busy || targets.length === 0) return
    setBusy(true)
    const failed = await actions.bulk(targets, operation).finally(() => setBusy(false))
    const done = new Set(targets.filter((task) => !failed.includes(task)).map((task) => task.id))
    setSelected(new Set(props.view.selected.filter((id) => !done.has(id))))
  }
  return (
    <PageShell.Root
      layout={view.layout === "board" ? "board" : "workspace"}
      title="Tasks"
      actions={
        <Actions disabled={!hasSpaces} onCreate={() => openCreate({})}>
          {hasSpaces && view.layout === "board" ? (
            <Select.Root
              label="Board space"
              placeholder="Choose a space"
              value={spaceId}
              size="compact"
              width="compact"
              options={catalog.spaces.map((entry) => ({ value: entry.id, label: entry.name }))}
              onValueChange={(id) =>
                props.onViewChange({ ...props.view, filters: { ...props.view.filters, space: [id] }, selected: [] })
              }
            />
          ) : null}
          {hasSpaces ? <TasksToolbar view={props.view} onChange={props.onViewChange} options={options} /> : null}
        </Actions>
      }
    >
      {hasSpaces ? <ActiveFilters view={props.view} onChange={props.onViewChange} options={options} /> : null}
      <section aria-label="Tasks" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <Collection
          state={TaskView.collectionState({ status: list.status, spaces: creatable.length, tasks, rows })}
          view={view}
          onRetry={() => void list.refetch()}
          onCreate={() => openCreate({})}
        >
          <TaskCollection
            view={view}
            groups={TaskView.groups(view, catalog.agents, tasks, rows)}
            catalog={catalog}
            userId={props.userId}
            selected={selected}
            onToggleSelected={(id) => {
              const next = new Set(selected)
              if (!next.delete(id)) next.add(id)
              setSelected(next)
            }}
            onCreate={openCreate}
            onOpen={(task) => void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } })}
            actions={actions}
            onArchive={(task) => setDialog({ kind: "archive", tasks: [task] })}
          />
          <SelectionBar
            tasks={selectedRows}
            busy={busy}
            agents={catalog.agents}
            onStatus={(status) => void runBulk(selectedRows, { kind: "status", status })}
            onMove={(agentId) => void runBulk(selectedRows, { kind: "move", agentId })}
            onArchive={() => setDialog({ kind: "archive", tasks: selectedRows })}
            onClear={() => setSelected(new Set())}
          />
        </Collection>
      </section>
      <Dialogs
        dialog={dialog}
        spaces={creatable}
        spaceId={TaskView.preferredSpace(props.view.filters)}
        catalog={catalog}
        onClose={() => setDialog(null)}
        onArchiveMany={(targets) => runBulk(targets, { kind: "archive" })}
      />
    </PageShell.Root>
  )
}

function Dialogs(props: {
  dialog: Dialog
  spaces: Parameters<typeof TaskCreateDialog>[0]["spaces"]
  spaceId: string
  catalog: ReturnType<typeof Tasks.useCatalog>
  onClose: () => void
  onArchiveMany: (tasks: ReadonlyArray<TaskInfo>) => Promise<unknown>
}) {
  return (
    <>
      {props.dialog?.kind === "create" ? (
        <TaskCreateDialog
          onClose={props.onClose}
          spaces={props.spaces}
          spaceId={props.spaceId}
          preset={props.dialog.preset}
          catalog={props.catalog}
        />
      ) : null}
      <ArchiveTasksDialog
        tasks={props.dialog?.kind === "archive" ? props.dialog.tasks : []}
        onClose={props.onClose}
        onArchiveMany={props.onArchiveMany}
      />
    </>
  )
}

function Actions(props: { disabled: boolean; onCreate: () => void; children: ReactNode }) {
  return (
    <Toolbar.Root size="small" leading={props.children}>
      <IconButton
        label="New task"
        appearance="primary"
        disabled={props.disabled}
        onClick={props.onCreate}
        aria-keyshortcuts="C"
        title="New task (C)"
      >
        <Icon glyph="Compose" />
      </IconButton>
    </Toolbar.Root>
  )
}

function SelectionBar(
  props: Omit<Parameters<typeof BulkActionBar>[0], "count" | "agents"> & {
    tasks: ReadonlyArray<TaskInfo>
    agents: ReadonlyArray<Tasks.Agent>
  },
) {
  const spaces = new Set(props.tasks.map((task) => task.spaceId))
  const space = spaces.size === 1 ? [...spaces][0] : undefined
  const spaceAgents = Tasks.useSpaceAgents(space, { enabled: space !== undefined })
  return (
    <BulkActionBar
      {...props}
      count={props.tasks.length}
      agents={space === undefined ? props.agents.filter((agent) => agent.isGlobal) : (spaceAgents.data ?? [])}
    />
  )
}

function Collection(props: {
  state: TaskView.CollectionState
  view: TaskView.View
  onRetry: () => void
  onCreate: () => void
  children: ReactNode
}) {
  if (props.state === "loading") return <LoadingMessage placement="section" />
  if (props.state === "no-spaces")
    return (
      <StateMessage
        state="empty"
        icon={<Icon glyph="Checklist" size="medium" tone="secondary" />}
        title="No spaces yet"
        description="Join or create a space to start organizing tasks."
      />
    )
  if (props.state === "failed")
    return <StateMessage state="failed" placement="section" title="Couldn’t load tasks." onRetry={props.onRetry} />
  if (props.state === "ready" || props.view.layout === "board") return props.children
  return (
    <>
      {props.state === "no-results" ? (
        <StateMessage
          state="no-results"
          icon={<Icon glyph="Checklist" size="medium" tone="secondary" />}
          title="No matching tasks"
          description="Try a different search or filter."
        />
      ) : (
        <StateMessage
          state="empty"
          icon={<Icon glyph="Checklist" size="medium" tone="secondary" />}
          title="No tasks yet"
          description="Create one to plan work and hand it to an agent."
          action={
            <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={props.onCreate}>
              New task
            </Button>
          }
        />
      )}
      {props.view.empty ? props.children : null}
    </>
  )
}
