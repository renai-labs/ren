import { createFileRoute } from "@tanstack/react-router"
import { TasksSkeleton } from "../../../../components/route-skeleton.js"
import { PageSkeleton } from "../../../../components/page.js"
import { TasksPage } from "../../../../features/tasks/tasks-page.js"
import { Loader } from "../../../../lib/loader.js"
import { allTasksOptions, taskListInput, TaskSearch } from "../../../../lib/tasks.js"

export const Route = createFileRoute("/_authed/_shell/tasks/")({
  head: () => ({ meta: [{ title: "Tasks · Ren" }] }),
  validateSearch: TaskSearch,
  loaderDeps: (options) => options.search,
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(allTasksOptions(options.context.client, taskListInput(options.deps))),
    )
  },
  pendingComponent: TasksPending,
  component: TasksPage,
})

function TasksPending() {
  return (
    <PageSkeleton title="Tasks" width="full">
      <TasksSkeleton />
    </PageSkeleton>
  )
}
