import { createFileRoute } from "@tanstack/react-router"
import { AgentPage } from "../../../../../../../features/agents/agent-page.js"
import { Loader } from "../../../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/agents/$agentId/")({
  head: () => ({ meta: [{ title: "Agent · Space · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.agent.get.queryOptions({ idOrSlug: options.params.agentId }),
      ),
    )
  },
  wrapInSuspense: false,
  component: AgentPage,
})
