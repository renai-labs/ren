export * as Controls from "./controls.js"

import type { Plugin } from "@opencode/plugin/effect"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Option, Schema, Semaphore, Stream, Struct, SubscriptionRef } from "effect"
import { Binding } from "./binding.js"
import { Link } from "./link.js"
import { Mirror } from "./mirror.js"
import { RenModel } from "./model.js"
import { RenApi } from "./ren.js"

const providerID = "ren"

class ControlError extends Schema.TaggedError<ControlError>()("Controls.ControlError", { message: Schema.String }) {}

type Outcome = { readonly summary: string } | { readonly error: string }

export const register = Effect.fn("Controls.register")(function* (ctx: Plugin.Context) {
  const bindings = yield* Binding.Service
  const ren = yield* RenApi.Service
  const links = yield* Link.Service
  const mirror = yield* Mirror.Service
  const lock = yield* Semaphore.make(1)
  const refusals = new Map<string, string>()

  const own = (sessionID: string) =>
    Schema.decodeUnknownEffect(Session.ID)(sessionID).pipe(
      Effect.flatMap((id) =>
        Effect.map(bindings.get(id), (bound) => Option.filter(bound, (info) => info.sessionId === id)),
      ),
      Effect.orElseSucceed(() => Option.none<Binding.Info>()),
    )

  const notice = (sessionID: string, text: string) =>
    ctx.session.synthetic({ sessionID: Binding.LocalID.make(sessionID), text, description: text, resume: false })

  const keepRen = Effect.fn("Controls.keepRen")(function* (sessionID: string) {
    yield* lock.withPermit(
      Effect.gen(function* () {
        if (Option.isNone(yield* own(sessionID))) return
        const local = Binding.LocalID.make(sessionID)
        const current = (yield* ctx.session.get({ sessionID: local })).model
        if (!current || current.providerID === providerID) return
        const restored = (yield* ctx.session.context({ sessionID: local }))
          .flatMap((message) => (message.type === "model-switched" ? [message.previous, message.model] : []))
          .findLast((ref) => ref?.providerID === providerID)
        if (!restored)
          return yield* Effect.logWarning("A Ren session switched to a local model has no Ren model to keep")
        yield* ctx.session.switchModel({ sessionID: local, model: restored })
        yield* notice(
          sessionID,
          `A Ren session runs only on ren models, so it stays on ren/${restored.id}. To continue on a local model, fork it.`,
        )
      }),
    )
  })

  const compact = (sessionId: Session.ID) =>
    Effect.gen(function* () {
      const link = yield* links.open(sessionId)
      const frames = yield* link.frames
      yield* link.wake
      const chat = yield* link.client
      yield* SubscriptionRef.changes(link.status).pipe(
        Stream.filter((status) => status === "connected"),
        Stream.runHead,
        Effect.timeoutOrElse({
          duration: "1 minute",
          orElse: () => Effect.fail(new ControlError({ message: "Ren’s brain did not answer within a minute." })),
        }),
      )
      if (!(yield* chat.session.get({ sessionID: sessionId })).capabilities.compact)
        return yield* new ControlError({ message: "This Ren session cannot be compacted." })
      const item = yield* chat.session.compact({ sessionID: sessionId, id: SessionMessage.ID.create() })
      const read = chat.session.message({ sessionID: sessionId, messageID: item.id }).pipe(
        Effect.map((message): ReadonlyArray<Outcome> => {
          if (message.type !== "compaction" || message.status === "running") return []
          return [message.status === "completed" ? { summary: message.summary } : { error: message.error.message }]
        }),
        Effect.catchTag("NotFoundError", () => Effect.succeed([])),
      )
      const outcome = yield* frames.pipe(
        Stream.filter(
          (frame) =>
            frame.type === "server.connected" || ("sessionID" in frame.data && frame.data.sessionID === sessionId),
        ),
        Stream.mapAccumEffect(
          () => false,
          (started, frame) => {
            if (frame.type === "server.connected") return Effect.map(read, (found) => [started, found] as const)
            const now = started || (frame.type === "session.compaction.started" && frame.data.inputID === item.id)
            if (frame.type === "session.compaction.ended" && now)
              return Effect.succeed([now, [{ summary: frame.data.text }]] as const)
            if (frame.type === "session.compaction.failed" && (now || frame.data.inputID === item.id))
              return Effect.succeed([now, [{ error: frame.data.error.message }]] as const)
            return Effect.succeed([now, []] as const)
          },
        ),
        Stream.runHead,
      )
      if (Option.isNone(outcome)) return yield* new ControlError({ message: "Ren’s brain stopped the event stream." })
      if ("error" in outcome.value) return yield* new ControlError({ message: outcome.value.error })
      return outcome.value.summary
    }).pipe(Effect.scoped)

  yield* ctx.session.hook("prompt", (event) =>
    keepRen(event.sessionID).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Could not keep a Ren session on its Ren model", cause)),
    ),
  )
  yield* ctx.session.hook("compaction", (event) =>
    Effect.gen(function* () {
      const bound = yield* own(event.sessionID)
      if (Option.isNone(bound) || !bound.value.sessionId) return
      const summary = yield* compact(bound.value.sessionId)
      event.result = { summary }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          refusals.set(event.sessionID, error.message)
        }),
      ),
    ),
  )
  yield* ctx.session.hook(
    "model.request",
    (event) =>
      Effect.sync(() => {
        const refusal = refusals.get(event.sessionID)
        if (event.kind !== "compaction" || !refusal) return
        refusals.delete(event.sessionID)
        event.headers[RenModel.refusalHeader] = refusal
      }),
    { providerID },
  )
  yield* ctx.event
    .subscribe({
      types: ["session.model.selected", "session.archived", "session.unarchived", "session.deleted", "session.forked"],
    })
    .pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const sessionID = event.data.sessionID
          if (event.type === "session.model.selected" && event.data.model.providerID !== providerID)
            return yield* keepRen(sessionID)
          if (event.type === "session.deleted")
            return yield* Effect.flatMap(Schema.decodeUnknownEffect(Session.ID)(sessionID), mirror.unwatch)
          if (event.type === "session.forked") {
            const local = yield* ctx.session.get({ sessionID })
            const copied = Schema.decodeUnknownOption(Schema.Struct({ ren: Binding.Info }))(local.metadata)
            if (Option.isNone(copied) || String(copied.value.ren.sessionId) === sessionID) return
            yield* ctx.session.update({ sessionID, metadata: Struct.omit(local.metadata ?? {}, ["ren"]) })
            return yield* notice(
              sessionID,
              "This fork is a local copy of a Ren session, and Ren has no fork, so it is not connected to Ren. Pick a local model to continue it here.",
            )
          }
          const bound = yield* own(sessionID)
          if (Option.isNone(bound)) return
          if (event.type === "session.archived") {
            const client = yield* ren.client
            return yield* client.session.archive({ id: Session.ID.make(sessionID) })
          }
          if (event.type === "session.unarchived")
            yield* notice(sessionID, "Ren has no unarchive, so the Ren session stays archived in Ren.")
        }).pipe(Effect.catchCause((cause) => Effect.logWarning("Could not apply a session control to Ren", cause))),
      ),
      Effect.forkScoped,
    )
})
