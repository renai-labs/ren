export * as Info from "./info.js"

import { Session } from "@ren/schema/session"
import type { SessionLinks } from "@ren/schema/session/links"
import { Effect, Option, Schema, Struct } from "effect"
import { Binding } from "./binding.js"
import { Mirror } from "./mirror.js"
import { RenApi } from "./ren.js"
import type { RenRpc } from "./rpc.js"

class Unavailable extends Schema.TaggedError<Unavailable>()("Info.Unavailable", { message: Schema.String }) {}

const Options = Schema.Struct({ appUrl: Schema.optional(Schema.String) })

const noLinks: SessionLinks.Info = { tasks: [], pullRequests: [], issues: [], threads: [] }

export const webApp = (server: URL, option: string | undefined) => {
  const chosen = option ? URL.parse(option) : null
  if (chosen && ["http:", "https:"].includes(chosen.protocol)) return chosen.href.replace(/\/$/u, "")
  const app = new URL(server.origin)
  if (["localhost", "127.0.0.1", "[::1]"].includes(app.hostname) && app.port === "4000") app.port = "5173"
  else if (app.hostname.startsWith("api.")) app.hostname = app.hostname.slice("api.".length)
  return app.origin
}

export const make = (options: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const ren = yield* RenApi.Service
    const bindings = yield* Binding.Service
    const mirror = yield* Mirror.Service
    const app = webApp(
      ren.server,
      Schema.decodeUnknownOption(Options)(options).pipe(
        Option.flatMapNullishOr((value) => value.appUrl),
        Option.getOrUndefined,
      ),
    )
    const local = (sessionID: string): RenRpc.Details => ({
      sessionID,
      ren: false,
      created: false,
      app,
      url: null,
      space: null,
      startedBy: null,
      origin: null,
      links: noLinks,
      pullRequests: [],
      context: null,
      cost: null,
    })

    return Effect.fn("Info.get")(function* (sessionID: string) {
      const id = Schema.decodeUnknownOption(Session.ID)(sessionID)
      if (Option.isNone(id)) return local(sessionID)
      const bound = Option.filter(
        yield* bindings.get(id.value).pipe(Effect.orElseSucceed(() => Option.none<Binding.Info>())),
        (info) => !info.sessionId || info.sessionId === id.value,
      )
      if (Option.isNone(bound)) return local(sessionID)
      const client = yield* ren.client
      const found = yield* client.space
        .get({ idOrSlug: bound.value.spaceId })
        .pipe(Effect.mapError(() => new Unavailable({ message: "Ren did not find this session’s space." })))
      const space = Struct.pick(found, ["id", "slug", "name", "kind", "description"])
      const sessionId = bound.value.sessionId
      if (!sessionId) return Struct.assign(local(sessionID), { ren: true, url: `${app}/spaces/${space.id}`, space })
      const session = yield* client.session
        .get({ idOrSlug: sessionId })
        .pipe(Effect.mapError(() => new Unavailable({ message: "Ren did not find this session." })))
      const me = yield* mirror.me
      const links = yield* client.link.session.links({ id: sessionId }).pipe(Effect.orElseSucceed(() => noLinks))
      const read = yield* Effect.all(
        {
          startedBy: Option.contains(me, session.createdBy)
            ? Effect.succeed("You")
            : mirror.name(session.spaceId, session.createdBy),
          pullRequests:
            links.pullRequests.length > 0
              ? client.link.session.pullRequests({ id: sessionId }).pipe(Effect.orElseSucceed(() => []))
              : Effect.succeed([]),
          cost: client.link.session.usage({ id: sessionId }).pipe(Effect.orElseSucceed(() => null)),
          messages: client.chat.messages({ id: sessionId, limit: 20 }).pipe(
            Effect.map((page) => page.items),
            Effect.orElseSucceed(() => []),
          ),
        },
        { concurrency: "unbounded" },
      )
      const compacted = read.messages.findIndex(
        (message) => message.type === "compaction" && message.status === "completed",
      )
      const step = read.messages
        .slice(0, compacted === -1 ? undefined : compacted)
        .find((message) => message.type === "assistant" && message.tokens)
      const tokens = step?.type === "assistant" ? step.tokens : undefined
      return Struct.assign(local(sessionID), {
        ren: true,
        created: true,
        url: `${app}/sessions/${sessionId}`,
        space,
        startedBy: read.startedBy,
        origin: session.origin,
        links,
        pullRequests: read.pullRequests,
        context: tokens
          ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
          : null,
        cost: read.cost,
      })
    })
  })
