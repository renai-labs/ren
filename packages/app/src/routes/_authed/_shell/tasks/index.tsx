import { Tasks } from "@ren/client/react"
import { createFileRoute } from "@tanstack/react-router"
import { TasksPage } from "../../../../features/tasks/tasks-page.js"
import { Loader } from "../../../../lib/loader.js"
import { TaskSearch, viewsInput } from "../../../../lib/tasks.js"

export const Route = createFileRoute("/_authed/_shell/tasks/")({
  head: () => ({ meta: [{ title: "Tasks · Ren" }] }),
  validateSearch: TaskSearch,
  loaderDeps: (options) => options.search,
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(Tasks.all(options.context.client, Tasks.listInput(options.deps.filters))),
      options.context.queryClient.query(options.context.api.view.list.queryOptions(viewsInput())),
    )
  },
  component: HomeTasks,
})

function HomeTasks() {
  const navigate = Route.useNavigate()
  return <TasksPage search={Route.useSearch()} setSearch={(update) => void navigate({ search: update })} />
}
