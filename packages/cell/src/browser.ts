export * as Browsers from "./browser.js"

import type { BrowserNavigateInput } from "@ren/protocol/chat"
import type { Browser } from "@ren/schema/browser"
import { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Layer,
  Option,
  PubSub,
  Queue,
  RcMap,
  Schema,
  type Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"
import { BrainStorage } from "./brain-storage.js"

export class NotFound extends Schema.TaggedError<NotFound>()("Browsers.NotFound", { message: Schema.String }) {}

export class Refused extends Schema.TaggedError<Refused>()("Browsers.Refused", { message: Schema.String }) {}

export interface Opened extends Schema.Schema.Type<typeof Opened> {}
export const Opened = Schema.Struct({
  id: Schema.String,
  provider: Schema.Literal("kernel"),
  liveView: Schema.String,
  cdp: Schema.String,
})

const Stored = Schema.fromJsonString(Opened)

const keyOf = (root: string) => `ren:browser:${root}`

interface Page {
  readonly url: string
  readonly title: string
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

interface BrowserControl {
  readonly pages: Stream.Stream<Page>
  readonly navigate: (to: BrowserNavigateInput) => Effect.Effect<void, Refused>
}

const Message = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Number),
    method: Schema.optionalKey(Schema.String),
    params: Schema.optionalKey(Schema.Unknown),
    result: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
  }),
)

const TargetInfo = Schema.Struct({
  targetInfo: Schema.Struct({ targetId: Schema.String, type: Schema.String, url: Schema.String, title: Schema.String }),
})
const TargetDestroyed = Schema.Struct({ targetId: Schema.String })
const Attached = Schema.Struct({ sessionId: Schema.String })
const History = Schema.Struct({
  currentIndex: Schema.Int,
  entries: Schema.Array(Schema.Struct({ id: Schema.Int })),
})
const Navigated = Schema.Struct({ errorText: Schema.optionalKey(Schema.String) })

const callTimeout = "10 seconds"

// oxlint-disable-next-line ren/no-comments -- A second CDP client next to the agent's: Kernel's proxy gives each client its own connection to Chromium. The page shown is the newest page target, the one the agent opened last.
const kernel = Effect.fnUntraced(function* (cdp: string): Effect.fn.Return<BrowserControl, Refused, Scope.Scope> {
  const closed = yield* Deferred.make<void>()
  const pending = new Map<number, Deferred.Deferred<unknown, Refused>>()
  const events = yield* Queue.unbounded<{ readonly method: string; readonly params: unknown }>()
  const socket = yield* Effect.acquireRelease(
    Effect.callback<WebSocket, Refused>((resume) => {
      const address = new URL(cdp)
      // oxlint-disable-next-line ren/no-comments -- Kernel returns its CDP address on port 8443 and serves it on 443 too. A sandbox's network sends only ports 80 and 443 to the egress and drops the others.
      if (address.port === "8443") address.port = ""
      const opening = new WebSocket(address.toString())
      opening.addEventListener("open", () => resume(Effect.succeed(opening)), { once: true })
      opening.addEventListener(
        "error",
        () => resume(Effect.fail(new Refused({ message: "Ren could not connect to the browser" }))),
        { once: true },
      )
      return Effect.sync(() => opening.close())
    }).pipe(
      Effect.timeoutOrElse({
        duration: callTimeout,
        orElse: () => Effect.fail(new Refused({ message: "The browser did not answer in time" })),
      }),
    ),
    (open) => Effect.sync(() => open.close()),
  )
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return
    const message = Option.getOrUndefined(Schema.decodeUnknownOption(Message)(event.data))
    if (!message) return
    if (message.id) {
      const waiting = pending.get(message.id)
      if (!waiting) return
      Deferred.doneUnsafe(
        waiting,
        message.error ? Effect.fail(new Refused({ message: message.error.message })) : Effect.succeed(message.result),
      )
      return
    }
    if (message.method) Queue.offerUnsafe(events, { method: message.method, params: message.params })
  })
  socket.addEventListener("close", () => {
    Deferred.doneUnsafe(closed, Effect.void)
    for (const waiting of pending.values())
      Deferred.doneUnsafe(waiting, Effect.fail(new Refused({ message: "The browser closed" })))
  })
  const counter = { next: 0 }
  const call = <S extends Schema.Top>(
    schema: S,
    method: string,
    params: object,
    session?: string,
  ): Effect.Effect<S["Type"], Refused, S["DecodingServices"]> =>
    Effect.suspend(() => {
      counter.next += 1
      const id = counter.next
      const answer = Deferred.makeUnsafe<unknown, Refused>()
      pending.set(id, answer)
      socket.send(JSON.stringify({ id, method, params, ...(session && { sessionId: session }) }))
      return Deferred.await(answer).pipe(
        Effect.timeoutOrElse({
          duration: callTimeout,
          orElse: () => Effect.fail(new Refused({ message: `The browser did not answer ${method} in time` })),
        }),
        Effect.flatMap((result) => Schema.decodeUnknownEffect(schema)(result)),
        Effect.catchTag("SchemaError", (error) =>
          Effect.fail(
            new Refused({ message: `The browser answered ${method} with a value Ren cannot read: ${error.message}` }),
          ),
        ),
        Effect.ensuring(Effect.sync(() => pending.delete(id))),
      )
    })
  const targets = new Map<string, { url: string; title: string; session?: string }>()
  const current = yield* SubscriptionRef.make(Option.none<Page>())
  const page = Effect.gen(function* () {
    const targetId = [...targets.keys()].at(-1)
    const target = targetId && targets.get(targetId)
    if (!targetId || !target) return yield* new Refused({ message: "The browser has no open page" })
    if (!target.session)
      target.session = (yield* call(Attached, "Target.attachToTarget", { targetId, flatten: true })).sessionId
    return { ...target, session: target.session }
  })
  const history = (session: string) => call(History, "Page.getNavigationHistory", {}, session)
  const read = Effect.gen(function* () {
    const found = yield* page
    const steps = yield* history(found.session)
    yield* SubscriptionRef.set(
      current,
      Option.some({
        url: found.url,
        title: found.title,
        canGoBack: steps.currentIndex > 0,
        canGoForward: steps.currentIndex < steps.entries.length - 1,
      }),
    )
  })
  yield* Stream.fromQueue(events).pipe(
    Stream.runForEach((event) => {
      if (event.method === "Target.targetDestroyed")
        Option.map(Schema.decodeUnknownOption(TargetDestroyed)(event.params), (found) => targets.delete(found.targetId))
      else if (event.method === "Target.targetCreated" || event.method === "Target.targetInfoChanged") {
        const info = Option.getOrUndefined(Schema.decodeUnknownOption(TargetInfo)(event.params))?.targetInfo
        if (info?.type !== "page") return Effect.void
        targets.set(info.targetId, { ...targets.get(info.targetId), url: info.url, title: info.title })
      } else return Effect.void
      return read.pipe(Effect.catch((error) => Effect.logWarning("Ren could not read the browser’s page", error)))
    }),
    Effect.withErrorReporting,
    Effect.forkScoped,
  )
  yield* call(Schema.Unknown, "Target.setDiscoverTargets", { discover: true })
  return {
    pages: SubscriptionRef.changes(current).pipe(
      Stream.filter(Option.isSome),
      Stream.map((found) => found.value),
      Stream.interruptWhen(Deferred.await(closed)),
    ),
    navigate: (to) =>
      Effect.gen(function* () {
        const found = yield* page
        if ("url" in to) {
          const navigated = yield* call(Navigated, "Page.navigate", { url: to.url }, found.session)
          if (navigated.errorText) yield* new Refused({ message: navigated.errorText })
          return
        }
        if (to.history === "reload") {
          yield* call(Schema.Unknown, "Page.reload", {}, found.session)
          return
        }
        const steps = yield* history(found.session)
        const entry = steps.entries[steps.currentIndex + (to.history === "back" ? -1 : 1)]
        if (!entry) return yield* new Refused({ message: `The browser has no page to go ${to.history} to` })
        yield* call(Schema.Unknown, "Page.navigateToHistoryEntry", { entryId: entry.id }, found.session)
      }).pipe(Effect.asVoid),
  } satisfies BrowserControl
})

const blank: Page = { url: "", title: "", canGoBack: false, canGoForward: false }

const infoOf = (browser: Opened, page: Page): Browser.Info => ({
  id: browser.id,
  provider: browser.provider,
  liveView: browser.liveView,
  ...page,
})

type Event = typeof SessionEvent.BrowserOpened.Type | typeof SessionEvent.BrowserClosed.Type

export interface Interface {
  readonly record: (root: string, browser: Opened) => Effect.Effect<void>
  readonly forget: (root: string, id: string) => Effect.Effect<void>
  readonly get: (root: string) => Effect.Effect<Browser.Info, NotFound>
  readonly watch: (root: string) => Effect.Effect<Stream.Stream<Browser.Info>, NotFound>
  readonly navigate: (root: string, to: BrowserNavigateInput) => Effect.Effect<void, NotFound | Refused>
  readonly events: Stream.Stream<Event>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Browsers") {}

// oxlint-disable-next-line ren/no-comments -- A CDP client keeps a Kernel browser running and billed, so the socket lives only while someone watches, and 5 seconds after.
const idle = "5 seconds"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const events = yield* PubSub.unbounded<Event>()
    const writes = yield* Semaphore.make(1)
    const seen = new Map<string, Page>()
    const controls = yield* RcMap.make({ lookup: kernel, idleTimeToLive: idle })
    const read = (root: string) =>
      Effect.promise(() => storage.get(keyOf(root))).pipe(
        Effect.map((stored) => Schema.decodeUnknownOption(Stored)(stored)),
      )
    const found = (root: string) =>
      read(root).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new NotFound({ message: "This chat has no open browser" })),
            onSome: Effect.succeed,
          }),
        ),
      )
    const publish = (type: Event["type"], root: string, id: string) =>
      Effect.flatMap(Clock.currentTimeMillis, (created) =>
        PubSub.publish(events, {
          id: `evt_${type}_${id}_${created}`,
          created,
          type,
          data: { sessionID: Session.ID.make(root), id },
        }),
      )
    const forget = (root: string, id: string) =>
      writes.withPermit(
        Effect.gen(function* () {
          const browser = Option.getOrUndefined(yield* read(root))
          if (browser?.id !== id) return
          yield* Effect.promise(() => storage.delete(keyOf(root)))
          yield* RcMap.invalidate(controls, browser.cdp)
          seen.delete(id)
          yield* publish("browser.closed", root, id)
        }),
      )
    return Service.of({
      record: (root, browser) =>
        writes.withPermit(
          Effect.gen(function* () {
            const previous = Option.getOrUndefined(yield* read(root))
            yield* Effect.promise(() => storage.put(keyOf(root), Schema.encodeSync(Stored)(browser)))
            if (previous && previous.cdp !== browser.cdp) {
              yield* RcMap.invalidate(controls, previous.cdp)
              seen.delete(previous.id)
            }
            yield* publish("browser.opened", root, browser.id)
          }),
        ),
      forget,
      get: (root) => Effect.map(found(root), (browser) => infoOf(browser, seen.get(browser.id) ?? blank)),
      watch: (root) =>
        Effect.map(found(root), (browser) =>
          Stream.unwrap(
            RcMap.get(controls, browser.cdp).pipe(
              Effect.tapError(() => RcMap.invalidate(controls, browser.cdp)),
              Effect.map((control) =>
                control.pages.pipe(
                  Stream.tap((page) => Effect.sync(() => seen.set(browser.id, page))),
                  Stream.map((page) => infoOf(browser, page)),
                  Stream.concat(Stream.fromEffectDrain(forget(root, browser.id))),
                ),
              ),
            ),
          ).pipe(
            Stream.catch((error) =>
              Stream.fromEffectDrain(Effect.logWarning("Ren stopped following the browser", error)),
            ),
          ),
        ),
      navigate: (root, to) =>
        Effect.gen(function* () {
          const browser = yield* found(root)
          const control = yield* RcMap.get(controls, browser.cdp).pipe(
            Effect.tapError(() => RcMap.invalidate(controls, browser.cdp)),
          )
          yield* control.navigate(to)
        }).pipe(Effect.scoped),
      events: Stream.fromPubSub(events),
    })
  }),
)
