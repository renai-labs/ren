export * as Chat from "./chat.js"

import { ChatApi } from "@ren/protocol/chat"
import { ConflictError, InvalidRequestError, NotFoundError } from "@ren/protocol/errors"
import type { SessionEvent } from "@ren/schema/session-event"
import { Clock, Effect, Layer, Option, Ref, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Cell } from "./cell.js"
import type { Harness } from "./harness/harness.js"

type Services = Cell.Info | Cell.Activity | Harness.Service

const prefix = "/chat"

export const userHeader = "ren-user"

export const owns = (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

const notFound = (error: Harness.NotFound) => new NotFoundError({ message: error.message })
const rejected = (error: Harness.Rejected) => new InvalidRequestError({ message: error.message })
const conflict = (error: Harness.Conflict) => new ConflictError({ message: error.message })

const frame = <const Type extends "server.connected" | "server.heartbeat">(type: Type) =>
  Effect.map(Clock.currentTimeMillis, (created) => ({ id: `evt_${type}_${created}`, created, type, data: {} }))

export const events = Stream.unwrap(
  Effect.gen(function* () {
    const info = yield* Cell.Info
    const harness = yield* Cell.acquire
    const last = yield* Ref.make(yield* Clock.currentTimeMillis)
    const live = harness.chat.events.pipe(
      Stream.tap(() => Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(last, now))),
      Stream.map((event): SessionEvent.Frame => event),
    )
    const ticks = Stream.tick(`${info.vars.CHAT_HEARTBEAT_MS} millis`).pipe(
      Stream.drop(1),
      Stream.mapEffect(
        Effect.fnUntraced(function* () {
          const now = yield* Clock.currentTimeMillis
          const quiet = now - (yield* Ref.get(last)) >= info.vars.CHAT_IDLE_MS
          if (quiet && !(yield* harness.chat.active))
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
    return Stream.fromEffect(frame("server.connected")).pipe(
      Stream.concat(Stream.merge(live, ticks, { haltStrategy: "either" })),
      Stream.takeUntil((event) => event.type === "stream.ended"),
      Stream.catch(() => Stream.empty),
    )
  }),
)

const sender = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
  Option.map(Option.fromNullishOr(request.headers[userHeader]), (userId) => ({ userId })),
)

export const handlers = Layer.mergeAll(
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
        .handle("session.interrupt", (request) =>
          run((chat) => chat.interrupt(request.params.sessionID).pipe(Effect.mapError(notFound))),
        )
        .handle("session.model.switch", (request) =>
          run((chat) =>
            chat.switchModel(request.params.sessionID, request.payload.model).pipe(
              Effect.catchTags({
                "Harness.NotFound": (e) => Effect.fail(notFound(e)),
                "Harness.Rejected": (e) => Effect.fail(rejected(e)),
              }),
            ),
          ),
        )
        .handle("session.permission.reply", (request) =>
          run((chat) =>
            chat
              .replyPermission(request.params.sessionID, request.params.requestID, request.payload.reply)
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
