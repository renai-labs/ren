export * as RenReferences from "./references.js"

import { AbsolutePath } from "@opencode/client/effect"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import type { Reference } from "@ren/schema/reference"
import type { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import { RenWorkspaceDriver } from "./workspace-driver.js"

export interface Prepared {
  readonly reference: Reference.Info
  readonly path: AbsolutePath
}

export const prepare = (sessionId: string, references: Reference.List) =>
  Effect.forEach(references, (reference) =>
    Effect.promise(async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify([reference.repository, reference.branch])),
      )
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
      return { reference, path: AbsolutePath.make(`/tmp/ren-references/${sessionId}/${hash}`) }
    }),
  )

export const materialize = Effect.fn("RenReferences.materialize")(function* (
  connections: EnvironmentConnections.Interface,
  sessionId: Session.ID,
  references: ReadonlyArray<Prepared>,
) {
  const environment = RenWorkspaceDriver.session(connections, sessionId)
  yield* Effect.forEach(
    references,
    (entry) =>
      Effect.gen(function* () {
        const exists = yield* environment.overrides.stat(`${entry.path}/.git`).pipe(
          Effect.retry({
            times: 1,
            while: (error) =>
              error._tag === "Environment.Failed" && Boolean(EnvironmentConnections.failureOf(error.cause)),
          }),
          Effect.as(true),
          Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
        )
        if (exists) return
        yield* environment.overrides.mkdir(`/tmp/ren-references/${sessionId}`)
        const partial = `${entry.path}.partial`
        yield* environment.overrides.remove(partial)
        const code = yield* environment.spawner.exitCode(
          ChildProcess.make(
            "git",
            [
              "clone",
              "--quiet",
              ...(entry.reference.branch ? ["--branch", entry.reference.branch] : []),
              "--",
              entry.reference.repository,
              partial,
            ],
            { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
          ),
        )
        if (code !== 0)
          return yield* Effect.fail(
            new Error(`Could not clone reference ${entry.reference.alias}: git exited with ${code}`),
          )
        yield* environment.overrides.move(partial, entry.path)
      }),
    { discard: true },
  )
})
