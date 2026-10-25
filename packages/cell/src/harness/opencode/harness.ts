export * as OpenCodeHarness from "./harness.js"

import { AbsolutePath, Agent, Session, SessionMessage } from "@opencode/client/effect"
import type { OpenCodeClient } from "@opencode/client/effect"
import { Location } from "@opencode/schema/location"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { BrainSettings } from "@ren/brain/settings"
import type { AppCatalog } from "@ren/schema/app-catalog"
import type { SessionCreateInput, SessionListInput, SessionUpdateInput } from "@opencode/client/effect/api"
import { BrainRejectedError, SessionNotStartedError } from "@ren/host-api/errors"
import { Environment } from "@ren/schema/environment"
import type { Models } from "@ren/schema/models"
import type { StartBody } from "@ren/host-api/brain-api"
import { Model, type SendInput } from "@ren/schema/session"
import {
  Clock,
  DateTime,
  Effect,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
  type Scope,
  Semaphore,
  Stream,
  Struct,
} from "effect"
import { FetchHttpClient } from "effect/http"
import { mkdir, rm, stat } from "node:fs/promises"
// oxlint-disable-next-line ren/no-node-modules-import -- @opencode/core exports no package.json and no version, and the harness version must be the installed one.
import opencode from "../../../node_modules/@opencode/core/package.json"
import { BrainStorage } from "../../brain-storage.js"
import { AppStore } from "../../app-store.js"
import { Cell } from "../../cell.js"
import { ChatSettings } from "../../chat-settings.js"
import { HarnessStorage } from "../../harness-storage.js"
import { HostToken } from "../../host-token.js"
import { ModelRefresh } from "../../model-refresh.js"
import { Inference } from "../../inference.js"
import { RenAddress } from "../../ren-address.js"
import { Harness } from "../harness.js"
import { OpenCodeChat } from "./chat.js"
import { OpenCodeRows } from "@ren/opencode-transcript/opencode-rows"
import type { OpenCodeMcp } from "./mcp.js"
import { RenPlugin } from "./plugin.js"
import { OpenCodeServer } from "./server.js"
import { InstructionEntries } from "./instruction-entries.js"
import { OpenCodeModels } from "./models.js"
import { RenWorkspaceDriver } from "./workspace-driver.js"
import { SessionSettings } from "./session-settings.js"
import type { HarnessConfig } from "../config.js"

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
      (item) => item.providerID === model.endpointId && item.id === model.modelId,
    )
  )
    return yield* new BrainRejectedError({ message: `Unknown model: ${model.endpointId}/${model.modelId}` })
})

// oxlint-disable-next-line ren/no-comments -- A chat whose picked model is gone uses its settings' model; the pick is cleared and the chat is told why (E55).
const dropPick = Effect.fnUntraced(function* (
  client: OpenCodeClient,
  session: Option.Option<Session.Info>,
  now: Model,
) {
  const info = Option.getOrUndefined(session)
  const saved = Option.getOrUndefined(Option.flatMap(session, SessionSettings.savedOf))
  if (!info || !saved?.model) return
  yield* client.session
    .update({ sessionID: info.id, metadata: SessionSettings.metadata(session, { ...saved, model: null }) })
    .pipe(Effect.orDie)
  yield* client.session
    .synthetic({
      sessionID: info.id,
      text: `The model ${saved.model.endpointId}/${saved.model.modelId} is no longer available. This chat now uses ${now.endpointId}/${now.modelId}.`,
      resume: false,
    })
    .pipe(Effect.orDie)
})

const filesReset = "ren.files-reset"

const rejected = (error: { readonly message: string }) => new BrainRejectedError({ message: error.message })

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

const overrideOf = (session: Option.Option<Session.Info>, start: Model | null) => {
  const saved = Option.getOrUndefined(Option.flatMap(session, SessionSettings.savedOf))
  return saved && JSON.stringify(saved.start) === JSON.stringify(start) ? saved.model : start
}

const lookupOf = (client: OpenCodeClient) =>
  client.model.list().pipe(
    Effect.orDie,
    Effect.map(
      (page) => (model: Model) =>
        Option.fromUndefinedOr(
          page.data.find((item) => item.providerID === model.endpointId && item.id === model.modelId),
        ).pipe(Option.map((item) => ({ variants: item.variants.map((variant) => variant.id) }))),
    ),
  )

const resolve = (
  client: OpenCodeClient,
  settings: Option.Option<ChatSettings.Interface>,
  sessionId: Session.ID,
  override: Model | null,
) =>
  Option.match(settings, {
    onNone: () => rejectUnknownModel(client, override ?? undefined).pipe(Effect.as(undefined)),
    onSome: (chats) =>
      lookupOf(client).pipe(
        Effect.flatMap((lookup) => chats.resolve(sessionId, Option.fromNullishOr(override), lookup)),
        Effect.mapError(rejected),
      ),
  })

const remember = Effect.fnUntraced(function* (
  server: OpenCodeServer.Instance,
  settings: Option.Option<ChatSettings.Interface>,
  sessionId: string,
  chat: RenPlugin.Chat | undefined,
  options: { readonly install: boolean },
) {
  if (!chat || Option.isNone(server.chats)) return
  yield* Ref.update(server.chats.value.latest, (all) => new Map([...all, [sessionId, chat]]))
  if (Option.isSome(settings)) yield* settings.value.keep(sessionId, chat)
  if (!options.install) return
  yield* server.activate(sessionId).pipe(Effect.ignore)
  yield* server.configure({ chats: yield* Ref.get(server.chats.value.latest) })
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

const pick = Effect.fnUntraced(function* (
  client: OpenCodeClient,
  server: OpenCodeServer.Instance,
  settings: Option.Option<ChatSettings.Interface>,
  sessionID: Session.ID,
  model: Option.Option<Model>,
  options: { readonly interactive: boolean },
) {
  if (Option.isNone(settings)) {
    if (Option.isNone(model)) return
    yield* rejectUnknownModel(client, model.value)
    yield* client.session.switchModel({ sessionID, model: RenPlugin.modelRef(model.value) }).pipe(Effect.orDie)
    return
  }
  if (Option.isSome(model) && Option.isNone((yield* lookupOf(client))(model.value)))
    return yield* new BrainRejectedError({ message: `Unknown model: ${model.value.endpointId}/${model.value.modelId}` })
  const resolved = yield* resolve(client, settings, sessionID, Option.getOrNull(model))
  yield* remember(server, settings, sessionID, resolved && { resolved, interactive: options.interactive }, {
    install: true,
  })
})

const start = Effect.fn("OpenCodeHarness.start")(function* (
  client: OpenCodeClient,
  server: OpenCodeServer.Instance,
  settings: Option.Option<ChatSettings.Interface>,
  input: StartBody,
) {
  const sessionID = Session.ID.make(input.sessionId)
  const directory = AbsolutePath.make(server.directoryOf(input.sessionId))
  const session = yield* findSession(client, sessionID)
  const start = input.model ?? null
  const override = overrideOf(session, start)
  const resolved = yield* resolve(client, settings, sessionID, override)
  const agent = resolved && Agent.ID.make(resolved.primary.name)
  const chosen = resolved?.primary.model ?? override ?? undefined
  const model = chosen && RenPlugin.modelRef(chosen)
  const metadata = SessionSettings.metadata(session, { start, model: override, interactive: input.interactive })
  const environmentDirectory = yield* environmentDirectoryOf(server, input, session)
  // oxlint-disable-next-line ren/no-comments -- The folder on the brain's own hand exists from the start, so a restore that finds it missing knows its files were lost (E105).
  if (Option.getOrElse(environmentDirectory, () => directory) === directory) yield* server.makeDirectory(directory)
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
  yield* remember(server, settings, input.sessionId, resolved && { resolved, interactive: input.interactive }, {
    install: true,
  })
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
    yield* send(client, {
      ...input.initialMessage,
      sessionId: input.sessionId,
    }).pipe(Effect.catchTag("SessionNotStartedError", Effect.die))
  return { sessionId: input.sessionId, harness: "opencode" as const }
})

const send = Effect.fn("OpenCodeHarness.send")(function* (
  client: OpenCodeClient,
  input: Omit<SendInput, "delivery"> & { readonly delivery?: SendInput["delivery"] },
) {
  const sessionID = Session.ID.make(input.sessionId)
  const session = yield* findSession(client, sessionID)
  if (Option.isNone(session))
    return yield* new SessionNotStartedError({ message: `Session ${input.sessionId} has not been started` })
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

export const version = opencode.version

type Opener = (
  endpoints: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  connections: Option.Option<EnvironmentConnections.Interface>,
  config: string,
  settings: Option.Option<ChatSettings.Interface>,
  apps: Option.Option<AppCatalog.Info>,
  ren: Option.Option<OpenCodeMcp.RenAccess>,
) => Effect.Effect<OpenCodeServer.Instance, Error, Scope.Scope>

const layerWith = (opener: Opener) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const cell = yield* Cell.Info
      const inference = yield* Inference.Service
      const refreshKey = yield* ModelRefresh.Service
      const connections = yield* Effect.serviceOption(EnvironmentConnections.Service)
      const settings = cell.vars.REN_URL ? yield* Effect.serviceOption(ChatSettings.Service) : Option.none()
      const apps = yield* Effect.serviceOption(AppStore.Service)
      const address = yield* Effect.serviceOption(RenAddress.Service)
      const hostToken = yield* Effect.serviceOption(HostToken.Service)
      const ren =
        cell.vars.REN_URL && Option.isSome(address) && Option.isSome(hostToken)
          ? Option.some({ address: address.value.current, token: hostToken.value.current })
          : Option.none()
      const prepare = HarnessStorage.prepare(version).pipe(
        Effect.provideService(BrainStorage.Service, yield* BrainStorage.Service),
        Effect.provideService(HarnessStorage.Service, yield* HarnessStorage.Service),
      )
      return Harness.layer(
        prepare.pipe(
          Effect.andThen(
            Effect.gen(function* () {
              const catalog = yield* inference.catalog
              const baseUrl = yield* inference.baseUrl
              if (Option.isNone(catalog) || Option.isNone(baseUrl)) return []
              return yield* OpenCodeModels.endpoints(catalog.value, baseUrl.value, refreshKey)
            }),
          ),
          Effect.flatMap((endpoints) =>
            Effect.gen(function* () {
              const server = yield* opener(
                endpoints,
                refreshKey,
                connections,
                cell.vars.OPENCODE_CONFIG,
                settings,
                Option.isSome(apps) ? yield* apps.value.current : Option.none(),
                ren,
              )
              return yield* make(server, endpoints, settings, Option.some({ inference, refreshKey }))
            }),
          ),
        ),
      )
    }),
  )

export const layer = (storage: DurableObjectStorage) =>
  layerWith((endpoints, refreshKey, connections, config, settings, apps, ren) =>
    OpenCodeServer.open(storage, config, endpoints, refreshKey, connections, {
      saved: Option.map(settings, (each) => each.saved),
      apps,
      ren,
      directoryOf: (sessionId) => `/workspace/${sessionId}`,
    }),
  )

export const layerProcess = (database: string, confinement: RenPlugin.Confinement) =>
  layerWith((endpoints, refreshKey, connections, config, settings, apps, ren) =>
    OpenCodeServer.openProcess(database, config, endpoints, refreshKey, connections, {
      saved: Option.map(settings, (each) => each.saved),
      apps,
      ren,
      directoryOf: (sessionId) => `${confinement.workspace}/${sessionId}`,
      confinement,
      makeDirectory: (directory) => Effect.promise(() => mkdir(directory, { recursive: true })),
    }),
  )

export const make = Effect.fn("OpenCodeHarness.make")(function* (
  server: OpenCodeServer.Instance,
  endpoints: ReadonlyArray<Models.Endpoint>,
  settings: Option.Option<ChatSettings.Interface> = Option.none(),
  models: Option.Option<{
    readonly inference: Inference.Interface
    readonly refreshKey: Harness.Refresh
  }> = Option.none(),
) {
  const client = server.client
  const state = { firstAskedAt: new Map<string, number>(), models: endpoints }
  const mutations = yield* Semaphore.make(1)
  const configure = Effect.fn("OpenCodeHarness.configure")(function* (
    update: HarnessConfig.Update,
  ): Effect.fn.Return<void> {
    const models = update.models ?? state.models
    if (Option.isSome(server.chats) && update.settings) {
      const pulled = update.settings
      const known = server.chats.value
      const native = yield* lookupOf(client)
      const managed = new Set([...state.models, ...models].map((endpoint) => endpoint.id))
      const lookup: BrainSettings.Lookup = (model) => {
        if (!managed.has(model.endpointId)) return native(model)
        return Option.fromUndefinedOr(
          models
            .find((endpoint) => endpoint.id === model.endpointId)
            ?.models.find((entry) => entry.id === model.modelId),
        ).pipe(Option.map((entry) => ({ variants: entry.efforts ?? [] })))
      }
      yield* Effect.forEach(
        pulled.chats,
        (chat) =>
          Effect.gen(function* () {
            const session = yield* findSession(client, Session.ID.make(chat.id))
            if (Option.isNone(session)) return
            if (chat.archived) {
              yield* client.session.interrupt({ sessionID: session.value.id }).pipe(Effect.orDie)
              return
            }
            const saved = Option.getOrUndefined(SessionSettings.savedOf(session.value))
            const picked = saved?.model && Option.isSome(lookup(saved.model)) ? saved.model : undefined
            const resolved = BrainSettings.resolve(
              pulled.layers,
              {
                agent: chat.agent,
                model: Option.fromUndefinedOr(picked),
              },
              lookup,
            )
            if (Result.isFailure(resolved)) {
              yield* Effect.logWarning(`Chat ${chat.id} keeps its settings: ${resolved.failure.message}`)
              return
            }
            if (!picked) yield* dropPick(client, session, resolved.success.primary.model)
            const next = { resolved: resolved.success, interactive: saved?.interactive ?? true }
            yield* Ref.update(known.latest, (all) => new Map([...all, [chat.id, next]]))
            if (Option.isSome(settings)) yield* settings.value.keep(chat.id, next)
          }),
        { discard: true },
      )
    }
    state.models = models
    yield* server.configure({
      models,
      ...(update.apps && { apps: update.apps }),
      ...(Option.isSome(server.chats) && { chats: yield* Ref.get(server.chats.value.latest) }),
    })
  })
  yield* configure({ models: endpoints })
  const reader = Option.isSome(models)
    ? Option.some(
        yield* OpenCodeModels.make({
          inference: models.value.inference,
          keyFor: models.value.refreshKey,
          apply: (next) => mutations.withPermit(configure({ models: next })),
        }).pipe(Effect.provide(FetchHttpClient.layer)),
      )
    : Option.none()
  const refreshModels = Option.match(reader, { onNone: () => Effect.void, onSome: (found) => found.refresh })
  // oxlint-disable-next-line ren/no-comments -- HR14: a model that the brain does not know yet may be new in LiteLLM, so the brain reads the list once before it refuses the model.
  const knowing = Effect.fnUntraced(function* (model: Model | null | undefined) {
    if (!model) return
    if (Option.isSome((yield* lookupOf(client))(model))) return
    yield* refreshModels
  })

  return {
    fetch: server.fetch,
    chat: OpenCodeChat.make(server),
    configure: (update: HarnessConfig.Update) => mutations.withPermit(configure(update)),
    configuration: server.configuration,
    refreshModels,
    start: (input: StartBody) =>
      knowing(input.model).pipe(Effect.andThen(mutations.withPermit(start(client, server, settings, input)))),
    send: (input: SendInput) => mutations.withPermit(send(client, input)),
    transcript: {
      drop: (chat) =>
        mutations.withPermit(client.session.remove({ sessionID: Session.ID.make(chat) }).pipe(Effect.ignore)),
      // oxlint-disable-next-line ren/no-comments -- Only a folder on the brain's own hand is on this disk; a hand Ren did not create is never touched (E114).
      removeFolder: (chat) =>
        server.hasEnvironmentConnections
          ? Effect.promise(() => rm(server.directoryOf(chat), { recursive: true, force: true }))
          : Effect.void,
      has: (chat) => findSession(client, Session.ID.make(chat)).pipe(Effect.map(Option.isSome)),
      start: (input) =>
        mutations
          .withPermit(
            start(client, server, settings, {
              ...Struct.omit(input, ["environmentTemplateId", "directory"]),
              ...(input.directory && { directory: Environment.Directory.make(input.directory) }),
            }),
          )
          .pipe(Effect.asVoid),
      // oxlint-disable-next-line ren/no-comments -- The in-process import keeps the chat's workspace link, so its tools stay on its hand (E104); OpenCode's import route drops it.
      restore: (data) =>
        mutations.withPermit(
          Effect.gen(function* () {
            const info = OpenCodeRows.session(data.session)
            const messages = yield* Effect.forEach(data.messages, OpenCodeRows.message)
            // oxlint-disable-next-line ren/no-comments -- Only the brain's own hand is on this disk: its folder is made before the import, and a folder that was gone means its files were lost (E105, E113).
            const isOwnHand =
              server.hasEnvironmentConnections && info.location.directory === server.directoryOf(data.chat.id)
            const isLost =
              isOwnHand &&
              !(yield* Effect.promise(() =>
                stat(info.location.directory).then(
                  () => true,
                  () => false,
                ),
              ))
            if (isLost) yield* server.makeDirectory(info.location.directory)
            const workspaceID = data.session.workspace_id
              ? yield* server.workspaces.create({
                  id: RenWorkspaceDriver.workspaceId(data.chat.id),
                  provider: RenWorkspaceDriver.provider,
                })
              : undefined
            yield* server.transfer.import({
              data: { info, messages },
              location: Location.Ref.make({ directory: info.location.directory, workspaceID }),
            })
            // oxlint-disable-next-line ren/no-comments -- Queued messages go back in the chat's inbox with their ids and order, and start no turn (E110).
            yield* Effect.forEach(
              data.chat.inbox.filter((row) => row.type === "user"),
              (row) =>
                Schema.decodeUnknownEffect(Schema.fromJsonString(SessionInbox.UserPayload))(row.payload).pipe(
                  Effect.flatMap((payload) =>
                    client.session.prompt({
                      text: payload.text,
                      ...(payload.metadata && { metadata: payload.metadata }),
                      ...(payload.agents && { agents: payload.agents }),
                      ...(payload.skills && { skills: payload.skills }),
                      sessionID: info.id,
                      id: SessionMessage.ID.make(row.id),
                      delivery: row.delivery === "steer" ? "steer" : "queue",
                      resume: false,
                    }),
                  ),
                ),
              { discard: true },
            )
            if (isLost)
              yield* client.session.synthetic({
                sessionID: info.id,
                text: "This chat moved to a new machine. Its workspace files from before the move are gone; the chat history is kept.",
                metadata: { source: filesReset },
                resume: false,
              })
            // oxlint-disable-next-line ren/no-comments -- A revert that was staged, not committed, stays staged (E112).
            if (data.chat.revertMessageId)
              yield* client.session.revert.stage({
                sessionID: info.id,
                messageID: SessionMessage.ID.make(data.chat.revertMessageId),
              })
          }).pipe(Effect.orDie),
        ),
    },
    setModel: (sessionId: string, model: Option.Option<Model>) =>
      knowing(Option.getOrUndefined(model)).pipe(
        Effect.andThen(
          mutations.withPermit(
            Effect.gen(function* () {
              const sessionID = Session.ID.make(sessionId)
              const session = yield* findSession(client, sessionID)
              if (Option.isNone(session))
                return yield* new SessionNotStartedError({ message: `Session ${sessionId} has not been started` })
              const saved = Option.getOrUndefined(SessionSettings.savedOf(session.value))
              yield* pick(client, server, settings, sessionID, model, { interactive: saved?.interactive ?? true })
              yield* client.session
                .update({
                  sessionID,
                  metadata: SessionSettings.metadata(session, {
                    start: saved?.start ?? null,
                    model: Option.getOrNull(model),
                    interactive: saved?.interactive ?? true,
                  }),
                })
                .pipe(Effect.orDie)
            }),
          ),
        ),
      ),
    onTurn: (hooks) =>
      Option.match(server.chats, {
        onNone: () => Effect.void,
        onSome: (chats) =>
          Effect.all([Ref.set(chats.turnStarted, hooks.started), Ref.set(chats.turnEnded, hooks.ended)], {
            discard: true,
          }),
      }),
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
            progress: String(DateTime.toEpochMillis(info.time.updated)),
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
          .map((id) => ({ id, inbox: [], progress: "", unfinished: false })),
      ].map((session) => {
        const questionAgesMs = forms
          .filter((form) => form.sessionID === session.id)
          .map((form) => now - (state.firstAskedAt.get(form.id) ?? now))
        return {
          id: session.id,
          active: active.includes(session.id),
          progress: session.progress,
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
