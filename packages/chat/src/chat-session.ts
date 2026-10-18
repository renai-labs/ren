export * as ChatSession from "./chat-session.js"

import { Ren } from "@ren/client/chat/effect"
import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import type { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session-event"
import type { SessionInbox } from "@ren/schema/session-inbox"
import { SessionMessage } from "@ren/schema/session-message"
import type { SessionModel } from "@ren/schema/session-model"
import { Clock, Data, DateTime, Effect, Fiber, Option, Semaphore, SubscriptionRef } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ChatState } from "./chat-state.js"
import { Connection } from "./connection.js"
import { Hydrate } from "./hydrate.js"
import { Outbox } from "./outbox.js"
import { Reads } from "./reads.js"
import { Reducer } from "./reducer.js"

export const messagePageLimit = 20
export const olderPageLimit = 200
export const settleMs = 150
const refreshBefore = 60_000

export class AccessFailed extends Data.TaggedError("ChatSession.AccessFailed")<{ readonly cause: unknown }> {}

export interface Options {
  readonly sessionID: Session.ID
  readonly access: Effect.Effect<Session.ClientAccess, unknown>
  readonly initialMessageLimit?: number
  readonly sender?: SessionMessage.Sender
  readonly connection?: Partial<Pick<Connection.Options, "connectTimeout" | "idleTimeout" | "reconnectDelay">>
  readonly onError?: (error: unknown) => Effect.Effect<void>
}

type Client = Effect.Success<ReturnType<typeof Ren.make>>

export interface PromptInput {
  readonly text: string
  readonly delivery?: SessionInbox.Delivery
  readonly id?: SessionMessage.ID
}

export const make = Effect.fnUntraced(function* (options: Options) {
  const scope = yield* Effect.scope
  const http = yield* HttpClient.HttpClient
  const root = options.sessionID
  const state = yield* SubscriptionRef.make(ChatState.empty)
  const status = yield* SubscriptionRef.make<Connection.Status>("connecting")
  const reads = yield* Reads.make<unknown>()
  const sending = yield* Semaphore.make(1)
  const accessLock = yield* Semaphore.make(1)
  const wanted = new Map<string, Reducer.Read>()
  const settling = new Map<string, Fiber.Fiber<void>>()
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
      const authorized = HttpClient.mapRequest(http, HttpClientRequest.basicAuth("ren", access.token))
      const made = yield* Ren.make({ baseUrl: access.url }).pipe(
        Effect.provideService(HttpClient.HttpClient, authorized),
      )
      cached.current = Option.some({ access, client: made })
      return made
    }),
  )

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

  const refresh = (read: Reducer.Read) =>
    Effect.gen(function* () {
      if ((yield* SubscriptionRef.get(status)) !== "connected") return
      yield* reads.run(Reducer.key(read), load(read)).pipe(Effect.catch(report), Effect.forkIn(scope))
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
      ],
      { concurrency: "unbounded", discard: true },
    )

  const children = Effect.gen(function* () {
    const api = yield* client
    const sessions = yield* api.session.children({ sessionID: root })
    yield* update((current) => Hydrate.info(current, sessions))
  })

  const loadMore = Effect.fnUntraced(function* (sessionID: Session.ID, all = false) {
    const api = yield* client
    const cursor = (yield* SubscriptionRef.get(state)).cursor[sessionID]
    if (!cursor) return
    const fetch = (
      next: string,
      fetched: ReadonlyArray<SessionMessage.Info>,
    ): Effect.Effect<{ readonly items: ReadonlyArray<SessionMessage.Info>; readonly next?: string }, unknown> =>
      api.session.messages({ sessionID, cursor: next, limit: all ? olderPageLimit : messagePageLimit }).pipe(
        Effect.flatMap((page) => {
          const items = [...fetched, ...page.items]
          if (all && page.cursor.next) return fetch(page.cursor.next, items)
          return Effect.succeed({ items, ...(page.cursor.next && { next: page.cursor.next }) })
        }),
      )
    const result = yield* fetch(cursor, [])
    yield* update((current) => Hydrate.older(current, sessionID, result.items, result.next))
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
    yield* sending
      .withPermits(1)(
        Effect.flatMap(client, (api) => api.session.prompt({ sessionID: root, id, text: input.text, delivery })),
      )
      .pipe(Effect.tapError(() => (fresh ? update((current) => Outbox.rollback(current, root, id)) : Effect.void)))
    const echoed = yield* SubscriptionRef.modify(state, (current) => [
      !current.outbox.has(id),
      Outbox.acknowledge(current, id),
    ])
    if (!echoed) yield* execute({ _tag: "Revalidate", read: { _tag: "Pending", sessionID: root } })
    return id
  })

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

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...settling.values()], (fiber) => Fiber.interrupt(fiber), { discard: true }),
  )

  return {
    sessionID: root,
    state,
    status,
    open,
    children,
    loadMore,
    prompt,
    wake: connection.wake,
    resync: connection.resync,
    models: Effect.flatMap(client, (api) => api.model.list()),
    interrupt: Effect.flatMap(client, (api) => api.session.interrupt({ sessionID: root })),
    switchModel: (model: SessionModel.Ref) =>
      sending.withPermits(1)(Effect.flatMap(client, (api) => api.session.model.switch({ sessionID: root, model }))),
    replyPermission: (sessionID: Session.ID, requestID: Permission.RequestID, reply: Permission.Reply) =>
      Effect.flatMap(client, (api) => api.session.permission.reply({ sessionID, requestID, reply })).pipe(
        Effect.catchTag("NotFoundError", () => Effect.void),
        Effect.andThen(removePermission(sessionID, requestID)),
      ),
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
