export * as OutputLog from "./output-log.js"

import { type OutputWindow, type ProcessEvent, stallAfter } from "@ren/hand-api/executor-api"
import { type Cause, Clock, Duration, Effect, Option, PubSub, type Scope, Stream } from "effect"

export const limitBytes = 2 * 1024 * 1024

type OutputEvent = Extract<ProcessEvent, { readonly type: "stdout" | "stderr" }>

type KeptChunk = OutputEvent & { readonly newlinesBefore: number }

export type ExitEvent = Extract<ProcessEvent, { readonly type: "exit" }>

const countNewlines = (bytes: Uint8Array) => bytes.reduce((count, byte) => (byte === 10 ? count + 1 : count), 0)

export interface Log {
  readonly chunks: Array<KeptChunk>
  readonly readerPositions: Map<object, number>
  readonly changed: PubSub.PubSub<void>
  readonly readerMoves: PubSub.Subscription<void>
  readonly readerMoved: PubSub.PubSub<void>
  nextOffset: number
  newlines: number
  exit: ExitEvent | undefined
  failure: Cause.Cause<never> | undefined
}

export const make: Effect.Effect<Log, never, Scope.Scope> = Effect.gen(function* () {
  const readerMoved = yield* PubSub.sliding<void>(1)
  return {
    chunks: [],
    readerPositions: new Map(),
    changed: yield* PubSub.sliding<void>(1),
    readerMoves: yield* PubSub.subscribe(readerMoved),
    readerMoved,
    nextOffset: 0,
    newlines: 0,
    exit: undefined,
    failure: undefined,
  }
})

export const keptBytes = (log: Log) => log.chunks.reduce((bytes, chunk) => bytes + chunk.bytes.length, 0)

export const hasReaders = (log: Log) => log.readerPositions.size > 0

const trim: (log: Log) => Effect.Effect<void> = Effect.fnUntraced(function* (log: Log) {
  const first = log.chunks.at(0)
  if (!first || log.chunks.length === 1 || log.nextOffset - first.offset <= limitBytes) return
  const end = first.offset + first.bytes.length
  if ([...log.readerPositions.values()].some((position) => position < end)) {
    const moved = yield* PubSub.take(log.readerMoves).pipe(Effect.timeoutOption(stallAfter))
    if (Option.isSome(moved)) return yield* trim(log)
    for (const reader of log.readerPositions.keys())
      if ((log.readerPositions.get(reader) ?? end) < end) log.readerPositions.delete(reader)
  }
  log.chunks.shift()
  return yield* trim(log)
})

export const append = Effect.fnUntraced(function* (log: Log, type: OutputEvent["type"], bytes: Uint8Array) {
  log.chunks.push({ type, bytes, offset: log.nextOffset, newlinesBefore: log.newlines })
  log.nextOffset += bytes.length
  log.newlines += countNewlines(bytes)
  yield* PubSub.publish(log.changed, undefined)
  yield* trim(log)
})

export const end = (log: Log, event: ExitEvent) =>
  Effect.suspend(() => {
    log.exit = event
    return PubSub.publish(log.changed, undefined)
  })

export const fail = (log: Log, cause: Cause.Cause<never>) =>
  Effect.suspend(() => {
    log.failure = cause
    return PubSub.publish(log.changed, undefined)
  })

const outputFrom = (log: Log, position: number) =>
  log.chunks.flatMap((chunk): ReadonlyArray<OutputEvent> => {
    if (chunk.offset + chunk.bytes.length <= position) return []
    if (chunk.offset >= position) return [{ type: chunk.type, offset: chunk.offset, bytes: chunk.bytes }]
    return [{ type: chunk.type, offset: position, bytes: chunk.bytes.subarray(position - chunk.offset) }]
  })

const newlinesAt = (log: Log, offset: number) => {
  const chunk = log.chunks.find((kept) => offset < kept.offset + kept.bytes.length)
  if (!chunk) return log.newlines
  if (offset <= chunk.offset) return chunk.newlinesBefore
  return chunk.newlinesBefore + countNewlines(chunk.bytes.subarray(0, offset - chunk.offset))
}

const waitForChange: (log: Log, position: number, changes: PubSub.Subscription<void>) => Effect.Effect<void> =
  Effect.fnUntraced(function* (log, position, changes) {
    if (log.nextOffset > position || log.exit || log.failure) return
    yield* PubSub.take(changes)
    return yield* waitForChange(log, position, changes)
  })

export const read = (log: Log, cursor?: number, window?: OutputWindow): Stream.Stream<ProcessEvent> => {
  const reader = {}
  const leave = Effect.suspend(() => {
    log.readerPositions.delete(reader)
    return PubSub.publish(log.readerMoved, undefined)
  })
  return Stream.unwrap(
    Effect.map(PubSub.subscribe(log.changed), (changes) =>
      Stream.paginate({ position: cursor ?? 0, newlines: newlinesAt(log, cursor ?? 0), sentAtMs: 0 }, (state) =>
        Effect.gen(function* () {
          // oxlint-disable-next-line ren/no-comments -- A reader with a window skips what it does not keep, so it never holds back the trim of older output.
          log.readerPositions.set(reader, window ? Number.POSITIVE_INFINITY : state.position)
          yield* PubSub.publish(log.readerMoved, undefined)
          yield* waitForChange(log, state.position, changes)
          if (window && !log.exit) {
            const waitMs = state.sentAtMs + window.intervalMs - (yield* Clock.currentTimeMillis)
            if (waitMs > 0) yield* Effect.sleep(Duration.millis(waitMs))
          }
          if (log.failure) return yield* Effect.failCause(log.failure)
          const end = log.nextOffset
          const from = window ? Math.max(state.position, end - window.maxBytes) : state.position
          const events: ReadonlyArray<ProcessEvent> = [
            ...(from > state.position
              ? [
                  {
                    type: "skip" as const,
                    offset: state.position,
                    bytes: from - state.position,
                    newlines: newlinesAt(log, from) - state.newlines,
                  },
                ]
              : []),
            ...outputFrom(log, from),
          ]
          if (log.exit) return [[...events, log.exit], Option.none()] as const
          return [
            events,
            Option.some({ position: end, newlines: log.newlines, sentAtMs: yield* Clock.currentTimeMillis }),
          ] as const
        }),
      ),
    ),
  ).pipe(Stream.ensuring(leave))
}
