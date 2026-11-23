export * as Mirror from "./mirror.js"

import type { Plugin } from "@opencode/plugin/effect"
import type { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Space } from "@ren/schema/space"
import { Clock, Context, Effect, Exit, Fiber, Layer, Option, PubSub, Scope, Semaphore, Stream } from "effect"
import { Binding } from "./binding.js"
import { Link } from "./link.js"
import { RenApi } from "./ren.js"
import { Title } from "./title.js"

const limit = 4

const recorded = 10_000

const providers = { slack: "Slack", linear: "Linear", github: "GitHub" }

export interface Replay {
  readonly ids: ReadonlySet<string>
  readonly frames: Stream.Stream<SessionEvent.Frame>
}

interface Watcher {
  readonly link: Link.Link
  readonly hub: PubSub.PubSub<SessionEvent.Frame>
  readonly pending: Map<string, number>
  log: Array<SessionEvent.Frame>
  base: number
  next: number
  replays: number
  used: number
}

export class Service extends Context.Service<
  Service,
  {
    readonly watch: (sessionId: Session.ID) => Effect.Effect<void>
    readonly replay: (
      sessionId: Session.ID,
      ids: ReadonlyArray<SessionMessage.ID>,
    ) => Effect.Effect<Option.Option<Replay>, never, Scope.Scope>
  }
>()("@ren/opencode/Mirror") {}

const origin = (message: SessionMessage.User) =>
  (message.channel && `${message.channel.sender} via ${providers[message.channel.provider]}`) ??
  (message.schedule && `Schedule ${message.schedule.name}`) ??
  (message.webhook && `Webhook ${message.webhook.name}`) ??
  (message.task && `Task ${message.task.identifier}`)

const forget = (watcher: Watcher, ids: ReadonlyArray<string>) => {
  for (const id of ids) watcher.pending.delete(id)
  const first = Math.min(watcher.next, ...watcher.pending.values())
  watcher.log = watcher.log.slice(first - watcher.base)
  watcher.base = first
}

export const layer = (ctx: Pick<Plugin.Context, "session">) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const links = yield* Link.Service
      const ren = yield* RenApi.Service
      const bindings = yield* Binding.Service
      const titles = yield* Title.Service
      const scope = yield* Effect.scope
      const lock = yield* Semaphore.make(1)
      const watchers = new Map<Session.ID, { readonly watcher: Watcher; readonly fiber: Fiber.Fiber<void> }>()
      const people = new Map<Space.ID, ReadonlyMap<string, string>>()
      const asked = new Set<string>()
      const signedIn: { id?: string } = {}

      const me = Effect.gen(function* () {
        if (signedIn.id) return signedIn.id
        const client = yield* ren.client
        signedIn.id = (yield* client.me.get()).user.id
        return signedIn.id
      })

      const nameOf = Effect.fnUntraced(
        function* (spaceId: Space.ID, userId: string) {
          const key = `${spaceId}:${userId}`
          if (!people.get(spaceId)?.has(userId) && !asked.has(key)) {
            asked.add(key)
            const client = yield* ren.client
            const page = yield* client["space-member"].list({ spaceId, page: 1, pageSize: 100 })
            people.set(
              spaceId,
              new Map(
                page.items.flatMap((member) => (member.status === "active" ? [[member.userId, member.name]] : [])),
              ),
            )
          }
          return people.get(spaceId)?.get(userId) ?? "Member"
        },
        Effect.orElseSucceed(() => "Member"),
      )

      const speaker = Effect.fnUntraced(function* (sessionId: Session.ID, message: SessionMessage.User) {
        const userId = message.sender?.userId
        const own = Boolean(userId) && userId === (yield* me.pipe(Effect.option, Effect.map(Option.getOrUndefined)))
        const bound = yield* bindings.get(sessionId).pipe(Effect.orElseSucceed(() => Option.none<Binding.Info>()))
        const userName = userId && !own && Option.isSome(bound) ? yield* nameOf(bound.value.spaceId, userId) : undefined
        return { userId, userName, prefix: origin(message) ?? (own ? undefined : (userName ?? "Member")) }
      })

      const admit = Effect.fn("Mirror.admit")(function* (
        watcher: Watcher,
        sessionId: Session.ID,
        id: SessionMessage.ID,
      ) {
        const sessionID = Binding.LocalID.make(sessionId)
        const local = Binding.LocalMessageID.make(id)
        if ((yield* ctx.session.context({ sessionID })).some((message) => message.id === local)) return false
        const chat = yield* watcher.link.client
        const message = yield* chat.session.message({ sessionID: sessionId, messageID: id })
        if (message.type !== "user") return false
        const who = yield* speaker(sessionId, message)
        const text = message.presentation?.displayText ?? message.text
        yield* ctx.session.prompt({
          sessionID,
          id: local,
          text: who.prefix ? `${who.prefix}: ${text}` : text,
          delivery: "steer",
          resume: true,
          metadata: {
            ...(who.userId && { userID: who.userId }),
            ...(who.userName && { userName: who.userName }),
            remote: true,
          },
        })
        return true
      })

      const handle = (sessionId: Session.ID, watcher: Watcher) => (frame: SessionEvent.Frame) =>
        Effect.gen(function* () {
          const delivered =
            frame.type === "session.inbox.delivered" && frame.data.sessionID === sessionId
              ? Option.some(frame.data.inboxID)
              : Option.none()
          yield* lock.withPermit(
            Effect.suspend(() => {
              if (Option.isSome(delivered)) watcher.pending.set(delivered.value, watcher.next)
              if (watcher.pending.size > 0) watcher.log.push(frame)
              watcher.next += 1
              if (watcher.log.length > recorded) forget(watcher, [...watcher.pending.keys()])
              if (watcher.pending.size === 0) watcher.base = watcher.next
              return PubSub.publish(watcher.hub, frame)
            }),
          )
          yield* titles.frame(sessionId, frame)
          if (Option.isNone(delivered)) return
          const kept = yield* admit(watcher, sessionId, delivered.value).pipe(
            Effect.catchCause((cause) =>
              Effect.as(Effect.logWarning("Could not show a message from Ren in the local session", cause), false),
            ),
          )
          if (!kept) yield* lock.withPermit(Effect.sync(() => forget(watcher, [delivered.value])))
        })

      const start = Effect.fnUntraced(function* (sessionId: Session.ID, used: number) {
        const owned = yield* Scope.fork(scope)
        const link = yield* links.open(sessionId).pipe(Scope.provide(owned))
        const hub = yield* PubSub.unbounded<SessionEvent.Frame>()
        yield* Scope.addFinalizer(owned, PubSub.shutdown(hub))
        const frames = yield* link.frames.pipe(Scope.provide(owned))
        const watcher: Watcher = { link, hub, pending: new Map(), log: [], base: 0, next: 0, replays: 0, used }
        const fiber = yield* frames.pipe(
          Stream.takeUntil(
            (frame) => frame.type === "stream.ended" && frame.data.reason === "idle" && watcher.replays === 0,
          ),
          Stream.runForEach(handle(sessionId, watcher)),
          Effect.ensuring(
            Effect.suspend(() => {
              if (watchers.get(sessionId)?.watcher === watcher) watchers.delete(sessionId)
              return Scope.close(owned, Exit.void)
            }),
          ),
          Effect.forkIn(scope),
        )
        watchers.set(sessionId, { watcher, fiber })
        yield* link.wake
      })

      return Service.of({
        watch: Effect.fn("Mirror.watch")(function* (sessionId) {
          yield* lock.withPermit(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              const found = watchers.get(sessionId)
              if (found) {
                found.watcher.used = now
                return yield* found.watcher.link.wake
              }
              const evicted = [...watchers.values()]
                .filter((entry) => entry.watcher.replays === 0)
                .toSorted((left, right) => left.watcher.used - right.watcher.used)
                .slice(0, Math.max(0, watchers.size - limit + 1))
              yield* Effect.forEach(evicted, (entry) => Fiber.interrupt(entry.fiber), { discard: true })
              yield* start(sessionId, now)
            }),
          )
        }),
        replay: Effect.fn("Mirror.replay")(function* (sessionId, ids) {
          return yield* lock.withPermit(
            Effect.gen(function* () {
              const watcher = watchers.get(sessionId)?.watcher
              if (!watcher) return Option.none<Replay>()
              const covered = ids.filter((id) => watcher.pending.has(id))
              if (covered.length === 0) return Option.none<Replay>()
              const from = Math.min(...covered.map((id) => watcher.pending.get(id) ?? watcher.next))
              const earlier = watcher.log.slice(from - watcher.base)
              forget(watcher, covered)
              const subscription = yield* PubSub.subscribe(watcher.hub)
              watcher.replays += 1
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  watcher.replays -= 1
                }),
              )
              const connected: SessionEvent.Frame = {
                id: "evt_mirror_connected",
                created: yield* Clock.currentTimeMillis,
                type: "server.connected",
                data: {},
              }
              return Option.some<Replay>({
                ids: new Set(covered),
                frames: Stream.fromSubscription(subscription).pipe(Stream.prepend([connected, ...earlier])),
              })
            }),
          )
        }),
      })
    }),
  )
