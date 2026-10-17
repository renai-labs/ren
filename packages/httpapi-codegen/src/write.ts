export * as Write from "./write.js"

import { isAbsolute, join } from "node:path"
import { Effect, FileSystem, PlatformError, Schema } from "effect"
import { format } from "prettier"
import { Errors } from "./errors.js"
import type { Types } from "./types.js"

const Manifest = Schema.fromJsonString(Schema.Array(Schema.String))
const manifestName = ".httpapi-codegen.json"

function isSafeOutputPath(path: string) {
  return path !== manifestName && !isAbsolute(path) && path !== "." && path !== ".." && !/[\\/]/.test(path)
}

export function write(
  output: Types.Output,
  directory: string,
): Effect.Effect<void, Errors.GenerationError | PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const paths = new Set<string>()
    const normalizedPaths = new Set<string>()
    for (const file of output.files) {
      if (!isSafeOutputPath(file.path))
        yield* new Errors.GenerationError({ reason: `Unsafe output path: ${file.path}` })
      const path = file.path.toLowerCase()
      if (normalizedPaths.has(path)) {
        yield* new Errors.GenerationError({ reason: `Duplicate output path: ${file.path}` })
      }
      normalizedPaths.add(path)
      paths.add(file.path)
    }
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(directory, { recursive: true })
    const manifest = join(directory, manifestName)
    const previous = (yield* fs.exists(manifest))
      ? yield* fs.readFileString(manifest).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Manifest)),
          Effect.mapError(() => new Errors.GenerationError({ reason: `Invalid generated file manifest: ${manifest}` })),
        )
      : []
    if (previous.some((path) => !isSafeOutputPath(path))) {
      yield* new Errors.GenerationError({ reason: `Invalid generated file manifest: ${manifest}` })
    }
    yield* Effect.forEach(
      previous.filter((path) => !paths.has(path)),
      (path) => fs.remove(join(directory, path), { force: true }),
      { concurrency: 8, discard: true },
    )
    yield* Effect.forEach(
      output.files,
      (file) =>
        fs.exists(join(directory, file.path)).pipe(
          Effect.flatMap((exists) => (exists ? fs.stat(join(directory, file.path)) : Effect.undefined)),
          Effect.flatMap((info) =>
            info?.type === "SymbolicLink"
              ? new Errors.GenerationError({ reason: `Unsafe output path: ${file.path}` })
              : Effect.void,
          ),
        ),
      { concurrency: 8, discard: true },
    )
    yield* Effect.forEach(
      output.files,
      (file) =>
        Effect.tryPromise({
          try: () => format(file.content, { filepath: file.path, parser: "typescript", semi: false, printWidth: 120 }),
          catch: (error) => new Errors.GenerationError({ reason: `Failed to format ${file.path}: ${String(error)}` }),
        }).pipe(Effect.flatMap((content) => fs.writeFileString(join(directory, file.path), content))),
      { concurrency: 8, discard: true },
    )
    // oxlint-disable-next-line ren/no-comments -- The manifest must use the repo-wide prettier settings so `check:generated` stays clean after the generate bot reformats the tree.
    const manifestJson = JSON.stringify(output.files.map((file) => file.path).toSorted())
    const manifestContent = yield* Effect.tryPromise({
      try: () => format(manifestJson, { filepath: manifest, parser: "json", printWidth: 120 }),
      catch: (error) => new Errors.GenerationError({ reason: `Failed to format ${manifest}: ${String(error)}` }),
    })
    yield* fs.writeFileString(manifest, manifestContent)
  })
}
