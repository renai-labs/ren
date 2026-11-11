export * as OpenCodePermissionSweep from "./permission-sweep.js"

import type { OpenCodeClient, Session } from "@opencode/client/effect"
import type { SessionID } from "@opencode/schema/session-id"
import type { Permission } from "@opencode/schema/permission"
import { BrainSettings } from "@ren/brain/settings"
import { Effect } from "effect"

export interface Change {
  readonly id: string
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
    const skip = (message: string) => () => Effect.logWarning(message).pipe(Effect.as(undefined))
    const owned = (sessionID: SessionID): Effect.Effect<Session.Info | undefined> =>
      client.session.get({ sessionID }).pipe(
        Effect.flatMap((info) => {
          if (info.id === change.id) return Effect.succeed(info)
          if (!info.parentID) return Effect.undefined
          return owned(info.parentID)
        }),
        Effect.catch(skip("The permission sweep could not read a session")),
      )
    const waiting = yield* client.permission.request.list({ location: { directory: change.directory } }).pipe(
      Effect.map((found) => found.data),
      Effect.catch(() => Effect.logWarning("The permission sweep could not list requests").pipe(Effect.as([]))),
    )
    const decided = yield* Effect.forEach(waiting, (request) =>
      Effect.gen(function* () {
        const info = yield* client.session
          .get({ sessionID: request.sessionID })
          .pipe(Effect.catch(skip("The permission sweep could not read a session")))
        if (!info || !(yield* owned(request.sessionID))) return []
        const before = decide(previous, info.agent, request)
        const after = decide(change.next, info.agent, request)
        if (!before || !after || before === after || after === "ask") return []
        return [{ request, reply: after === "allow" ? ("once" as const) : ("reject" as const) }]
      }),
    )
    const ordered = decided.flat().toSorted((a, b) => Number(a.reply === "reject") - Number(b.reply === "reject"))
    yield* Effect.forEach(
      ordered,
      (item) =>
        client.permission
          .reply({ sessionID: item.request.sessionID, requestID: item.request.id, decision: item.reply })
          .pipe(
            Effect.catchTag("PermissionNotFoundError", () => Effect.void),
            Effect.catch(() => Effect.logWarning("The permission sweep could not reply to a request")),
          ),
      { discard: true },
    )
  },
)
