export * as Sessions from "./sessions.js"

import type { Plugin } from "@opencode/plugin/effect"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Space } from "@ren/schema/space"
import { Context, DateTime, Effect, Layer, Option, Schedule, Schema } from "effect"
import type { RenAuth } from "./auth.js"
import { Binding } from "./binding.js"
import { Mirror } from "./mirror.js"
import { RenProvider } from "./provider.js"
import { RenApi } from "./ren.js"
import type { RenRpc } from "./rpc.js"
import { History } from "./history.js"

class OpenError extends Schema.TaggedError<OpenError>()("Sessions.OpenError", { message: Schema.String }) {}

export interface Opened {
  readonly sessionID: string
  readonly outcome: RenRpc.Outcome
  readonly import?: RenRpc.Imported
}

type Failure = OpenError | RenAuth.SignedOut | RenAuth.AuthError

export class Service extends Context.Service<
  Service,
  {
    readonly list: (filter: RenRpc.Filter) => Effect.Effect<
      {
        readonly sessions: ReadonlyArray<RenRpc.SessionSummary>
        readonly spaceId: Space.ID
        readonly page: number
        readonly pageSize: number
        readonly total: number
      },
      Failure | Binding.NoSpace
    >
    readonly open: (
      sessionId: string,
      options: { readonly existing: boolean; readonly imported: boolean; readonly queued: boolean },
    ) => Effect.Effect<Opened, Failure>
  }
>()("@ren/opencode/Sessions") {}

const Bound = Schema.Struct({ ren: Binding.Info })

const recent = 20

export const layer = (ctx: Pick<Plugin.Context, "session" | "location">) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const ren = yield* RenApi.Service
      const bindings = yield* Binding.Service
      const mirror = yield* Mirror.Service
      const provider = yield* RenProvider.Service
      const unavailable = (message: string) => () => new OpenError({ message })

      const page = (sessionId: Session.ID, limit: number, cursor: string | undefined) =>
        Effect.flatMap(ren.client, (client) =>
          client.chat.messages({ id: sessionId, limit, ...(cursor && { cursor }) }).pipe(
            Effect.retry({
              while: (error) => error._tag === "UnavailableError",
              schedule: Schedule.spaced("2 seconds"),
              times: 5,
            }),
          ),
        )

      const transcript = (
        sessionId: Session.ID,
        limit: number,
        cursor: string | undefined,
        newest: ReadonlyArray<SessionMessage.Info>,
      ): Effect.Effect<ReadonlyArray<SessionMessage.Info>, Failure> =>
        page(sessionId, limit, cursor).pipe(
          Effect.mapError((error) =>
            error._tag === "RenAuth.SignedOut" || error._tag === "RenAuth.AuthError" || error._tag === "TooLargeError"
              ? error
              : new OpenError({ message: "Could not read the Ren session’s messages." }),
          ),
          Effect.matchEffect({
            onFailure: (error) =>
              error._tag === "TooLargeError" && limit > 1
                ? transcript(sessionId, Math.ceil(limit / 2), cursor, newest)
                : Effect.fail(
                    error._tag === "TooLargeError"
                      ? new OpenError({ message: "A message of the Ren session is too large to open here." })
                      : error,
                  ),
            onSuccess: (found) =>
              found.cursor.next
                ? transcript(sessionId, limit, found.cursor.next, [...newest, ...found.items])
                : Effect.succeed([...newest, ...found.items].toReversed()),
          }),
        )

      const build = Effect.fnUntraced(function* (sessionId: Session.ID, messages: ReadonlyArray<SessionMessage.Info>) {
        const client = yield* ren.client
        const info = yield* client.session
          .get({ idOrSlug: sessionId })
          .pipe(Effect.mapError(unavailable(`Ren has no session ${sessionId} for you.`)))
        const model =
          History.current(messages) ??
          (yield* client.chat.models({ id: sessionId, spaceId: info.spaceId }).pipe(
            Effect.map((choices) => choices.default ?? choices.models.at(0)),
            Effect.mapError(unavailable("Could not list the models of the Ren space.")),
          ))
        if (!model) return yield* new OpenError({ message: "The Ren session’s space offers no models." })
        const providerID = yield* provider.id
        if (Option.isNone(providerID)) return yield* new OpenError({ message: RenProvider.taken })
        const speakers = new Map(
          yield* Effect.forEach(
            messages.filter((message): message is SessionMessage.User => message.type === "user"),
            (message) => Effect.map(mirror.speaker(info.spaceId, message), (speaker) => [message.id, speaker] as const),
          ),
        )
        return {
          info: {
            id: sessionId,
            projectID: ctx.location.project.id,
            model: History.model(model, providerID.value),
            ...(info.title && { title: info.title }),
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: DateTime.toEpochMillis(info.createdAt), updated: DateTime.toEpochMillis(info.updatedAt) },
            metadata: { ren: { spaceId: info.spaceId, sessionId } },
            location: { directory: ctx.location.directory },
          },
          messages: messages
            .filter(History.isSettled)
            .map((message) => History.toOpenCode(message, providerID.value, speakers.get(message.id))),
        } satisfies RenRpc.Imported
      })

      const catchUp = Effect.fnUntraced(function* (
        sessionId: Session.ID,
        time: { readonly busy?: DateTime.Utc | undefined; readonly idle?: DateTime.Utc | undefined },
        options: { readonly queued: boolean },
      ) {
        const sessionID = Binding.LocalID.make(sessionId)
        const read = ctx.session
          .context({ sessionID })
          .pipe(Effect.mapError(unavailable("Could not read the local session’s messages.")))
        const window = yield* page(sessionId, recent, undefined).pipe(
          Effect.mapError(unavailable("Could not read the Ren session’s messages.")),
        )
        if (!History.behind(window.items.toReversed(), yield* read)) return "current" as const
        if (time.busy && (!time.idle || DateTime.isGreaterThan(time.busy, time.idle))) return "busy" as const
        const messages = yield* transcript(sessionId, 100, undefined, [])
        if (options.queued || History.unsent(messages, yield* read).length > 0) return "unsent" as const
        const data = yield* build(sessionId, messages)
        yield* mirror.unwatch(sessionId)
        yield* ctx.session
          .remove({ sessionID })
          .pipe(Effect.mapError(unavailable("Could not replace the local copy of the Ren session.")))
        return { sessionID, outcome: "import", import: data } satisfies Opened
      })

      return Service.of({
        list: Effect.fn("Sessions.list")(function* (filter) {
          const client = yield* ren.client
          const spaceId = yield* bindings.space
          const me = yield* mirror.me
          const search = filter.search?.trim()
          const found = yield* client.session
            .list({
              spaceId: [spaceId],
              ...(filter.scope !== "space" && Option.isSome(me) && { createdBy: [Auth.UserID.make(me.value)] }),
              ...(filter.status && { status: filter.status }),
              ...(filter.origin?.length && { origin: filter.origin }),
              ...(search && { search }),
              orderBy: "updated",
              page: filter.page ?? 1,
              pageSize: filter.pageSize ?? 50,
            })
            .pipe(Effect.mapError(unavailable("Could not list the Ren sessions.")))
          const sessions = yield* Effect.forEach(found.items, (item) =>
            Effect.gen(function* () {
              const mine = Option.contains(me, item.createdBy)
              const local = yield* ctx.session.get({ sessionID: Binding.LocalID.make(item.id) }).pipe(
                Effect.as(true),
                Effect.orElseSucceed(() => false),
              )
              return {
                id: item.id,
                title: item.title,
                startedBy: mine ? "You" : yield* mirror.name(spaceId, item.createdBy),
                mine,
                origin: item.origin,
                status: item.status,
                updated: DateTime.toEpochMillis(item.updatedAt),
                local,
              }
            }),
          )
          return { sessions, spaceId, page: found.page, pageSize: found.pageSize, total: found.total }
        }),
        open: Effect.fn("Sessions.open")(function* (raw, options) {
          const id = Schema.decodeUnknownOption(Session.ID)(raw)
          if (Option.isNone(id)) {
            if (options.existing) return { sessionID: raw, outcome: "local" } satisfies Opened
            return yield* new OpenError({ message: `${raw} is not a Ren session.` })
          }
          const sessionId = id.value
          const sessionID = Binding.LocalID.make(sessionId)
          const local = yield* ctx.session.get({ sessionID }).pipe(Effect.option)
          if (Option.isNone(local)) {
            if (options.existing) return { sessionID, outcome: "local" } satisfies Opened
            const messages = yield* transcript(sessionId, 100, undefined, [])
            return { sessionID, outcome: "import", import: yield* build(sessionId, messages) } satisfies Opened
          }
          const bound = Schema.decodeUnknownOption(Bound)(local.value.metadata)
          if (Option.isNone(bound) || bound.value.ren.sessionId !== sessionId) {
            if (options.existing) return { sessionID, outcome: "local" } satisfies Opened
            return yield* new OpenError({ message: "A local session that is not this Ren session has its ID." })
          }
          const outcome = options.imported ? "current" : yield* catchUp(sessionId, local.value.time, options)
          if (typeof outcome !== "string") return outcome
          yield* mirror.watch(sessionId)
          return { sessionID, outcome } satisfies Opened
        }),
      })
    }),
  )
