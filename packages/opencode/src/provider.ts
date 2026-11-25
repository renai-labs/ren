export * as RenProvider from "./provider.js"

import { Model, type Plugin, Provider } from "@opencode/plugin/effect"
import { Session } from "@ren/schema/session"
import { SessionModel } from "@ren/schema/session/model"
import { Array, Context, Deferred, Effect, Layer, Option, Queue, Schedule, Schema, Semaphore, Stream } from "effect"
import { Binding } from "./binding.js"
import { RenModel } from "./model.js"
import { RenApi } from "./ren.js"
import { Title } from "./title.js"

export const ids = [Provider.ID.make("ren"), Provider.ID.make("ren-cloud")] as const
const names: Record<string, string> = { ren: "Ren", "ren-cloud": "Ren Cloud" }
const packageName = "@renai-labs/opencode"
const source = `aisdk:${packageName}`

export const taken =
  "OpenCode already has providers ren and ren-cloud that are not Ren’s, so Ren’s models are not registered. Rename one of them in your OpenCode config."

export interface Ref {
  readonly providerID: string
  readonly id: string
}

export class Service extends Context.Service<
  Service,
  {
    readonly id: Effect.Effect<Option.Option<Provider.ID>>
    readonly current: Effect.Effect<Option.Option<Provider.ID>>
    readonly owns: (model: Ref) => boolean
    readonly ready: Effect.Effect<void>
    readonly refresh: Effect.Effect<void>
  }
>()("@ren/opencode/RenProvider") {}

const toModel = (id: Provider.ID) => (choice: SessionModel.Choice) => ({
  ...Model.Info.default(id, Model.ID.make(`${choice.providerID}/${choice.id}`)),
  name: choice.name,
  limit: { context: 0, output: 0 },
  capabilities: { tools: true, input: ["text" as const], output: ["text" as const] },
  variants: choice.variants.map((variant) => ({ id: Model.VariantID.make(variant.id) })),
})

export const layer = (ctx: Plugin.Context) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const ren = yield* RenApi.Service
      const bindings = yield* Binding.Service
      const titles = yield* Title.Service
      const same = Array.makeEquivalence(Schema.toEquivalence(SessionModel.Choice))
      const state: {
        models: ReadonlyArray<SessionModel.Choice>
        id: Provider.ID | undefined
        added: Provider.ID | undefined
      } = { models: [], id: ids.at(0), added: undefined }
      const loaded = yield* Deferred.make<void>()
      const changes = yield* Queue.unbounded<Provider.ID | undefined>()
      const lock = yield* Semaphore.make(1)
      const refresh = Effect.gen(function* () {
        const client = yield* ren.client
        const spaceId = yield* bindings.space
        return (yield* client.chat.models({ id: Session.ID.create(), spaceId })).models
      }).pipe(
        Effect.catchTag("RenAuth.SignedOut", () => Effect.succeed(Array.empty<SessionModel.Choice>())),
        Effect.flatMap((models) => {
          if (same(models, state.models)) return Effect.void
          state.models = models
          return ctx.provider.reload()
        }),
        Effect.catch((error) => Effect.logWarning("Could not list the Ren models", error)),
        (listing) => lock.withPermit(listing),
      )
      yield* ctx.provider.transform((editor) => {
        const id = state.id
        state.added = undefined
        if (!id || state.models.length === 0 || editor.get(id)) return
        state.added = id
        editor.add({
          info: { id, name: names[id] ?? "Ren", activation: "auto", package: source },
          models: state.models.map(toModel(id)),
        })
      })
      yield* ctx.model.transform((editor) => {
        const next = ids.find((id) => {
          const record = editor.provider.get(id)
          return (
            !record ||
            (state.added === id && record.provider.package === source && record.provider.activation === "auto")
          )
        })
        if (next === state.id) return
        state.id = next
        Queue.offerUnsafe(changes, next)
      })
      yield* Stream.fromQueue(changes).pipe(
        Stream.runForEach((next) =>
          (next
            ? Effect.logInfo(`The Ren plugin registers its models under the provider ${next}`)
            : Effect.logWarning(taken)
          ).pipe(Effect.andThen(ctx.provider.reload())),
        ),
        Effect.forkScoped,
      )
      yield* refresh.pipe(
        Effect.ensuring(Deferred.succeed(loaded, undefined)),
        Effect.andThen(refresh.pipe(Effect.repeat(Schedule.spaced("5 minutes")), Effect.delay("5 minutes"))),
        Effect.forkScoped,
      )
      const context = yield* Effect.context<RenModel.Services>()
      const ours = (providerID: string) => Boolean(state.id) && providerID === state.id
      yield* ctx.aisdk.hook("sdk", (event) =>
        Effect.sync(() => {
          if (event.package !== packageName) return
          event.sdk = { languageModel: (modelID: string) => RenModel.make(modelID, context, ctx.session) }
        }),
      )
      yield* ctx.session.hook("model.request", (event) =>
        Effect.sync(() => {
          if (!ours(event.model.providerID)) return
          event.headers[RenModel.kindHeader] = event.kind
          if (event.model.variant && event.model.variant !== "default")
            event.headers[RenModel.variantHeader] = event.model.variant
        }),
      )
      yield* ctx.session.hook("retry", (event) =>
        Effect.sync(() => {
          if (ours(event.model.providerID)) event.decision = { retry: false }
        }),
      )
      yield* ctx.session.hook("title", (event) =>
        Effect.gen(function* () {
          if (!ours(event.model.providerID)) return
          const title = yield* Effect.gen(function* () {
            const sessionID = yield* Schema.decodeUnknownEffect(Session.ID)(event.sessionID)
            const created = Option.flatMapNullishOr(yield* bindings.get(sessionID), (info) => info.sessionId)
            if (Option.isNone(created)) return ""
            const client = yield* ren.client
            const found = (yield* client.session.get({ idOrSlug: created.value })).title ?? ""
            yield* titles.seen(sessionID, found)
            return found
          }).pipe(Effect.orElseSucceed(() => ""))
          event.result = title
        }),
      )
      return Service.of({
        id: ctx.model.list().pipe(Effect.ignore, Effect.andThen(Effect.sync(() => Option.fromNullishOr(state.id)))),
        current: Effect.sync(() => Option.fromNullishOr(state.id)),
        owns: (model) =>
          ours(model.providerID) ||
          (ids.some((id) => id === model.providerID) &&
            state.models.some((choice) => SessionModel.key(choice) === model.id)),
        ready: Deferred.await(loaded).pipe(Effect.timeoutOption("30 seconds"), Effect.asVoid),
        refresh,
      })
    }),
  )
