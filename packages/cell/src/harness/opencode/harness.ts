export * as OpenCodeHarness from "./harness.js"

import { AbsolutePath, Agent, Model, OpenCode, Provider, Session, SessionMessage } from "@opencode/client/effect"
import type { OpenCodeClient } from "@opencode/client/effect"
import { Location } from "@opencode/schema/location"
import { HandConnections } from "@ren/brain/hand-connections"
import type { SessionCreateInput, SessionListInput } from "@opencode/client/effect/api"
import { BrainRejectedError, SessionNotStartedError } from "@ren/brain-api/errors"
import type { Models } from "@ren/schema/models"
import type { StartBody } from "@ren/brain-api/brain-api"
import type { SendInput } from "@ren/schema/session"
import { Clock, Effect, Layer, Option, Semaphore, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { Cell } from "../../cell.js"
import { ModelRefresh } from "../../model-refresh.js"
import { ModelStore } from "../../model-store.js"
import { Harness } from "../harness.js"
import { Credentials } from "./credentials.js"
import { Host } from "./host.js"
import { InstructionEntries } from "./instruction-entries.js"
import { ModelCredentials } from "./model-credentials.js"
import { RenWorkspaceDriver } from "./workspace-driver.js"

const handActions = ["read", "edit", "glob", "grep", "shell"]

const environmentInstructionKey = "ren.environment"

const notSupported = (sessionId: string) =>
  new BrainRejectedError({ message: `Session ${sessionId} cannot change its environment: not supported yet` })

const environmentInstructions = (host: Host.Instance, handDirectory: Option.Option<string>) => {
  if (Option.isSome(handDirectory))
    return {
      [environmentInstructionKey]: `Your file and shell tools run on a separate machine, in ${handDirectory.value}. You have full access to that machine.`,
    }
  if (!host.hasHandConnections) return {}
  return {
    [environmentInstructionKey]:
      "This session has no environment, so it has no file or shell tools. The other tools work as usual.",
  }
}

const deniedActions = (host: Host.Instance, input: StartBody, handDirectory: Option.Option<string>) => [
  ...(input.interactive ? [] : ["question"]),
  ...(host.hasHandConnections && Option.isNone(handDirectory) ? handActions : []),
]

const findSession = (client: OpenCodeClient, sessionID: Session.ID) =>
  client.session.get({ sessionID }).pipe(
    Effect.map(Option.some),
    Effect.catchTag("SessionNotFoundError", () => Effect.succeed(Option.none())),
    Effect.orDie,
  )

const rejectUnknownModel = Effect.fn("OpenCodeHarness.rejectUnknownModel")(function* (
  client: OpenCodeClient,
  input: StartBody,
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
  input: StartBody,
  directory: AbsolutePath,
  handDirectory: Option.Option<string>,
  session: Pick<SessionCreateInput, "title" | "agent" | "model" | "permissions"> & { readonly id: Session.ID },
) {
  if (Option.isNone(handDirectory))
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
      location: Location.Ref.make({ directory: AbsolutePath.make(handDirectory.value), workspaceID }),
    })
    .pipe(Effect.orDie)
})

const handDirectoryOf = Effect.fn("OpenCodeHarness.handDirectoryOf")(function* (
  host: Host.Instance,
  input: StartBody,
  session: Option.Option<Session.Info>,
): Effect.fn.Return<Option.Option<string>, BrainRejectedError> {
  if (Option.isSome(session)) {
    const location = (yield* host.sessions.get(session.value.id).pipe(Effect.orDie)).location
    if (input.directory && !location.workspaceID) return yield* notSupported(input.sessionId)
    return location.workspaceID ? Option.some(location.directory) : Option.none()
  }
  if (!input.directory) return Option.none()
  if (!host.hasHandConnections) return yield* new BrainRejectedError({ message: "This brain cannot use environments" })
  return Option.some(input.directory)
})

const start = Effect.fn("OpenCodeHarness.start")(function* (
  client: OpenCodeClient,
  host: Host.Instance,
  input: StartBody,
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
  const handDirectory = yield* handDirectoryOf(host, input, session)
  const permissions = deniedActions(host, input, handDirectory).map((action) => ({
    action,
    resource: "*",
    effect: "deny" as const,
  }))
  if (Option.isNone(session))
    yield* create(client, host, input, directory, handDirectory, {
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
    if (model) yield* client.session.switchModel({ sessionID, model }).pipe(Effect.orDie)
  }
  const changes = InstructionEntries.changes(
    yield* client.session.instructions.entry.list({ sessionID }).pipe(Effect.orDie),
    { ...input.instructions, ...environmentInstructions(host, handDirectory) },
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
  connections: Option.Option<HandConnections.Interface>,
) {
  return yield* make(yield* Host.open(storage, config, endpoints, refreshKey, connections), endpoints)
})

export const layer = (storage: DurableObjectStorage) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const cell = yield* Cell.Info
      const store = yield* ModelStore.Service
      const refreshKey = yield* ModelRefresh.Service
      const connections = yield* Effect.serviceOption(HandConnections.Service)
      return Harness.layer(
        store.read.pipe(
          Effect.map(Option.match({ onNone: () => [], onSome: (access) => access.endpoints })),
          Effect.flatMap((endpoints) => open(storage, cell.vars.OPENCODE_CONFIG, endpoints, refreshKey, connections)),
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
  const mutations = yield* Semaphore.make(1)
  const configure = Effect.fn("OpenCodeHarness.configure")(function* (next: ReadonlyArray<Models.Endpoint>) {
    yield* host.configure(next)
    yield* Credentials.sync(host.credentials, ModelCredentials.owner, ModelCredentials.entries(next))
  })
  yield* configure(endpoints)

  return {
    fetch: host.fetch,
    configure: (next: ReadonlyArray<Models.Endpoint>) => mutations.withPermit(configure(next)),
    start: (input: StartBody) => mutations.withPermit(start(client, host, input, directory)),
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
