export * as OpenCodePermissionSweep from "./permission-sweep.js"

import type { OpenCodeClient } from "@opencode/client/effect"
import type { Permission } from "@opencode/schema/permission"
import { BrainSettings } from "@ren/brain/settings"
import { Effect } from "effect"

export interface Change {
  readonly directory: string
  readonly previous: BrainSettings.Chat | undefined
  readonly next: BrainSettings.Chat
}

const decide = (chat: BrainSettings.Chat, agent: string | undefined, request: Permission.Request) => {
  const found =
    !agent || agent === chat.resolved.primary.name
      ? chat.resolved.primary
      : chat.resolved.subagents.find((each) => each.name === agent)
  return (
    found &&
    BrainSettings.evaluate(
      found,
      { action: request.action, resources: request.resources },
      { interactive: chat.interactive, denied: [] },
    ).effect
  )
}

export const run: (client: OpenCodeClient, change: Change) => Effect.Effect<void> = Effect.fnUntraced(
  function* (client, change) {
    const previous = change.previous
    if (!previous) return
    const waiting = yield* client.permission.request
      .list({ location: { directory: change.directory } })
      .pipe(Effect.orDie)
    yield* Effect.forEach(
      waiting.data,
      (request) =>
        Effect.gen(function* () {
          const info = yield* client.session.get({ sessionID: request.sessionID }).pipe(
            Effect.catchTag("SessionNotFoundError", () => Effect.succeed(undefined)),
            Effect.orDie,
          )
          if (!info) return
          const before = decide(previous, info.agent, request)
          const after = decide(change.next, info.agent, request)
          if (!before || !after || before === after) return
          if (after === "ask") return
          yield* client.permission
            .reply({
              sessionID: request.sessionID,
              requestID: request.id,
              decision: after === "allow" ? "once" : "reject",
            })
            .pipe(
              Effect.catchTag("PermissionNotFoundError", () => Effect.void),
              Effect.orDie,
            )
        }),
      { discard: true },
    )
  },
)
