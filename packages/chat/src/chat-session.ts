export * as ChatSession from "./chat-session.js"

import { ClientError, Ren } from "@ren/client/chat/effect"
import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import { Session } from "@ren/schema/session"
import type { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionEvent } from "@ren/schema/session/event"
import type { SessionInbox } from "@ren/schema/session/inbox"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import type { Shell } from "@ren/schema/shell"
import {
  Clock,
  Data,
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Option,
  Predicate,
  PubSub,
  Ref,
  Schedule,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { ChatState } from "./chat-state.js"
import { Connection } from "./connection.js"
import { Hydrate } from "./hydrate.js"
import { Outbox } from "./outbox.js"
import { QueueRewrite } from "./queue-rewrite.js"
import { Reads } from "./reads.js"
import { Reducer } from "./reducer.js"
import { WebSearch } from "./websearch.js"

export const messagePageLimit = 20
export const olderPageLimit = 200
export const settleMs = 150
export const headersTimeout = "60 seconds"
const respondedLimit = 1_000
const autoApproveRetries = 2
const refreshBefore = 60_000

const startingPollMs = 2_000

// oxlint-disable-next-line ren/no-comments -- Ren refuses a page of saved history over its size limit with 413 (E111); the runtime asks again for fewer messages.
export const savedPageSizes = [100, 50, 25, 5, 1]

const savedRetries = 3

const prepareEveryMs = 5 * 60_000

const httpErrorOf = (error: unknown) =>
  error instanceof ClientError && HttpClientError.isHttpClientError(error.cause)
    ? Option.some(error.cause)
    : Option.none()

const isUnauthorized = (error: unknown) =>
  Option.exists(httpErrorOf(error), (cause) => "response" in cause.reason && cause.reason.response.status === 401)

// oxlint-disable-next-line ren/no-comments -- The brain did not answer, or refused a token of an old generation: the message stays pending and is sent again with the same id after new access; the brain skips an id it has (E126).
const isUnreachable = (error: unknown) =>
  isUnauthorized(error) || Option.exists(httpErrorOf(error), (cause) => cause.reason._tag === "TransportError")

// oxlint-disable-next-line ren/no-comments -- The answer to a question whose turn stopped, as a message that quotes each question (E129).
export const quote = (form: Form.Info, answer: Form.Answer) =>
  [
    `An answer to an earlier question, "${form.title}":`,
    ...form.fields.map((field) => {
      const value = answer[field.key]
      const text = Array.isArray(value) ? value.join(", ") : String(value ?? "")
      const asked = [
        "title" in field && field.title ? field.title : field.key,
        ...("description" in field && field.description ? [field.description] : []),
      ]
      return [...asked.map((line) => `> ${line}`), text].join("\n")
    }),
  ].join("\n\n")

export class AccessFailed extends Data.TaggedError("ChatSession.AccessFailed")<{ readonly cause: unknown }> {}

export interface Options {
  readonly sessionID: Session.ID
  readonly access: (input: { readonly unreachable: boolean }) => Effect.Effect<Session.ClientAccess, unknown>
  readonly saved?: (query: { readonly limit: number }) => Effect.Effect<SessionMessage.Page, unknown>
  readonly outbox?: {
    readonly load: Effect.Effect<ReadonlyArray<Outbox.Kept>>
    readonly keep: (items: ReadonlyArray<Outbox.Kept>) => Effect.Effect<void>
  }
  readonly initialMessageLimit?: number
  readonly sender?: SessionMessage.Sender
  readonly handoff?: Handoff
  readonly autoApprove?: boolean
  readonly connection?: Partial<Pick<Connection.Options, "connectTimeout" | "idleTimeout" | "reconnectDelay">>
  readonly onError?: (error: unknown) => Effect.Effect<void>
}

export interface Handoff {
  readonly id: SessionMessage.ID
  readonly text: string
}

type Client = Effect.Success<ReturnType<typeof Ren.make>>

export interface Mentions {
  readonly agents?: ReadonlyArray<SessionMessage.AgentAttachment>
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly mention?: SessionMessage.Mention }>
}

export interface PromptInput extends Mentions {
  readonly text: string
  readonly delivery?: SessionInbox.Delivery
  readonly id?: SessionMessage.ID
  readonly model?: SessionModel.Ref
  readonly resume?: boolean
}

export class QueueRefused extends Data.TaggedError("ChatSession.QueueRefused")<{
  readonly reason: QueueRewrite.Refusal | "reverted"
}> {}

export interface CommandInput extends Mentions {
  readonly name: string
  readonly text: string
  readonly delivery?: SessionInbox.Delivery
  readonly model?: SessionModel.Ref
}

export const leadingTurnPageDelay = "200 millis"
export const leadingTurnPageLimit = 3

export const enrichLeadingTurn = <E>(input: {
  readonly messages: Effect.Effect<ReadonlyArray<SessionMessage.Info>>
  readonly more: Effect.Effect<boolean>
  readonly loading: Effect.Effect<boolean>
  readonly loadMore: Effect.Effect<void, E>
  readonly pause: Effect.Effect<void>
  readonly maxPages: number
}) => {
  const needed = Effect.zipWith(input.messages, input.more, (messages, more) => {
    const assistant = messages.findIndex((message) => message.type === "assistant")
    const boundary = messages.findIndex((message) => message.type === "user" || message.type === "shell")
    return more && assistant !== -1 && (boundary === -1 || assistant < boundary)
  })
  const load = (pages: number): Effect.Effect<void, E> =>
    Effect.gen(function* () {
      if (pages >= input.maxPages || !(yield* needed)) return
      yield* input.pause
      if (!(yield* needed)) return
      if (yield* input.loading) return yield* load(pages)
      yield* input.loadMore
      return yield* load(pages + 1)
    })
  return load(0)
}

export const make = Effect.fnUntraced(function* (options: Options) {
  const scope = yield* Effect.scope
  const http = yield* HttpClient.HttpClient
  const root = options.sessionID
  const handoff = options.handoff
  const state = yield* SubscriptionRef.make(
    handoff
      ? Outbox.admit(
          ChatState.empty,
          {
            sessionID: root,
            id: handoff.id,
            text: handoff.text,
            delivery: "steer",
            ...(options.sender && { sender: options.sender }),
          },
          yield* DateTime.now,
        )
      : ChatState.empty,
  )
  const status = yield* SubscriptionRef.make<Connection.Status>("connecting")
  const events = yield* PubSub.unbounded<SessionEvent.Event>()
  const reads = yield* Reads.make<unknown>()
  const accessLock = yield* Semaphore.make(1)
  const wanted = new Map<string, Reducer.Read>()
  const settling = new Map<string, Fiber.Fiber<void>>()
  const histories = new Map<string, Deferred.Deferred<void, unknown>>()
  const sends = { tail: Deferred.makeUnsafe<void>() }
  Deferred.doneUnsafe(sends.tail, Effect.void)
  const cached: { current: Option.Option<{ readonly access: Session.ReadyAccess; readonly client: Client }> } = {
    current: Option.none(),
  }
  // oxlint-disable-next-line ren/no-comments -- A request to the brain's URL that got no answer: the next access asks Ren to check the sandbox (E123).
  const reach = { unreachable: false }

  const report = options.onError ?? ((error: unknown) => Effect.logWarning("A chat read failed", error))

  const update = (f: (current: ChatState.State) => ChatState.State) => SubscriptionRef.update(state, f)

  const kept = yield* Ref.make(options.outbox ? yield* options.outbox.load : [])
  const keep = (f: (items: ReadonlyArray<Outbox.Kept>) => ReadonlyArray<Outbox.Kept>) =>
    options.outbox ? Ref.updateAndGet(kept, f).pipe(Effect.flatMap(options.outbox.keep)) : Effect.void
  const unkeep = (id: SessionMessage.ID) => keep((items) => items.filter((item) => item.id !== id))

  const savedPage = (sizes: ReadonlyArray<number>): Effect.Effect<SessionMessage.Page, unknown> => {
    const size = sizes.at(0)
    if (!options.saved || !size) return Effect.fail(new Error("Ren has no saved page small enough"))
    return options.saved({ limit: size }).pipe(
      Effect.retry({
        while: (error) => Predicate.isTagged(error, "UnavailableError"),
        times: savedRetries,
        schedule: Schedule.spaced(startingPollMs),
      }),
      Effect.catchIf(
        (error) => Predicate.isTagged(error, "TooLargeError"),
        () => savedPage(sizes.slice(1)),
      ),
    )
  }

  // oxlint-disable-next-line ren/no-comments -- While the brain starts, the chat shows the history Ren saved; the brain's read replaces it at ready, so each message shows once (E108).
  const shown = { saved: false }
  const showSaved = Effect.suspend(() => {
    if (!options.saved || shown.saved) return Effect.void
    shown.saved = true
    return savedPage(savedPageSizes).pipe(
      Effect.flatMap((page) =>
        update((current) =>
          current.messages[root] ? current : Hydrate.messages(current, root, { items: page.items, cursor: {} }),
        ),
      ),
      Effect.catch(report),
      Effect.forkIn(scope),
      Effect.asVoid,
    )
  })

  const client = accessLock.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (
        Option.isSome(cached.current) &&
        DateTime.toEpochMillis(cached.current.value.access.expiresAt) - now > refreshBefore
      )
        return cached.current.value.client
      const unreachable = reach.unreachable
      reach.unreachable = false
      const access = yield* options.access({ unreachable }).pipe(
        Effect.mapError((cause) => new AccessFailed({ cause })),
        Effect.flatMap((answer) => {
          if (answer.status === "ready") return Effect.succeed(Option.some(answer))
          if (answer.status === "failed")
            return showSaved.pipe(Effect.andThen(Effect.fail(new AccessFailed({ cause: new Error(answer.reason) }))))
          return showSaved.pipe(
            Effect.andThen(Effect.sleep(startingPollMs)),
            Effect.as(Option.none<Session.ReadyAccess>()),
          )
        }),
        Effect.repeat({ until: Option.isSome }),
        Effect.flatMap((answer) =>
          Option.match(answer, {
            onNone: () => Effect.fail(new AccessFailed({ cause: new Error("The brain did not start") })),
            onSome: Effect.succeed,
          }),
        ),
      )
      const authorized = HttpClient.mapRequest(http, HttpClientRequest.basicAuth("ren", access.token)).pipe(
        HttpClient.transform((response, request) =>
          response.pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (error.reason._tag !== "TransportError") return
                reach.unreachable = true
                cached.current = Option.none()
              }),
            ),
            Effect.provideService(HttpClient.TracerPropagationEnabled, false),
            Effect.timeoutOrElse({
              duration: headersTimeout,
              orElse: () =>
                Effect.fail(
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.TransportError({
                      request,
                      description: "Timed out waiting for the session to respond",
                    }),
                  }),
                ),
            }),
          ),
        ),
      )
      const made = yield* Ren.make({ baseUrl: access.url }).pipe(
        Effect.provideService(HttpClient.HttpClient, authorized),
      )
      cached.current = Option.some({ access, client: made })
      return made
    }),
  )

  const send = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.suspend(() => {
      const previous = sends.tail
      const own = Deferred.makeUnsafe<void>()
      sends.tail = own
      return Deferred.await(previous).pipe(
        Effect.andThen(effect),
        Effect.onExit(() =>
          Deferred.await(previous).pipe(Effect.andThen(Deferred.succeed(own, undefined)), Effect.forkIn(scope)),
        ),
      )
    })

  const load = (read: Reducer.Read): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const api = yield* client
      switch (read._tag) {
        case "Status": {
          const connection = (yield* SubscriptionRef.get(state)).connection
          return yield* api.session.status().pipe(
            Effect.flatMap((family) => update((current) => Hydrate.status(current, family, connection))),
            Effect.tapError(() => update((current) => Hydrate.statusFailed(current, connection))),
          )
        }
        case "Info":
          return yield* api.session
            .get({ sessionID: read.sessionID })
            .pipe(Effect.flatMap((info) => update((current) => Hydrate.info(current, [info]))))
        case "Children":
          return yield* api.session.children({ sessionID: read.sessionID }).pipe(
            Effect.tap((sessions) =>
              Effect.forEach(
                sessions,
                (session) => Effect.sync(() => reads.complete(Reducer.key({ _tag: "Info", sessionID: session.id }))),
                { discard: true },
              ),
            ),
            Effect.flatMap((sessions) => update((current) => Hydrate.info(current, sessions))),
          )
        case "Messages":
          return yield* Reads.snapshot({
            state,
            select: (current) => current.messages[read.sessionID],
            load: (before) =>
              Effect.gen(function* () {
                const oldest = before?.at(0)?.id
                const complete = before && !(yield* SubscriptionRef.get(state)).cursor[read.sessionID]
                const fetch = (cursor?: string): Effect.Effect<SessionMessage.Page, unknown> =>
                  api.session
                    .messages({
                      sessionID: read.sessionID,
                      limit: cursor ? olderPageLimit : (options.initialMessageLimit ?? messagePageLimit),
                      ...(cursor && { cursor }),
                    })
                    .pipe(
                      Effect.flatMap((page) =>
                        oldest && page.cursor.next && (complete || !page.items.some((item) => item.id === oldest))
                          ? fetch(page.cursor.next).pipe(
                              Effect.map((older) => ({
                                items: [...page.items, ...older.items],
                                cursor: older.cursor,
                              })),
                            )
                          : Effect.succeed(page),
                      ),
                    )
                return yield* fetch()
              }),
            apply: (current, page) => Hydrate.messages(current, read.sessionID, page),
          })
        case "Message":
          return yield* api.session
            .message({ sessionID: read.sessionID, messageID: read.messageID })
            .pipe(Effect.flatMap((item) => update((current) => Hydrate.message(current, read.sessionID, item))))
        case "Pending":
          yield* update((current) => Hydrate.startPending(current, read.sessionID))
          return yield* api.session.inbox.list({ sessionID: read.sessionID }).pipe(
            Effect.flatMap((items) => update((current) => Hydrate.pending(current, read.sessionID, items))),
            Effect.tapError(() => update((current) => Hydrate.endPending(current, read.sessionID))),
          )
        case "Permissions":
          return yield* Reads.snapshot({
            state,
            select: (current) => current.permissions[read.sessionID],
            load: () => api.session.permission.list({ sessionID: read.sessionID }),
            apply: (current, items) => Hydrate.permissions(current, read.sessionID, items),
          })
        case "Forms":
          return yield* Reads.snapshot({
            state,
            select: (current) => current.forms[read.sessionID],
            load: () => api.session.form.list({ sessionID: read.sessionID }),
            apply: (current, items) => Hydrate.forms(current, read.sessionID, items),
          })
        case "Shells":
          return yield* api.shell
            .list({ sessionID: root })
            .pipe(Effect.flatMap((shells) => update((current) => Hydrate.shells(current, shells))))
      }
    })

  const quietly = (effect: Effect.Effect<void, unknown>) =>
    effect.pipe(
      Effect.catch((error) =>
        Effect.flatMap(SubscriptionRef.get(status), (current) =>
          current === "connected" ? report(error) : Effect.void,
        ),
      ),
    )

  const refresh = (read: Reducer.Read) =>
    Effect.gen(function* () {
      if ((yield* SubscriptionRef.get(status)) !== "connected") return
      yield* reads.run(Reducer.key(read), load(read)).pipe(quietly, Effect.forkIn(scope))
    })

  const sync = (read: Reducer.Read) => {
    wanted.set(Reducer.key(read), read)
    return reads.run(Reducer.key(read), load(read))
  }

  const isLoaded = (current: ChatState.State, read: Reducer.Read) => {
    if (read._tag === "Info") return Boolean(current.info[read.sessionID])
    if (read._tag === "Messages") return Boolean(current.messages[read.sessionID])
    if (read._tag === "Shells") return Boolean(current.shells)
    return false
  }

  const execute = (command: Reducer.Command): Effect.Effect<void> =>
    Effect.gen(function* () {
      const key = Reducer.key(command.read)
      if (command._tag === "Complete") return reads.complete(key)
      if (command._tag === "Invalidate") {
        wanted.delete(key)
        return reads.invalidate(key)
      }
      if (command._tag === "Rename") {
        if ((yield* SubscriptionRef.get(status)) !== "connected") return
        return yield* reads
          .run(key, load(command.read))
          .pipe(
            Effect.andThen(update((current) => Hydrate.rename(current, command.read.sessionID, command.title))),
            quietly,
            Effect.forkIn(scope),
            Effect.asVoid,
          )
      }
      if (
        command._tag === "Revalidate" &&
        !reads.has(key) &&
        !isLoaded(yield* SubscriptionRef.get(state), command.read)
      )
        return
      if (command._tag === "Settle") {
        const previous = settling.get(key)
        if (previous) yield* Fiber.interrupt(previous)
        const fiber = yield* Effect.sleep(settleMs).pipe(
          Effect.andThen(Effect.sync(() => settling.delete(key))),
          Effect.andThen(execute({ _tag: "Refresh", read: command.read })),
          Effect.forkIn(scope),
        )
        settling.set(key, fiber)
        return
      }
      reads.invalidate(key)
      yield* refresh(command.read)
    })

  const reread = Effect.suspend(() => {
    reads.invalidate()
    return Effect.forEach([...wanted.values()], refresh, { discard: true })
  })

  const onFrames = (frames: ReadonlyArray<SessionEvent.Frame>) =>
    Effect.gen(function* () {
      const commands = yield* SubscriptionRef.modify(state, (current) => {
        const result = frames.reduce<Reducer.Result>(
          (accumulated, frame) => {
            if (frame.type === "server.heartbeat" || frame.type === "stream.ended") return accumulated
            const next =
              frame.type === "server.connected"
                ? Reducer.connected(accumulated.state)
                : Reducer.apply(accumulated.state, frame)
            return { state: next.state, commands: [...accumulated.commands, ...next.commands] }
          },
          { state: current, commands: [] },
        )
        return [result.commands, result.state]
      })
      if (frames.some((frame) => frame.type === "server.connected")) yield* reread
      yield* Effect.forEach(commands, execute, { discard: true })
      yield* PubSub.publishAll(
        events,
        frames.filter(
          (frame): frame is SessionEvent.Event =>
            frame.type !== "server.connected" && frame.type !== "server.heartbeat" && frame.type !== "stream.ended",
        ),
      )
    })

  const connection = yield* Connection.make({
    ...options.connection,
    subscribe: Effect.map(client, (api) => api.event.subscribe()),
    onFrames,
    onStatus: (next) =>
      Effect.gen(function* () {
        if (next !== "connected") reads.invalidate()
        // oxlint-disable-next-line ren/no-comments -- A parked brain may be asleep or gone: the next read or send asks Ren first, which wakes it (E128).
        if (next === "reconnecting" || next === "parked") cached.current = Option.none()
        yield* SubscriptionRef.set(status, next)
      }),
  })

  const open = (sessionID: Session.ID) =>
    Effect.all(
      [
        sync({ _tag: "Info", sessionID }),
        sync({ _tag: "Messages", sessionID }),
        sync({ _tag: "Pending", sessionID }),
        sync({ _tag: "Permissions", sessionID }),
        sync({ _tag: "Forms", sessionID }),
        ...(sessionID === root ? [sync({ _tag: "Children", sessionID }), sync({ _tag: "Shells" })] : []),
      ],
      { concurrency: "unbounded", discard: true },
    )

  const loadMore = (sessionID: Session.ID, all = false): Effect.Effect<void, unknown> =>
    Effect.suspend(() => {
      const active = histories.get(sessionID)
      if (active) return Deferred.await(active).pipe(Effect.andThen(all ? loadMore(sessionID, true) : Effect.void))
      const done = Deferred.makeUnsafe<void, unknown>()
      histories.set(sessionID, done)
      const fetch = (
        api: Client,
        next: string,
        fetched: ReadonlyArray<SessionMessage.Info>,
      ): Effect.Effect<{ readonly items: ReadonlyArray<SessionMessage.Info>; readonly next?: string }, unknown> =>
        api.session.messages({ sessionID, cursor: next, limit: all ? olderPageLimit : messagePageLimit }).pipe(
          Effect.flatMap((page) => {
            const items = [...fetched, ...page.items]
            if (all && page.cursor.next) return fetch(api, page.cursor.next, items)
            return Effect.succeed({ items, ...(page.cursor.next && { next: page.cursor.next }) })
          }),
        )
      return Effect.gen(function* () {
        const cursor = (yield* SubscriptionRef.get(state)).cursor[sessionID]
        if (!cursor) return
        yield* update((current) => Hydrate.loadingHistory(current, sessionID, { loading: true }))
        const api = yield* client
        const result = yield* fetch(api, cursor, [])
        yield* update((current) => Hydrate.older(current, sessionID, result.items, result.next))
      }).pipe(
        Effect.ensuring(update((current) => Hydrate.loadingHistory(current, sessionID, { loading: false }))),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (histories.get(sessionID) === done) histories.delete(sessionID)
          }).pipe(Effect.andThen(Deferred.done(done, exit))),
        ),
        Effect.forkIn(scope),
        Effect.andThen(Deferred.await(done)),
      )
    })

  const applySelection = Effect.fnUntraced(function* (
    model: SessionModel.Ref | undefined,
    delivery: SessionInbox.Delivery,
  ) {
    const api = yield* client
    const staged = ChatState.revertMessageID(yield* SubscriptionRef.get(state), root)
    if (staged) {
      yield* api.session.revert.commit({ sessionID: root })
      yield* update((current) => Reducer.commitRevert(current, root, staged))
    }
    if (model && delivery === "steer") yield* api.session.model.switch({ sessionID: root, model })
    return api
  })

  const prompt = Effect.fnUntraced(function* (input: PromptInput) {
    const id = input.id ?? SessionMessage.ID.create()
    const delivery = input.delivery ?? "steer"
    const now = yield* DateTime.now
    const fresh = Outbox.isFresh(yield* SubscriptionRef.get(state), root, id)
    yield* update((current) =>
      Outbox.admit(
        current,
        {
          sessionID: root,
          id,
          text: input.text,
          delivery,
          ...(options.sender && { sender: options.sender }),
          ...(input.agents && { agents: input.agents }),
        },
        now,
      ),
    )
    yield* keep((items) => [
      ...items.filter((item) => item.id !== id),
      {
        id,
        text: input.text,
        delivery,
        ...(input.agents && { agents: input.agents }),
        ...(input.skills && { skills: input.skills }),
      },
    ])
    yield* connection.wake
    yield* send(
      Effect.gen(function* () {
        const api = yield* applySelection(input.model, delivery)
        return yield* api.session.prompt({
          sessionID: root,
          id,
          text: input.text,
          delivery,
          ...(input.resume === false && { resume: false }),
          ...(input.agents && { agents: input.agents }),
          ...(input.skills && { skills: input.skills }),
        })
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (!isUnauthorized(error)) return
            reach.unreachable = true
            cached.current = Option.none()
          }),
        ),
        Effect.retry({ while: isUnreachable, schedule: Schedule.spaced(startingPollMs) }),
      ),
    ).pipe(
      Effect.tapError((error) =>
        error instanceof AccessFailed
          ? Effect.void
          : unkeep(id).pipe(
              Effect.andThen(fresh ? update((current) => Outbox.rollback(current, root, id)) : Effect.void),
            ),
      ),
    )
    yield* unkeep(id)
    const echoed = yield* SubscriptionRef.modify(state, (current) => [
      !current.outbox.has(id),
      Outbox.acknowledge(current, id),
    ])
    if (!echoed) yield* execute({ _tag: "Revalidate", read: { _tag: "Pending", sessionID: root } })
    return id
  })

  const command = Effect.fnUntraced(function* (input: CommandInput) {
    const delivery = input.delivery ?? "steer"
    yield* connection.wake
    yield* send(
      Effect.gen(function* () {
        const api = yield* applySelection(input.model, delivery)
        return yield* api.session.command({
          sessionID: root,
          name: input.name,
          text: input.text,
          delivery,
          ...(input.agents && { agents: input.agents }),
          ...(input.skills && { skills: input.skills }),
        })
      }),
    )
    yield* execute({ _tag: "Revalidate", read: { _tag: "Pending", sessionID: root } })
  })

  const cancelInput = (inboxID: SessionMessage.ID) =>
    connection.wake.pipe(
      Effect.andThen(send(Effect.flatMap(client, (api) => api.session.inbox.cancel({ sessionID: root, inboxID })))),
      Effect.andThen(
        update((current) =>
          ChatState.hasInput(current, root, inboxID)
            ? Reducer.retract(Outbox.acknowledge(current, inboxID), root, inboxID)
            : current,
        ),
      ),
      Effect.ensuring(execute({ _tag: "Revalidate", read: { _tag: "Pending", sessionID: root } })),
    )

  const redirect = (inboxID: SessionMessage.ID, delivery: SessionInbox.Delivery) =>
    connection.wake.pipe(
      Effect.andThen(
        send(Effect.flatMap(client, (api) => api.session.inbox.update({ sessionID: root, inboxID, delivery }))),
      ),
      Effect.andThen(update((current) => Reducer.updateDelivery(current, root, inboxID, delivery))),
      Effect.ensuring(execute({ _tag: "Revalidate", read: { _tag: "Pending", sessionID: root } })),
    )

  const reorderInput = (inboxIDs: ReadonlyArray<SessionMessage.ID>) =>
    Effect.gen(function* () {
      if (ChatState.revertMessageID(yield* SubscriptionRef.get(state), root))
        return yield* new QueueRefused({ reason: "reverted" })
      yield* connection.wake
      const cancelled = yield* send(
        Effect.gen(function* () {
          const api = yield* client
          const plan = QueueRewrite.plan(yield* api.session.inbox.list({ sessionID: root }), inboxIDs, options.sender)
          if (plan._tag === "Refused") return yield* new QueueRefused({ reason: plan.reason })
          if (plan._tag === "Unchanged") return []
          const admitted: Array<SessionMessage.ID> = []
          yield* Effect.forEach(
            plan.readmit,
            (item) =>
              Effect.suspend(() => {
                const id = SessionMessage.ID.create()
                admitted.push(id)
                return api.session.prompt({
                  sessionID: root,
                  id,
                  text: item.payload.text,
                  delivery: "queue",
                  resume: false,
                  ...(item.payload.agents && { agents: item.payload.agents }),
                  ...(item.payload.skills && {
                    skills: item.payload.skills.map((skill) => ({
                      id: skill.id,
                      ...(skill.mention && { mention: skill.mention }),
                    })),
                  }),
                })
              }),
            { discard: true },
          ).pipe(
            Effect.tapError(() =>
              Effect.forEach(
                admitted,
                (inboxID) => api.session.inbox.cancel({ sessionID: root, inboxID }).pipe(Effect.ignore),
                { discard: true },
              ),
            ),
          )
          yield* Effect.forEach(plan.cancel, (inboxID) => api.session.inbox.cancel({ sessionID: root, inboxID }), {
            discard: true,
          })
          return plan.cancel
        }),
      )
      yield* update((current) =>
        cancelled.reduce(
          (next, inboxID) =>
            ChatState.hasInput(next, root, inboxID)
              ? Reducer.retract(Outbox.acknowledge(next, inboxID), root, inboxID)
              : next,
          current,
        ),
      )
    }).pipe(Effect.ensuring(execute({ _tag: "Revalidate", read: { _tag: "Pending", sessionID: root } })))

  const compaction = (id: SessionMessage.ID, model: SessionModel.Ref | undefined) =>
    send(
      Effect.gen(function* () {
        const api = yield* client
        if (model) yield* api.session.model.switch({ sessionID: root, model })
        return yield* api.session.compact({ sessionID: root, id })
      }),
    ).pipe(
      Effect.tap((item) => update((current) => Outbox.compacted(current, root, id, item))),
      Effect.tapError(() => update((current) => Outbox.compactFailed(current, root, id))),
    )

  const compacting: {
    current?:
      | Deferred.Deferred<Effect.Success<ReturnType<typeof compaction>>, Effect.Error<ReturnType<typeof compaction>>>
      | undefined
  } = {}

  const compact = (model?: SessionModel.Ref) =>
    Effect.suspend(() => {
      const active = compacting.current
      if (active) return Deferred.await(active)
      const done = Deferred.makeUnsafe<
        Effect.Success<ReturnType<typeof compaction>>,
        Effect.Error<ReturnType<typeof compaction>>
      >()
      compacting.current = done
      const id = SessionMessage.ID.create()
      return Effect.gen(function* () {
        const now = yield* DateTime.now
        yield* update((current) => Outbox.propose(current, root, id, now))
        yield* connection.wake
        yield* compaction(id, model).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (compacting.current === done) compacting.current = undefined
            }).pipe(Effect.andThen(Deferred.done(done, exit))),
          ),
          Effect.forkIn(scope),
        )
        return yield* Deferred.await(done)
      })
    })

  const stage = (message: SessionMessage.User) =>
    connection.wake.pipe(
      Effect.andThen(
        send(
          Effect.gen(function* () {
            const api = yield* client
            if (ChatState.hasInput(yield* SubscriptionRef.get(state), root, message.id)) {
              yield* api.session.inbox.cancel({ sessionID: root, inboxID: message.id })
              return yield* update((current) =>
                Reducer.retract(Outbox.acknowledge(current, message.id), root, message.id),
              )
            }
            const boundary = yield* api.session.revert.stage({ sessionID: root, messageID: message.id })
            yield* update((current) => Hydrate.revert(current, root, boundary))
          }),
        ),
      ),
      Effect.as(Option.some(message)),
    )

  const revert = (messageID: SessionMessage.ID) =>
    Effect.flatMap(SubscriptionRef.get(state), (current) => {
      const message = ChatState.userMessages(current, root).find((item) => item.id === messageID)
      return message ? stage(message) : Effect.succeed(Option.none<SessionMessage.User>())
    })

  const undo = Effect.flatMap(SubscriptionRef.get(state), (current) => {
    const message = ChatState.visibleUserMessages(current, root).at(-1)
    return message ? stage(message) : Effect.succeed(Option.none<SessionMessage.User>())
  })

  const redo = Effect.gen(function* () {
    if (!ChatState.revertMessageID(yield* SubscriptionRef.get(state), root)) return
    yield* connection.wake
    yield* send(Effect.flatMap(client, (api) => api.session.revert.clear({ sessionID: root })))
    yield* update((current) => Hydrate.revert(current, root, undefined))
  })

  const rename = (title: string) =>
    Effect.gen(function* () {
      const trimmed = title.trim()
      if (!trimmed || (yield* SubscriptionRef.get(state)).info[root]?.title === trimmed) return
      yield* Effect.flatMap(client, (api) => api.session.rename({ sessionID: root, title: trimmed }))
      yield* update((current) => Hydrate.rename(current, root, trimmed))
    })

  const reveal = (sessionID: Session.ID, messageID: SessionMessage.ID): Effect.Effect<boolean, unknown> =>
    Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state)
      if (ChatState.messages(current, sessionID).some((item) => item.id === messageID)) return true
      if (!ChatState.more(current, sessionID)) return false
      yield* loadMore(sessionID)
      return yield* reveal(sessionID, messageID)
    })

  const enrich = (sessionID: Session.ID) => {
    const select = <A>(f: (current: ChatState.State) => A) => Effect.map(SubscriptionRef.get(state), f)
    return enrichLeadingTurn({
      messages: select((current) => ChatState.messages(current, sessionID)),
      more: select((current) => ChatState.more(current, sessionID)),
      loading: select((current) => ChatState.loadingHistory(current, sessionID)),
      loadMore: loadMore(sessionID),
      pause: Effect.sleep(leadingTurnPageDelay),
      maxPages: leadingTurnPageLimit,
    })
  }

  const removePermission = (sessionID: Session.ID, requestID: Permission.RequestID) =>
    update((current) =>
      Hydrate.permissions(
        current,
        sessionID,
        (current.permissions[sessionID] ?? []).filter((request) => request.id !== requestID),
      ),
    )

  const removeForm = (sessionID: Session.ID, formID: Form.ID) =>
    update((current) =>
      Hydrate.forms(
        current,
        sessionID,
        (current.forms[sessionID] ?? []).filter((form) => form.id !== formID),
      ),
    ).pipe(Effect.andThen(execute({ _tag: "Refresh", read: { _tag: "Forms", sessionID } })))

  const forgetExpired = (sessionID: Session.ID, formID: Form.ID) =>
    update((current) => ({
      ...current,
      expired: ChatState.set(
        current.expired,
        sessionID,
        ChatState.expiredForms(current, sessionID).filter((form) => form.id !== formID),
      ),
    }))

  const replyPermission = (
    sessionID: Session.ID,
    requestID: Permission.RequestID,
    reply: Permission.Reply,
    message?: string,
  ) =>
    Effect.flatMap(client, (api) =>
      api.session.permission.reply({
        sessionID,
        requestID,
        reply,
        ...(message?.trim() && { message: message.trim() }),
      }),
    ).pipe(
      Effect.catchTag("NotFoundError", () => Effect.void),
      Effect.andThen(removePermission(sessionID, requestID)),
    )

  const autoApprove = yield* SubscriptionRef.make(options.autoApprove ?? false)
  const responded = new Set<string>()

  const approve = (request: Permission.Request) => {
    const attempt = (retries: number): Effect.Effect<void, unknown> =>
      replyPermission(request.sessionID, request.id, "once").pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (retries >= autoApproveRetries) return yield* Effect.fail(error)
            yield* Effect.sleep(`${retries + 1} seconds`)
            if (!(yield* SubscriptionRef.get(autoApprove))) return
            return yield* attempt(retries + 1)
          }),
        ),
      )
    return attempt(0).pipe(
      Effect.catch((error) => Effect.sync(() => responded.delete(request.id)).pipe(Effect.andThen(report(error)))),
    )
  }

  yield* Stream.zipLatestWith(
    SubscriptionRef.changes(state),
    SubscriptionRef.changes(autoApprove),
    (current, enabled) => (enabled ? Object.values(current.permissions).flat() : []),
  ).pipe(
    Stream.runForEach((requests) =>
      Effect.forEach(
        requests.filter((request) => !responded.has(request.id)),
        (request) =>
          Effect.suspend(() => {
            responded.add(request.id)
            if (responded.size > respondedLimit) responded.delete(responded.values().next().value ?? request.id)
            return Effect.forkIn(approve(request), scope)
          }),
        { discard: true },
      ),
    ),
    Effect.forkIn(scope),
  )

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...settling.values()], (fiber) => Fiber.interrupt(fiber), { discard: true }),
  )

  // oxlint-disable-next-line ren/no-comments -- Typing in a parked chat asks Ren for access, which wakes its brain before the send; at most once per 5 minutes (E130).
  const prepared = { at: Number.NEGATIVE_INFINITY }
  const typing = Effect.gen(function* () {
    if ((yield* SubscriptionRef.get(status)) !== "parked") return
    const now = yield* Clock.currentTimeMillis
    if (now - prepared.at < prepareEveryMs) return
    prepared.at = now
    yield* client.pipe(Effect.ignore, Effect.forkIn(scope))
  })

  // oxlint-disable-next-line ren/no-comments -- Messages kept before a reload go again with their ids; the brain skips an id it already has (E118).
  yield* Effect.forEach(yield* Ref.get(kept), (item) => prompt(item).pipe(Effect.catch(report)), {
    discard: true,
  }).pipe(Effect.forkIn(scope))

  return {
    sessionID: root,
    state,
    status,
    open,
    enrich,
    loadMore,
    reveal,
    prompt,
    compact,
    revert,
    undo,
    redo,
    rename,
    command,
    cancelInput,
    steerInput: (inboxID: SessionMessage.ID) => redirect(inboxID, "steer"),
    queueInput: (inboxID: SessionMessage.ID) => redirect(inboxID, "queue"),
    reorderInput,
    wake: connection.wake,
    typing,
    resync: connection.resync,
    foreground: connection.foreground,
    models: Effect.flatMap(client, (api) => api.model.list()),
    agents: Effect.flatMap(client, (api) => api.agent.list({ sessionID: root })),
    skills: Effect.flatMap(client, (api) => api.skill.list({ sessionID: root })),
    commands: Effect.flatMap(client, (api) => api.command.list({ sessionID: root })),
    searchFiles: (query: string, type?: SessionCatalog.FileType) =>
      Effect.flatMap(client, (api) => api.file.search({ sessionID: root, query, ...(type && { type }) })),
    interrupt: Effect.flatMap(client, (api) => api.session.interrupt({ sessionID: root, resume: true })),
    stop: (sessionID: Session.ID) => Effect.flatMap(client, (api) => api.session.interrupt({ sessionID })),
    background: Effect.flatMap(client, (api) => api.session.background({ sessionID: root })),
    switchModel: (model: SessionModel.Ref) =>
      send(Effect.flatMap(client, (api) => api.session.model.switch({ sessionID: root, model }))),
    autoApprove,
    replyPermission,
    webSearchProviders: (sessionID: Session.ID) =>
      Effect.flatMap(client, (api) => api.websearch.providers({ sessionID })),
    replyWebSearch: (form: Form.Info, selection: string | false) =>
      connection.wake.pipe(
        Effect.andThen(
          WebSearch.reply({
            form,
            selection,
            events,
            lost: SubscriptionRef.changes(status).pipe(
              Stream.drop(1),
              Stream.filter((next) => next === "reconnecting" || next === "parked"),
              Stream.runHead,
              Effect.asVoid,
            ),
            reply: (target, answer) =>
              Effect.flatMap(client, (api) =>
                api.session.form.reply({ sessionID: Session.ID.make(target.sessionID), formID: target.id, answer }),
              ).pipe(Effect.andThen(removeForm(Session.ID.make(target.sessionID), target.id))),
          }),
        ),
      ),
    replyForm: (sessionID: Session.ID, formID: Form.ID, answer: Form.Answer) =>
      Effect.gen(function* () {
        const expired = ChatState.expiredForms(yield* SubscriptionRef.get(state), sessionID).find(
          (form) => form.id === formID,
        )
        if (!expired)
          return yield* Effect.flatMap(client, (api) => api.session.form.reply({ sessionID, formID, answer })).pipe(
            Effect.catchTags({ NotFoundError: () => Effect.void, ConflictError: () => Effect.void }),
            Effect.andThen(removeForm(sessionID, formID)),
          )
        yield* forgetExpired(sessionID, formID)
        yield* prompt({ text: quote(expired, answer) })
      }),
    cancelForm: (sessionID: Session.ID, formID: Form.ID) =>
      Effect.flatMap(client, (api) => api.session.form.cancel({ sessionID, formID })).pipe(
        Effect.catchTags({ NotFoundError: () => Effect.void, ConflictError: () => Effect.void }),
        Effect.andThen(removeForm(sessionID, formID)),
        Effect.andThen(forgetExpired(sessionID, formID)),
      ),
    shellOutput: (sessionID: Session.ID, shellID: Shell.ID, cursor: number) =>
      Effect.flatMap(client, (api) => api.shell.output({ sessionID, shellID, cursor })),
    stopShell: (sessionID: Session.ID, shellID: Shell.ID) =>
      Effect.flatMap(client, (api) => api.shell.remove({ sessionID, shellID })).pipe(
        Effect.andThen(update((current) => Hydrate.stopShell(current, shellID))),
      ),
  }
})

export type ChatSession = Effect.Success<ReturnType<typeof make>>
