export * as ChannelFixture from "./channel-fixture.js"

import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { Channel } from "@ren/schema/channel"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelOrigin } from "@ren/schema/channel-origin"
import { Session } from "@ren/schema/session"
import { TaskLink } from "@ren/schema/task-link"
import { BunCrypto } from "@effect/platform-bun"
import {
  Clock,
  ConfigProvider,
  Context,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Schema,
  Struct,
} from "effect"
import { ClusterWorkflowEngine, SingleRunner } from "effect/cluster"
import { WorkflowEngine } from "effect/workflow"
import { BrainRegistry } from "../../src/brain-registry.js"
import { Access } from "../../src/access.js"
import { ChannelIdentity } from "../../src/channel-identity.js"
import { ChannelInstalls } from "../../src/channel-installs.js"
import { ChannelSecrets } from "../../src/channel-secrets.js"
import { ChannelMappings } from "../../src/channel-mappings.js"
import { ChannelNotice } from "../../src/channel-notice.js"
import { ChannelProvider } from "../../src/channel-provider.js"
import { ChannelTurns } from "../../src/channel-turns.js"
import { EgressControl } from "../../src/egress-control.js"
import { Envelope } from "../../src/envelope.js"
import { PersonCredentials } from "../../src/person-credentials.js"
import { ChannelRoute } from "../../src/channel-route.js"
import { Channels } from "../../src/channels.js"
import { DurableRunner } from "../../src/durable-runner.js"
import { Models } from "../../src/models.js"
import { SessionRunner } from "../../src/session/runner.js"
import { SessionSync } from "../../src/session-sync.js"
import { Task } from "../../src/task.js"
import { Host } from "./host.js"

const secret = "channel-test-secret"

const sign = (body: string) => new Bun.CryptoHasher("sha256", secret).update(body).digest("hex")

const Body = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ type: Schema.Literal("handshake"), challenge: Schema.String }),
    Schema.Struct({ type: Schema.Literal("ignore") }),
    Schema.Struct({ type: Schema.Literal("uninstalled"), install: Schema.NonEmptyString }),
    Schema.Struct({ type: Schema.Literal("event"), event: Channel.Event }),
    Schema.Struct({ type: Schema.Literal("signal"), signal: Channel.Signal }),
  ]),
)

export class Hold extends Context.Service<
  Hold,
  { readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }
>()("@ren/core/test/ChannelFixture/Hold") {}

const hold = (held: boolean) =>
  Layer.effect(
    Hold,
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      if (!held) yield* Deferred.succeed(release, undefined)
      return { entered: yield* Deferred.make<void>(), release }
    }),
  )

export class Outbox extends Context.Service<
  Outbox,
  {
    readonly sent: Array<{ readonly target: ChannelProvider.Target; readonly text: string }>
    readonly attempts: Array<string>
    readonly progress: Array<{ readonly message: string; readonly status: ChannelProvider.Status }>
    readonly emails: Map<string, string>
    readonly lookups: Array<string>
    readonly places: Array<ChannelProvider.Place>
    readonly announced: Array<{ readonly place: string; readonly text: string }>
  }
>()("@ren/core/test/ChannelFixture/Outbox") {}

export const trigger = {
  id: "channel_message",
  title: "Answer every message",
  description: "Each message in the channel, with no mention.",
  defaultPrompt: "Answer this message.",
}

const provider = Effect.gen(function* () {
  const gate = yield* Hold
  const outbox = yield* Outbox
  return {
    id: "slack",
    triggers: [trigger],
    replyTool: "slack_reply_to_current_thread",
    verify: (request) =>
      request.headers.get("x-signature") === sign(request.body)
        ? Effect.void
        : Effect.fail(new ChannelProvider.Unauthorized({ message: "The signature does not match the body" })),
    parse: (request) =>
      Schema.decodeUnknownEffect(Body)(request.body).pipe(
        Effect.mapError((error) => new ChannelProvider.Malformed({ message: error.message })),
        Effect.map((body): Channel.Parsed => {
          if (body.type === "handshake") return { _tag: "Handshake", body: { challenge: body.challenge } }
          if (body.type === "ignore") return { _tag: "Ignore", reason: "a bot’s own message" }
          if (body.type === "uninstalled") return { _tag: "Uninstalled", install: body.install }
          if (body.type === "signal") return { _tag: "Signal", signal: body.signal }
          return { _tag: "Event", event: body.event }
        }),
      ),
    fetchFile: (_install, file) => {
      if (file.url === "held")
        return Deferred.succeed(gate.entered, undefined).pipe(
          Effect.andThen(Deferred.await(gate.release)),
          Effect.as(new Uint8Array(1)),
        )
      return file.url.startsWith("bytes:")
        ? Effect.succeed(new Uint8Array(Number(file.url.slice("bytes:".length))).fill(97))
        : Effect.fail(new ChannelProvider.FileUnavailable({ message: `${file.name} is gone` }))
    },
    context: (found) =>
      found.message === "unreadable"
        ? Effect.fail(new ChannelProvider.Unavailable({ message: "Slack is down" }))
        : Effect.succeedSome("[Bob] the deploy failed at 10:02"),
    linkOf: (found) =>
      Option.fromNullishOr(found.thread.url).pipe(
        Option.map(TaskLink.classify),
        Option.filter((link) => link.kind === "slack_thread"),
      ),
    send: (target, text) =>
      Effect.suspend(
        (): Effect.Effect<void, ChannelProvider.PlaceGone | ChannelProvider.Unavailable | ChannelProvider.Rejected> => {
          outbox.attempts.push(text)
          if (text === "gone") return Effect.fail(new ChannelProvider.PlaceGone({ message: "channel_not_found" }))
          if (text === "down") return Effect.fail(new ChannelProvider.Unavailable({ message: "Slack is down" }))
          if (text === "refused") return Effect.fail(new ChannelProvider.Rejected({ message: "msg_too_long" }))
          outbox.sent.push({ target, text })
          return Effect.void
        },
      ),
    progress: (target, status) => Effect.sync(() => void outbox.progress.push({ message: target.message, status })),
    email: (_install, sender) =>
      Effect.suspend(() => {
        outbox.lookups.push(sender.accountId)
        const found = outbox.emails.get(sender.accountId)
        return found === "down"
          ? Effect.fail(new ChannelProvider.Unavailable({ message: "Slack is down" }))
          : Effect.succeed(Option.fromNullishOr(found))
      }),
    installUrl: (state) => `https://slack.test/install?state=${state}`,
    completeInstall: (query) =>
      query.team
        ? Effect.succeed({ workspace: query.team, name: "Acme" })
        : Effect.fail(new ChannelProvider.InstallFailed({ message: "Slack sent no team." })),
    changedOnProvider: () => false,
    revoke: () => Effect.void,
    places: () => Effect.sync(() => outbox.places),
    place: (_workspace, id) => Effect.sync(() => Option.fromNullishOr(outbox.places.find((place) => place.id === id))),
    announce: (_workspace, place, text) => Effect.sync(() => void outbox.announced.push({ place: place.id, text })),
  } satisfies ChannelProvider.Provider
})

const providers = Effect.map(provider, (slack) => [
  Option.some<ChannelProvider.Provider>(slack),
  Option.some<ChannelProvider.Provider>({ ...Struct.omit(slack, ["replyTool"]), id: "github" }),
])

export const request = (body: string, signature = sign(body)): ChannelProvider.Request => ({
  headers: new Headers({ "x-signature": signature }),
  body,
})

export const event = (install: string, overrides: Partial<Channel.Event> = {}): Channel.Event => ({
  provider: "slack",
  eventId: `Ev${crypto.randomUUID()}`,
  install,
  place: { id: "C07", kind: "channel", name: "eng" },
  thread: { id: `C07:${crypto.randomUUID()}`, url: "https://acme.slack.com/archives/C07/p1712" },
  message: "1712.33",
  sender: { accountId: "U01", name: "Ana", handle: "ana" },
  text: "the deploy failed",
  files: [],
  ...overrides,
})

export const delivery = (found: Channel.Event) => JSON.stringify({ type: "event", event: found })

export const install = Effect.fnUntraced(function* (owner: {
  readonly organizationId: Auth.OrganizationID
  readonly createdBy: Auth.UserID
}) {
  const database = yield* Database.Service
  const workspace = `T${crypto.randomUUID()}`
  yield* database.db.insert(Database.Schema.channel_install).values({
    id: ChannelInstall.ID.create(),
    organization_id: owner.organizationId,
    provider: "slack",
    workspace,
    name: "Acme",
    installed_by: owner.createdBy,
  })
  return workspace
})

export const app = "https://ren.test/app"

const notices = ChannelNotice.layer.pipe(
  Layer.provide(ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ APP_URL: app }))),
)

const Start = Schema.Struct({
  sessionId: Session.ID,
  interactive: Schema.Boolean,
  initialMessage: Schema.optionalKey(
    Schema.Struct({
      messageId: Session.MessageID,
      prompt: Session.Prompt,
      sender: Session.Sender,
      channel: Schema.optionalKey(ChannelOrigin.Info),
      synthetic: Schema.optionalKey(Session.Synthetic),
    }),
  ),
})

const Send = Schema.Struct({
  messageId: Session.MessageID,
  prompt: Session.Prompt,
  delivery: Session.Delivery,
  channel: Schema.optionalKey(ChannelOrigin.Info),
  synthetic: Schema.optionalKey(Session.Synthetic),
})

export interface Delivered {
  readonly kind: "start" | "send"
  readonly sessionId: Session.ID
  readonly messageId: Session.MessageID
  readonly prompt: Session.Prompt
  readonly delivery?: Session.Delivery
  readonly interactive?: boolean
  readonly channel?: ChannelOrigin.Info
  readonly synthetic?: Session.Synthetic
}

export class Cell extends Context.Service<
  Cell,
  {
    readonly url: string
    readonly accepted: ReadonlyArray<Delivered>
    readonly sends: ReadonlyArray<Session.MessageID>
    readonly start: (sessionId: Session.ID) => void
    readonly failSends: (count: number) => void
    readonly rejectSends: () => void
  }
>()("@ren/core/test/ChannelFixture/Cell") {}

const cell = Layer.effect(
  Cell,
  Effect.gen(function* () {
    const accepted: Array<Delivered> = []
    const sends: Array<Session.MessageID> = []
    const started = new Set<string>()
    const failures = { left: 0, rejected: false }
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: async (incoming) => {
            const path = new URL(incoming.url).pathname
            if (path === "/ren/sessions") {
              const body = Schema.decodeUnknownSync(Start)(await incoming.json())
              started.add(body.sessionId)
              if (body.initialMessage)
                accepted.push({
                  kind: "start",
                  sessionId: body.sessionId,
                  interactive: body.interactive,
                  ...body.initialMessage,
                })
              return Response.json({ sessionId: body.sessionId, harness: "opencode" })
            }
            const sessionId = Session.ID.make(path.split("/")[3] ?? "")
            const body = Schema.decodeUnknownSync(Send)(await incoming.json())
            sends.push(body.messageId)
            if (failures.rejected) return new Response("too large", { status: 413 })
            if (failures.left > 0) {
              failures.left -= 1
              return new Response("waking", { status: 503 })
            }
            if (!started.has(sessionId))
              return Response.json({ _tag: "SessionNotStartedError", message: "not started" }, { status: 409 })
            accepted.push({ kind: "send", sessionId, ...body })
            return Response.json({ messageId: body.messageId })
          },
        }),
      ),
      (running) => Effect.promise(() => running.stop(true)),
    )
    return Cell.of({
      url: server.url.origin,
      accepted,
      sends,
      start: (sessionId) => void started.add(sessionId),
      failSends: (count) => {
        failures.left = count
      },
      rejectSends: () => {
        failures.rejected = true
      },
    })
  }),
)

const models = Models.layerNone

const core = (held: boolean) =>
  Layer.mergeAll(
    Task.layer.pipe(Layer.provideMerge(SessionRunner.layer)),
    ChannelInstalls.layer,
    ChannelRoute.layer.pipe(Layer.provideMerge(ChannelIdentity.layer)),
    ChannelMappings.layer,
    SessionSync.layer,
    notices,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        BrainRegistry.layer,
        ChannelProvider.layer(providers),
        Access.layer,
        Layer.mergeAll(PersonCredentials.layer, ChannelSecrets.layer).pipe(
          Layer.provide(Layer.mergeAll(Envelope.layerLocal, EgressControl.layerNone)),
        ),
      ),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        hold(held),
        Layer.sync(Outbox, () => ({
          sent: [],
          attempts: [],
          progress: [],
          emails: new Map(),
          lookups: [],
          places: [
            { id: "C07", name: "eng", private: false, anyoneCanWrite: false },
            { id: "C09", name: "sales", private: true, anyoneCanWrite: false },
            { id: "C11", name: "shared-with-vendor", private: false, anyoneCanWrite: true },
          ],
          announced: [],
        })),
      ),
    ),
  )

const onCell = <A, E, R, RE, RR>(
  channels: Layer.Layer<A, E, R>,
  runner: Layer.Layer<WorkflowEngine.WorkflowEngine, RE, RR>,
  options: { readonly held: boolean } = { held: false },
) =>
  channels.pipe(
    Layer.provideMerge(core(options.held)),
    Layer.provideMerge(
      Layer.unwrap(
        Effect.gen(function* () {
          const found = yield* Cell
          return Host.cellLayerWith(runner)({ CELL_URL: found.url }, models, Host.noTemplates)
        }),
      ),
    ),
    Layer.provideMerge(cell),
  )

export const cellLayer = onCell(Layer.mergeAll(Channels.layer, ChannelTurns.layer), DurableRunner.layerMemory).pipe(
  Layer.provideMerge(Testing.layer),
)

export const unstoredLayer = onCell(
  Channels.layer.pipe(
    Layer.provide(
      Layer.effect(
        WorkflowEngine.WorkflowEngine,
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine
          return WorkflowEngine.WorkflowEngine.of({
            ...engine,
            execute: () => Effect.die(new Error("The run store is down")),
          })
        }),
      ),
    ),
  ),
  DurableRunner.layerMemory,
).pipe(Layer.provideMerge(Testing.layer))

export const durableLayer = (options: { readonly held: boolean }) =>
  onCell(
    Channels.layer,
    ClusterWorkflowEngine.layer.pipe(
      Layer.provideMerge(SingleRunner.layer({ shardingConfig: { entityTerminationTimeout: "100 millis" } })),
      Layer.provide(BunCrypto.layer),
    ),
    options,
  )

export const sandboxLayer = Channels.layer.pipe(
  Layer.provideMerge(core(false)),
  Layer.provideMerge(Host.layer({}, models)),
  Layer.provideMerge(Testing.layer),
)

const quick = (live: Clock.Clock): Clock.Clock => ({
  currentTimeMillisUnsafe: () => live.currentTimeMillisUnsafe(),
  currentTimeMillis: live.currentTimeMillis,
  currentTimeNanosUnsafe: () => live.currentTimeNanosUnsafe(),
  currentTimeNanos: live.currentTimeNanos,
  monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
  monotonicTimeNanos: live.monotonicTimeNanos,
  sleep: (duration) => (Duration.isLessThan(duration, Duration.seconds(30)) ? Effect.yieldNow : live.sleep(duration)),
})

export const receive = (body: string, signature?: string) =>
  Effect.gen(function* () {
    const channels = yield* Channels.Service
    const live = yield* Clock.Clock
    return yield* channels
      .receive("slack", request(body, signature))
      .pipe(Effect.provideService(Clock.Clock, quick(live)))
  })

export const settled = (found: Channel.Event) =>
  Effect.gen(function* () {
    const executionId = yield* Channels.EventRun.executionId({
      event: found,
      messageId: Session.MessageID.create(),
      sessionId: Session.ID.create(),
    })
    yield* Channels.EventRun.poll(executionId).pipe(
      Effect.repeat({ until: Option.isSome, schedule: Schedule.spaced("20 millis") }),
      Effect.timeoutOrElse({
        duration: "20 seconds",
        orElse: () => Effect.die(new Error(`The run of ${found.eventId} did not finish`)),
      }),
    )
  })

export const accepted = (count: number) =>
  Effect.gen(function* () {
    const found = yield* Cell
    yield* Effect.sync(() => found.accepted.length).pipe(
      Effect.repeat({ until: (length) => length >= count, schedule: Schedule.spaced("20 millis") }),
      Effect.timeoutOrElse({
        duration: "20 seconds",
        orElse: () => Effect.die(new Error(`The cell accepted ${found.accepted.length} of ${count} messages`)),
      }),
    )
    return found.accepted
  })

export const thread = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  found: Channel.Event,
  sessionId: Session.ID,
) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.channel_thread).values({
    id: Channel.ThreadID.create(),
    organization_id: organizationId,
    provider: found.provider,
    install: found.install,
    thread: found.thread.id,
    session_id: sessionId,
  })
})

export const threads = Effect.gen(function* () {
  const database = yield* Database.Service
  return yield* database.db.select().from(Database.Schema.channel_thread)
})
