export * as HotReload from "./hot-reload.js"

import { BrainSettings } from "@ren/brain/settings"
import type { PullSession } from "@ren/host-api/ren-host-api"
import { Session } from "@ren/schema/session"
import { Clock, Context, DateTime, Duration, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { FetchHttpClient } from "effect/http"
import { AppStore } from "./app-store.js"
import { BrainKeys } from "./brain-keys.js"
import { BrainStorage } from "./brain-storage.js"
import { Cell } from "./cell.js"
import { ChatSettings } from "./chat-settings.js"
import { CredentialEnv } from "./credential-env.js"
import { Fence } from "./fence.js"
import { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"
import { RenAddress } from "./ren-address.js"

const deletedKey = "ren:deleted"

const folderAfter = Duration.days(7)

const Since = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number))

export interface Interface {
  readonly pull: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/HotReload") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const info = yield* Cell.Info
    const activity = yield* Cell.Activity
    const hostToken = yield* HostToken.Service
    const store = yield* ModelStore.Service
    const apps = yield* AppStore.Service
    const settings = yield* ChatSettings.Service
    const keys = yield* BrainKeys.Service
    const fence = yield* Fence.Service
    const harness = yield* Harness.Service
    const credentialEnv = yield* CredentialEnv.Service
    const url = info.vars.REN_URL
    if (!url) return Service.of({ pull: Effect.void })
    const host = yield* HostToken.client(url).pipe(
      Effect.provide(RenAddress.http.pipe(Layer.provide(FetchHttpClient.layer))),
    )
    const pulls = yield* Semaphore.make(1)
    const storage = yield* BrainStorage.Service
    const deletedSince = Effect.promise(() => storage.get(deletedKey)).pipe(
      Effect.map((text) =>
        Option.getOrElse(Schema.decodeUnknownOption(Since)(text ?? "{}"), (): Readonly<Record<string, number>> => ({})),
      ),
    )

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
            apps: Option.getOrNull(Option.map(yield* apps.current, (saved) => saved.fingerprint)),
            layers: BrainSettings.known(layers),
            sessions,
            roots: sessions.map((session) => session.id),
            ...Option.match(yield* credentialEnv.hash, { onNone: () => ({}), onSome: (env) => ({ env }) }),
          },
        })
        .pipe(HostToken.withToken(token.value), Effect.timeout(HostToken.renAnswersWithin))
      yield* Ref.set(activity.pulledAt, Option.some(yield* DateTime.now))
      if (reply.apps?.catalog)
        yield* apps
          .save({ fingerprint: reply.apps.fingerprint, catalog: reply.apps.catalog })
          .pipe(Effect.catch((error) => Effect.logWarning("The brain keeps its last app catalog", error)))
      yield* keys.save(reply.publicKeys)
      if (reply.env?.variables) yield* credentialEnv.apply(reply.env.hash, reply.env.variables)
      const access = reply.models.access
      if (access) yield* store.install(access, reply.models.hash)
      yield* settings.save(BrainSettings.merge(layers, reply.layers), reply.chats)
      if (!isOpen) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* harness.get
          yield* opened.configure({
            models: Option.match(yield* store.read, { onNone: () => [], onSome: (saved) => saved.endpoints }),
            apps: yield* apps.current,
            settings: { layers: yield* settings.layers, chats: yield* settings.chats },
          })
          // oxlint-disable-next-line ren/no-comments -- A chat Ren deleted leaves the harness at once, when idle; its folder goes after 7 days of Ren naming it deleted (E109, E114).
          const busy = new Set(sessions.filter((session) => session.busy).map((session) => session.id))
          yield* Effect.forEach(
            reply.deleted.filter((id) => !busy.has(id)),
            (id) => opened.transcript.drop(id),
            { discard: true },
          )
          const now = yield* Clock.currentTimeMillis
          const since = yield* deletedSince
          const next = Object.fromEntries(reply.deleted.map((id) => [id, since[id] ?? now]))
          const due = reply.deleted.filter((id) => now - (next[id] ?? now) >= Duration.toMillis(folderAfter))
          yield* Effect.forEach(due, (id) => opened.transcript.removeFolder(id), { discard: true })
          yield* Effect.promise(() => storage.put(deletedKey, JSON.stringify(next)))
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
