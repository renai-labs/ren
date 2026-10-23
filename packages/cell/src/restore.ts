export * as Restore from "./restore.js"

import type { BrainRejectedError } from "@ren/host-api/errors"
import type { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Schema } from "effect"
import { Cell } from "./cell.js"
import { Harness } from "./harness/harness.js"
import { Sync } from "./sync.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Restore.Unavailable", { message: Schema.String }) {}

export interface Interface {
  readonly ensure: (
    chat: Session.ID,
    options?: { readonly isStarting?: boolean },
  ) => Effect.Effect<void, Unavailable | BrainRejectedError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Restore") {}

// oxlint-disable-next-line ren/no-comments -- A chat comes back from Ren on its first request, with its whole group, parents first (E98, E103). Ren unreachable: Unavailable, and the restore flag stays for the next request. A chat that brain.start is starting is left to that start, which has the whole start input from Ren.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sync = yield* Sync.Service
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
                options.isStarting && input.sessionId === chat ? Effect.void : harness.transcript.start(input),
              import: harness.transcript.restore,
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
