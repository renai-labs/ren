export * as OpenCodeHarness from "./harness.js"

import { AbsolutePath, Agent, Session, SessionMessage } from "@opencode/client/effect"
import type { OpenCodeClient } from "@opencode/client/effect"
import { Location } from "@opencode/schema/location"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import type { BrainSettings } from "@ren/brain/settings"
import type { SessionCreateInput, SessionListInput, SessionUpdateInput } from "@opencode/client/effect/api"
import { BrainRejectedError, SessionNotStartedError, SyncUnavailableError } from "@ren/host-api/errors"
import type { Models } from "@ren/schema/models"
import type { StartBody } from "@ren/host-api/brain-api"
import { Model, type SendInput } from "@ren/schema/session"
import { Clock, Effect, Layer, Option, Schema, Semaphore, Stream, Struct } from "effect"
import { Cell } from "../../cell.js"
import { ModelRefresh } from "../../model-refresh.js"
import { ModelStore } from "../../model-store.js"
import { SettingsHost } from "../../settings-host.js"
import { Sync } from "../../sync.js"
import { Harness } from "../harness.js"
import { Credentials } from "./credentials.js"
import { OpenCodeRows } from "./opencode-rows.js"
import { RenPlugin } from "./plugin.js"
import { OpenCodeServer } from "./server.js"
import { InstructionEntries } from "./instruction-entries.js"
import { ModelCredentials } from "./model-credentials.js"
import { RenWorkspaceDriver } from "./workspace-driver.js"

const environmentActions = ["read", "edit", "glob", "grep", "shell"]

const environmentInstructionKey = "ren.environment"

const notSupported = (sessionId: string) =>
  new BrainRejectedError({ message: `Session ${sessionId} cannot change its environment: not supported yet` })

const environmentInstructions = (server: OpenCodeServer.Instance, environmentDirectory: Option.Option<string>) => {
  if (Option.isSome(environmentDirectory))
    return {
      [environmentInstructionKey]: `Your file and shell tools run on a separate machine, in ${environmentDirectory.value}. You have full access to that machine.`,
    }
  if (!server.hasEnvironmentConnections) return {}
  return {
    [environmentInstructionKey]:
      "This session has no environment, so it has no file or shell tools. The other tools work as usual.",
  }
}

const deniedActions = (
  server: OpenCodeServer.Instance,
  input: StartBody,
  environmentDirectory: Option.Option<string>,
) => [
  ...(input.interactive ? [] : ["question"]),
  ...(server.hasEnvironmentConnections && Option.isNone(environmentDirectory) ? environmentActions : []),
]

const findSession = (client: OpenCodeClient, sessionID: Session.ID) =>
  client.session.get({ sessionID }).pipe(
    Effect.map(Option.some),
    Effect.catchTag("SessionNotFoundError", () => Effect.succeed(Option.none())),
    Effect.orDie,
  )

const rejectUnknownModel = Effect.fn("OpenCodeHarness.rejectUnknownModel")(function* (
  client: OpenCodeClient,
  model: Model | undefined,
) {
  if (
    model &&
    !(yield* client.model.list().pipe(Effect.orDie)).data.some(
      (item) => item.providerID === model.endpointId && item.modelID === model.modelId,
    )
  )
    return yield* new BrainRejectedError({ message: `Unknown model: ${model.endpointId}/${model.modelId}` })
})

const rejected = (error: { readonly message: string }) => new BrainRejectedError({ message: error.message })

const SavedState = Schema.Struct({ interactive: Schema.Boolean })

const savedOf = (session: Session.Info) => Schema.decodeUnknownOption(SavedState)(session.metadata?.ren)

const withSaved = (session: Option.Option<Session.Info>, saved: typeof SavedState.Type) => ({
  ...Option.getOrUndefined(session)?.metadata,
  ren: Schema.encodeSync(SavedState)(saved),
})

const create = Effect.fn("OpenCodeHarness.create")(function* (
  client: OpenCodeClient,
  server: OpenCodeServer.Instance,
  input: StartBody,
  directory: AbsolutePath,
  environmentDirectory: Option.Option<string>,
  session: Pick<SessionCreateInput, "title" | "agent" | "model" | "permissions" | "metadata"> & {
    readonly id: Session.ID
  },
) {
  if (Option.isNone(environmentDirectory))
    return yield* client.session.create({ ...session, location: { directory } }).pipe(Effect.orDie)
  const workspaceID = yield* server.workspaces
    .create({
      id: RenWorkspaceDriver.workspaceId(input.sessionId),
      provider: RenWorkspaceDriver.provider,
    })
    .pipe(Effect.orDie)
  return yield* server.sessions
    .create({
      id: session.id,
      ...(session.title && { title: session.title }),
      ...(session.agent && { agent: session.agent }),
      ...(session.model && { model: session.model }),
      ...(session.permissions && { permissions: session.permissions }),
      ...(session.metadata && { metadata: session.metadata }),
      location: Location.Ref.make({ directory: AbsolutePath.make(environmentDirectory.value), workspaceID }),
    })
    .pipe(Effect.orDie)
})

const environmentDirectoryOf = Effect.fn("OpenCodeHarness.environmentDirectoryOf")(function* (
  server: OpenCodeServer.Instance,
  input: StartBody,
  session: Option.Option<Session.Info>,
): Effect.fn.Return<Option.Option<string>, BrainRejectedError> {
  if (Option.isSome(session)) {
    const location = (yield* server.sessions.get(session.value.id).pipe(Effect.orDie)).location
    if (input.directory && !location.workspaceID) return yield* notSupported(input.sessionId)
    return location.workspaceID ? Option.some(location.directory) : Option.none()
  }
  if (!input.directory) return Option.none()
  if (!server.hasEnvironmentConnections)
    return yield* new BrainRejectedError({ message: "This brain cannot use environments" })
  return Option.some(input.directory)
})

const resolve = (
  client: OpenCodeClient,
  server: OpenCodeServer.Instance,
  session: { readonly sessionId: Session.ID; readonly interactive: boolean },
  override: Model | null,
) =>
  Option.match(server.settings, {
    onNone: () => rejectUnknownModel(client, override ?? undefined).pipe(Effect.as(undefined)),
    onSome: (settings) =>
      settings
        .attach(session)
        .pipe(
          Effect.andThen(override ? settings.setModel(Option.some(override)) : settings.pull),
          Effect.mapError(rejected),
        ),
  })

const update = Effect.fnUntraced(function* (
  client: OpenCodeClient,
  session: Session.Info,
  fields: Omit<SessionUpdateInput, "sessionID">,
  wanted: { readonly agent: Agent.ID | undefined; readonly model: Model | undefined },
) {
  yield* client.session.update({ sessionID: session.id, ...fields }).pipe(Effect.orDie)
  if (wanted.agent && wanted.agent !== session.agent)
    yield* client.session.switchAgent({ sessionID: session.id, agent: wanted.agent }).pipe(Effect.orDie)
  if (wanted.model && !RenPlugin.sameModel(session.model, wanted.model))
    yield* client.session
      .switchModel({ sessionID: session.id, model: RenPlugin.modelRef(wanted.model) })
      .pipe(Effect.orDie)
})

const start = Effect.fn("OpenCodeHarness.start")(function* (
  client: OpenCodeClient,
  server: OpenCodeServer.Instance,
  input: StartBody,
  directory: AbsolutePath,
) {
  const sessionID = Session.ID.make(input.sessionId)
  const session = yield* findSession(client, sessionID)
  const override = input.model ?? null
  const resolved = yield* resolve(client, server, { sessionId: sessionID, interactive: input.interactive }, override)
  const agent = resolved && Agent.ID.make(resolved.primary.name)
  const chosen = resolved?.primary.model ?? override ?? undefined
  const model = chosen && RenPlugin.modelRef(chosen)
  const metadata = withSaved(session, { interactive: input.interactive })
  const environmentDirectory = yield* environmentDirectoryOf(server, input, session)
  const permissions = deniedActions(server, input, environmentDirectory).map((action) => ({
    action,
    resource: "*",
    effect: "deny" as const,
  }))
  if (Option.isNone(session))
    yield* create(client, server, input, directory, environmentDirectory, {
      id: sessionID,
      title: input.title,
      agent,
      model,
      permissions,
      metadata,
    })
  if (Option.isSome(session))
    yield* update(client, session.value, { title: input.title, permissions, metadata }, { agent, model: chosen })
  const changes = InstructionEntries.changes(
    yield* client.session.instructions.entry.list({ sessionID }).pipe(Effect.orDie),
    environmentInstructions(server, environmentDirectory),
  )
  yield* Effect.forEach(
    changes.put,
    (entry) => client.session.instructions.entry.put({ sessionID, key: entry.key, value: entry.value }),
    { discard: true },
  ).pipe(Effect.orDie)
  yield* Effect.forEach(changes.remove, (key) => client.session.instructions.entry.remove({ sessionID, key }), {
    discard: true,
  }).pipe(Effect.orDie)
  if (input.initialMessage)
    yield* send(client, server, {
      ...input.initialMessage,
      sessionId: input.sessionId,
    }).pipe(Effect.catchTag("SessionNotStartedError", Effect.die))
  return { sessionId: input.sessionId, harness: "opencode" as const }
})

const send = Effect.fn("OpenCodeHarness.send")(function* (
  client: OpenCodeClient,
  server: OpenCodeServer.Instance,
  input: Omit<SendInput, "delivery"> & { readonly delivery?: SendInput["delivery"] },
) {
  const sessionID = Session.ID.make(input.sessionId)
  const session = yield* findSession(client, sessionID)
  if (Option.isNone(session))
    return yield* new SessionNotStartedError({ message: `Session ${input.sessionId} has not been started` })
  if (Option.isSome(server.settings))
    yield* server.settings.value.attach({
      sessionId: sessionID,
      interactive: Option.getOrUndefined(savedOf(session.value))?.interactive ?? true,
    })
  const messageID = SessionMessage.ID.make(input.messageId)
  const isSent = yield* client.session.message.get({ sessionID, messageID }).pipe(
    Effect.as(true),
    Effect.catchTag("MessageNotFoundError", () => Effect.succeed(false)),
    Effect.orDie,
  )
  if (isSent) return { messageId: input.messageId }
  yield* client.session
    .prompt({
      sessionID,
      id: messageID,
      text: input.prompt.text,
      files: input.prompt.files?.map((file) => ({ uri: file.url, name: file.name })),
      delivery: input.delivery,
      metadata: { userID: input.sender.userId },
    })
    .pipe(Effect.orDie)
  return { messageId: input.messageId }
})

const open = Effect.fn("OpenCodeHarness.open")(function* (
  storage: DurableObjectStorage,
  config: string,
  endpoints: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  connections: Option.Option<EnvironmentConnections.Interface>,
  settings: Option.Option<Pick<BrainSettings.Host, "read">>,
) {
  return yield* make(
    yield* OpenCodeServer.open(storage, config, endpoints, refreshKey, connections, settings),
    endpoints,
  )
})

export const layer = (storage: DurableObjectStorage) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const cell = yield* Cell.Info
      const store = yield* ModelStore.Service
      const refreshKey = yield* ModelRefresh.Service
      const connections = yield* Effect.serviceOption(EnvironmentConnections.Service)
      const settings = yield* Effect.serviceOption(SettingsHost.Service)
      return Harness.layer(
        store.read.pipe(
          Effect.map(Option.match({ onNone: () => [], onSome: (access) => access.endpoints })),
          Effect.flatMap((endpoints) =>
            open(storage, cell.vars.OPENCODE_CONFIG, endpoints, refreshKey, connections, settings),
          ),
        ),
      )
    }),
  )

export const make = Effect.fn("OpenCodeHarness.make")(function* (
  server: OpenCodeServer.Instance,
  endpoints: ReadonlyArray<Models.Endpoint>,
  directory: AbsolutePath = AbsolutePath.make("/workspace"),
) {
  const client = yield* OpenCodeServer.client(server.fetch)
  const state = { firstAskedAt: new Map<string, number>() }
  const sync = yield* Effect.serviceOption(Sync.Service)
  const mutations = yield* Semaphore.make(1)
  const configure = Effect.fn("OpenCodeHarness.configure")(function* (next: ReadonlyArray<Models.Endpoint>) {
    yield* server.configure(next)
    yield* Credentials.sync(server.credentials, ModelCredentials.owner, ModelCredentials.entries(next))
  })
  yield* configure(endpoints)

  return {
    fetch: server.fetch,
    configure: (next: ReadonlyArray<Models.Endpoint>) => mutations.withPermit(configure(next)),
    start: (input: StartBody) =>
      mutations.withPermit(
        Effect.gen(function* () {
          if (Option.isSome(sync))
            yield* sync.value
              .restore({
                sessionId: input.sessionId,
                exists: (id) => findSession(client, Session.ID.make(id)).pipe(Effect.map(Option.isSome)),
                create: start(client, server, Struct.omit(input, ["initialMessage"]), directory),
                import: (data) =>
                  Effect.gen(function* () {
                    const info = OpenCodeRows.session(data.session)
                    const messages = yield* Effect.forEach(data.messages, OpenCodeRows.message)
                    return yield* client.session.import({
                      info,
                      messages,
                      location: { directory: info.location.directory },
                    })
                  }).pipe(Effect.orDie),
              })
              .pipe(
                Effect.catchTag("OpenCodeSync.SyncError", (error) =>
                  Effect.fail(
                    new SyncUnavailableError({ message: `Ren could not restore the session: ${error.message}` }),
                  ),
                ),
              )
          // oxlint-disable-next-line ren/no-comments -- Phase 5 explicitly defers workspace restoration until OpenCode's import API accepts it.
          // TODO: Restore the ren workspace for sessions with an environment when the import API supports workspace locations.
          return yield* start(client, server, input, directory)
        }),
      ),
    send: (input: SendInput) => mutations.withPermit(send(client, server, input)),
    sessions: Effect.gen(function* () {
      const roots = yield* Stream.paginate(undefined, (cursor: SessionListInput["cursor"]) =>
        client.session.list({ parentID: null, cursor }).pipe(
          Effect.orDie,
          Effect.map((page) => [page.data, Option.fromNullishOr(page.cursor.next)] as const),
        ),
      ).pipe(Stream.runCollect)
      const snapshots = yield* Effect.forEach(roots, (info) =>
        Effect.gen(function* () {
          const inbox = yield* client.session.inbox.list({ sessionID: info.id }).pipe(Effect.orDie)
          const lastRelevantMessage = yield* Stream.paginate(undefined, (cursor: string | undefined) =>
            client.message.list({ sessionID: info.id, limit: 50, ...(cursor ? { cursor } : { order: "desc" }) }).pipe(
              Effect.orDie,
              Effect.map((page) => [page.data, Option.fromNullishOr(page.cursor.next)] as const),
            ),
          ).pipe(
            Stream.filter(
              (message) => message.type === "idle" || message.type === "user" || message.type === "synthetic",
            ),
            Stream.runHead,
          )
          return {
            id: info.id,
            inbox,
            unfinished: Option.isSome(lastRelevantMessage) && lastRelevantMessage.value.type !== "idle",
          }
        }),
      )
      const active = Object.keys(yield* client.session.active().pipe(Effect.orDie)).map((id) => Session.ID.make(id))
      const forms = yield* Effect.forEach(active, (sessionID) =>
        client.session.form.list({ sessionID }).pipe(Effect.orDie),
      ).pipe(Effect.map((lists) => lists.flat()))
      const now = yield* Clock.currentTimeMillis
      state.firstAskedAt = new Map(forms.map((form) => [form.id, state.firstAskedAt.get(form.id) ?? now]))
      return [
        ...snapshots,
        ...active
          .filter((id) => !snapshots.some((session) => session.id === id))
          .map((id) => ({ id, inbox: [], unfinished: false })),
      ].map((session) => {
        const questionAgesMs = forms
          .filter((form) => form.sessionID === session.id)
          .map((form) => now - (state.firstAskedAt.get(form.id) ?? now))
        return {
          id: session.id,
          active: active.includes(session.id),
          unfinished: session.unfinished,
          questionAgeMs: questionAgesMs.reduce<number | undefined>(
            (oldest, ms) => Math.max(oldest ?? ms, ms),
            undefined,
          ),
          inbox: session.inbox,
          resend: Effect.fn("OpenCodeHarness.resend")(function* (id: string) {
            const item = session.inbox.find((entry) => entry.id === id)
            if (item?.type !== "user") return
            yield* client.session
              .prompt({ sessionID: item.sessionID, id: item.id, delivery: item.delivery, text: item.payload.text })
              .pipe(Effect.orDie)
          }),
          wait: (ms: number) => client.session.wait({ sessionID: session.id }).pipe(Effect.timeout(ms), Effect.ignore),
          interrupt: client.session.interrupt({ sessionID: session.id }).pipe(Effect.orDie, Effect.asVoid),
        }
      })
    }),
  } satisfies Harness.Instance
})
