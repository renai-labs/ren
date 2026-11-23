export * as RenProvider from "./provider.js"

import { Model, type Plugin, Provider } from "@opencode/plugin/effect"
import { Session } from "@ren/schema/session"
import { SessionModel } from "@ren/schema/session/model"
import { Array, Effect, Option, Schedule, Schema } from "effect"
import { Binding } from "./binding.js"
import { RenModel } from "./model.js"
import { RenApi } from "./ren.js"

const id = Provider.ID.make("ren")
const packageName = "@renai-labs/opencode"

const toModel = (choice: SessionModel.Choice): Model.Info => ({
  ...Model.Info.default(id, Model.ID.make(`${choice.providerID}/${choice.id}`)),
  name: choice.name,
  limit: { context: 0, output: 0 },
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: choice.variants.map((variant) => ({ id: Model.VariantID.make(variant.id) })),
})

export const register = Effect.fn("RenProvider.register")(function* (ctx: Plugin.Context) {
  const ren = yield* RenApi.Service
  const bindings = yield* Binding.Service
  const same = Array.makeEquivalence(Schema.toEquivalence(SessionModel.Choice))
  const current: { models: ReadonlyArray<SessionModel.Choice> } = { models: [] }
  const refresh = Effect.gen(function* () {
    const client = yield* ren.client
    const spaceId = yield* bindings.space
    return (yield* client.chat.models({ id: Session.ID.create(), spaceId })).models
  }).pipe(
    Effect.catchTag("RenAuth.SignedOut", () => Effect.succeed(Array.empty<SessionModel.Choice>())),
    Effect.flatMap((models) => {
      if (same(models, current.models)) return Effect.void
      current.models = models
      return ctx.provider.reload()
    }),
    Effect.catch((error) => Effect.logWarning("Could not list the Ren models", error)),
  )
  yield* ctx.provider.transform((editor) => {
    if (current.models.length === 0) return
    editor.add({
      info: { id, name: "Ren", activation: "auto", package: `aisdk:${packageName}` },
      models: current.models.map(toModel),
    })
  })
  yield* refresh.pipe(Effect.timeoutOption("5 seconds"))
  yield* refresh.pipe(Effect.repeat(Schedule.spaced("5 minutes")), Effect.delay("5 minutes"), Effect.forkScoped)
  const context = yield* Effect.context<RenModel.Services>()
  yield* ctx.aisdk.hook(
    "sdk",
    (event) =>
      Effect.sync(() => {
        if (event.package !== packageName) return
        event.sdk = { languageModel: (modelID: string) => RenModel.make(modelID, context, ctx.session) }
      }),
    { providerID: id },
  )
  yield* ctx.session.hook(
    "model.request",
    (event) =>
      Effect.sync(() => {
        event.headers[RenModel.kindHeader] = event.kind
        if (event.model.variant && event.model.variant !== "default")
          event.headers[RenModel.variantHeader] = event.model.variant
      }),
    { providerID: id },
  )
  yield* ctx.session.hook(
    "retry",
    (event) =>
      Effect.sync(() => {
        event.decision = { retry: false }
      }),
    { providerID: id },
  )
  yield* ctx.session.hook(
    "title",
    (event) =>
      Effect.gen(function* () {
        const sessionID = yield* Schema.decodeUnknownEffect(Session.ID)(event.sessionID)
        const created = Option.flatMapNullishOr(yield* bindings.get(sessionID), (info) => info.sessionId)
        if (Option.isNone(created)) return ""
        const client = yield* ren.client
        return (yield* client.session.get({ idOrSlug: created.value })).title ?? ""
      }).pipe(
        Effect.orElseSucceed(() => ""),
        Effect.map((title) => {
          event.result = title
        }),
      ),
    { providerID: id },
  )
  return refresh
})
