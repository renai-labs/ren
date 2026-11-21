import { Tasks } from "@ren/client/react"
import { createFileRoute } from "@tanstack/react-router"
import { TaskScopeProvider } from "../../../../../../features/tasks/task-scope.js"
import { TasksPage } from "../../../../../../features/tasks/tasks-page.js"
import { useSpace } from "../../../../../../features/spaces/use-space.js"
import { Loader } from "../../../../../../lib/loader.js"
import { TaskSearch } from "../../../../../../lib/tasks.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/tasks/")({
  head: () => ({ meta: [{ title: "Tasks · Space · Ren" }] }),
  validateSearch: TaskSearch,
  loaderDeps: (options) => options.search,
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        Tasks.all(options.context.client, Tasks.listInput(options.deps.filters, options.params.spaceId)),
      ),
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
