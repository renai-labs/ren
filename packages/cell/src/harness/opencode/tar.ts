export * as Tar from "./tar.js"

import { Clock, Effect, Predicate, Schema } from "effect"

class PathTooLong extends Schema.TaggedError<PathTooLong>()("Tar.PathTooLong", { path: Schema.String }) {
  override get message() {
    return `The path ${this.path} is too long for an archive.`
  }
}

const encoder = new TextEncoder()

const slash = 47

export const gzip = Effect.fn("Tar.gzip")(function* (folder: string, files: Readonly<Record<string, string>>) {
  const modified = `${Math.floor((yield* Clock.currentTimeMillis) / 1000)
    .toString(8)
    .padStart(11, "0")}\0`
  const blocks = yield* Effect.forEach(Object.keys(files), (name) =>
    Effect.gen(function* () {
      const path = encoder.encode(`${folder}/${name}`)
      const body = encoder.encode(files[name] ?? "")
      const split = [...path.keys()].findLast(
        (index) => path.at(index) === slash && index <= 155 && path.length - index - 1 <= 100,
      )
      if (path.length > 100 && Predicate.isUndefined(split)) return yield* new PathTooLong({ path: name })
      const header = new Uint8Array(512)
      const field = (offset: number, value: Uint8Array | string) =>
        header.set(Predicate.isString(value) ? encoder.encode(value) : value, offset)
      field(0, path.length > 100 ? path.subarray((split ?? 0) + 1) : path)
      field(100, "0000644\0")
      field(108, "0000000\0")
      field(116, "0000000\0")
      field(124, `${body.length.toString(8).padStart(11, "0")}\0`)
      field(136, modified)
      field(148, "        ")
      field(156, "0")
      field(257, "ustar\0")
      field(263, "00")
      if (path.length > 100) field(345, path.subarray(0, split))
      field(
        148,
        `${header
          .reduce((sum, byte) => sum + byte, 0)
          .toString(8)
          .padStart(6, "0")}\0 `,
      )
      return [header, body, new Uint8Array((512 - (body.length % 512)) % 512)]
    }),
  )
  const archive = new Blob([...blocks.flat(), new Uint8Array(1024)])
  return yield* Effect.promise(() => new Response(archive.stream().pipeThrough(new CompressionStream("gzip"))).bytes())
})
