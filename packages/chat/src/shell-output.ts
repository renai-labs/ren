export * as ShellOutput from "./shell-output.js"

import type { Shell } from "@ren/schema/shell"
import { Effect, Option, Stream } from "effect"

export const tailBytes = 64 * 1024

export const progressLimit = 32

export const pollInterval = "1 second"

interface Progress {
  readonly cursor: number
  readonly output: string
  readonly state: "partial" | "complete" | "missing"
}

export interface Follow<E> {
  readonly id: string
  readonly running: boolean
  readonly load: (cursor: number) => Effect.Effect<Option.Option<Shell.Output>, E>
}

export const make = () => {
  const progress = new Map<string, Progress>()

  const remember = (id: string, entry: Progress) => {
    progress.delete(id)
    progress.set(id, entry)
    const oldest = progress.keys().next().value
    if (progress.size > progressLimit && oldest) progress.delete(oldest)
  }

  const follow = <E>(input: Follow<E>): Stream.Stream<string> =>
    Stream.suspend(() => {
      const cached = progress.get(input.id)
      if (cached) remember(input.id, cached)
      const head = cached ? Stream.make(cached.output) : Stream.empty
      if (cached?.state === "missing" || (cached?.state === "complete" && !input.running)) return head
      const position = cached
        ? { cursor: cached.cursor, output: cached.output, missing: false }
        : { cursor: 0, output: "", missing: false }
      const page = (): Effect.Effect<ReadonlyArray<string>> =>
        input.load(position.cursor).pipe(
          Effect.map((loaded) => ({ loaded })),
          Effect.catch(() => Effect.succeed(undefined)),
          Effect.flatMap((result) => {
            if (!result) return Effect.succeed([])
            if (Option.isNone(result.loaded)) {
              position.missing = true
              remember(input.id, { cursor: position.cursor, output: position.output, state: "missing" })
              return Effect.succeed([])
            }
            const read = result.loaded.value
            const advanced = read.cursor > position.cursor
            position.cursor = Math.max(position.cursor, read.cursor)
            position.output = (position.output + read.output).slice(-tailBytes)
            const complete = !input.running && position.cursor >= read.size
            remember(input.id, {
              cursor: position.cursor,
              output: position.output,
              state: complete ? "complete" : "partial",
            })
            if (input.running || complete || !advanced) return Effect.succeed([position.output])
            return Effect.map(page(), (more) => [position.output, ...more])
          }),
        )
      const reads = input.running
        ? Stream.tick(pollInterval).pipe(
            Stream.mapEffect(page),
            Stream.takeWhile(() => !position.missing),
          )
        : Stream.fromEffect(page())
      return Stream.concat(head, reads.pipe(Stream.flatMap(Stream.fromIterable)))
    })

  return { follow }
}

export type ShellOutput = ReturnType<typeof make>
