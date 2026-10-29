export * as Chat from "./chat.js"

import { ChatAccess, ChatApi } from "@ren/protocol/chat"
import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
  UnavailableError,
} from "@ren/protocol/errors"
import { Observability } from "@ren/schema/observability"
import { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import { Clock, Deferred, Effect, Layer, Option, Predicate, Ref, Result, Schema, type Scope, Stream } from "effect"
import { Base64Url } from "effect/encoding"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Cell } from "./cell.js"
import { Harness } from "./harness/harness.js"
import { HotReload } from "./hot-reload.js"
import { Restore } from "./restore.js"

type Services = Cell.Info | Cell.Activity | Harness.Service | HotReload.Service | Restore.Service

const prefix = "/chat"

const userHeader = "ren-user"

const userNameHeader = "ren-user-name"

const memberHeader = "ren-user-member"

const sessionHeader = "ren-session"

const expiresHeader = "ren-token-expires"

export const setMember = (
  headers: Headers,
  member: {
    readonly sub?: string
    readonly member?: string
    readonly name?: string
    readonly sid?: string
    readonly exp?: number
  },
) => {
  headers.delete(userHeader)
  headers.delete(userNameHeader)
  headers.delete(memberHeader)
  headers.delete(sessionHeader)
  headers.delete(expiresHeader)
  if (member.sid) headers.set(sessionHeader, member.sid)
  if (member.exp) headers.set(expiresHeader, String(member.exp))
  if (!member.sub) return
  headers.set(userHeader, member.sub)
  if (member.member) headers.set(memberHeader, member.member)
  if (member.name) headers.set(userNameHeader, Base64Url.encode(member.name))
}

export const owns = (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

const frame = <const Type extends "server.heartbeat">(type: Type) =>
  Effect.map(Clock.currentTimeMillis, (created) => ({ id: `evt_${type}_${created}`, created, type, data: {} }))

export const frames = (input: {
  readonly live: Stream.Stream<
    SessionEvent.Event | typeof SessionEvent.Connected.Type | typeof SessionEvent.Ended.Type,
    Error
  >
  readonly active: Effect.Effect<boolean>
  readonly idleMs: number
  readonly heartbeatMs: number
}): Stream.Stream<SessionEvent.Frame> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const last = yield* Ref.make(yield* Clock.currentTimeMillis)
      const connected = yield* Deferred.make<void>()
      const live = input.live.pipe(
        Stream.tap((event) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(last, now)).pipe(
            Effect.andThen(event.type === "server.connected" ? Deferred.succeed(connected, undefined) : Effect.void),
          ),
        ),
        Stream.map((event): SessionEvent.Frame => event),
      )
      const ticks = Stream.fromEffect(Deferred.await(connected)).pipe(
        Stream.flatMap(() => Stream.tick(`${input.heartbeatMs} millis`)),
        Stream.drop(1),
        Stream.mapEffect(
          Effect.fnUntraced(function* () {
            const now = yield* Clock.currentTimeMillis
            const quiet = now - (yield* Ref.get(last)) >= input.idleMs
            if (quiet && !(yield* input.active))
              return {
                id: `evt_stream.ended_${now}`,
                created: now,
                type: "stream.ended",
                data: { reason: "idle" },
              } as const
            return yield* frame("server.heartbeat")
          }),
        ),
      )
      return Stream.merge(live, ticks, { haltStrategy: "either" }).pipe(
        Stream.takeUntil((event) => event.type === "stream.ended"),
        Stream.catch((error) =>
          Stream.drain(Stream.fromEffect(Effect.logError("The chat event stream failed", error))),
        ),
      )
    }),
  )

const sessionOf = (event: SessionEvent.Event | typeof SessionEvent.Connected.Type): string | undefined => {
  const data: unknown = event.data
  if (!Predicate.isObject(data)) return undefined
  if (Predicate.hasProperty(data, "sessionID") && Predicate.isString(data.sessionID)) return data.sessionID
  for (const key of ["info", "form"] as const)
    if (Predicate.hasProperty(data, key) && Predicate.isObject(data[key])) {
      const inner = data[key]
      if (Predicate.hasProperty(inner, "sessionID") && Predicate.isString(inner.sessionID)) return inner.sessionID
    }
  return undefined
}

const isWithin = Effect.fnUntraced(function* (harness: Harness.Instance, root: string, sessionId: string) {
  let current: string | undefined = sessionId
  for (let depth = 0; current && depth < 32; depth++) {
    if (current === root) return true
    const found: Option.Option<{ readonly parentID?: string }> = yield* harness.chat
      .get(Session.ID.make(current))
      .pipe(Effect.option)
    current = Option.getOrUndefined(found)?.parentID
  }
  return false
})

const scopeOf = Effect.map(HttpServerRequest.HttpServerRequest, (request) => ({
  sid: Option.fromNullishOr(request.headers[sessionHeader]),
  exp: Option.fromNullishOr(request.headers[expiresHeader]).pipe(Option.map(Number)),
}))

const events = (scope: Effect.Success<typeof scopeOf>) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const info = yield* Cell.Info
      const harness = yield* Cell.acquire
      const allowed = new Set(Option.toArray(scope.sid))
      const shells = new Map<string, string>()
      const live = Option.isNone(scope.sid)
        ? harness.chat.events
        : harness.chat.events.pipe(
            Stream.filter((event) => {
              if (event.type === "session.created" && event.data.parentID && allowed.has(event.data.parentID))
                allowed.add(event.data.sessionID)
              if (event.type === "shell.created") shells.set(event.data.info.id, event.data.info.sessionID)
              const owner =
                event.type === "shell.exited" || event.type === "shell.deleted"
                  ? shells.get(event.data.id)
                  : sessionOf(event)
              return !owner ? event.type.startsWith("server.") : allowed.has(owner)
            }),
          )
      const expiring = Option.match(scope.exp, {
        onNone: () => live,
        onSome: (exp) =>
          Stream.merge(
            live,
            Stream.fromEffect(
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis
                yield* Effect.sleep(Math.max(0, exp * 1000 - now))
                return {
                  id: `evt_stream.ended_${exp}`,
                  created: exp * 1000,
                  type: "stream.ended",
                  data: { reason: "closing" },
                } as const
              }),
            ),
            { haltStrategy: "either" },
          ),
      })
      return frames({
        live: expiring,
        active: harness.chat.active,
        idleMs: info.vars.CHAT_IDLE_MS,
        heartbeatMs: info.vars.CHAT_HEARTBEAT_MS,
      })
    }),
  )

// oxlint-disable-next-line ren/no-comments -- workerd does not cancel a stream when its client leaves; its request signal (enable_request_signal) tells.
const disconnected = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.callback<void>((resume) => {
    if (!(request.source instanceof Request)) return
    const signal = request.source.signal
    if (signal.aborted) return resume(Effect.void)
    signal.addEventListener("abort", () => resume(Effect.void), { once: true })
  })

const sender = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
  Option.map(Option.fromNullishOr(request.headers[userHeader]), (userId): Harness.Sender => {
    const name = Option.fromNullishOr(request.headers[userNameHeader]).pipe(
      Option.flatMap((encoded) => Result.getSuccess(Base64Url.decodeString(encoded))),
      Option.filter((decoded) => decoded.trim().length > 0),
    )
    const memberId = request.headers[memberHeader]
    return { userId, ...(memberId && { memberId }), ...(Option.isSome(name) && { name: name.value }) }
  }),
)

const notFound = <A, E, R>(effect: Effect.Effect<A, E | Harness.NotFound, R>) =>
  Effect.catchIf(effect, Schema.is(Harness.NotFound), (error) =>
    Effect.fail(new NotFoundError({ message: error.message })),
  )

const conflict = <A, E, R>(effect: Effect.Effect<A, E | Harness.Conflict, R>) =>
  Effect.catchIf(effect, Schema.is(Harness.Conflict), (error) =>
    Effect.fail(new ConflictError({ message: error.message })),
  )

const rejected = <A, E, R>(effect: Effect.Effect<A, E | Harness.Rejected, R>) =>
  Effect.catchIf(effect, Schema.is(Harness.Rejected), (error) =>
    Effect.fail(new InvalidRequestError({ message: error.message })),
  )

const harnessed = Effect.map(
  Effect.context<Services>(),
  (context) =>
    <A, E, R>(use: (harness: Harness.Instance) => Effect.Effect<A, E, R>) =>
      Effect.flatMap(Cell.acquire, use).pipe(Effect.scoped, Effect.provide(context)),
)

const access = Layer.effect(
  ChatAccess,
  Effect.gen(function* () {
    const run = yield* harnessed
    const restore = yield* Restore.Service
    return ChatAccess.of(
      Effect.fnUntraced(function* (httpEffect) {
        const scope = yield* scopeOf
        const target = (yield* HttpRouter.params).sessionID
        if (!target) return yield* httpEffect
        yield* restore.ensure(Session.ID.make(Option.getOrElse(scope.sid, () => target))).pipe(
          Effect.catchTags({
            "Restore.Unavailable": (error) =>
              Effect.fail(
                new UnavailableError({
                  message: `Ren could not restore the chat: ${error.message}`,
                  retryAfterMs: 2000,
                }),
              ),
            BrainRejectedError: (error) =>
              Effect.logError("A restored chat could not start again", error).pipe(
                Effect.andThen(Effect.fail(new UnavailableError({ message: error.message, retryAfterMs: 2000 }))),
              ),
          }),
        )
        if (Option.isNone(scope.sid)) return yield* httpEffect
        const root = scope.sid.value
        if (yield* run((harness) => isWithin(harness, root, target))) return yield* httpEffect
        return yield* new ForbiddenError({ message: "The token is for another chat" })
      }),
    )
  }),
)

const handlers = Layer.mergeAll(
  HttpApiBuilder.group(ChatApi, "event", (group) =>
    Effect.map(Effect.context<Services>(), (context) =>
      group.handle("event.subscribe", () =>
        Effect.map(Effect.all({ scope: scopeOf, request: HttpServerRequest.HttpServerRequest }), (found) =>
          events(found.scope).pipe(Stream.interruptWhen(disconnected(found.request)), Stream.provideContext(context)),
        ),
      ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "model", (group) =>
    Effect.map(harnessed, (run) => group.handle("model.list", () => run((harness) => harness.chat.models))),
  ),
  HttpApiBuilder.group(ChatApi, "session", (group) =>
    Effect.map(harnessed, (run) =>
      group
        .handle("session.get", (request) => run((harness) => harness.chat.get(request.params.sessionID).pipe(notFound)))
        .handle("session.status", () =>
          run((harness) =>
            Effect.gen(function* () {
              const family = yield* harness.chat.status
              const scope = yield* scopeOf
              if (Option.isNone(scope.sid)) return family
              const root = scope.sid.value
              const kept = yield* Effect.filter(Object.keys(family), (id) => isWithin(harness, root, id))
              return Object.fromEntries(kept.flatMap((id) => (family[id] ? [[id, family[id]] as const] : [])))
            }),
          ),
        )
        .handle("session.messages", (request) =>
          run((harness) =>
            harness.chat
              .messages(request.params.sessionID, {
                ...(request.query.limit ? { limit: request.query.limit } : {}),
                ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
              })
              .pipe(notFound, rejected, (messages) =>
                request.query.cursor
                  ? messages
                  : messages.pipe(
                      Observability.Trace.chatHistory,
                      Effect.annotateSpans("ren.session.id", request.params.sessionID),
                    ),
              ),
          ),
        )
        .handle("session.message", (request) =>
          run((harness) => harness.chat.message(request.params.sessionID, request.params.messageID).pipe(notFound)),
        )
        .handle("session.children", (request) =>
          run((harness) => harness.chat.children(request.params.sessionID).pipe(notFound)),
        )
        .handle("session.inbox.list", (request) =>
          run((harness) => harness.chat.inbox(request.params.sessionID).pipe(notFound)),
        )
        .handle("session.permission.list", (request) =>
          run((harness) => harness.chat.permissions(request.params.sessionID).pipe(notFound)),
        )
        .handle("session.form.list", (request) =>
          run((harness) => harness.chat.forms(request.params.sessionID).pipe(notFound)),
        )
        .handle("session.prompt", (request) =>
          run((harness) =>
            Effect.gen(function* () {
              const hotReload = yield* HotReload.Service
              yield* hotReload.pull
              yield* harness.chat.prompt(request.params.sessionID, { ...request.payload, sender: yield* sender })
              return { id: request.payload.id }
            }).pipe(
              notFound,
              conflict,
              Observability.Trace.chatPrompt,
              Effect.annotateSpans("ren.session.id", request.params.sessionID),
            ),
          ),
        )
        .handle("session.compact", (request) =>
          run((harness) => harness.chat.compact(request.params.sessionID, request.payload.id).pipe(notFound, conflict)),
        )
        .handle("session.interrupt", (request) =>
          run((harness) =>
            harness.chat.interrupt(request.params.sessionID, { resume: request.query.resume === true }).pipe(notFound),
          ),
        )
        .handle("session.background", (request) =>
          run((harness) => harness.chat.background(request.params.sessionID).pipe(notFound)),
        )
        .handle("session.rename", (request) =>
          run((harness) => harness.chat.rename(request.params.sessionID, request.payload.title).pipe(notFound)),
        )
        .handle("session.revert.stage", (request) =>
          run((harness) =>
            harness.chat.revert.stage(request.params.sessionID, request.payload.messageID).pipe(notFound, conflict),
          ),
        )
        .handle("session.revert.clear", (request) =>
          run((harness) => harness.chat.revert.clear(request.params.sessionID).pipe(notFound, conflict)),
        )
        .handle("session.revert.commit", (request) =>
          run((harness) => harness.chat.revert.commit(request.params.sessionID).pipe(notFound, conflict)),
        )
        .handle("session.inbox.cancel", (request) =>
          run((harness) =>
            harness.chat.cancelInbox(request.params.sessionID, request.params.inboxID).pipe(notFound, conflict),
          ),
        )
        .handle("session.inbox.update", (request) =>
          run((harness) =>
            harness.chat
              .updateInbox(request.params.sessionID, request.params.inboxID, request.payload.delivery)
              .pipe(notFound, conflict),
          ),
        )
        .handle("session.command", (request) =>
          run((harness) => harness.chat.command(request.params.sessionID, request.payload).pipe(notFound)),
        )
        .handle("session.model.switch", (request) =>
          run((harness) =>
            Effect.gen(function* () {
              const session = yield* harness.chat.get(request.params.sessionID).pipe(notFound)
              if (session.parentID)
                return yield* new InvalidRequestError({ message: "A subagent’s model comes from its parent session" })
              const model = request.payload.model
              yield* harness
                .setModel(
                  request.params.sessionID,
                  Option.some({
                    endpointId: model.providerID,
                    modelId: model.id,
                    ...(model.variant && { variant: model.variant }),
                  }),
                )
                .pipe(
                  Effect.catchTags({
                    BrainRejectedError: (error) => Effect.fail(new InvalidRequestError({ message: error.message })),
                    SessionNotStartedError: (error) => Effect.fail(new NotFoundError({ message: error.message })),
                  }),
                )
            }),
          ),
        )
        .handle("session.permission.reply", (request) =>
          run((harness) =>
            harness.chat
              .replyPermission(
                request.params.sessionID,
                request.params.requestID,
                request.payload.reply,
                request.payload.message,
              )
              .pipe(notFound),
          ),
        )
        .handle("session.form.reply", (request) =>
          run((harness) =>
            harness.chat
              .replyForm(request.params.sessionID, request.params.formID, request.payload.answer)
              .pipe(notFound, conflict, rejected),
          ),
        )
        .handle("session.form.cancel", (request) =>
          run((harness) =>
            harness.chat.cancelForm(request.params.sessionID, request.params.formID).pipe(notFound, conflict),
          ),
        ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "shell", (group) =>
    Effect.map(harnessed, (run) =>
      group
        .handle("shell.list", (request) =>
          run((harness) => harness.chat.shells(request.params.sessionID).pipe(notFound)),
        )
        .handle("shell.output", (request) =>
          run((harness) =>
            harness.chat
              .shellOutput(request.params.sessionID, request.params.shellID, {
                ...(Predicate.isNumber(request.query.cursor) && { cursor: request.query.cursor }),
                ...(Predicate.isNumber(request.query.limit) && { limit: request.query.limit }),
              })
              .pipe(notFound),
          ),
        )
        .handle("shell.remove", (request) =>
          run((harness) => harness.chat.removeShell(request.params.sessionID, request.params.shellID).pipe(notFound)),
        ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "agent", (group) =>
    Effect.map(harnessed, (run) =>
      group.handle("agent.list", (request) =>
        run((harness) => harness.chat.agents(request.params.sessionID).pipe(notFound)),
      ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "skill", (group) =>
    Effect.map(harnessed, (run) =>
      group.handle("skill.list", (request) =>
        run((harness) => harness.chat.skills(request.params.sessionID).pipe(notFound)),
      ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "command", (group) =>
    Effect.map(harnessed, (run) =>
      group.handle("command.list", (request) =>
        run((harness) => harness.chat.commands(request.params.sessionID).pipe(notFound)),
      ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "file", (group) =>
    Effect.map(harnessed, (run) =>
      group.handle("file.search", (request) =>
        run((harness) =>
          harness.chat
            .files(request.params.sessionID, {
              query: request.query.query,
              ...(request.query.type && { type: request.query.type }),
              ...(Predicate.isNumber(request.query.limit) && { limit: request.query.limit }),
            })
            .pipe(notFound),
        ),
      ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "websearch", (group) =>
    Effect.map(harnessed, (run) =>
      group.handle("websearch.providers", (request) =>
        run((harness) => harness.chat.webSearchProviders(request.params.sessionID).pipe(notFound)),
      ),
    ),
  ),
)

export const layer = Layer.effect(
  Cell.Chat,
  Effect.gen(function* () {
    const app = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(ChatApi).pipe(
        Layer.provide(handlers),
        Layer.provide(access),
        Layer.provide(HttpServer.layerServices),
      ),
    )
    const context = yield* Effect.context<Services>()
    return Cell.Chat.of({
      owns,
      fetch: HttpEffect.toWebHandlerWith<Services, HttpServerRequest.HttpServerRequest | Scope.Scope>(context)(app),
    })
  }),
)
