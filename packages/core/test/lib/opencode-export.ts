export * as OpenCodeExport from "./opencode-export.js"

import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { Effect, Schema } from "effect"

// oxlint-disable-next-line ren/no-comments -- A person's own OpenCode, on the stub model: it runs the turns and exports the session as its HTTP API does, the JSON a client sends to session.import. It is gone before Ren imports, as a laptop's folder is not on a brain.
export const make = (title: string, turns: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = Shared.stub()
      const host = yield* OpenCodeHost.make(
        Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
          Shared.vars(stub.url).OPENCODE_CONFIG,
        ),
      )
      const created = yield* Effect.promise(() =>
        host.promise.session.create({
          title,
          location: host.location,
          model: { providerID: "stub", id: "stub-model" },
        }),
      )
      yield* Effect.forEach(
        turns,
        (reply) =>
          Effect.gen(function* () {
            const script = stub.script({ reply })
            yield* Effect.promise(() => host.promise.session.prompt({ sessionID: created.id, text: script.marker }))
            yield* Effect.promise(() => host.promise.experimental.session.wait({ sessionID: created.id }))
          }),
        { discard: true },
      )
      const transcript = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
        JSON.stringify(
          yield* Effect.promise(() => host.promise.experimental.session.export({ sessionID: created.id })),
        ),
      )
      return { id: Session.ID.make(created.id), transcript }
    }),
  )
