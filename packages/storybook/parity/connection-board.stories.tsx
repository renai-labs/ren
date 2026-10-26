import { useState } from "react"
import type { ConnectionBoardProps } from "@ren/ui/connection-board"
import { ConnectionBoard } from "ren-v1/composites/connection-board"
import meta from "../ui/connection-board.stories.js"

export default {
  ...meta,
  component: ConnectionBoard,
  render: function Render(args: ConnectionBoardProps) {
    const [links, setLinks] = useState(args.links)
    return (
      <ConnectionBoard
        {...args}
        allowSharedTargets={args.targetSharing === "shared"}
        links={links}
        onConnect={(sourceId, targetId) =>
          setLinks((current) => [...current.filter((link) => link.sourceId !== sourceId), { sourceId, targetId }])
        }
        onDisconnect={(sourceId) => setLinks((current) => current.filter((link) => link.sourceId !== sourceId))}
      />
    )
  },
}

export { Empty, Unrouted, WithLinks, Configurable, Busy, SharedTargets } from "../ui/connection-board.stories.js"
