export * as Channels from "./channels.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import { Channel } from "@ren/schema/channel"
import { Session } from "@ren/schema/session"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result, Schema, Struct } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { BrainHost } from "./brain-host.js"
import { ChannelInstalls } from "./channel-installs.js"
import { ChannelNotice } from "./channel-notice.js"
import { ChannelProvider } from "./channel-provider.js"
import { ChannelRoute } from "./channel-route.js"
import { DurableRunner } from "./durable-runner.js"
import { SessionRunner } from "./session/runner.js"
import { Task } from "./task.js"
import { TaskTrail } from "./task/trail.js"

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
  sessionId: Schema.optionalKey(Session.ID),
}) {}

type Message = Omit<Session.SendInput, "sessionId" | "delivery">

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
    const tasks = yield* Task.Service
    const thread = Database.Schema.channel_thread
    const install = Database.Schema.channel_install

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
          spaceId: Database.Schema.agent_session.space_id,
          agentId: Database.Schema.agent_session.agent_id,
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
      if (!claimed.created) return claimed
      if (!claimed.archivedAt && claimed.spaceId === route.spaceId && claimed.agentId === (route.agentId ?? null))
        return claimed
      yield* database.db
        .update(thread)
        .set({ session_id: sessionId, last_reply_at: null, updated_at: new Date() })
        .where(and(eq(thread.id, claimed.id), eq(thread.session_id, claimed.sessionId)))
        .pipe(Effect.orDie)
      return yield* read
    })

    const send = (input: Session.SendInput) =>
      runner.send(input).pipe(
        Effect.catchTag("BrainRejectedError", (error) =>
          Effect.fail(new Stopped({ reason: "unknown", message: error.message, sessionId: input.sessionId })),
        ),
        Effect.catchTag("BrainUnavailable", (error) =>
          Effect.gen(function* () {
            const session = yield* runner.get(input.sessionId).pipe(Effect.orDie)
            const state = yield* brainHost.access(session.brainId)
            if (state._tag === "Failed")
              return yield* new Stopped({
                reason: "brain_failed",
                message: `The brain failed: ${state.reason}`,
                sessionId: input.sessionId,
              })
            return yield* error
          }),
        ),
      )

    const routeTask = Effect.fn("Channels.routeTask")(function* (
      task: NonNullable<ChannelRoute.Route["task"]>,
      route: ChannelRoute.Route,
      event: Channel.Event,
      message: Message,
      newSessionId: Session.ID,
    ) {
      yield* Effect.annotateCurrentSpan("taskId", task.id)
      const handoff = (error: { readonly message: string }) =>
        new Stopped({ reason: "task_handoff", message: `Task ${task.id}: ${error.message}` })
      const sessionId = task.sessionId ?? newSessionId
      const initial = task.sessionId
        ? message
        : {
            ...message,
            prompt: {
              ...message.prompt,
              text: [
                message.prompt.text,
                `<task_context task_id=${JSON.stringify(task.id)} note="This message reached you through the task it is linked to, in a new session. Work it as that task: use task_get for the full record and its activity trail, and do not create another task for it.">`,
                `Task ${task.id}: ${task.title}`,
                task.description,
                "</task_context>",
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          }
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
          place_name: event.place.name ?? event.place.id,
          last_message: event.message,
          last_message_at: new Date(),
        })
        .onConflictDoUpdate({
          target: [thread.provider, thread.install, thread.thread],
          set: {
            session_id: sessionId,
            last_reply_at: sql`case when ${thread.session_id} = ${sessionId} then ${thread.last_reply_at} end`,
            place_name: event.place.name ?? event.place.id,
            last_message: event.message,
            last_message_at: new Date(),
            updated_at: new Date(),
          },
        })
        .pipe(Effect.orDie)
      const deliver = send({ ...initial, sessionId, delivery: "steer" })
      yield* (
        task.sessionId
          ? deliver
          : runner
              .create(
                { organizationId: route.organizationId, spaceId: route.spaceId, createdBy: route.senderUserId },
                { sessionId, harness: "opencode", interactive: false, initialMessage: initial },
                task.isGlobal ? {} : { agentId: task.agentId },
              )
              .pipe(
                Effect.catchTags({
                  "SessionRunner.AlreadyExists": () => deliver,
                  "SessionRunner.NotFound": (error) => Effect.fail(handoff(error)),
                  BrainRejectedError: (error) => Effect.fail(handoff(error)),
                }),
              )
      ).pipe(
        Effect.catchTag("Channels.Stopped", (error) =>
          Effect.fail(error.reason === "unknown" ? handoff(error) : error),
        ),
      )
      if (task.sessionId) return
      yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const inserted = yield* transaction
            .insert(Database.Schema.task_session)
            .values({ task_id: task.id, session_id: sessionId, agent_id: task.agentId })
            .onConflictDoNothing()
            .returning({ id: Database.Schema.task_session.session_id })
          if (inserted.length === 0) return
          yield* TaskTrail.record(
            transaction,
            { id: task.id, organizationId: route.organizationId },
            { userId: route.senderUserId, organizationId: route.organizationId, roles: [] },
            [{ _tag: "started", agentId: task.agentId, sessionId, mode: "new" }],
          )
        }),
      )
    })

    const signal = (provider: Channel.Provider, received: Channel.Signal) =>
      Effect.gen(function* () {
        const installed = (yield* database.db
          .select({ organizationId: install.organization_id })
          .from(install)
          .where(and(eq(install.provider, provider), eq(install.workspace, received.install)))).at(0)
        if (!installed) return yield* Effect.logWarning(`A ${provider} signal names no install: ${received.install}`)
        const done = yield* tasks.completeMerged(installed.organizationId, received.link, received.url)
        yield* Effect.logInfo(`${received.url} merged; ${done.length} tasks are done`)
      }).pipe(
        Effect.as({ status: 200 } satisfies Reply),
        Effect.catchCause((cause) =>
          Effect.logError(`A ${provider} signal could not be handled`, cause).pipe(
            Effect.as({ status: 500 } satisfies Reply),
          ),
        ),
      )

    const targetOf = (event: Channel.Event): ChannelProvider.Target => ({
      install: event.install,
      place: event.place.name ?? event.place.id,
      thread: event.thread.id,
      message: event.message,
    })

    const failed = (event: Channel.Event, reason: Channel.FailureReason, sessionId?: Session.ID) =>
      Effect.all(
        [
          Option.match(registry.get(event.provider), {
            onNone: () => Effect.void,
            onSome: (provider) =>
              provider
                .progress(targetOf(event), "failed")
                .pipe(Effect.catchCause((cause) => Effect.logWarning("A channel progress could not be sent", cause))),
          }),
          notices.notice({
            provider: event.provider,
            target: targetOf(event),
            reason,
            ...(sessionId && { sessionId }),
          }),
        ],
        { discard: true },
      )

    const routeThread = Effect.fnUntraced(function* (
      route: ChannelRoute.Route,
      event: Channel.Event,
      message: Message,
      sessionId: Session.ID,
    ) {
      const claimed = yield* claim(route, event, sessionId)
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
      return yield* (
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
        Effect.catchTags({
          "SessionRunner.AlreadyExists": () => sendToThread,
          "SessionRunner.NotFound": Effect.die,
          BrainRejectedError: (error) =>
            Effect.fail(new Stopped({ reason: "unknown", message: error.message, sessionId: claimed.sessionId })),
        }),
      )
    })

    const run = Effect.fnUntraced(function* (payload: typeof EventRun.payloadSchema.Type) {
      const found = registry.get(payload.event.provider)
      if (Option.isNone(found))
        return yield* Effect.logError(`No channel provider ${payload.event.provider} runs this event`)
      const event = found.value.enrich ? yield* found.value.enrich(payload.event) : payload.event
      const route = yield* routes.resolve(event)
      yield* found.value
        .progress(targetOf(event), "received")
        .pipe(Effect.catchCause((cause) => Effect.logWarning("A channel progress could not be sent", cause)))
      const trigger = found.value.triggers.find((each) => each.id === event.trigger)
      const context = yield* found.value.context(event).pipe(
        Effect.tapError((error) => Effect.logWarning(`The ${event.provider} thread context could not be read`, error)),
        Effect.orElseSucceed(Option.none<string>),
      )
      const message = {
        messageId: payload.messageId,
        prompt: yield* prompt(found.value, Struct.evolve(event, { text: () => route.text })),
        sender: { userId: route.senderUserId },
        channel: {
          provider: event.provider,
          place: event.place.name ?? event.place.id,
          ...(event.thread.url && { threadUrl: event.thread.url }),
          sender: event.sender.name ?? event.sender.handle ?? event.sender.accountId,
          ...(event.sender.handle && { handle: event.sender.handle }),
          ...(Option.isSome(context) && { context: context.value }),
          ...(trigger && { trigger: trigger.title }),
        },
      }
      if (route.task) return yield* routeTask(route.task, route, event, message, payload.sessionId)
      yield* routeThread(route, event, message, payload.sessionId)
    })

    yield* DurableRunner.register(EventRun, (payload) =>
      DurableRunner.supervise(
        `channel:${payload.event.provider}:${payload.event.install}:${payload.event.eventId}`,
        run(payload).pipe(
          Effect.catchTags({
            "ChannelRoute.Refused": (error) =>
              payload.event.trigger
                ? Effect.logInfo(`A ${payload.event.trigger} trigger was refused: ${error.reason}`)
                : failed(payload.event, error.reason),
            "ChannelRoute.NotTriggered": (error) => Effect.logDebug(`A channel trigger is off: ${error.message}`),
            "ChannelRoute.Unroutable": (error) => Effect.logWarning(`A channel event has no route: ${error.message}`),
            "Channels.Stopped": (error) =>
              Effect.logWarning(`A channel message stopped: ${error.message}`).pipe(
                Effect.andThen(failed(payload.event, error.reason, error.sessionId)),
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
        if (value._tag === "Signal") return yield* signal(found.value.id, value.signal)
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
