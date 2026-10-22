export * as HotReload from "./hot-reload.js"

import { BrainSettings } from "@ren/brain/settings"
import type { PullSession } from "@ren/host-api/ren-host-api"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Option, Semaphore } from "effect"
import { FetchHttpClient } from "effect/http"
import { BrainKeys } from "./brain-keys.js"
import { Cell } from "./cell.js"
import { ChatSettings } from "./chat-settings.js"
import { Fence } from "./fence.js"
import { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"

export interface Interface {
  readonly pull: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/HotReload") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const info = yield* Cell.Info
    const hostToken = yield* HostToken.Service
    const store = yield* ModelStore.Service
    const settings = yield* ChatSettings.Service
    const keys = yield* BrainKeys.Service
    const fence = yield* Fence.Service
    const harness = yield* Harness.Service
    const url = info.vars.REN_URL
    if (!url) return Service.of({ pull: Effect.void })
    const host = yield* HostToken.client(url).pipe(Effect.provide(FetchHttpClient.layer))
    const pulls = yield* Semaphore.make(1)

    const pull = Effect.gen(function* () {
      if (yield* fence.isRetired) return
      const token = yield* hostToken.current
      if (Option.isNone(token)) return yield* Effect.logWarning("The brain has no valid host token; it skips a pull")
      const isOpen = (yield* harness.state).isOpen
      const sessions: ReadonlyArray<PullSession> = isOpen
        ? yield* Effect.scoped(
            Effect.flatMap(harness.get, (opened) => opened.sessions).pipe(
              Effect.map((all) =>
                all.map((session) => ({
                  id: Session.ID.make(session.id),
                  busy: session.active,
                  progress: session.progress,
                })),
              ),
            ),
          )
        : []
      const layers = yield* settings.layers
      const reply = yield* host.pull
        .pull({
          payload: {
            version: info.version,
            keyIds: (yield* keys.current).map((key) => key.id),
            models: Option.getOrNull(yield* store.hash),
            layers: BrainSettings.known(layers),
            sessions,
          },
        })
        .pipe(HostToken.withToken(token.value), Effect.timeout(HostToken.renAnswersWithin))
      yield* keys.save(reply.publicKeys)
      const access = reply.models.access
      if (access) yield* store.install(access, reply.models.hash)
      yield* settings.save(BrainSettings.merge(layers, reply.layers), reply.chats)
      if (!isOpen) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* harness.get
          if (access) yield* opened.configure(access.endpoints)
          yield* opened.applySettings(reply.chats)
        }),
      )
    }).pipe(
      Effect.catchTag("GenerationRetiredError", (error) => fence.retire(error.message)),
      Effect.catch((error) => Effect.logWarning("The pull failed; the brain keeps its last settings", error)),
      Effect.withSpan("HotReload.pull"),
    )

    return Service.of({ pull: pulls.withPermit(pull) })
  }),
)
