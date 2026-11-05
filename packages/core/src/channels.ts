export * as Channels from "./channels.js"

import { Observability } from "@ren/schema/observability"
import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import { Channel } from "@ren/schema/channel"
import { Drive } from "@ren/schema/drive"
import { Session } from "@ren/schema/session"
import { FileName } from "@ren/util/file-name"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { BrainHost } from "./brain-host.js"
import { ChannelInstalls } from "./channel-installs.js"
import { ChannelNotice } from "./channel-notice.js"
import { ChannelProvider } from "./channel-provider.js"
import { ChannelRoute } from "./channel-route.js"
import { Drives } from "./drives.js"
import { DurableRunner } from "./durable-runner.js"
import { SessionRunner } from "./session/runner.js"
import { SlackTaskActions } from "./slack-task-actions.js"
import { SlackTaskCard } from "./slack-task-card.js"
import { Task } from "./task.js"
import { TaskCard } from "./task-card.js"
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

type MessageFor = (sessionId: Session.ID) => Effect.Effect<Message>

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
    const cards = yield* TaskCard.Service
    const slackCards = yield* SlackTaskCard.Service
    const slackActions = yield* SlackTaskActions.Service
    const drives = yield* Drives.Service
    const thread = Database.Schema.channel_thread
    const install = Database.Schema.channel_install

    const fetchFiles = Effect.fnUntraced(function* (
      provider: ChannelProvider.Provider,
      event: Channel.Event,
      context: Option.Option<ChannelProvider.ThreadContext>,
    ) {
      const own = new Set(event.files.map((file) => file.url))
      const earlier = Option.match(context, {
        onNone: () => [],
        onSome: (found) => found.files.filter((file) => !own.has(file.url)),
      })
      const fetched = yield* Effect.forEach(
        [...event.files, ...earlier],
        (file) =>
          provider.fetchFile(event.install, file).pipe(
            Effect.tapError((error) => Effect.logWarning(`Channel file ${file.name} could not be read`, error)),
            Effect.option,
            Effect.map((bytes) => ({ file, bytes })),
          ),
        { concurrency: filesAtOnce },
      )
      const taken = new Set<string>()
      return {
        notes: fetched.flatMap((each) => (Option.isNone(each.bytes) ? [`(${each.file.name} could not be read.)`] : [])),
        files: fetched.flatMap((each) => {
          if (Option.isNone(each.bytes)) return []
          const name = FileName.free(each.file.name, taken)
          taken.add(name)
          return [
            {
              name,
              mime: mimeType.test(each.file.mime) ? each.file.mime : "application/octet-stream",
              bytes: each.bytes.value,
            },
          ]
        }),
      }
    })

    type Fetched = Effect.Success<ReturnType<typeof fetchFiles>>

    const prompt = Effect.fnUntraced(function* (
      route: ChannelRoute.Route,
      fetched: Fetched,
      sessionId: Session.ID,
      messageId: Session.MessageID,
    ) {
      const text = (lines: ReadonlyArray<string>) => {
        const joined = [route.text, ...fetched.notes, ...lines].filter((line) => line.length > 0).join("\n")
        return joined.length > 0 ? joined : "(no text)"
      }
      const copies = fetched.files.reduce(
        (sum, file) => {
          const url = `data:${file.mime};base64,${base64(file.bytes)}`
          const bytes = Session.fileBytes(url)
          if (sum.bytes + bytes > Session.maxFileBytes)
            sum.skipped.push(`(${file.name} is not attached: a message’s files total at most 10 MB.)`)
          else {
            sum.bytes += bytes
            sum.files.push({ url, name: file.name })
          }
          return sum
        },
        { bytes: 0, files: new Array<Session.InlineFile>(), skipped: new Array<string>() },
      )
      if (fetched.files.length === 0) return { text: text([]) } satisfies Session.Prompt
      const owner = {
        organizationId: route.organizationId,
        spaceId: yield* runner.get(sessionId).pipe(
          Effect.map((session) => session.spaceId),
          Effect.orElseSucceed(() => route.spaceId),
        ),
      }
      const folder = Drive.uploadsOf(sessionId, messageId)
      const placed = yield* Effect.forEach(
        fetched.files,
        (file) => drives.put(owner, `${folder}/${file.name}`, file.bytes, file.mime),
        { concurrency: filesAtOnce, discard: true },
      ).pipe(
        Effect.as(true),
        Effect.catchTag("Drives.Unavailable", (error) =>
          Effect.logWarning("Channel files could not be put in the space’s drive", error).pipe(Effect.as(false)),
        ),
      )
      if (!placed)
        return {
          text: text(copies.skipped),
          ...(copies.files.length > 0 && { files: copies.files }),
        } satisfies Session.Prompt
      return {
        text: text([]),
        files: fetched.files.map((file) => ({ path: `${folder}/${file.name}`, name: file.name })),
        ...(copies.files.length > 0 && { fallback: copies.files }),
      } satisfies Session.Prompt
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
      messageFor: MessageFor,
      newSessionId: Session.ID,
    ) {
      yield* Effect.annotateCurrentSpan("taskId", task.id)
      const handoff = (error: { readonly message: string }) =>
        new Stopped({ reason: "task_handoff", message: `Task ${task.id}: ${error.message}` })
      const sessionId = task.sessionId ?? newSessionId
      const message = yield* messageFor(sessionId)
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
                {
                  organizationId: route.organizationId,
                  spaceId: route.spaceId,
                  createdBy: route.senderUserId,
                  origin: event.provider,
                },
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
      yield* cards.refresh(task.id)
    })

    const signal = (provider: Channel.Provider, received: Channel.Signal) =>
      Effect.gen(function* () {
        const installed = (yield* database.db
          .select({ organizationId: install.organization_id, botUser: install.bot_user })
          .from(install)
          .where(and(eq(install.provider, provider), eq(install.workspace, received.install)))).at(0)
        if (!installed) return yield* Effect.logWarning(`A ${provider} signal names no install: ${received.install}`)
        if (received.kind === "links_shared") return yield* slackCards.unfurl(installed.organizationId, received)
        if (received.kind === "details_requested") return yield* slackCards.present(installed.organizationId, received)
        if (received.kind === "card_action") return yield* slackActions.act(installed.organizationId, received)
        if (received.kind === "pull_request_merged") {
          const done = yield* tasks.completeMerged(installed.organizationId, received.link, received.url)
          return yield* Effect.logInfo(`${received.url} merged; ${done.length} tasks are done`)
        }
        // oxlint-disable-next-line ren/no-comments -- Ren's own bot opens the factory's pull requests for the organization's agents, so it may name any task of the organization. A person must be able to update each task.
        const isRen = Boolean(installed.botUser) && received.sender.accountId === installed.botUser
        const person = isRen
          ? Option.none()
          : yield* routes.actorOf(installed.organizationId, {
              provider,
              install: received.install,
              sender: received.sender,
            })
        if (!isRen && Option.isNone(person))
          return yield* Effect.logInfo(`${received.url} is from a sender with no Ren account; no task is linked`)
        const linked = yield* tasks.linkMentioned(
          installed.organizationId,
          Option.getOrNull(person),
          received.url,
          received.text,
        )
        if (linked.length > 0) yield* Effect.logInfo(`${received.url} names ${linked.length} tasks; linked`)
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
      messageFor: MessageFor,
      sessionId: Session.ID,
    ) {
      const claimed = yield* claim(route, event, sessionId)
      const message = yield* messageFor(claimed.sessionId)
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
          {
            organizationId: route.organizationId,
            spaceId: route.spaceId,
            createdBy: route.senderUserId,
            origin: event.provider,
          },
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
        Effect.orElseSucceed(Option.none<ChannelProvider.ThreadContext>),
      )
      const fetched = yield* fetchFiles(found.value, event, context)
      const base = {
        messageId: payload.messageId,
        sender: { userId: route.senderUserId },
        channel: {
          provider: event.provider,
          place: event.place.name ?? event.place.id,
          ...(event.thread.url && { threadUrl: event.thread.url }),
          sender: event.sender.name ?? event.sender.handle ?? event.sender.accountId,
          ...(event.sender.handle && { handle: event.sender.handle }),
          ...(Option.isSome(context) && { context: context.value.text }),
          ...(trigger && { trigger: trigger.title }),
        },
      }
      const messageFor = (sessionId: Session.ID) =>
        Effect.map(prompt(route, fetched, sessionId, payload.messageId), (built) => ({ ...base, prompt: built }))
      if (route.task) return yield* routeTask(route.task, route, event, messageFor, payload.sessionId)
      yield* routeThread(route, event, messageFor, payload.sessionId)
    })

    yield* DurableRunner.register(EventRun, (payload) =>
      DurableRunner.supervise(
        `channel:${payload.event.provider}:${payload.event.install}:${payload.event.eventId}`,
        run(payload).pipe(
          Observability.Trace.channelEvent,
          Effect.annotateSpans("ren.session.id", payload.sessionId),
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
        if (value.signal) {
          const signaled = yield* signal(found.value.id, value.signal)
          if (signaled.status !== 200) return signaled
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
