import { Tabs } from "@ren/ui/tabs"
import { PageTabsList, PageTabsTrigger } from "../../components/page.js"
import type { TaskViewState } from "./use-task-view.js"

export function TaskViewTabs(props: { state: TaskViewState }) {
  const state = props.state
  return (
    <Tabs
      value={state.current?.id ?? ""}
      onValueChange={(value: string) => state.select(value)}
      className="min-w-0 overflow-x-auto overscroll-contain"
    >
      <PageTabsList aria-label="Task views">
        {state.views.map((view) => (
          <PageTabsTrigger key={view.id} value={view.id}>
            {view.name}
          </PageTabsTrigger>
        ))}
      </PageTabsList>
    </Tabs>
  )
}
