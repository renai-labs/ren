export * as Drives from "./drives.js"

import type { Drive } from "@ren/schema/drive"
import { Effect } from "effect"
import type { References } from "./references.js"

export const root = "drives"

const reasons: Record<Drive.UnavailableReason, string> = {
  no_mount: "its environment cannot mount them",
  no_egress: "its environment is not behind Ren’s egress, which signs their requests",
}

export const chat = (input: {
  readonly drives: () => Drive.Availability | undefined
  readonly changed: Effect.Effect<void>
}): References.Source => ({
  root,
  note: "A drive holds files that people upload in Ren. A file uploaded during the chat appears in it within seconds.",
  readOnly: "is in a read-only drive.",
  prepared: () => {
    const drives = input.drives()
    if (!drives) return []
    if (drives.type === "unavailable")
      return [
        {
          type: "unavailable",
          alias: "drive",
          note: `The drives of this space and organization are not available in this chat: ${reasons[drives.reason]}.`,
        },
      ]
    return drives.mounts.map((mount) => ({
      type: "ready",
      alias: mount.alias,
      description: mount.description,
      path: mount.kind,
      copy: { type: "mount", remote: mount.remote, access: mount.access },
    }))
  },
  refresh: input.changed,
  ready: Effect.void,
})
