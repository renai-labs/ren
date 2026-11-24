import { Tasks } from "@ren/client/react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { TaskScopeProvider } from "../../../../../../features/tasks/task-scope.js"
import { TaskView } from "../../../../../../features/tasks/task-view.js"
import { TasksPage } from "../../../../../../features/tasks/tasks-page.js"
import { useSpace } from "../../../../../../features/spaces/use-space.js"
import { Loader } from "../../../../../../lib/loader.js"
import { TaskSearch, viewsInput } from "../../../../../../lib/tasks.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/tasks/")({
  head: () => ({ meta: [{ title: "Tasks · Space · Ren" }] }),
  validateSearch: TaskSearch,
  beforeLoad: async (options) => {
    if (options.search.view || options.search.filters) return
    const context = options.context
    const spaceId = options.params.spaceId
    const views = await context.queryClient.query(context.api.view.list.queryOptions(viewsInput(spaceId)))
    const search = TaskView.restore(context.platform.storage, spaceId, views.items)
    if (search) throw redirect({ to: "/spaces/$spaceId/tasks", params: options.params, search, replace: true })
  },
  loaderDeps: (options) => options.search,
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        Tasks.all(
          options.context.client,
          Tasks.treeInput(Tasks.listInput(options.deps.filters, options.params.spaceId)),
        ),
      ),
      options.context.queryClient.query(options.context.api.view.list.queryOptions(viewsInput(options.params.spaceId))),
    )
  },
  wrapInSuspense: false,
  component: SpaceTasks,
})

function SpaceTasks() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const space = useSpace()
  return (
    <TaskScopeProvider spaceId={space.id}>
      <TasksPage
        key={space.id}
        search={search}
        spaceId={space.id}
        setSearch={(update) => void navigate({ search: update })}
      />
    </TaskScopeProvider>
  )
}
