export * as Status from "./status.js"

import type { Plugin } from "@opencode/plugin/effect"
import type { ChatAccess } from "@ren/chat/chat-access"
import type { Connection } from "@ren/chat/connection"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { Context, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect"
import { RenAuth } from "./auth.js"
import { Binding } from "./binding.js"
import { Link } from "./link.js"
import { Mirror } from "./mirror.js"
import { RenApi } from "./ren.js"
import { RenRpc } from "./rpc.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Status.Unavailable", { message: Schema.String }) {}

const isRemote = Schema.is(Schema.Struct({ remote: Schema.Literal(true) }))

const resending = "Sending the last message to Ren again."

const stateOf = (
  boot: ChatAccess.Boot,
  status: Connection.Status,
): { readonly state: RenRpc.SessionStatus["state"]; readonly detail: string } => {
  if (boot._tag === "Starting") return { state: "starting", detail: boot.phase }
  if (boot._tag === "Failed") return { state: "failed", detail: boot.reason }
  if (boot._tag === "Stopped") return { state: "stopped", detail: "" }
  if (status === "reconnecting" || boot._tag === "Ready")
    return { state: status === "connected" ? "ready" : status, detail: "" }
  return { state: "checking", detail: "" }
}

const lastTurn = (messages: Effect.Success<ReturnType<Plugin.Context["session"]["context"]>>) => {
  const latest = messages.at(-1)
  const answered = messages.findLastIndex(
    (message) => message.type === "assistant" && Boolean(message.time.completed) && !message.error,
  )
  const last = messages
    .slice(answered + 1)
    .findLast((message) => message.type === "user" && message.text.trim() !== "" && !isRemote(message.metadata))
  return {
    running: latest?.type === "assistant" && !latest.time.completed && !latest.error,
    unanswered: last?.type === "user" ? Option.some(last) : Option.none(),
  }
}

export class Service extends Context.Service<
  Service,
  {
    readonly get: (sessionID: string) => Effect.Effect<RenRpc.SessionStatus>
    readonly changes: Stream.Stream<RenRpc.SessionStatus>
    readonly retry: (
      sessionID: string,
    ) => Effect.Effect<RenRpc.Retried, Unavailable | RenAuth.SignedOut | RenAuth.AuthError>
  }
>()("@ren/opencode/Status") {}

export const layer = (ctx: Pick<Plugin.Context, "session">) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bindings = yield* Binding.Service
      const ren = yield* RenApi.Service
      const auth = yield* RenAuth.Service
      const links = yield* Link.Service
      const mirror = yield* Mirror.Service
      const names = new Map<Space.ID, string>()
      const same = Schema.toEquivalence(RenRpc.SessionStatus)

      const own = (sessionID: string) =>
        Schema.decodeUnknownEffect(Session.ID)(sessionID).pipe(
          Effect.flatMap((id) =>
            Effect.map(bindings.get(id), (bound) =>
              Option.filter(bound, (info) => !info.sessionId || info.sessionId === id),
            ),
          ),
          Effect.orElseSucceed(() => Option.none<Binding.Info>()),
        )

      const linkOf = (info: Binding.Info) =>
        Effect.map(SubscriptionRef.get(links.opened), (opened) =>
          Option.fromUndefinedOr(info.sessionId && opened.get(info.sessionId)),
        )

      const spaceName = Effect.fnUntraced(
        function* (spaceId: Space.ID) {
          const known = names.get(spaceId)
          if (known) return known
          const client = yield* ren.client
          const name = (yield* client.space.get({ idOrSlug: spaceId })).name
          names.set(spaceId, name)
          return name
        },
        Effect.orElseSucceed(() => null),
      )

      const get = Effect.fn("Status.get")(function* (sessionID: string): Effect.fn.Return<RenRpc.SessionStatus> {
        const bound = yield* own(sessionID)
        if (Option.isNone(bound))
          return { sessionID, ren: false, space: null, state: "closed", detail: "", retryAt: 0, busy: false }
        const space = yield* spaceName(bound.value.spaceId)
        const signedOut = yield* auth.token.pipe(
          Effect.as(false),
          Effect.catchTag("RenAuth.SignedOut", () => Effect.succeed(true)),
          Effect.orElseSucceed(() => false),
        )
        const link = signedOut ? Option.none<Link.Link>() : yield* linkOf(bound.value)
        if (Option.isNone(link))
          return {
            sessionID,
            ren: true,
            space,
            state: signedOut ? "signed_out" : "closed",
            detail: "",
            retryAt: 0,
            busy: false,
          }
        const brain = stateOf(
          yield* SubscriptionRef.get(link.value.boot),
          yield* SubscriptionRef.get(link.value.status),
        )
        return {
          sessionID,
          ren: true,
          space,
          state: brain.state,
          detail: brain.detail,
          retryAt: brain.state === "reconnecting" ? yield* SubscriptionRef.get(link.value.retryAt) : 0,
          busy: yield* SubscriptionRef.get(link.value.busy),
        }
      })

      const changes = SubscriptionRef.changes(links.opened).pipe(
        Stream.mapAccum(
          () => new Set<Session.ID>(),
          (previous, opened) =>
            [new Set(opened.keys()), [{ gone: [...previous].filter((id) => !opened.has(id)), opened }]] as const,
        ),
        Stream.switchMap((change) =>
          Stream.merge(
            Stream.fromIterable(change.gone),
            Stream.mergeAll(
              [...change.opened.values()].flatMap((link) => [
                Stream.as(SubscriptionRef.changes(link.boot), link.sessionId),
                Stream.as(SubscriptionRef.changes(link.status), link.sessionId),
                Stream.as(SubscriptionRef.changes(link.retryAt), link.sessionId),
                Stream.as(SubscriptionRef.changes(link.busy), link.sessionId),
              ]),
              { concurrency: "unbounded" },
            ),
          ),
        ),
        Stream.mapEffect(get),
        Stream.mapAccum(
          () => new Map<string, RenRpc.SessionStatus>(),
          (last, status) => {
            const before = last.get(status.sessionID)
            if (before && same(before, status)) return [last, []] as const
            return [new Map(last).set(status.sessionID, status), [status]] as const
          },
        ),
      )

      const restart = Effect.fnUntraced(function* (sessionId: Session.ID) {
        const client = yield* ren.client
        yield* client.chat
          .retry({ id: sessionId })
          .pipe(
            Effect.mapError(
              (error) => new Unavailable({ message: `Ren did not start the session again: ${error.message}` }),
            ),
          )
        yield* mirror.unwatch(sessionId)
        yield* links.reset(sessionId)
      })

      const saved = (sessionId: Session.ID, messageID: string) =>
        ren.client.pipe(
          Effect.flatMap((client) => client.chat.messages({ id: sessionId, limit: 20 })),
          Effect.map((page) => page.items.some((message) => String(message.id) === messageID)),
          Effect.orElseSucceed(() => false),
        )

      const retry = Effect.fn("Status.retry")(function* (sessionID: string) {
        const bound = yield* own(sessionID)
        if (Option.isNone(bound)) return yield* new Unavailable({ message: "This is not a Ren session." })
        const local = Binding.LocalID.make(sessionID)
        const messages = yield* ctx.session
          .context({ sessionID: local })
          .pipe(Effect.mapError(() => new Unavailable({ message: "Could not read the local session’s messages." })))
        const turn = lastTurn(messages)
        if (turn.running) return "running"
        const unanswered = turn.unanswered
        const resend = ctx.session
          .synthetic({ sessionID: local, text: resending, description: resending, resume: true })
          .pipe(Effect.mapError(() => new Unavailable({ message: "Could not resume the local session." })))
        const sessionId = bound.value.sessionId
        const link = yield* linkOf(bound.value)
        const boot = Option.isSome(link) ? (yield* SubscriptionRef.get(link.value.boot))._tag : "Checking"
        if (sessionId && (boot === "Failed" || boot === "Stopped")) {
          yield* restart(sessionId)
          if (Option.isNone(unanswered)) {
            yield* mirror.watch(sessionId)
            return "restarted"
          }
          yield* resend
          return "restarted_resent"
        }
        if (Option.isNone(unanswered)) return "nothing"
        if (sessionId && (yield* saved(sessionId, unanswered.value.id))) {
          yield* ctx.session
            .prompt({ sessionID: local, text: unanswered.value.text, resume: true })
            .pipe(Effect.mapError(() => new Unavailable({ message: "Could not send the message again." })))
          return "sent_again"
        }
        yield* resend
        return "resumed"
      })

      return Service.of({ get, changes, retry })
    }),
  )
