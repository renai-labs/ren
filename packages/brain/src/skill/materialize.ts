export * as SkillMaterialize from "./materialize.js"

import { Skill } from "@ren/schema/skill"
import { Effect, Schema } from "effect"
import type { EnvironmentSession } from "../environment/session.js"

export class Failed extends Schema.TaggedError<Failed>()("SkillMaterialize.Failed", { message: Schema.String }) {}

export interface File {
  readonly path: string
  readonly bytes: Uint8Array
}

export type Files =
  | {
      readonly type: "archive"
      readonly url: string
      readonly headers: Readonly<Record<string, string>>
      readonly folder: string
    }
  | { readonly type: "inline"; readonly files: ReadonlyArray<File> }

const isInside = Schema.is(Skill.SourceDirectory)

// oxlint-disable-next-line ren/no-comments -- The environment downloads an archive itself, so its bytes never pass through the brain. Both forms fill a staging folder that moves into place, so a folder that exists is complete.
export const ensure = Effect.fn("SkillMaterialize.ensure")(function* (
  environment: EnvironmentSession.Files,
  directory: string,
  files: Files,
) {
  const failed = (error: { readonly message: string }) =>
    new Failed({ message: `Could not put the skill’s files in ${directory}: ${error.message}` })
  if (files.type === "archive")
    return yield* environment
      .unpack({ url: files.url, headers: files.headers, folder: files.folder, path: directory })
      .pipe(Effect.mapError(failed))
  const exists = yield* environment.stat(directory).pipe(
    Effect.as(true),
    Effect.catchTag("FileNotFoundError", () => Effect.succeed(false)),
    Effect.mapError(failed),
  )
  if (exists) return
  const staging = `${directory}.${crypto.randomUUID()}.staging`
  yield* Effect.forEach(
    files.files,
    (file) =>
      isInside(file.path) && file.path !== "."
        ? environment.write(`${staging}/${file.path}`, file.bytes)
        : Effect.fail({ message: `${file.path} is not a path inside it` }),
    { discard: true },
  ).pipe(
    Effect.andThen(environment.move(staging, directory)),
    Effect.mapError(failed),
    Effect.onError(() => environment.remove(staging).pipe(Effect.ignore)),
  )
})
