export * as RenModel from "./model.js"

import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { Plugin } from "@opencode/plugin/effect"
import { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { type Context, Effect, Exit, Option, Schema, Stream, SubscriptionRef } from "effect"
import { Binding } from "./binding.js"
import { Link } from "./link.js"
import { Mirror } from "./mirror.js"
import { RenApi } from "./ren.js"
import { Turn } from "./turn.js"

export const kindHeader = "x-ren-request-kind"
export const variantHeader = "x-ren-variant"
export const refusalHeader = "x-ren-refusal"
const sessionHeader = "x-opencode-session-id"

export type Services = Binding.Service | RenApi.Service | Link.Service | Mirror.Service

class TurnError extends Schema.TaggedError<TurnError>()("RenModel.TurnError", { message: Schema.String }) {}

interface Candidate {
  readonly id: SessionMessage.ID
  readonly text: string
  readonly remote: boolean
}

interface State {
  readonly phase: "connecting" | "waiting" | "started" | "ended"
  readonly expected: ReadonlySet<string>
  readonly turn: Turn.State
}

const copied =
  "This session is a local copy of a Ren session, and Ren has no fork. Pick a local model to continue it here, or go back to the Ren session."

const isRemote = Schema.is(Schema.Struct({ remote: Schema.Literal(true) }))

const refused = {
  compaction: "Only a Ren session that has started can be compacted.",
  generate: "Ren models answer only in a Ren session, not in one-off generations.",
  title: "Ren names a Ren session itself.",
}

const explain = (error: { readonly _tag: string; readonly message: string; readonly cause?: unknown }) => {
  if (error._tag !== "ChatAccess.AccessFailed") return error.message
  const reason = error.cause instanceof Error ? error.cause.message : "unknown reason"
  return `Ren could not open this session’s brain: ${reason}. Send the message again later.`
}

export const make = (
  modelId: string,
  context: Context.Context<Services>,
  session: Plugin.Context["session"],
): LanguageModelV3 => ({
  specificationVersion: "v3",
  provider: "ren",
  modelId,
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error("Ren models only stream.")),
  doStream: (options: LanguageModelV3CallOptions) => {
    const headers = options.headers ?? {}
    const kind = headers[kindHeader]
    return Promise.resolve({
      stream: Stream.toReadableStreamWith(
        (kind === "primary"
          ? turn({ session, modelId, sessionID: headers[sessionHeader] ?? "", variant: headers[variantHeader] })
          : Stream.fail(
              new TurnError({
                message:
                  headers[refusalHeader] ??
                  (kind === "compaction" || kind === "generate" || kind === "title"
                    ? refused[kind]
                    : "Ren models answer only the requests of a Ren session."),
              }),
            )
        ).pipe(Stream.mapError((error) => new Error(explain(error)))),
        context,
      ),
    })
  },
})

const turn = (input: {
  readonly session: Plugin.Context["session"]
  readonly modelId: string
  readonly sessionID: string
  readonly variant: string | undefined
}) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const bindings = yield* Binding.Service
      const ren = yield* RenApi.Service
      const links = yield* Link.Service
      const mirror = yield* Mirror.Service
      const sessionID = yield* Schema.decodeUnknownEffect(Session.ID)(input.sessionID).pipe(
        Effect.mapError(() => new TurnError({ message: `OpenCode session ${input.sessionID} has no ID Ren accepts.` })),
      )
      const bound = yield* bindings.get(sessionID)
      const created = Option.flatMapNullishOr(bound, (info) => info.sessionId)
      if (Option.isSome(created) && created.value !== sessionID) return yield* new TurnError({ message: copied })
      const separator = input.modelId.indexOf("/")
      const model: SessionModel.Ref = {
        providerID: input.modelId.slice(0, separator),
        id: input.modelId.slice(separator + 1),
        ...(input.variant && { variant: input.variant }),
      }
      const messages = yield* input.session
        .context({ sessionID: Binding.LocalID.make(sessionID) })
        .pipe(Effect.mapError(() => new TurnError({ message: "Could not read the local session’s messages." })))
      const answered = messages.findLastIndex(
        (message) => message.type === "assistant" && Boolean(message.time.completed) && !message.error,
      )
      const candidates = messages.slice(answered + 1).flatMap((message): ReadonlyArray<Candidate> => {
        if (message.type !== "user" || message.text.trim() === "") return []
        return Option.match(Schema.decodeUnknownOption(SessionMessage.ID)(message.id), {
          onNone: () => [],
          onSome: (id) => [{ id, text: message.text, remote: isRemote(message.metadata) }],
        })
      })
      if (Option.isNone(created)) {
        const local = yield* input.session
          .get({ sessionID: Binding.LocalID.make(sessionID) })
          .pipe(Effect.mapError(() => new TurnError({ message: "Could not read the local session." })))
        if (local.fork) return yield* new TurnError({ message: copied })
        const spaceId = Option.isSome(bound) ? bound.value.spaceId : yield* bindings.space
        const client = yield* ren.client
        yield* client.session
          .create({ id: sessionID, spaceId, model })
          .pipe(
            Effect.mapError((error) => new TurnError({ message: `Ren did not create the session: ${error.message}` })),
          )
        yield* bindings.set(sessionID, { spaceId, sessionId: sessionID })
      }
      yield* mirror.watch(sessionID)
      const link = yield* links.open(sessionID)
      const replay = yield* mirror.replay(
        sessionID,
        candidates.filter((candidate) => candidate.remote).map((candidate) => candidate.id),
      )
      const covered = Option.match(replay, { onNone: () => new Set<string>(), onSome: (found) => found.ids })
      const frames = Option.isSome(replay) ? replay.value.frames : yield* link.frames
      yield* link.wake
      const chat = yield* link.client
      yield* Effect.addFinalizer((exit) =>
        Exit.hasInterrupts(exit) ? chat.session.interrupt({ sessionID }).pipe(Effect.ignore) : Effect.void,
      )
      yield* SubscriptionRef.changes(link.status).pipe(
        Stream.filter((status) => status === "connected"),
        Stream.runHead,
        Effect.timeoutOrElse({
          duration: "1 minute",
          orElse: () => Effect.fail(new TurnError({ message: "Ren’s brain did not answer within a minute." })),
        }),
      )
      const failed = (error: { readonly message: string }) =>
        new TurnError({ message: `Ren’s brain refused a request: ${error.message}` })
      const has = (id: SessionMessage.ID) =>
        chat.session.message({ sessionID, messageID: id }).pipe(
          Effect.as(true),
          Effect.catchTag("NotFoundError", () => Effect.succeed(false)),
          Effect.mapError(failed),
        )
      const resync = Effect.fnUntraced(function* (state: State) {
        if (!(yield* Effect.forEach(candidates, (candidate) => has(candidate.id))).every(Boolean))
          return [state, []] as const
        const busy = (yield* chat.session.status().pipe(Effect.mapError(failed)))[sessionID]?.type === "busy"
        if (busy) return [{ ...state, phase: "started" }, []] as const
        const next = Turn.finish(state.turn, "caught-up")
        return [{ ...state, phase: "ended", turn: next.state }, next.parts] as const
      })
      const switchModel = Effect.gen(function* () {
        const info = yield* chat.session.get({ sessionID }).pipe(Effect.mapError(failed))
        if (
          info.model &&
          SessionModel.key(info.model) === SessionModel.key(model) &&
          (info.model.variant ?? "default") === (model.variant ?? "default")
        )
          return
        const label = `${SessionModel.key(model)}${model.variant ? ` (${model.variant})` : ""}`
        if (!info.capabilities.model)
          return yield* new TurnError({
            message: `This Ren session cannot switch its model to ${label}. Pick the model it runs on.`,
          })
        yield* chat.session.model.switch({ sessionID, model }).pipe(
          Effect.mapError(
            (error) =>
              new TurnError({
                message: `Ren could not switch this session to ${label}: ${error.message}. Pick another ren model.`,
              }),
          ),
        )
      })
      const connect = Effect.fnUntraced(function* (state: State) {
        const missing = yield* Effect.filter(
          candidates.filter((candidate) => !covered.has(candidate.id)),
          (candidate) => Effect.map(has(candidate.id), (found) => !found),
        )
        if (Option.isSome(created) && missing.some((candidate) => !candidate.remote)) yield* switchModel
        yield* Effect.forEach(
          missing.filter((candidate) => !candidate.remote),
          (candidate) =>
            chat.session
              .prompt({ sessionID, id: candidate.id, text: candidate.text, delivery: "steer" })
              .pipe(Effect.mapError(failed)),
          { discard: true },
        )
        const waiting: State = {
          ...state,
          phase: "waiting",
          expected: new Set([...covered, ...missing.map((candidate) => candidate.id)]),
        }
        return waiting.expected.size === 0 ? yield* resync(waiting) : ([waiting, []] as const)
      })
      const isNextMessage = (state: State, delivered: Option.Option<SessionMessage.ID>) =>
        Option.isSome(delivered) &&
        state.expected.size === 0 &&
        !candidates.some((candidate) => candidate.id === delivered.value)
          ? chat.session.message({ sessionID, messageID: delivered.value }).pipe(
              Effect.map((message) => message.type === "user"),
              Effect.catchTag("NotFoundError", () => Effect.succeed(false)),
              Effect.mapError(failed),
            )
          : Effect.succeed(false)
      const step = Effect.fnUntraced(function* (
        state: State,
        frame: SessionEvent.Frame,
      ): Effect.fn.Return<readonly [State, ReadonlyArray<Turn.Part>], TurnError> {
        if (frame.type === "server.connected")
          return yield* state.phase === "connecting" ? connect(state) : resync(state)
        if (frame.type === "server.heartbeat" || frame.type === "stream.ended") return [state, []]
        const delivered =
          frame.type === "session.inbox.delivered" && frame.data.sessionID === sessionID
            ? Option.some(frame.data.inboxID)
            : Option.none()
        if (Option.isSome(delivered) && state.expected.has(delivered.value))
          return [
            {
              ...state,
              phase: "started",
              expected: new Set([...state.expected].filter((id) => id !== delivered.value)),
            },
            [],
          ]
        if (state.phase !== "started") return [state, []]
        const next = (yield* isNextMessage(state, delivered))
          ? Turn.finish(state.turn, "next-message")
          : Turn.next(state.turn, frame)
        return [{ ...state, phase: next.state.ended ? "ended" : "started", turn: next.state }, next.parts]
      })
      return frames.pipe(
        Stream.mapAccumEffect(
          (): State => ({ phase: "connecting", expected: new Set(), turn: Turn.start(sessionID) }),
          step,
        ),
        Stream.takeUntil((part) => part.type === "finish" || part.type === "error"),
        Stream.prepend([{ type: "stream-start", warnings: [] } satisfies Turn.Part]),
      )
    }),
  )
