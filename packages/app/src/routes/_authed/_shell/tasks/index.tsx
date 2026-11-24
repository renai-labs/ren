import { Tasks } from "@ren/client/react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { TaskView } from "../../../../features/tasks/task-view.js"
import { TasksPage } from "../../../../features/tasks/tasks-page.js"
import { Loader } from "../../../../lib/loader.js"
import { TaskSearch, viewsInput } from "../../../../lib/tasks.js"

export const Route = createFileRoute("/_authed/_shell/tasks/")({
  head: () => ({ meta: [{ title: "Tasks · Ren" }] }),
  validateSearch: TaskSearch,
  beforeLoad: async (options) => {
    if (options.search.view || options.search.filters) return
    const context = options.context
    const views = await context.queryClient.query(context.api.view.list.queryOptions(viewsInput()))
    const search = TaskView.restore(context.platform.storage, undefined, views.items)
    if (search) throw redirect({ to: "/tasks", search, replace: true })
  },
  loaderDeps: (options) => options.search,
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        Tasks.all(options.context.client, Tasks.treeInput(Tasks.listInput(options.deps.filters))),
      ),
      options.context.queryClient.query(options.context.api.view.list.queryOptions(viewsInput())),
    )
  },
  component: HomeTasks,
})

function HomeTasks() {
  const navigate = Route.useNavigate()
  return <TasksPage search={Route.useSearch()} setSearch={(update) => void navigate({ search: update })} />
}
