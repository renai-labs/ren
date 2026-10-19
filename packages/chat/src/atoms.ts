export * as ChatAtoms from "./atoms.js"

import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session-message"
import { Effect, Option, Queue, Stream, SubscriptionRef } from "effect"
import type { HttpClient } from "effect/http"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import { ChatSession } from "./chat-session.js"
import { ChatState } from "./chat-state.js"
import { Projection } from "./projection.js"
import type { TimelineDetail } from "./timeline-detail.js"

export type Lifecycle = "foreground" | "online"

export interface Options<R, ER> {
  readonly runtime: Atom.AtomRuntime<R | HttpClient.HttpClient, ER>
  readonly access: (sessionID: Session.ID) => Effect.Effect<Session.ClientAccess, unknown, R>
  readonly sender?: SessionMessage.Sender
  readonly detail?: TimelineDetail.Detail
  readonly lifecycle?: (listener: (event: Lifecycle) => void) => () => void
}

export const make = <R, ER>(options: Options<R, ER>) => {
  const session = Atom.family((sessionID: Session.ID) =>
    options.runtime
      .atom(
        Effect.gen(function* () {
          const context = yield* Effect.context<R>()
          const opened = yield* ChatSession.make({
            sessionID,
            access: options.access(sessionID).pipe(Effect.provide(context)),
            ...(options.sender && { sender: options.sender }),
          })
          yield* opened.open(sessionID).pipe(
            Effect.catch((error) => Effect.logWarning("The chat could not load the session", error)),
            Effect.forkScoped,
          )
          const lifecycle = options.lifecycle
          if (lifecycle)
            yield* Stream.callback<Lifecycle>((queue) =>
              Effect.acquireRelease(
                Effect.sync(() => lifecycle((event) => Queue.offerUnsafe(queue, event))),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ).pipe(
              Stream.runForEach((event) =>
                event === "online"
                  ? opened.wake.pipe(Effect.andThen(opened.resync("The network connection is back")))
                  : opened.foreground,
              ),
              Effect.forkScoped,
            )
          return opened
        }),
      )
      .pipe(Atom.setIdleTTL("1 minute")),
  )

  const watch = <A>(
    sessionID: Session.ID,
    select: (opened: ChatSession.ChatSession) => SubscriptionRef.SubscriptionRef<A>,
  ) =>
    Atom.make((get) =>
      Stream.unwrap(Effect.map(get.result(session(sessionID)), (opened) => SubscriptionRef.changes(select(opened)))),
    )

  const state = Atom.family((sessionID: Session.ID) => watch(sessionID, (opened) => opened.state))

  const status = Atom.family((sessionID: Session.ID) => watch(sessionID, (opened) => opened.status))

  const timeline = Atom.family((sessionID: Session.ID) =>
    Atom.make((get) =>
      AsyncResult.map(get(state(sessionID)), (current): Projection.Projection => {
        const previous = Option.flatMap(get.self<AsyncResult.AsyncResult<Projection.Projection>>(), AsyncResult.value)
        return Projection.project({
          messages: ChatState.messages(current, sessionID),
          busy: ChatState.activity(current, sessionID) === "running",
          pendingInputIDs: new Set(ChatState.inputs(current, sessionID)),
          queuedCompactionIDs: ChatState.pending(current, sessionID).flatMap((item) =>
            item.type === "compaction" ? [item.id] : [],
          ),
          ...(options.detail && { detail: options.detail }),
          ...(Option.isSome(previous) && { previous: previous.value.rows }),
        })
      }),
    ),
  )

  const run = <A, E>(
    registry: AtomRegistry.AtomRegistry,
    sessionID: Session.ID,
    action: (opened: ChatSession.ChatSession) => Effect.Effect<A, E>,
  ) => Effect.flatMap(AtomRegistry.getResult(registry, session(sessionID), { suspendOnWaiting: true }), action)

  const models = Atom.family((sessionID: Session.ID) =>
    Atom.make((get) => Effect.flatMap(get.result(session(sessionID)), (opened) => opened.models)),
  )

  return {
    session,
    state,
    status,
    timeline,
    models,
    run,
  }
}

export type ChatAtoms = ReturnType<typeof make>
