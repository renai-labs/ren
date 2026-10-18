import { SessionDirectory } from "@ren/core/session/directory"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { Primitive } from "../primitive.js"

export const SessionHandler = HttpApiBuilder.group(Api, "session", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* SessionDirectory.Service
    return handlers
      .handle("session.list", Primitive.list(sessions.list))
      .handle("session.get", Primitive.get(sessions.get))
      .handle("session.create", Primitive.create(sessions.create))
      .handle("session.archive", Primitive.archive(sessions.archive))
  }),
)
