export * as ChatSession from "./chat-session.js"

import { Ren } from "@ren/client/chat/effect"
import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import type { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session-event"
import type { SessionInbox } from "@ren/schema/session-inbox"
import { SessionMessage } from "@ren/schema/session-message"
import type { SessionModel } from "@ren/schema/session-model"
import { Clock, Data, DateTime, Deferred, Effect, Fiber, Option, Semaphore, Stream, SubscriptionRef } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { ChatState } from "./chat-state.js"
import { Connection } from "./connection.js"
import { Hydrate } from "./hydrate.js"
import { Outbox } from "./outbox.js"
import { Reads } from "./reads.js"
import { Reducer } from "./reducer.js"

export const messagePageLimit = 20
export const olderPageLimit = 200
export const settleMs = 150
export const headersTimeout = "60 seconds"
const respondedLimit = 1_000
const autoApproveRetries = 2
const refreshBefore = 60_000

export class AccessFailed extends Data.TaggedError("ChatSession.AccessFailed")<{ readonly cause: unknown }> {}

export interface Options {
  readonly sessionID: Session.ID
  readonly access: Effect.Effect<Session.ClientAccess, unknown>
  readonly initialMessageLimit?: number
  readonly sender?: SessionMessage.Sender
  readonly autoApprove?: boolean
  readonly connection?: Partial<Pick<Connection.Options, "connectTimeout" | "idleTimeout" | "reconnectDelay">>
  readonly onError?: (error: unknown) => Effect.Effect<void>
}

type Client = Effect.Success<ReturnType<typeof Ren.make>>

export interface PromptInput {
  readonly text: string
  readonly delivery?: SessionInbox.Delivery
  readonly id?: SessionMessage.ID
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
  const state = yield* SubscriptionRef.make(ChatState.empty)
  const status = yield* SubscriptionRef.make<Connection.Status>("connecting")
  const reads = yield* Reads.make<unknown>()
  const accessLock = yield* Semaphore.make(1)
  const wanted = new Map<string, Reducer.Read>()
  const settling = new Map<string, Fiber.Fiber<void>>()
  const histories = new Map<string, Deferred.Deferred<void, unknown>>()
  const sends = { tail: Deferred.makeUnsafe<void>() }
  Deferred.doneUnsafe(sends.tail, Effect.void)
  const cached: { current: Option.Option<{ readonly access: Session.ClientAccess; readonly client: Client }> } = {
    current: Option.none(),
  }

  const report = options.onError ?? ((error: unknown) => Effect.logWarning("A chat read failed", error))

  const update = (f: (current: ChatState.State) => ChatState.State) => SubscriptionRef.update(state, f)

  const client = accessLock.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (
        Option.isSome(cached.current) &&
        DateTime.toEpochMillis(cached.current.value.access.expiresAt) - now > refreshBefore
      )
        return cached.current.value.client
      const access = yield* options.access.pipe(Effect.mapError((cause) => new AccessFailed({ cause })))
      const authorized = HttpClient.mapRequest(http, HttpClientRequest.basicAuth("ren", access.token)).pipe(
        HttpClient.transform((response, request) =>
          response.pipe(
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
          return yield* api.session
            .messages({ sessionID: read.sessionID, limit: options.initialMessageLimit ?? messagePageLimit })
            .pipe(Effect.flatMap((page) => update((current) => Hydrate.messages(current, read.sessionID, page))))
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
          return yield* api.session.permission
            .list({ sessionID: read.sessionID })
            .pipe(Effect.flatMap((items) => update((current) => Hydrate.permissions(current, read.sessionID, items))))
        case "Forms":
          return yield* api.session.form
            .list({ sessionID: read.sessionID })
            .pipe(Effect.flatMap((items) => update((current) => Hydrate.forms(current, read.sessionID, items))))
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
    })

  const connection = yield* Connection.make({
    ...options.connection,
    subscribe: Effect.map(client, (api) => api.event.subscribe()),
    onFrames,
    onStatus: (next) =>
      Effect.gen(function* () {
        if (next !== "connected") reads.invalidate()
        if (next === "reconnecting") cached.current = Option.none()
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
        ...(sessionID === root ? [sync({ _tag: "Children", sessionID })] : []),
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
        yield* update((current) => Hydrate.loadingHistory(current, sessionID, true))
        const api = yield* client
        const result = yield* fetch(api, cursor, [])
        yield* update((current) => Hydrate.older(current, sessionID, result.items, result.next))
      }).pipe(
        Effect.ensuring(update((current) => Hydrate.loadingHistory(current, sessionID, false))),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (histories.get(sessionID) === done) histories.delete(sessionID)
          }).pipe(Effect.andThen(Deferred.done(done, exit))),
        ),
        Effect.forkIn(scope),
        Effect.andThen(Deferred.await(done)),
      )
    })

  const prompt = Effect.fnUntraced(function* (input: PromptInput) {
    const id = input.id ?? SessionMessage.ID.create()
    const delivery = input.delivery ?? "steer"
    const now = yield* DateTime.now
    const fresh = Outbox.isFresh(yield* SubscriptionRef.get(state), root, id)
    yield* update((current) =>
      Outbox.admit(
        current,
        { sessionID: root, id, text: input.text, delivery, ...(options.sender && { sender: options.sender }) },
        now,
      ),
    )
    yield* connection.wake
    yield* send(
      Effect.gen(function* () {
        const api = yield* client
        const staged = ChatState.revertMessageID(yield* SubscriptionRef.get(state), root)
        if (staged) {
          yield* api.session.revert.commit({ sessionID: root })
          yield* update((current) => Reducer.commitRevert(current, root, staged))
        }
        if (input.model && delivery === "steer")
          yield* api.session.model.switch({ sessionID: root, model: input.model })
        return yield* api.session.prompt({ sessionID: root, id, text: input.text, delivery })
      }),
    ).pipe(Effect.tapError(() => (fresh ? update((current) => Outbox.rollback(current, root, id)) : Effect.void)))
    const echoed = yield* SubscriptionRef.modify(state, (current) => [
      !current.outbox.has(id),
      Outbox.acknowledge(current, id),
    ])
    if (!echoed) yield* execute({ _tag: "Revalidate", read: { _tag: "Pending", sessionID: root } })
    return id
  })

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

  const compacting = new Map<
    string,
    Deferred.Deferred<Effect.Success<ReturnType<typeof compaction>>, Effect.Error<ReturnType<typeof compaction>>>
  >()

  const compact = (model?: SessionModel.Ref) =>
    Effect.suspend(() => {
      const active = compacting.get(root)
      if (active) return Deferred.await(active)
      const done = Deferred.makeUnsafe<
        Effect.Success<ReturnType<typeof compaction>>,
        Effect.Error<ReturnType<typeof compaction>>
      >()
      compacting.set(root, done)
      const id = SessionMessage.ID.create()
      return Effect.gen(function* () {
        const now = yield* DateTime.now
        yield* update((current) => Outbox.propose(current, root, id, now))
        yield* connection.wake
        yield* compaction(id, model).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (compacting.get(root) === done) compacting.delete(root)
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

  const replyPermission = (sessionID: Session.ID, requestID: Permission.RequestID, reply: Permission.Reply) =>
    Effect.flatMap(client, (api) => api.session.permission.reply({ sessionID, requestID, reply })).pipe(
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
    wake: connection.wake,
    resync: connection.resync,
    foreground: connection.foreground,
    models: Effect.flatMap(client, (api) => api.model.list()),
    interrupt: Effect.flatMap(client, (api) => api.session.interrupt({ sessionID: root, resume: true })),
    stop: (sessionID: Session.ID) => Effect.flatMap(client, (api) => api.session.interrupt({ sessionID })),
    background: Effect.flatMap(client, (api) => api.session.background({ sessionID: root })),
    switchModel: (model: SessionModel.Ref) =>
      send(Effect.flatMap(client, (api) => api.session.model.switch({ sessionID: root, model }))),
    autoApprove,
    replyPermission,
    replyForm: (sessionID: Session.ID, formID: Form.ID, answer: Form.Answer) =>
      Effect.flatMap(client, (api) => api.session.form.reply({ sessionID, formID, answer })).pipe(
        Effect.catchTags({ NotFoundError: () => Effect.void, ConflictError: () => Effect.void }),
        Effect.andThen(removeForm(sessionID, formID)),
      ),
    cancelForm: (sessionID: Session.ID, formID: Form.ID) =>
      Effect.flatMap(client, (api) => api.session.form.cancel({ sessionID, formID })).pipe(
        Effect.catchTags({ NotFoundError: () => Effect.void, ConflictError: () => Effect.void }),
        Effect.andThen(removeForm(sessionID, formID)),
      ),
  }
})

export type ChatSession = Effect.Success<ReturnType<typeof make>>
