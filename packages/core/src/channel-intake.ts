export * as ChannelIntake from "./channel-intake.js"

import { Database } from "@ren/db/database"
import { Channel } from "@ren/schema/channel"
import { Drive } from "@ren/schema/drive"
import { Session } from "@ren/schema/session"
import { FileName } from "@ren/util/file-name"
import { and, eq } from "drizzle-orm"
import { Effect, Option, Result, Schema } from "effect"
import { ChannelInstalls } from "./channel-installs.js"
import { ChannelNotice } from "./channel-notice.js"
import { ChannelProvider } from "./channel-provider.js"
import { ChannelRoute } from "./channel-route.js"
import { ChannelThreads } from "./channel-threads.js"
import { Drives } from "./drives.js"
import type { Intake } from "./intake.js"
import { SessionRunner } from "./session/runner.js"
import { SlackTaskActions } from "./slack-task-actions.js"
import { SlackTaskCard } from "./slack-task-card.js"
import { Task } from "./task.js"
import { TaskCard } from "./task-card.js"
import { TaskTrail } from "./task/trail.js"

export interface Route extends Intake.Route {
  readonly event: Channel.Event
  readonly text: string
  readonly task: ChannelRoute.Route["task"]
}

export type Skip = ChannelRoute.Refused | ChannelRoute.NotTriggered | ChannelRoute.Unroutable

const filesAtOnce = 4

const mimeType = /^[a-z]+\/[a-z0-9.+-]+$/iu

const base64 = Schema.encodeSync(Schema.Uint8ArrayFromBase64)

const targetOf = (event: Channel.Event): ChannelProvider.Target => ({
  install: event.install,
  place: event.place.name ?? event.place.id,
  thread: event.thread.id,
  message: event.message,
})

export const receiver = Effect.fnUntraced(function* (provider: ChannelProvider.Provider) {
  const database = yield* Database.Service
  const routes = yield* ChannelRoute.Service
  const installs = yield* ChannelInstalls.Service
  const tasks = yield* Task.Service
  const slackCards = yield* SlackTaskCard.Service
  const slackActions = yield* SlackTaskActions.Service
  const install = Database.Schema.channel_install

  const signal = (received: Channel.Signal) =>
    Effect.gen(function* () {
      const installed = (yield* database.db
        .select({ organizationId: install.organization_id, botUser: install.bot_user })
        .from(install)
        .where(and(eq(install.provider, provider.id), eq(install.workspace, received.install)))).at(0)
      if (!installed) return yield* Effect.logWarning(`A ${provider.id} signal names no install: ${received.install}`)
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
            provider: provider.id,
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
      Effect.as({ _tag: "Answer", status: 200 } satisfies Intake.Received<Channel.Event>),
      Effect.catchCause((cause) =>
        Effect.logError(`A ${provider.id} signal could not be handled`, cause).pipe(
          Effect.as({ _tag: "Answer", status: 500 } satisfies Intake.Received<Channel.Event>),
        ),
      ),
    )

  return {
    origin: provider.id,
    event: Channel.Event,
    receive: Effect.fn("ChannelIntake.receive")(function* (request: Intake.Request) {
      const verified = yield* Effect.result(provider.verify(request))
      if (Result.isFailure(verified)) {
        yield* Effect.logWarning(`A ${provider.id} delivery failed verification: ${verified.failure.message}`)
        return { _tag: "Answer", status: 401 } satisfies Intake.Received<Channel.Event>
      }
      const parsed = yield* Effect.result(provider.parse(request))
      if (Result.isFailure(parsed)) {
        yield* Effect.logWarning(`A ${provider.id} delivery did not parse: ${parsed.failure.message}`)
        return { _tag: "Answer", status: 400 } satisfies Intake.Received<Channel.Event>
      }
      const value = parsed.success
      if (value._tag === "Handshake")
        return { _tag: "Answer", status: 200, body: value.body } satisfies Intake.Received<Channel.Event>
      if (value._tag === "Uninstalled") {
        yield* installs.removeByWorkspace(provider.id, value.install)
        return { _tag: "Answer", status: 200 } satisfies Intake.Received<Channel.Event>
      }
      if (value._tag === "Ignore") {
        yield* Effect.logDebug(`A ${provider.id} delivery is ignored: ${value.reason}`)
        return { _tag: "Answer", status: 200 } satisfies Intake.Received<Channel.Event>
      }
      if (value._tag === "Signal") return yield* signal(value.signal)
      if (value.signal) {
        const signaled = yield* signal(value.signal)
        if (signaled.status !== 200) return signaled
      }
      return { _tag: "Start", status: 200, event: value.event } satisfies Intake.Received<Channel.Event>
    }),
    keyOf: (event: Channel.Event) => ({ originId: event.install, eventId: event.eventId, threadKey: event.thread.id }),
  } satisfies Intake.Receiver<Channel.Event>
})

export const worker = Effect.fnUntraced(function* (provider: ChannelProvider.Provider) {
  const database = yield* Database.Service
  const routes = yield* ChannelRoute.Service
  const notices = yield* ChannelNotice.Service
  const runner = yield* SessionRunner.Service
  const cards = yield* TaskCard.Service
  const drives = yield* Drives.Service

  const fetchFiles = Effect.fnUntraced(function* (
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

  const prompt = Effect.fnUntraced(function* (
    route: Route,
    fetched: Effect.Success<ReturnType<typeof fetchFiles>>,
    ids: Intake.Ids,
  ) {
    const text = (lines: ReadonlyArray<string>) => {
      const joined = [route.text, ...fetched.notes, ...lines].filter((line) => line.length > 0).join("\n")
      return joined.length > 0 ? joined : "(no text)"
    }
    const copies = fetched.files.reduce(
      (sum, file) => {
        const url = `data:${file.mime};base64,${base64(file.bytes)}`
        const bytes = Session.fileBytes(url)
        if (bytes > Session.inlineLimitOf(file.mime) || sum.bytes + bytes > Session.maxInlineBytes)
          sum.skipped.push(
            `(${file.name} is not attached; it is in the space’s drive. Inline files: ${Session.inlineLimits}, 20 MiB per message.)`,
          )
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
      spaceId: yield* runner.get(ids.sessionId).pipe(
        Effect.map((session) => session.spaceId),
        Effect.orElseSucceed(() => route.spaceId),
      ),
    }
    const folder = Drive.uploadsOf(ids.sessionId, ids.messageId)
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

  const failed = (event: Channel.Event, reason: Channel.FailureReason, sessionId?: Session.ID) =>
    Effect.all(
      [
        provider
          .progress(targetOf(event), "failed")
          .pipe(Effect.catchCause((cause) => Effect.logWarning("A channel progress could not be sent", cause))),
        notices.notice({ provider: event.provider, target: targetOf(event), reason, ...(sessionId && { sessionId }) }),
      ],
      { discard: true },
    )

  return {
    origin: provider.id,
    event: Channel.Event,
    delivery: "steer",
    resolve: Effect.fn("ChannelIntake.resolve")(function* (event: Channel.Event) {
      const enriched = provider.enrich ? yield* provider.enrich(event) : event
      const route = yield* routes.resolve(enriched)
      yield* provider
        .progress(targetOf(enriched), "received")
        .pipe(Effect.catchCause((cause) => Effect.logWarning("A channel progress could not be sent", cause)))
      const task = route.task
      if (task) yield* Effect.annotateCurrentSpan("taskId", task.id)
      return {
        organizationId: route.organizationId,
        spaceId: route.spaceId,
        senderUserId: route.senderUserId,
        ...(task ? !task.isGlobal && { agentId: task.agentId } : route.agentId && { agentId: route.agentId }),
        chat: task ? { _tag: "Assigned", ...(task.sessionId && { sessionId: task.sessionId }) } : { _tag: "Thread" },
        event: enriched,
        text: route.text,
        task,
      } satisfies Route
    }),
    promptOf: Effect.fn("ChannelIntake.promptOf")(function* (_event: Channel.Event, route: Route, ids: Intake.Ids) {
      const event = route.event
      const trigger = provider.triggers.find((each) => each.id === event.trigger)
      const context = yield* provider.context(event).pipe(
        Effect.tapError((error) => Effect.logWarning(`The ${event.provider} thread context could not be read`, error)),
        Effect.orElseSucceed(Option.none<ChannelProvider.ThreadContext>),
      )
      const built = yield* prompt(route, yield* fetchFiles(event, context), ids)
      const task = route.task
      const text =
        task && !task.sessionId
          ? [
              built.text,
              `<task_context task_id=${JSON.stringify(task.id)} note="This message reached you through the task it is linked to, in a new session. Work it as that task: use task_get for the full record and its activity trail, and do not create another task for it.">`,
              `Task ${task.id}: ${task.title}`,
              task.description,
              "</task_context>",
            ]
              .filter(Boolean)
              .join("\n\n")
          : built.text
      yield* ChannelThreads.remember(database, event)
      return {
        prompt: { ...built, text },
        channel: {
          provider: event.provider,
          place: event.place.name ?? event.place.id,
          ...(event.thread.url && { threadUrl: event.thread.url }),
          sender: event.sender.name ?? event.sender.handle ?? event.sender.accountId,
          ...(event.sender.handle && { handle: event.sender.handle }),
          ...(Option.isSome(context) && { context: context.value.text }),
          ...(trigger && { trigger: trigger.title }),
        },
      } satisfies Intake.Message
    }),
    report: Effect.fn("ChannelIntake.report")(function* (event: Channel.Event, outcome: Intake.Outcome<Route, Skip>) {
      if (outcome._tag === "skipped") {
        const reason = outcome.reason
        if (reason._tag === "ChannelRoute.Refused")
          return yield* event.trigger
            ? Effect.logInfo(`A ${event.trigger} trigger was refused: ${reason.reason}`)
            : failed(event, reason.reason)
        if (reason._tag === "ChannelRoute.NotTriggered")
          return yield* Effect.logDebug(`A channel trigger is off: ${reason.message}`)
        return yield* Effect.logWarning(`A channel event has no route: ${reason.message}`)
      }
      const task = outcome.route.task
      if (outcome._tag === "failed") {
        if (outcome.reason === "brain_failed") return yield* failed(event, "brain_failed", outcome.sessionId)
        return yield* task ? failed(event, "task_handoff") : failed(event, "unknown", outcome.sessionId)
      }
      if (!task || task.sessionId) return
      const sessionId = outcome.sessionId
      const organizationId = outcome.route.organizationId
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
            { id: task.id, organizationId },
            { userId: outcome.route.senderUserId, organizationId, roles: [] },
            [{ _tag: "started", agentId: task.agentId, sessionId, mode: "new" }],
          )
        }),
      )
      yield* cards.refresh(task.id)
    }),
  } satisfies Intake.Worker<Channel.Event, Route, Skip>
})
