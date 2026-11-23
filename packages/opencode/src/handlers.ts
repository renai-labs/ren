export * as RenHandlers from "./handlers.js"

import { Model, type Plugin, Provider, type Rpc } from "@opencode/plugin/effect"
import { Session } from "@ren/schema/session"
import { SessionModel } from "@ren/schema/session/model"
import type { Space } from "@ren/schema/space"
import { Deferred, Effect, FiberHandle, Option, Schema, Scope, Stream, Struct } from "effect"
import { RenAuth } from "./auth.js"
import { Binding } from "./binding.js"
import { Mirror } from "./mirror.js"
import { RenApi } from "./ren.js"
import { Requests } from "./requests.js"
import { RenRpc } from "./rpc.js"
import { Sessions } from "./sessions.js"
import { Status } from "./status.js"

class Unavailable extends Schema.TaggedError<Unavailable>()("RenHandlers.Unavailable", { message: Schema.String }) {}

type Methods = (typeof RenRpc.Definition)["methods"]

const answer =
  (context: { readonly error: Rpc.ErrorFactory<Methods["getSpace"]> }) =>
  (error: RenAuth.SignedOut | { readonly message: string }) =>
    error instanceof RenAuth.SignedOut
      ? context.error("signed_out", error.message, { server: error.server })
      : context.error("unavailable", error.message, {})

const info = (space: Space.Info): RenRpc.SpaceInfo => Struct.pick(space, ["id", "slug", "name", "kind", "description"])

export const register = Effect.fn("RenHandlers.register")(function* (
  ctx: Plugin.Context,
  refresh: Effect.Effect<void>,
) {
  const ren = yield* RenApi.Service
  const bindings = yield* Binding.Service
  const mirror = yield* Mirror.Service
  const scope = yield* Scope.Scope
  const emitter = yield* Deferred.make<(space: RenRpc.SpaceInfo) => Effect.Effect<void, unknown>>()
  const auth = yield* RenAuth.Login
  const requests = yield* Requests.Service
  const changes = yield* requests.changes
  const sessions = yield* Sessions.Service
  const status = yield* Status.Service
  const announcer =
    yield* Deferred.make<(...args: Rpc.EventInput<typeof RenRpc.Definition>) => Effect.Effect<void, unknown>>()
  const announce = (...args: Rpc.EventInput<typeof RenRpc.Definition>) =>
    Deferred.await(announcer).pipe(
      Effect.flatMap((emit) => emit(...args)),
      Effect.catchCause((cause) => Effect.logWarning("Could not announce the Ren sign-in", cause)),
    )
  const attempts = yield* FiberHandle.make<void>()
  const pending: { attempt: string; redirect: RenAuth.Authorization["redirect"] } = {
    attempt: "",
    redirect: () => Effect.void,
  }
  const find = (spaceId: Space.ID) =>
    Effect.flatMap(ren.client, (client) =>
      client.space
        .get({ idOrSlug: spaceId })
        .pipe(Effect.mapError(() => new Unavailable({ message: `Ren has no space ${spaceId} for you.` }))),
    )
  const prepare = (spaceId: Space.ID) =>
    Effect.flatMap(ren.client, (client) => client.chat.prepare({ id: spaceId })).pipe(
      Effect.ignore,
      Effect.forkIn(scope),
    )
  const choose = Effect.fnUntraced(function* (
    spaceId: Space.ID,
    wanted: { readonly id: string; readonly variant?: string } | undefined,
  ) {
    const client = yield* ren.client
    const choices = yield* client.chat
      .models({ id: Session.ID.create(), spaceId })
      .pipe(Effect.mapError(() => new Unavailable({ message: "Could not list the models of the Ren space." })))
    const found = choices.models.find((choice) => SessionModel.key(choice) === wanted?.id)
    const variant = wanted?.variant
    const first = choices.models.at(0)
    const model: SessionModel.Ref | undefined = found
      ? {
          providerID: found.providerID,
          id: found.id,
          ...(variant && found.variants.some((each) => each.id === variant) && { variant }),
        }
      : (choices.default ?? (first && { providerID: first.providerID, id: first.id }))
    if (!model) return yield* new Unavailable({ message: "The Ren space offers no models." })
    return model
  })
  const registration = yield* ctx.rpc.register(RenRpc.Definition, {
    listSpaces: (_input, context) =>
      Effect.gen(function* () {
        const client = yield* ren.client
        const page = yield* client.space
          .list({ joined: true, page: 1, pageSize: 100 })
          .pipe(Effect.mapError(() => new Unavailable({ message: "Could not list your Ren spaces." })))
        const selected = yield* bindings.space.pipe(Effect.catchTag("Binding.NoSpace", () => Effect.succeed(null)))
        return { spaces: page.items.map(info), selected }
      }).pipe(Effect.mapError(answer(context))),
    getSpace: (_input, context) =>
      Effect.flatMap(bindings.space, find).pipe(Effect.map(info), Effect.mapError(answer(context))),
    selectSpace: (input, context) =>
      Effect.gen(function* () {
        const space = info(yield* find(input.spaceId))
        yield* bindings.select(space.id)
        yield* prepare(space.id)
        yield* refresh
        const emit = yield* Deferred.await(emitter)
        yield* emit(space).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Could not announce the Ren space", cause)),
        )
        return space
      }).pipe(Effect.mapError(answer(context))),
    createSession: (input, context) =>
      Effect.gen(function* () {
        const spaceId = yield* bindings.space
        const model = yield* choose(spaceId, input.model)
        yield* prepare(spaceId)
        return { sessionID: yield* bindings.create(spaceId, model), spaceId }
      }).pipe(Effect.mapError(answer(context))),
    account: () =>
      Effect.gen(function* () {
        const user = yield* ren.client.pipe(
          Effect.flatMap((client) => client.me.get()),
          Effect.map((me) => ({ name: me.user.name, email: me.user.email })),
          Effect.orElseSucceed(() => null),
        )
        return { server: ren.server.origin, environment: auth.environment, user }
      }),
    login: (input, context) =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<
          string,
          RenAuth.AuthError | RenAuth.FromEnvironment | RenAuth.SignInFailed
        >()
        yield* FiberHandle.run(
          attempts,
          Effect.gen(function* () {
            const authorization = yield* auth.authorize
            pending.attempt = input.attempt
            pending.redirect = authorization.redirect
            yield* Deferred.succeed(started, authorization.url)
            const credential = yield* authorization.credential
            const client = yield* ren.connect(credential.accessToken)
            const me = yield* client.me
              .get()
              .pipe(Effect.mapError(() => new RenAuth.SignInFailed({ message: "Ren did not accept the new login." })))
            yield* auth.store(credential)
            yield* refresh
            yield* announce("signedIn", { attempt: input.attempt, user: { name: me.user.name, email: me.user.email } })
          }).pipe(
            Effect.scoped,
            Effect.catch((error) =>
              Effect.flatMap(Deferred.fail(started, error), (failed) =>
                failed ? Effect.void : announce("loginFailed", { attempt: input.attempt, message: error.message }),
              ),
            ),
            Effect.onInterrupt(() =>
              Effect.flatMap(Deferred.interrupt(started), (interrupted) =>
                interrupted
                  ? Effect.void
                  : announce("loginFailed", { attempt: input.attempt, message: "Sign-in was cancelled." }),
              ),
            ),
          ),
        )
        return { url: yield* Deferred.await(started) }
      }).pipe(Effect.mapError(answer(context))),
    completeLogin: (input, context) =>
      Effect.gen(function* () {
        if (input.attempt !== pending.attempt)
          return yield* new Unavailable({ message: "That sign-in is over. Run /ren:login again." })
        yield* pending.redirect(input.url)
        return {}
      }).pipe(Effect.mapError(answer(context))),
    cancelLogin: (input) =>
      (input.attempt === pending.attempt ? FiberHandle.clear(attempts) : Effect.void).pipe(Effect.as({})),
    logout: (_input, context) =>
      Effect.gen(function* () {
        const signedOut = yield* auth.signOut
        if (signedOut) {
          yield* refresh
          yield* announce("signedOut", { server: ren.server.origin })
        }
        return { server: ren.server.origin, signedOut }
      }).pipe(Effect.mapError(answer(context))),
    moveSession: (input, context) =>
      Effect.gen(function* () {
        const sessionID = yield* Schema.decodeUnknownEffect(Session.ID)(input.sessionID).pipe(
          Effect.mapError(
            () => new Unavailable({ message: `OpenCode session ${input.sessionID} has no ID Ren accepts.` }),
          ),
        )
        const bound = Option.getOrUndefined(yield* bindings.get(sessionID))
        if (bound && bound.sessionId !== sessionID)
          return yield* new Unavailable({
            message: bound.sessionId
              ? "This session is a copy of a Ren session. It cannot move to Ren."
              : "This session is already a Ren session. Send a message to start it in Ren.",
          })
        const spaceId = bound?.spaceId ?? (yield* bindings.space)
        const model = yield* choose(spaceId, input.model)
        if (!bound) {
          const bytes = new TextEncoder().encode(JSON.stringify(input.transcript)).length
          if (bytes > Session.maxImportBytes)
            return yield* new Unavailable({
              message: `This session is ${Math.ceil(bytes / 1024 / 1024)} MiB. Ren moves a session of at most ${Session.maxImportBytes / 1024 / 1024} MiB.`,
            })
          const client = yield* ren.client
          yield* client.session
            .import({ id: sessionID, spaceId, harness: "opencode", model, transcript: input.transcript })
            .pipe(
              Effect.mapError(
                (error) =>
                  new Unavailable({
                    message:
                      error._tag === "ClientError"
                        ? `Ren did not take the session: ${error.message}`
                        : `Ren did not move the session: ${error.message}`,
                  }),
              ),
            )
          yield* bindings.set(sessionID, { spaceId, sessionId: sessionID })
        }
        yield* ctx.session
          .switchModel({
            sessionID: Binding.LocalID.make(sessionID),
            model: {
              providerID: Provider.ID.make("ren"),
              id: Model.ID.make(SessionModel.key(model)),
              ...(model.variant && { variant: Model.VariantID.make(model.variant) }),
            },
          })
          .pipe(
            Effect.mapError(
              () =>
                new Unavailable({ message: "The session is in Ren, but OpenCode did not switch it to a Ren model." }),
            ),
          )
        yield* mirror.watch(sessionID)
        yield* prepare(spaceId)
        return { sessionID, spaceId }
      }).pipe(Effect.mapError(answer(context))),
    requests: () => requests.pending,
    listSessions: (input, context) =>
      Effect.gen(function* () {
        const listed = yield* sessions.list(input)
        return { ...Struct.omit(listed, ["spaceId"]), space: info(yield* find(listed.spaceId)) }
      }).pipe(Effect.mapError(answer(context))),
    openSession: (input, context) =>
      sessions
        .open(input.sessionId, {
          existing: input.existing ?? false,
          imported: input.imported ?? false,
          queued: input.queued ?? false,
        })
        .pipe(Effect.mapError(answer(context))),
    sessionStatus: (input) => status.get(input.sessionID),
    retry: (input, context) =>
      status.retry(input.sessionID).pipe(
        Effect.map((outcome) => ({ outcome })),
        Effect.mapError(answer(context)),
      ),
  })
  yield* Deferred.succeed(emitter, (space) => registration.events.emit("spaceSelected", space))
  yield* Deferred.succeed(announcer, registration.events.emit)
  yield* changes.pipe(
    Stream.runForEach((change) =>
      (change.type === "formAsked"
        ? registration.events.emit("formAsked", change.form)
        : registration.events.emit("requestClosed", change.closed)
      ).pipe(Effect.catchCause((cause) => Effect.logWarning("Could not announce a Ren request", cause))),
    ),
    Effect.forkIn(scope),
  )
  yield* status.changes.pipe(
    Stream.runForEach((changed) =>
      registration.events
        .emit("statusChanged", changed)
        .pipe(Effect.catchCause((cause) => Effect.logWarning("Could not announce a Ren session's status", cause))),
    ),
    Effect.forkIn(scope),
  )
})
