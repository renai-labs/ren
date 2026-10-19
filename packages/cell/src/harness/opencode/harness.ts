export * as OpenCodeHarness from "./harness.js"

import { AbsolutePath, Agent, Model, OpenCode, Provider, Session, SessionMessage } from "@opencode/client/effect"
import type { OpenCodeClient } from "@opencode/client/effect"
import { Location } from "@opencode/schema/location"
import { Environments } from "@ren/brain/environments"
import type { SessionCreateInput, SessionListInput } from "@opencode/client/effect/api"
import { BrainRejectedError, SessionNotStartedError, SyncUnavailableError } from "@ren/brain-api/errors"
import type { Models } from "@ren/schema/models"
import { Environment } from "@ren/schema/environment"
import type { SendInput, StartInput } from "@ren/schema/session"
import { Clock, Effect, Layer, Option, Semaphore, Stream, Struct } from "effect"
import { FetchHttpClient } from "effect/http"
import { Cell } from "../../cell.js"
import { ModelRefresh } from "../../model-refresh.js"
import { ModelStore } from "../../model-store.js"
import { Sync } from "../../sync.js"
import { Harness } from "../harness.js"
import { OpenCodeChat } from "./chat.js"
import { Credentials } from "./credentials.js"
import { Host } from "./host.js"
import { OpenCodeRows } from "./opencode-rows.js"
import { InstructionEntries } from "./instruction-entries.js"
import { ModelCredentials } from "./model-credentials.js"
import { RenWorkspaceDriver } from "./ren-workspace-driver.js"

const toolsByCapability: Readonly<Record<Environment.Capability, ReadonlyArray<string>>> = {
  files: ["read", "edit", "glob", "grep"],
  processes: ["shell"],
}

const environmentActions = Environment.capabilities.flatMap((capability) => toolsByCapability[capability])

interface Placement {
  readonly isOnEnvironment: boolean
  readonly capabilities: ReadonlyArray<Environment.Capability>
}

const missingNotes: Readonly<Record<Environment.Capability, string>> = {
  files: "The sandbox gives no file access, so the read, write, edit, patch, glob and grep tools are off.",
  processes: "The sandbox runs no commands, so the shell tool is off.",
}

const environmentInstruction = "ren.environment"

const renModelKey = "ren.model"

const notSupported = (sessionId: string) =>
  new BrainRejectedError({ message: `Session ${sessionId} cannot change its environment: not supported yet` })

const environmentInstructions = (host: Host.Instance, sessionId: StartInput["sessionId"], placement: Placement) => {
  if (placement.isOnEnvironment)
    return {
      [environmentInstruction]: [
        `Your file and shell tools run on a sandbox, in ${Environment.sessionDirectory(sessionId)}. You have full access to the sandbox.`,
        ...Environment.capabilities
          .filter((capability) => !placement.capabilities.includes(capability))
          .map((capability) => missingNotes[capability]),
      ].join(" "),
    }
  if (!host.hasEnvironments) return {}
  return {
    [environmentInstruction]:
      "This session has no environment, so it has no file or shell tools. The other tools work as usual.",
  }
}

const deniedActions = (host: Host.Instance, input: StartInput, placement: Placement) => [
  ...(input.interactive ? [] : ["question"]),
  ...(host.hasEnvironments && !placement.isOnEnvironment ? environmentActions : []),
  ...(placement.isOnEnvironment
    ? Environment.capabilities
        .filter((capability) => !placement.capabilities.includes(capability))
        .flatMap((capability) => toolsByCapability[capability])
    : []),
]

const keptCapabilities = (session: Session.Info) =>
  Environment.capabilities.filter(
    (capability) =>
      !toolsByCapability[capability].every((action) =>
        (session.permissions ?? []).some((rule) => rule.action === action && rule.effect === "deny"),
      ),
  )

const findSession = (client: OpenCodeClient, sessionID: Session.ID) =>
  client.session.get({ sessionID }).pipe(
    Effect.map(Option.some),
    Effect.catchTag("SessionNotFoundError", () => Effect.succeed(Option.none())),
    Effect.orDie,
  )

const rejectUnknownModel = Effect.fn("OpenCodeHarness.rejectUnknownModel")(function* (
  client: OpenCodeClient,
  input: StartInput,
) {
  const agent = input.agent
  if (agent && !(yield* client.agent.list().pipe(Effect.orDie)).data.some((item) => item.id === agent))
    return yield* new BrainRejectedError({ message: `Unknown agent: ${agent}` })
  const model = input.model
  if (
    model &&
    !(yield* client.model.list().pipe(Effect.orDie)).data.some(
      (item) => item.providerID === model.endpointId && item.modelID === model.modelId,
    )
  )
    return yield* new BrainRejectedError({ message: `Unknown model: ${model.endpointId}/${model.modelId}` })
})

const create = Effect.fn("OpenCodeHarness.create")(function* (
  client: OpenCodeClient,
  host: Host.Instance,
  input: StartInput,
  directory: AbsolutePath,
  session: Pick<SessionCreateInput, "title" | "agent" | "model" | "permissions"> & { readonly id: Session.ID },
) {
  if (!input.environment)
    return yield* client.session.create({ ...session, location: { directory } }).pipe(Effect.orDie)
  const workspaceID = yield* host.workspaces
    .create({
      id: RenWorkspaceDriver.workspaceId(input.sessionId),
      provider: RenWorkspaceDriver.provider,
    })
    .pipe(Effect.orDie)
  return yield* host.sessions
    .create({
      id: session.id,
      ...(session.title && { title: session.title }),
      ...(session.agent && { agent: session.agent }),
      ...(session.model && { model: session.model }),
      ...(session.permissions && { permissions: session.permissions }),
      location: Location.Ref.make({ directory: AbsolutePath.make(input.environment.directory), workspaceID }),
    })
    .pipe(Effect.orDie)
})

const checkEnvironment = Effect.fn("OpenCodeHarness.checkEnvironment")(function* (
  host: Host.Instance,
  input: StartInput,
  session: Option.Option<Session.Info>,
) {
  const requested = input.environment
  if (Option.isSome(session)) {
    const isOnEnvironment = Boolean(
      (yield* host.sessions.get(session.value.id).pipe(Effect.orDie)).location.workspaceID,
    )
    if (requested && !isOnEnvironment) return yield* notSupported(input.sessionId)
    return isOnEnvironment
  }
  if (!requested) return false
  if (!host.hasEnvironments) return yield* new BrainRejectedError({ message: "This brain cannot use environments" })
  const folder = Environment.sessionDirectory(input.sessionId)
  if (requested.directory !== folder)
    return yield* new BrainRejectedError({
      message: `Session ${input.sessionId} works in ${folder} on its sandbox, not ${requested.directory}`,
    })
  return true
})

const applyRenModel = Effect.fn("OpenCodeHarness.applyRenModel")(function* (
  client: OpenCodeClient,
  sessionID: Session.ID,
  model: Model.Ref,
  session: Option.Option<Session.Info>,
) {
  const metadata = Option.match(session, {
    onNone: (): Session.Metadata => ({}),
    onSome: (found) => found.metadata ?? {},
  })
  const renModel = `${model.providerID}/${model.id}#${model.variant ?? ""}`
  if (metadata[renModelKey] === renModel) return
  if (Option.isSome(session)) yield* client.session.switchModel({ sessionID, model }).pipe(Effect.orDie)
  yield* client.session.update({ sessionID, metadata: { ...metadata, [renModelKey]: renModel } }).pipe(Effect.orDie)
})

const start = Effect.fn("OpenCodeHarness.start")(function* (
  client: OpenCodeClient,
  host: Host.Instance,
  input: StartInput,
  directory: AbsolutePath,
) {
  yield* rejectUnknownModel(client, input)
  const agent = input.agent ? Agent.ID.make(input.agent) : undefined
  const model = input.model && {
    providerID: Provider.ID.make(input.model.endpointId),
    id: Model.ID.make(input.model.modelId),
    ...(input.model.variant && { variant: Model.VariantID.make(input.model.variant) }),
  }
  const sessionID = Session.ID.make(input.sessionId)
  const session = yield* findSession(client, sessionID)
  const isOnEnvironment = yield* checkEnvironment(host, input, session)
  const placement = {
    isOnEnvironment,
    capabilities:
      input.environment?.capabilities ??
      Option.match(session, { onNone: () => Environment.capabilities, onSome: keptCapabilities }),
  }
  const permissions = deniedActions(host, input, placement).map((action) => ({
    action,
    resource: "*",
    effect: "deny" as const,
  }))
  if (Option.isNone(session))
    yield* create(client, host, input, directory, {
      id: sessionID,
      title: input.title,
      agent,
      model,
      permissions,
    })
  if (Option.isSome(session)) {
    yield* client.session.update({ sessionID, title: input.title, permissions }).pipe(Effect.orDie)
    if (agent && agent !== session.value.agent)
      yield* client.session.switchAgent({ sessionID, agent }).pipe(Effect.orDie)
  }
  if (model) yield* applyRenModel(client, sessionID, model, session)
  const changes = InstructionEntries.changes(
    yield* client.session.instructions.entry.list({ sessionID }).pipe(Effect.orDie),
    { ...input.instructions, ...environmentInstructions(host, input.sessionId, placement) },
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
  if (Option.isNone(yield* findSession(client, sessionID)))
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

const open = Effect.fn("OpenCodeHarness.open")(function* (
  storage: DurableObjectStorage,
  config: string,
  endpoints: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  environments: Option.Option<Environments.Interface>,
) {
  return yield* make(yield* Host.open(storage, config, endpoints, refreshKey, environments), endpoints)
})

export const layer = (storage: DurableObjectStorage) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const cell = yield* Cell.Info
      const store = yield* ModelStore.Service
      const refreshKey = yield* ModelRefresh.Service
      const environments = yield* Effect.serviceOption(Environments.Service)
      return Harness.layer(
        store.read.pipe(
          Effect.map(Option.match({ onNone: () => [], onSome: (access) => access.endpoints })),
          Effect.flatMap((endpoints) => open(storage, cell.vars.OPENCODE_CONFIG, endpoints, refreshKey, environments)),
        ),
      )
    }),
  )

export const make = Effect.fn("OpenCodeHarness.make")(function* (
  host: Host.Instance,
  endpoints: ReadonlyArray<Models.Endpoint>,
  directory: AbsolutePath = AbsolutePath.make("/workspace"),
) {
  const client = yield* OpenCode.make({ baseUrl: "http://opencode" }).pipe(
    Effect.provide(Layer.fresh(FetchHttpClient.layer)),
    Effect.provideService(FetchHttpClient.Fetch, (input, init) => host.fetch(new Request(input, init))),
  )
  const state = { firstAskedAt: new Map<string, number>() }
  const sync = yield* Effect.serviceOption(Sync.Service)
  const mutations = yield* Semaphore.make(1)
  const configure = Effect.fn("OpenCodeHarness.configure")(function* (next: ReadonlyArray<Models.Endpoint>) {
    yield* host.configure(next)
    yield* Credentials.sync(host.credentials, ModelCredentials.owner, ModelCredentials.entries(next))
  })
  yield* configure(endpoints)

  return {
    fetch: host.fetch,
    chat: OpenCodeChat.make(host),
    configure: (next: ReadonlyArray<Models.Endpoint>) => mutations.withPermit(configure(next)),
    start: (input: StartInput) =>
      mutations.withPermit(
        Effect.gen(function* () {
          if (Option.isSome(sync))
            yield* sync.value
              .restore({
                sessionId: input.sessionId,
                exists: (id) => findSession(client, Session.ID.make(id)).pipe(Effect.map(Option.isSome)),
                create: start(client, host, Struct.omit(input, ["initialMessage"]), directory),
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
          return yield* start(client, host, input, directory)
        }),
      ),
    send: (input: SendInput) => mutations.withPermit(send(client, input)),
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
