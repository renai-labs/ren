export * as HotReload from "./hot-reload.js"

import { Session } from "@ren/schema/session"
import { Clock, Context, DateTime, Duration, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { FetchHttpClient } from "effect/http"
import { AppStore } from "./app-store.js"
import { ChannelStore } from "./channel-store.js"
import { BrainKeys } from "./brain-keys.js"
import { BrainStorage } from "./brain-storage.js"
import { Cell } from "./cell.js"
import { ChatSettings } from "./chat-settings.js"
import { CredentialEnv } from "./credential-env.js"
import { Fence } from "./fence.js"
import { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { Inference } from "./inference.js"
import { RenAddress } from "./ren-address.js"

const deletedKey = "ren:deleted"

const folderAfter = Duration.days(7)

const Since = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number))

export interface Interface {
  readonly pull: Effect.Effect<void>
  readonly push: Effect.Effect<void>
  readonly tick: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/HotReload") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const info = yield* Cell.Info
    const activity = yield* Cell.Activity
    const hostToken = yield* HostToken.Service
    const apps = yield* AppStore.Service
    const channels = yield* ChannelStore.Service
    const settings = yield* ChatSettings.Service
    const keys = yield* BrainKeys.Service
    const fence = yield* Fence.Service
    const harness = yield* Harness.Service
    const credentialEnv = yield* CredentialEnv.Service
    const inference = yield* Inference.Service
    const url = info.vars.REN_URL
    if (!url) return Service.of({ pull: Effect.void, push: Effect.void, tick: Effect.void })
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
      const sessions = yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* harness.getIfOpen
          if (Option.isNone(opened)) return []
          return yield* opened.value.sessions
        }),
      )
      const reply = yield* host.pull
        .pull({
          payload: {
            version: info.version,
            keyIds: (yield* keys.current).map((key) => key.id),
            sessions: sessions.map((session) => ({
              id: Session.ID.make(session.id),
              busy: session.active,
              progress: session.progress,
            })),
            roots: sessions.map((session) => Session.ID.make(session.id)),
          },
        })
        .pipe(HostToken.withToken(token.value), Effect.timeout(HostToken.renAnswersWithin))
      yield* Ref.set(activity.pulledAt, Option.some(yield* DateTime.now))
      // oxlint-disable-next-line ren/no-comments -- HR9: Ren sends the full state; each store compares it with what it has, and the harness gets only the parts that changed.
      const appsChanged = reply.apps
        ? yield* apps
            .save(reply.apps)
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("The brain keeps its last app catalog", error).pipe(Effect.as(false)),
              ),
            )
        : false
      const channelsChanged = yield* channels
        .save(reply.channels ?? [])
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("The brain keeps its last channel servers", error).pipe(Effect.as(false)),
          ),
        )
      yield* keys.save(reply.publicKeys)
      yield* credentialEnv.apply(reply.env.variables)
      const inferenceChanged = yield* inference.saveBaseUrl(Option.fromNullishOr(reply.inference?.baseUrl))
      const settingsChanged = yield* settings.save(reply.layers, reply.chats)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const current = yield* harness.getIfOpen
          if (Option.isNone(current)) return
          const opened = current.value
          if (appsChanged || channelsChanged || settingsChanged)
            yield* opened.configure({
              ...(appsChanged && { apps: yield* apps.current }),
              ...(channelsChanged && { channels: yield* channels.current }),
              ...(settingsChanged && { settings: { layers: yield* settings.layers, chats: yield* settings.chats } }),
            })
          if (inferenceChanged) yield* opened.refreshModels
          // oxlint-disable-next-line ren/no-comments -- HR22: a chat Ren deleted leaves the harness at once; a busy one is interrupted first. Its folder goes after 7 days of Ren naming it deleted (E109, E114).
          yield* Effect.forEach(
            reply.deleted,
            (id) =>
              Effect.gen(function* () {
                const session = sessions.find((each) => each.id === id)
                if (session?.active) yield* session.interrupt
                yield* opened.transcript.drop(id)
              }),
            { discard: true },
          )
          const now = yield* Clock.currentTimeMillis
          const since = yield* deletedSince
          const next = Object.fromEntries(reply.deleted.map((id) => [id, since[id] ?? now]))
          const due = reply.deleted.filter((id) => now - (next[id] ?? now) >= Duration.toMillis(folderAfter))
          yield* Effect.forEach(due, (id) => opened.transcript.removeFolder(id), { discard: true })
          if (JSON.stringify(next) !== JSON.stringify(since))
            yield* Effect.promise(() => storage.put(deletedKey, JSON.stringify(next)))
        }),
      )
    }).pipe(
      Effect.catchTag("GenerationRetiredError", (error) => fence.retire(error.message)),
      Effect.catch((error) => Effect.logWarning("The pull failed; the brain keeps its last settings", error)),
      // oxlint-disable-next-line ren/no-comments -- A storage write that fails is a defect; the pull must still end, or the push loop stays marked running and no later push or timed pull runs.
      Effect.catchDefect((defect) => Effect.logError("The pull failed; the brain keeps its last settings", defect)),
      Effect.withSpan("HotReload.pull"),
    )

    const locked = pulls.withPermit(pull)
    const scope = yield* Effect.scope
    // oxlint-disable-next-line ren/no-comments -- HR13: a push during a running pull marks one more pull, which starts when the running one ends; more pushes in that time add nothing. The caller never waits.
    const state = yield* Ref.make({ running: false, again: false })
    const next = Ref.modify(state, (found) =>
      found.again ? [true, { running: true, again: false }] : [false, { running: false, again: false }],
    )
    const drain: Effect.Effect<void> = Effect.gen(function* () {
      yield* locked
      if (yield* next) yield* drain
    })
    const push = Effect.gen(function* () {
      const start = yield* Ref.modify(state, (found) =>
        found.running ? [false, { running: true, again: true }] : [true, { running: true, again: false }],
      )
      if (start) yield* drain.pipe(Effect.forkIn(scope))
    }).pipe(Effect.withSpan("HotReload.push"))

    return Service.of({
      pull: locked,
      push,
      // oxlint-disable-next-line ren/no-comments -- HR17: an open harness pulls every PULL_INTERVAL_MS; the alarm starts the pull and does not wait for it.
      tick: Effect.gen(function* () {
        if (!(yield* harness.state).isOpen) return
        const last = yield* Ref.get(activity.pulledAt)
        const now = yield* DateTime.now
        if (
          Option.isSome(last) &&
          DateTime.toEpochMillis(now) - DateTime.toEpochMillis(last.value) < info.vars.PULL_INTERVAL_MS
        )
          return
        yield* push
      }),
    })
  }),
)
