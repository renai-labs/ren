export * as Restore from "./restore.js"

import type { BrainRejectedError } from "@ren/host-api/errors"
import type { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Schema } from "effect"
import { Cell } from "./cell.js"
import { ChatSettings } from "./chat-settings.js"
import { Harness } from "./harness/harness.js"
import { HotReload } from "./hot-reload.js"
import { Sync } from "./sync.js"

class Unavailable extends Schema.TaggedError<Unavailable>()("Restore.Unavailable", { message: Schema.String }) {}

export interface Interface {
  readonly ensure: (
    chat: Session.ID,
    options?: { readonly isStarting?: boolean },
  ) => Effect.Effect<void, Unavailable | BrainRejectedError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Restore") {}

// oxlint-disable-next-line ren/no-comments -- A chat comes back from Ren on its first request, with its whole group, parents first (E98, E103). Ren unreachable: Unavailable, and the restore flag stays for the next request. A chat that brain.start is starting is left to that start, which has the whole start input from Ren. A root with no saved settings waits for a pull first, so it never runs without its agent, instructions and permission rules (E131).
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sync = yield* Sync.Service
    const settings = yield* ChatSettings.Service
    const hotReload = yield* HotReload.Service
    const isKnown = (chat: Session.ID) =>
      settings.chats.pipe(Effect.map((chats) => chats.some((each) => each.id === chat)))
    const settled = Effect.fnUntraced(function* (chat: Session.ID) {
      if (yield* isKnown(chat)) return
      yield* hotReload.pull
      if (!(yield* isKnown(chat))) return yield* new Unavailable({ message: "Ren did not give the chat’s settings" })
    })
    const context = yield* Effect.context<Cell.Info | Cell.Activity | Harness.Service>()
    return Service.of({
      ensure: Effect.fn("Restore.ensure")(function* (
        chat: Session.ID,
        options: { readonly isStarting?: boolean } = {},
      ) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const harness = yield* Cell.acquire
            yield* sync.restore({
              sessionId: chat,
              exists: harness.transcript.has,
              start: (input) =>
                options.isStarting && input.sessionId === chat
                  ? Effect.void
                  : settled(input.sessionId).pipe(Effect.andThen(harness.transcript.start(input))),
              import: (data) =>
                (data.chat.parentId ? Effect.void : settled(data.chat.id)).pipe(
                  Effect.andThen(harness.transcript.restore(data)),
                ),
            })
          }),
        ).pipe(
          Effect.provide(context),
          Effect.catchTag("OpenCodeSync.SyncError", (error) =>
            Effect.fail(new Unavailable({ message: error.message })),
          ),
        )
      }),
    })
  }),
)
