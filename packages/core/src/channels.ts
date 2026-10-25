export * as Channels from "./channels.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import { Channel } from "@ren/schema/channel"
import { Session } from "@ren/schema/session"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { BrainHost } from "./brain-host.js"
import { ChannelInstalls } from "./channel-installs.js"
import { ChannelNotice } from "./channel-notice.js"
import { ChannelProvider } from "./channel-provider.js"
import { ChannelRoute } from "./channel-route.js"
import { DurableRunner } from "./durable-runner.js"
import { SessionRunner } from "./session/runner.js"

export interface Reply {
  readonly status: 200 | 400 | 401 | 404 | 500
  readonly body?: Schema.Json
}

export interface Interface {
  readonly receive: (provider: string, request: ChannelProvider.Request) => Effect.Effect<Reply>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Channels") {}

export const EventRun = DurableRunner.make("ChannelEvent", {
  payload: { event: Channel.Event, messageId: Session.MessageID, sessionId: Session.ID },
  idempotencyKey: (payload) => `${payload.event.provider}:${payload.event.install}:${payload.event.eventId}`,
})

class Stopped extends Schema.TaggedError<Stopped>()("Channels.Stopped", {
  reason: Channel.FailureReason,
  message: Schema.String,
}) {}

const filesAtOnce = 4

const mimeType = /^[a-z]+\/[a-z0-9.+-]+$/iu

const base64 = Schema.encodeSync(Schema.Uint8ArrayFromBase64)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const registry = yield* ChannelProvider.Registry
    const routes = yield* ChannelRoute.Service
    const installs = yield* ChannelInstalls.Service
    const notices = yield* ChannelNotice.Service
    const runner = yield* SessionRunner.Service
    const brainHost = yield* BrainHost.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const thread = Database.Schema.channel_thread

    const prompt = Effect.fnUntraced(function* (provider: ChannelProvider.Provider, event: Channel.Event) {
      const fetched = yield* Effect.forEach(
        event.files,
        (file) =>
          provider.fetchFile(event.install, file).pipe(
            Effect.tapError((error) => Effect.logWarning(`Channel file ${file.name} could not be read`, error)),
            Effect.option,
            Effect.map((bytes) => ({ file, bytes })),
          ),
        { concurrency: filesAtOnce },
      )
      const kept = fetched.reduce(
        (sum, each) => {
          if (Option.isNone(each.bytes)) {
            sum.notes.push(`(${each.file.name} could not be read.)`)
            return sum
          }
          const mime = mimeType.test(each.file.mime) ? each.file.mime : "application/octet-stream"
          const url = `data:${mime};base64,${base64(each.bytes.value)}`
          const bytes = Session.fileBytes(url)
          if (sum.bytes + bytes > Session.maxFileBytes)
            sum.notes.push(`(${each.file.name} is not attached: a message’s files total at most 10 MB.)`)
          else {
            sum.bytes += bytes
            sum.files.push({ url, name: each.file.name })
          }
          return sum
        },
        { bytes: 0, files: new Array<Session.File>(), notes: new Array<string>() },
      )
      const text = [event.text, ...kept.notes].filter((line) => line.length > 0).join("\n")
      return { text: text.length > 0 ? text : "(no text)", ...(kept.files.length > 0 && { files: kept.files }) }
    })

    const claim = Effect.fnUntraced(function* (route: ChannelRoute.Route, event: Channel.Event, sessionId: Session.ID) {
      yield* database.db
        .insert(thread)
        .values({
          id: Channel.ThreadID.create(),
          organization_id: route.organizationId,
          provider: event.provider,
          install: event.install,
          thread: event.thread.id,
          session_id: sessionId,
          url: event.thread.url ?? null,
        })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
      const read = database.db
        .select({
          id: thread.id,
          sessionId: thread.session_id,
          created: Database.Schema.agent_session.id,
          archivedAt: Database.Schema.agent_session.archived_at,
        })
        .from(thread)
        .leftJoin(Database.Schema.agent_session, eq(Database.Schema.agent_session.id, thread.session_id))
        .where(
          and(
            eq(thread.provider, event.provider),
            eq(thread.install, event.install),
            eq(thread.thread, event.thread.id),
          ),
        )
        .pipe(
          Effect.orDie,
          Effect.flatMap((rows) =>
            Option.match(Option.fromNullishOr(rows.at(0)), {
              onNone: () => Effect.die(new Error(`The channel thread ${event.thread.id} has no row after its claim`)),
              onSome: Effect.succeed,
            }),
          ),
        )
      const claimed = yield* read
      if (!claimed.archivedAt) return claimed
      yield* database.db
        .update(thread)
        .set({ session_id: sessionId, updated_at: new Date() })
        .where(and(eq(thread.id, claimed.id), eq(thread.session_id, claimed.sessionId)))
        .pipe(Effect.orDie)
      return yield* read
    })

    const send = (input: Session.SendInput) =>
      runner.send(input).pipe(
        Effect.catchTag("BrainUnavailable", (error) =>
          Effect.gen(function* () {
            const session = yield* runner.get(input.sessionId).pipe(Effect.orDie)
            const state = yield* brainHost.access(session.brainId)
            if (state._tag === "Failed")
              return yield* new Stopped({ reason: "brain_failed", message: `The brain failed: ${state.reason}` })
            return yield* error
          }),
        ),
      )

    const run = Effect.fnUntraced(function* (payload: typeof EventRun.payloadSchema.Type) {
      const event = payload.event
      const found = registry.get(event.provider)
      if (Option.isNone(found)) return yield* Effect.logError(`No channel provider ${event.provider} runs this event`)
      const route = yield* routes.resolve(event)
      const context = yield* found.value.context(event).pipe(
        Effect.tapError((error) => Effect.logWarning(`The ${event.provider} thread context could not be read`, error)),
        Effect.orElseSucceed(Option.none<string>),
      )
      const message = {
        messageId: payload.messageId,
        prompt: yield* prompt(found.value, event),
        sender: { userId: route.senderUserId },
        channel: {
          provider: event.provider,
          place: event.place.name ?? event.place.id,
          ...(event.thread.url && { threadUrl: event.thread.url }),
          sender: event.sender.name ?? event.sender.handle ?? event.sender.accountId,
          ...(event.sender.handle && { handle: event.sender.handle }),
          ...(Option.isSome(context) && { context: context.value }),
        },
      }
      const claimed = yield* claim(route, event, payload.sessionId)
      yield* database.db
        .update(thread)
        .set({
          place_name: event.place.name ?? event.place.id,
          last_message: event.message,
          last_message_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(thread.id, claimed.id))
        .pipe(Effect.orDie)
      const sendToThread = send({ ...message, sessionId: claimed.sessionId, delivery: "steer" })
      if (claimed.created) return yield* sendToThread
      const create = (options: { readonly agentId?: Agent.ID }) =>
        runner.create(
          { organizationId: route.organizationId, spaceId: route.spaceId, createdBy: route.senderUserId },
          { sessionId: claimed.sessionId, harness: "opencode", interactive: false, initialMessage: message },
          options,
        )
      const agentId = route.agentId
      yield* (
        agentId
          ? create({ agentId }).pipe(
              Effect.catchTag("SessionRunner.NotFound", () =>
                Effect.logWarning(`Agent ${agentId} is gone; the channel session runs ren`).pipe(
                  Effect.andThen(create({})),
                ),
              ),
            )
          : create({})
      ).pipe(
        Effect.catchTags({ "SessionRunner.AlreadyExists": () => sendToThread, "SessionRunner.NotFound": Effect.die }),
      )
    })

    yield* DurableRunner.register(EventRun, (payload) =>
      DurableRunner.supervise(
        `channel:${payload.event.provider}:${payload.event.install}:${payload.event.eventId}`,
        run(payload).pipe(
          Effect.catchTags({
            "ChannelRoute.Refused": (error) => notices.notice(payload.event, error.reason),
            "ChannelRoute.Unroutable": (error) => Effect.logWarning(`A channel event has no route: ${error.message}`),
            BrainRejectedError: (error) =>
              Effect.logError(`The brain rejected a channel message: ${error.message}`).pipe(
                Effect.andThen(notices.notice(payload.event, "unknown")),
              ),
            "Channels.Stopped": (error) =>
              Effect.logWarning(`A channel message stopped: ${error.message}`).pipe(
                Effect.andThen(notices.notice(payload.event, error.reason)),
              ),
          }),
        ),
      ),
    )

    return Service.of({
      receive: Effect.fn("Channels.receive")(function* (id: string, request: ChannelProvider.Request) {
        const found = registry.get(id)
        if (Option.isNone(found)) return { status: 404 } satisfies Reply
        const verified = yield* Effect.result(found.value.verify(request))
        if (Result.isFailure(verified)) {
          yield* Effect.logWarning(`A ${id} delivery failed verification: ${verified.failure.message}`)
          return { status: 401 } satisfies Reply
        }
        const parsed = yield* Effect.result(found.value.parse(request))
        if (Result.isFailure(parsed)) {
          yield* Effect.logWarning(`A ${id} delivery did not parse: ${parsed.failure.message}`)
          return { status: 400 } satisfies Reply
        }
        const value = parsed.success
        if (value._tag === "Handshake") return { status: 200, body: value.body } satisfies Reply
        if (value._tag === "Uninstalled") {
          yield* installs.removeByWorkspace(found.value.id, value.install)
          return { status: 200 } satisfies Reply
        }
        if (value._tag === "Ignore") {
          yield* Effect.logDebug(`A ${id} delivery is ignored: ${value.reason}`)
          return { status: 200 } satisfies Reply
        }
        return yield* DurableRunner.ensure(EventRun, {
          event: value.event,
          messageId: Session.MessageID.create(),
          sessionId: Session.ID.create(),
        }).pipe(
          Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
          Effect.as({ status: 200 } satisfies Reply),
          Effect.catchCause((cause) =>
            Effect.logError(`A ${id} event could not be stored`, cause).pipe(
              Effect.as({ status: 500 } satisfies Reply),
            ),
          ),
        )
      }),
    })
  }),
)
