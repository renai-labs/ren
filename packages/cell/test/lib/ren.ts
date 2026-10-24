export * as FakeRen from "./ren.js"

import { BrainToken } from "@ren/host-api/brain-token"
import {
  EnvironmentNotFoundError,
  EnvironmentUnavailableError,
  ForbiddenError,
  GenerationRetiredError,
  ModelsUnavailableError,
  StaleUploadError,
  UnauthorizedError,
} from "@ren/host-api/errors"
import {
  CurrentHost,
  HostAuthentication,
  type PullChat,
  type PullRequest,
  RenHostApi,
} from "@ren/host-api/ren-host-api"
import { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Environment } from "@ren/schema/environment"
import type { Models } from "@ren/schema/models"
import type { Session } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session/settings"
import type { Signature } from "@ren/schema/signature"
import { Space } from "@ren/schema/space"
import type { Sync } from "@ren/schema/sync"
import { SyncApi } from "@ren/host-api/sync-api"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { TestSettings } from "./settings.js"
import { TestToken } from "./token.js"

export type Refresh = { readonly type: "grant"; readonly access: Models.Access } | { readonly type: "unavailable" }

export type Answer =
  | { readonly type: "access"; readonly access: Environment.Access }
  | { readonly type: "not_found" }
  | { readonly type: "unavailable"; readonly message: string }
  | { readonly type: "hold" }

export interface Call {
  readonly endpoint: "environments.access" | "environments.release" | "host.refresh" | "models.refresh" | "pull"
  readonly sessionId: Session.ID | undefined
  readonly brainId: Brain.ID
  readonly hostToken: string
  readonly status: number
}

const organizationId = Auth.OrganizationID.create()

export const hostToken = (
  brainId: Brain.ID = TestToken.brain,
  lifetimeSeconds = 7200,
  options: { readonly key?: Signature.PrivateKey; readonly generation?: number } = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const now = Math.floor(Date.now() / 1000)
      return yield* BrainToken.sign(options.key ?? TestToken.keys[0], {
        scope: "host",
        brain: brainId,
        gen: options.generation ?? 1,
        org: organizationId,
        iat: now,
        exp: now + lifetimeSeconds,
      })
    }),
  )

export const start = (options: { readonly hostname?: string } = {}) => {
  const answers = new Map<Session.ID, () => Answer | Promise<Answer>>()
  const calls: Array<Call> = []
  const pulls: Array<PullRequest> = []
  const held: Array<() => void> = []
  const state = {
    refuseHosts: false,
    generation: 1,
    refreshGate: undefined as (() => Promise<void>) | undefined,
    settings: TestSettings.layers(),
    chats: [] as ReadonlyArray<PullChat>,
    models: new Map<Brain.ID | "all", { readonly access: Models.Access; readonly hash: string }>(),
    modelsCount: 0,
    refresh: (): Refresh => ({ type: "unavailable" }),
    rotate: false,
    revoked: new Set<string>(),
    deleted: new Set<Session.ID>(),
    issued: 0,
  }
  const modelsOf = (brainId: Brain.ID) => state.models.get(brainId) ?? state.models.get("all")
  const renewed = Effect.fnUntraced(function* (brainId: Brain.ID) {
    if (state.rotate) state.revoked.add(presented.token)
    state.issued += 1
    return Redacted.make(yield* Effect.promise(() => hostToken(brainId, 7200 + state.issued)))
  })
  const presented = { token: "" }
  const listeners = new Set<() => void>()
  const record = (endpoint: Call["endpoint"], brainId: Brain.ID, sessionId: Session.ID | undefined, status: number) => {
    calls.push({ endpoint, brainId, sessionId, hostToken: presented.token, status })
    for (const listener of listeners) listener()
  }
  const handlers = Layer.mergeAll(
    HttpApiBuilder.group(RenHostApi, "environments", (group) =>
      Effect.succeed(
        group
          .handle("environments.access", (request) =>
            Effect.gen(function* () {
              const host = yield* CurrentHost
              const sessionId = request.params.id
              const answer = yield* Effect.promise(async (): Promise<Answer> =>
                (answers.get(sessionId) ?? (() => ({ type: "not_found" }) as const))(),
              )
              if (answer.type === "hold") {
                record("environments.access", host.brainId, sessionId, 0)
                return yield* Effect.callback<never>((resume) => {
                  held.push(() => resume(Effect.never))
                })
              }
              if (answer.type === "not_found") {
                record("environments.access", host.brainId, sessionId, 404)
                return yield* new EnvironmentNotFoundError({ message: `Session ${sessionId} has no environment` })
              }
              if (answer.type === "unavailable") {
                record("environments.access", host.brainId, sessionId, 503)
                return yield* new EnvironmentUnavailableError({ message: answer.message })
              }
              record("environments.access", host.brainId, sessionId, 200)
              return answer.access
            }),
          )
          .handle("environments.release", (request) =>
            Effect.map(CurrentHost, (host) => record("environments.release", host.brainId, request.params.id, 204)),
          ),
      ),
    ),
    HttpApiBuilder.group(RenHostApi, "host", (group) =>
      Effect.succeed(
        group.handle("host.refresh", () =>
          Effect.gen(function* () {
            const host = yield* CurrentHost
            record("host.refresh", host.brainId, undefined, 200)
            yield* Effect.promise(() => state.refreshGate?.() ?? Promise.resolve())
            return { hostToken: yield* renewed(host.brainId) }
          }),
        ),
      ),
    ),
    HttpApiBuilder.group(RenHostApi, "pull", (group) =>
      Effect.succeed(
        group.handle("pull", (request) =>
          Effect.gen(function* () {
            const host = yield* CurrentHost
            pulls.push(request.payload)
            record("pull", host.brainId, undefined, 200)
            const granted = modelsOf(host.brainId) ?? { hash: "models-0" }
            return {
              publicKeys: [...TestToken.publicKeys],
              models: "access" in granted && request.payload.models !== granted.hash ? granted : { hash: granted.hash },
              layers: state.settings,
              chats: state.chats,
              deleted: (request.payload.roots ?? []).filter((id) => state.deleted.has(id)),
            }
          }),
        ),
      ),
    ),
    HttpApiBuilder.group(RenHostApi, "models", (group) =>
      Effect.succeed(
        group.handle("models.refresh", () =>
          Effect.gen(function* () {
            const host = yield* CurrentHost
            const reply = state.refresh()
            if (reply.type === "unavailable") {
              record("models.refresh", host.brainId, undefined, 503)
              return yield* new ModelsUnavailableError({ message: "The fake Ren grants no models" })
            }
            record("models.refresh", host.brainId, undefined, 200)
            return { access: reply.access, hostToken: yield* renewed(host.brainId) }
          }),
        ),
      ),
    ),
  )
  const synced = {
    sessions: new Map<Session.ID, { readonly row: Sync.OpenCodeSessionRow; readonly seq: number }>(),
    messages: new Map<Session.ID, ReadonlyArray<Sync.OpenCodeMessageRow>>(),
    uploads: new Map<Session.ID, { readonly upload: number; readonly messages: Array<Sync.OpenCodeMessageRow> }>(),
    count: 0,
  }
  const sync = HttpApiBuilder.group(SyncApi, "sync", (group) =>
    Effect.succeed(
      group
        .handle("sync.checkpoints", () =>
          Effect.succeed({
            sessions: [...synced.sessions.values()].map((entry) => ({
              id: entry.row.id,
              syncSeq: entry.seq,
              timeSuspended: null,
            })),
          }),
        )
        .handle("sync.startUpload", (request) =>
          Effect.sync(() => {
            synced.count += 1
            synced.uploads.set(request.params.id, { upload: synced.count, messages: [] })
            return { upload: synced.count }
          }),
        )
        .handle("sync.uploadMessages", (request) =>
          Effect.gen(function* () {
            const upload = synced.uploads.get(request.params.id)
            if (upload?.upload !== request.params.upload)
              return yield* new StaleUploadError({ message: "The upload is stale" })
            upload.messages.push(...request.payload.messages)
          }),
        )
        .handle("sync.commit", (request) =>
          Effect.gen(function* () {
            const upload = synced.uploads.get(request.params.id)
            if (upload?.upload !== request.params.upload)
              return yield* new StaleUploadError({ message: "The upload is stale" })
            synced.uploads.delete(request.params.id)
            synced.sessions.set(request.params.id, { row: request.payload.session, seq: request.payload.seq })
            synced.messages.set(request.params.id, upload.messages)
          }),
        )
        .handle("sync.restore", (request) =>
          Effect.sync(() => ({
            chats: [...synced.sessions.values()]
              .map((entry) => entry.row)
              .filter((row) => row.id === request.payload.sessionId || row.parent_id === request.payload.sessionId)
              .map((row) => ({
                id: row.id,
                harness: "opencode" as const,
                harnessVersion: null,
                parentId: row.parent_id,
                revertMessageId: null,
                session: row,
                inbox: [],
              })),
          })),
        )
        .handle("sync.messages", (request) =>
          Effect.sync(() => {
            const all = synced.messages.get(request.params.id) ?? []
            const after = request.query.afterSeq
            const page = all
              .filter(
                (row) =>
                  after === undefined ||
                  row.seq > after ||
                  (row.seq === after && row.id > (request.query.afterId ?? "")),
              )
              .slice(0, request.query.limit)
            const last = page.at(-1)
            return {
              messages: page,
              next: last && page.length === request.query.limit ? { seq: last.seq, id: last.id } : null,
            }
          }),
        ),
    ),
  )
  const authentication = Layer.succeed(
    HostAuthentication,
    HostAuthentication.of({
      bearer: (httpEffect, options) =>
        Effect.gen(function* () {
          presented.token = Redacted.value(options.credential)
          const claims = yield* BrainToken.verify(TestToken.publicKeys, Redacted.value(options.credential))
          const host = Option.flatMap(claims, (found) => (found.scope === "host" ? Option.some(found) : Option.none()))
          if (Option.isNone(host)) return yield* new UnauthorizedError({ message: "The host token is not valid" })
          if (state.refuseHosts || state.revoked.has(presented.token))
            return yield* new ForbiddenError({ message: "The brain is gone" })
          if (host.value.gen !== state.generation)
            return yield* new GenerationRetiredError({ message: `Generation ${host.value.gen} is retired` })
          return yield* httpEffect.pipe(
            Effect.provideService(CurrentHost, {
              brainId: host.value.brain,
              organizationId: host.value.org,
              spaceId: Space.ID.create(),
              generation: host.value.gen,
            }),
          )
        }),
    }),
  )
  const api = HttpRouter.toWebHandler(
    Layer.mergeAll(
      HttpApiBuilder.layer(RenHostApi).pipe(Layer.provide(handlers)),
      HttpApiBuilder.layer(SyncApi).pipe(Layer.provide(sync)),
    ).pipe(Layer.provide(authentication), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )
  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: (request) => api.handler(request),
  })
  return {
    url: `http://127.0.0.1:${server.port ?? 0}`,
    calls,
    pulls,
    synced: (sessionId: Session.ID) => synced.sessions.get(sessionId),
    answer: (sessionId: Session.ID, answer: () => Answer | Promise<Answer>) => {
      answers.set(sessionId, answer)
    },
    settings: (layers: SessionSettings.Layers) => {
      state.settings = layers
    },
    chats: (chats: ReadonlyArray<PullChat>) => {
      state.chats = chats
    },
    models: (access: Models.Access, brainId?: Brain.ID) => {
      state.modelsCount += 1
      state.models.set(brainId ?? "all", { access, hash: `models-${state.modelsCount}` })
    },
    refresh: (reply: () => Refresh) => {
      state.refresh = reply
    },
    rotate: (on: boolean) => {
      state.rotate = on
    },
    retire: (generation: number) => {
      state.generation = generation
    },
    refuseHosts: (refusing: boolean) => {
      state.refuseHosts = refusing
    },
    holdRefresh: (gate: (() => Promise<void>) | undefined) => {
      state.refreshGate = gate
    },
    remove: (sessionId: Session.ID) => {
      state.deleted.add(sessionId)
    },
    accessCalls: (sessionId: Session.ID) =>
      calls.filter((call) => call.endpoint === "environments.access" && call.sessionId === sessionId).length,
    reached: (id: Session.ID | Brain.ID, count = 1) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (calls.filter((call) => call.sessionId === id || call.brainId === id).length < count) return
          listeners.delete(check)
          resolve()
        }
        listeners.add(check)
        check()
      }),
    stop: async () => {
      for (const release of held) release()
      await server.stop(true)
      await api.dispose()
    },
  }
}

export type Instance = ReturnType<typeof start>
