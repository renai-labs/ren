export * as Title from "./title.js"

import type { Plugin } from "@opencode/plugin/effect"
import { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import { Context, Effect, Exit, Layer, Option, Schema, Stream } from "effect"
import { Binding } from "./binding.js"
import { Link } from "./link.js"

interface Sent {
  readonly title: string
  done: boolean
}

interface State {
  applied: Array<string>
  sent: Array<Sent>
  unsent?: string | undefined
}

export class Service extends Context.Service<
  Service,
  {
    readonly seen: (sessionId: Session.ID, title: string) => Effect.Effect<void>
    readonly frame: (sessionId: Session.ID, frame: SessionEvent.Frame) => Effect.Effect<void>
  }
>()("@ren/opencode/Title") {}

const shortened = (local: string, title: string) =>
  local === title || (local.endsWith("...") && title.startsWith(local.slice(0, -3)))

export const layer = (ctx: Pick<Plugin.Context, "session" | "event">) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const links = yield* Link.Service
      const bindings = yield* Binding.Service
      const states = new Map<Session.ID, State>()
      const stateOf = (sessionId: Session.ID) => {
        const found = states.get(sessionId)
        if (found) return found
        const made: State = { applied: [], sent: [] }
        states.set(sessionId, made)
        return made
      }

      const push = Effect.fnUntraced(function* (sessionId: Session.ID, title: string) {
        const state = stateOf(sessionId)
        const entry: Sent = { title, done: false }
        state.sent.push(entry)
        state.unsent = title
        const exit = yield* Effect.gen(function* () {
          const link = yield* links.open(sessionId)
          const chat = yield* link.client
          const info = yield* chat.session.get({ sessionID: sessionId })
          if (!info.capabilities.rename || info.title === title) return
          yield* chat.session.rename({ sessionID: sessionId, title })
        }).pipe(Effect.scoped, Effect.timeout("1 minute"), Effect.exit)
        entry.done = true
        if (Exit.isSuccess(exit)) {
          if (state.unsent === title) state.unsent = undefined
          return
        }
        state.sent = state.sent.filter((each) => each !== entry)
        yield* Effect.logWarning("Could not rename the Ren session. It is renamed when it connects again.", exit.cause)
      })

      const remote = Effect.fnUntraced(function* (sessionId: Session.ID, title: string) {
        const state = stateOf(sessionId)
        const ours = state.sent.findIndex((entry) => entry.title === title)
        if (ours >= 0) {
          state.sent.splice(0, ours + 1)
          return
        }
        if (state.sent.some((entry) => !entry.done)) return
        state.sent = []
        state.unsent = undefined
        const sessionID = Binding.LocalID.make(sessionId)
        if ((yield* ctx.session.get({ sessionID })).title === title) return
        state.applied.push(title)
        yield* ctx.session.update({ sessionID, title })
      })

      const sync = Effect.fnUntraced(function* (sessionId: Session.ID) {
        const unsent = stateOf(sessionId).unsent
        if (unsent) return yield* push(sessionId, unsent)
        const link = yield* links.open(sessionId)
        const chat = yield* link.client
        const info = yield* chat.session.get({ sessionID: sessionId })
        if (info.title) return yield* remote(sessionId, info.title)
        const local = (yield* ctx.session.get({ sessionID: Binding.LocalID.make(sessionId) })).title?.trim()
        if (local) yield* push(sessionId, local)
      }, Effect.scoped)

      const local = Effect.fnUntraced(function* (sessionID: string, raw: string) {
        const title = raw.trim()
        const id = Schema.decodeUnknownOption(Session.ID)(sessionID)
        if (!title || Option.isNone(id)) return
        const state = stateOf(id.value)
        const applied = state.applied.findIndex((each) => shortened(title, each))
        if (applied >= 0) {
          state.applied.splice(0, applied + 1)
          return
        }
        const bound = Option.flatMapNullishOr(yield* bindings.get(id.value), (info) => info.sessionId)
        if (Option.isSome(bound) && bound.value === id.value) yield* push(id.value, title)
      })

      yield* ctx.event.subscribe({ types: ["session.renamed"] }).pipe(
        Stream.runForEach((event) =>
          local(event.data.sessionID, event.data.title).pipe(
            Effect.catchCause((cause) => Effect.logWarning("Could not rename the Ren session", cause)),
          ),
        ),
        Effect.catchCause((cause) => Effect.logWarning("Local renames no longer reach Ren", cause)),
        Effect.forkScoped,
      )

      return Service.of({
        seen: (sessionId, title) =>
          Effect.sync(() => {
            if (title) stateOf(sessionId).applied.push(title)
          }),
        frame: (sessionId, frame) =>
          Effect.gen(function* () {
            if (frame.type === "server.connected") yield* sync(sessionId)
            if (frame.type === "session.renamed" && frame.data.sessionID === sessionId)
              yield* remote(sessionId, frame.data.title)
          }).pipe(
            Effect.catchCause((cause) => Effect.logWarning("Could not sync the title of the Ren session", cause)),
          ),
      })
    }),
  )
