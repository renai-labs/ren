export * as Chat from "./chat.js"

import { ChatApi } from "@ren/protocol/chat"
import { ConflictError, InvalidRequestError, NotFoundError } from "@ren/protocol/errors"
import type { SessionEvent } from "@ren/schema/session/event"
import { Clock, Deferred, Effect, Layer, Option, Predicate, Ref, Result, Stream } from "effect"
import { Base64Url } from "effect/encoding"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Cell } from "./cell.js"
import type { Harness } from "./harness/harness.js"

type Services = Cell.Info | Cell.Activity | Harness.Service

const prefix = "/chat"

const userHeader = "ren-user"

const userNameHeader = "ren-user-name"

export const setMember = (headers: Headers, member: { readonly sub?: string; readonly name?: string }) => {
  headers.delete(userHeader)
  headers.delete(userNameHeader)
  if (!member.sub) return
  headers.set(userHeader, member.sub)
  if (member.name) headers.set(userNameHeader, Base64Url.encode(member.name))
}

export const owns = (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

const notFound = (error: Harness.NotFound) => new NotFoundError({ message: error.message })
const rejected = (error: Harness.Rejected) => new InvalidRequestError({ message: error.message })
const conflict = (error: Harness.Conflict) => new ConflictError({ message: error.message })

const frame = <const Type extends "server.heartbeat">(type: Type) =>
  Effect.map(Clock.currentTimeMillis, (created) => ({ id: `evt_${type}_${created}`, created, type, data: {} }))

export const frames = (input: {
  readonly live: Stream.Stream<SessionEvent.Event | typeof SessionEvent.Connected.Type, Error>
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

const events = Stream.unwrap(
  Effect.gen(function* () {
    const info = yield* Cell.Info
    const harness = yield* Cell.acquire
    return frames({
      live: harness.chat.events,
      active: harness.chat.active,
      idleMs: info.vars.CHAT_IDLE_MS,
      heartbeatMs: info.vars.CHAT_HEARTBEAT_MS,
    })
  }),
)

const sender = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
  Option.map(Option.fromNullishOr(request.headers[userHeader]), (userId): Harness.Sender => {
    const name = Option.fromNullishOr(request.headers[userNameHeader]).pipe(
      Option.flatMap((encoded) => Result.getSuccess(Base64Url.decodeString(encoded))),
      Option.filter((decoded) => decoded.trim().length > 0),
    )
    return { userId, ...(Option.isSome(name) && { name: name.value }) }
  }),
)

const handlers = Layer.mergeAll(
  HttpApiBuilder.group(ChatApi, "event", (group) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<Services>()
      return group.handle("event.subscribe", () => Effect.succeed(events.pipe(Stream.provideContext(context))))
    }),
  ),
  HttpApiBuilder.group(ChatApi, "model", (group) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<Services>()
      return group.handle("model.list", () =>
        Effect.flatMap(Cell.acquire, (harness) => harness.chat.models).pipe(Effect.scoped, Effect.provide(context)),
      )
    }),
  ),
  HttpApiBuilder.group(ChatApi, "session", (group) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<Services>()
      const run = <A, E>(use: (chat: Harness.Chat) => Effect.Effect<A, E, HttpServerRequest.HttpServerRequest>) =>
        Effect.flatMap(Cell.acquire, (harness) => use(harness.chat)).pipe(Effect.scoped, Effect.provide(context))
      return group
        .handle("session.get", (request) =>
          run((chat) => chat.get(request.params.sessionID).pipe(Effect.mapError(notFound))),
        )
        .handle("session.status", () => run((chat) => chat.status))
        .handle("session.messages", (request) =>
          run((chat) =>
            chat
              .messages(request.params.sessionID, {
                ...(request.query.limit ? { limit: request.query.limit } : {}),
                ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
              })
              .pipe(
                Effect.catchTags({
                  "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                  "Harness.Rejected": (e) => Effect.fail(rejected(e)),
                }),
              ),
          ),
        )
        .handle("session.message", (request) =>
          run((chat) =>
            chat.message(request.params.sessionID, request.params.messageID).pipe(Effect.mapError(notFound)),
          ),
        )
        .handle("session.children", (request) =>
          run((chat) => chat.children(request.params.sessionID).pipe(Effect.mapError(notFound))),
        )
        .handle("session.inbox.list", (request) =>
          run((chat) => chat.inbox(request.params.sessionID).pipe(Effect.mapError(notFound))),
        )
        .handle("session.permission.list", (request) =>
          run((chat) => chat.permissions(request.params.sessionID).pipe(Effect.mapError(notFound))),
        )
        .handle("session.form.list", (request) =>
          run((chat) => chat.forms(request.params.sessionID).pipe(Effect.mapError(notFound))),
        )
        .handle("session.prompt", (request) =>
          run((chat) =>
            Effect.gen(function* () {
              yield* chat.prompt(request.params.sessionID, {
                id: request.payload.id,
                text: request.payload.text,
                delivery: request.payload.delivery,
                ...(Predicate.isBoolean(request.payload.resume) && { resume: request.payload.resume }),
                ...(request.payload.agents && { agents: request.payload.agents }),
                ...(request.payload.skills && { skills: request.payload.skills }),
                sender: yield* sender,
              })
              return { id: request.payload.id }
            }).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Conflict": (e) => Effect.fail(conflict(e)),
              }),
            ),
          ),
        )
        .handle("session.compact", (request) =>
          run((chat) =>
            chat.compact(request.params.sessionID, request.payload.id).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Conflict": (e) => Effect.fail(conflict(e)),
              }),
            ),
          ),
        )
        .handle("session.interrupt", (request) =>
          run((chat) =>
            chat
              .interrupt(request.params.sessionID, { resume: request.query.resume === true })
              .pipe(Effect.mapError(notFound)),
          ),
        )
        .handle("session.background", (request) =>
          run((chat) => chat.background(request.params.sessionID).pipe(Effect.mapError(notFound))),
        )
        .handle("session.rename", (request) =>
          run((chat) => chat.rename(request.params.sessionID, request.payload.title).pipe(Effect.mapError(notFound))),
        )
        .handle("session.revert.stage", (request) =>
          run((chat) =>
            chat.revert.stage(request.params.sessionID, request.payload.messageID).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Conflict": (e) => Effect.fail(conflict(e)),
              }),
            ),
          ),
        )
        .handle("session.revert.clear", (request) =>
          run((chat) =>
            chat.revert.clear(request.params.sessionID).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Conflict": (e) => Effect.fail(conflict(e)),
              }),
            ),
          ),
        )
        .handle("session.revert.commit", (request) =>
          run((chat) =>
            chat.revert.commit(request.params.sessionID).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Conflict": (e) => Effect.fail(conflict(e)),
              }),
            ),
          ),
        )
        .handle("session.inbox.cancel", (request) =>
          run((chat) =>
            chat.cancelInbox(request.params.sessionID, request.params.inboxID).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Conflict": (e) => Effect.fail(conflict(e)),
              }),
            ),
          ),
        )
        .handle("session.inbox.update", (request) =>
          run((chat) =>
            chat.updateInbox(request.params.sessionID, request.params.inboxID, request.payload.delivery).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Conflict": (e) => Effect.fail(conflict(e)),
              }),
            ),
          ),
        )
        .handle("session.command", (request) =>
          run((chat) =>
            chat
              .command(request.params.sessionID, {
                name: request.payload.name,
                text: request.payload.text,
                delivery: request.payload.delivery,
                ...(request.payload.agents && { agents: request.payload.agents }),
                ...(request.payload.skills && { skills: request.payload.skills }),
              })
              .pipe(Effect.mapError(notFound)),
          ),
        )
        .handle("session.model.switch", (request) =>
          Effect.gen(function* () {
            const info = yield* Cell.Info
            if (request.params.sessionID !== info.sessionId)
              return yield* new InvalidRequestError({ message: "A subagent’s model comes from its parent session" })
            const harness = yield* Cell.acquire
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
          }).pipe(Effect.scoped, Effect.provide(context)),
        )
        .handle("session.permission.reply", (request) =>
          run((chat) =>
            chat
              .replyPermission(
                request.params.sessionID,
                request.params.requestID,
                request.payload.reply,
                request.payload.message,
              )
              .pipe(Effect.mapError(notFound)),
          ),
        )
        .handle("session.form.reply", (request) =>
          run((chat) =>
            chat.replyForm(request.params.sessionID, request.params.formID, request.payload.answer).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Conflict": (e) => Effect.fail(conflict(e)),
                "Harness.Rejected": (e) => Effect.fail(rejected(e)),
              }),
            ),
          ),
        )
        .handle("session.form.cancel", (request) =>
          run((chat) =>
            chat.cancelForm(request.params.sessionID, request.params.formID).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Conflict": (e) => Effect.fail(conflict(e)),
              }),
            ),
          ),
        )
    }),
  ),
  HttpApiBuilder.group(ChatApi, "shell", (group) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<Services>()
      const run = <A, E>(use: (chat: Harness.Chat) => Effect.Effect<A, E>) =>
        Effect.flatMap(Cell.acquire, (harness) => use(harness.chat)).pipe(Effect.scoped, Effect.provide(context))
      return group
        .handle("shell.list", (request) =>
          run((chat) => chat.shells(request.params.sessionID).pipe(Effect.mapError(notFound))),
        )
        .handle("shell.output", (request) =>
          run((chat) =>
            chat
              .shellOutput(request.params.sessionID, request.params.shellID, {
                ...(Predicate.isNumber(request.query.cursor) && { cursor: request.query.cursor }),
                ...(Predicate.isNumber(request.query.limit) && { limit: request.query.limit }),
              })
              .pipe(Effect.mapError(notFound)),
          ),
        )
        .handle("shell.remove", (request) =>
          run((chat) =>
            chat.removeShell(request.params.sessionID, request.params.shellID).pipe(Effect.mapError(notFound)),
          ),
        )
    }),
  ),
  HttpApiBuilder.group(ChatApi, "agent", (group) =>
    Effect.map(Effect.context<Services>(), (context) =>
      group.handle("agent.list", (request) =>
        Effect.flatMap(Cell.acquire, (harness) => harness.chat.agents(request.params.sessionID)).pipe(
          Effect.mapError(notFound),
          Effect.scoped,
          Effect.provide(context),
        ),
      ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "skill", (group) =>
    Effect.map(Effect.context<Services>(), (context) =>
      group.handle("skill.list", (request) =>
        Effect.flatMap(Cell.acquire, (harness) => harness.chat.skills(request.params.sessionID)).pipe(
          Effect.mapError(notFound),
          Effect.scoped,
          Effect.provide(context),
        ),
      ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "command", (group) =>
    Effect.map(Effect.context<Services>(), (context) =>
      group.handle("command.list", (request) =>
        Effect.flatMap(Cell.acquire, (harness) => harness.chat.commands(request.params.sessionID)).pipe(
          Effect.mapError(notFound),
          Effect.scoped,
          Effect.provide(context),
        ),
      ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "file", (group) =>
    Effect.map(Effect.context<Services>(), (context) =>
      group.handle("file.search", (request) =>
        Effect.flatMap(Cell.acquire, (harness) =>
          harness.chat.files(request.params.sessionID, {
            query: request.query.query,
            ...(request.query.type && { type: request.query.type }),
            ...(Predicate.isNumber(request.query.limit) && { limit: request.query.limit }),
          }),
        ).pipe(Effect.mapError(notFound), Effect.scoped, Effect.provide(context)),
      ),
    ),
  ),
  HttpApiBuilder.group(ChatApi, "websearch", (group) =>
    Effect.map(Effect.context<Services>(), (context) =>
      group.handle("websearch.providers", (request) =>
        Effect.flatMap(Cell.acquire, (harness) => harness.chat.webSearchProviders(request.params.sessionID)).pipe(
          Effect.mapError(notFound),
          Effect.scoped,
          Effect.provide(context),
        ),
      ),
    ),
  ),
)

export const layer = Layer.effect(
  Cell.Chat,
  Effect.gen(function* () {
    const app = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(ChatApi).pipe(Layer.provide(handlers), Layer.provide(HttpServer.layerServices)),
    )
    const context = yield* Effect.context<Services>()
    return Cell.Chat.of({ owns, fetch: HttpEffect.toWebHandler(app.pipe(Effect.provide(context))) })
  }),
)
