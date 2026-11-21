import { createFileRoute } from "@tanstack/react-router"
import { AgentsView } from "../../../../../../features/agents/agents-view.js"
import { Agents } from "../../../../../../lib/agents.js"
import { Loader } from "../../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/agents/")({
  head: () => ({ meta: [{ title: "Agents · Space · Ren" }] }),
  loader: (options) => {
    Loader.start(options.context.queryClient.query(Agents.listOptions(options.context.api, options.params.spaceId)))
  },
  wrapInSuspense: false,
  component: SpaceAgents,
})

function SpaceAgents() {
  return <AgentsView spaceId={Route.useParams().spaceId} />
}
