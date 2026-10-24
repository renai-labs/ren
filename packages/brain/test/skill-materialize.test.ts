import { expect } from "bun:test"
import { TestEnvironment, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { mkdtemp, readdir, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EnvironmentConnections } from "../src/environment/connections.js"
import { EnvironmentSession } from "../src/environment/session.js"
import { SkillMaterialize } from "../src/skill/materialize.js"
import { SkillSource } from "../src/skill/source.js"
import { TestAccess } from "./lib/access.js"
import { TestGitHub } from "./lib/github.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const it = testEffect(TestEnvironment.layer({ environmentId, workspace }))

const encoder = new TextEncoder()

const sessionFiles = Effect.fnUntraced(function* () {
  const sessionId = Session.ID.create()
  const directory = join(workspace, sessionId)
  const access = yield* TestEnvironment.access({
    url: yield* TestEnvironment.url,
    environmentId,
    brain: Brain.ofSession(sessionId),
    directory,
  })
  const connections = Context.get(
    yield* Layer.build(
      EnvironmentConnections.layer.pipe(
        Layer.provide(TestAccess.fixed(new Map([[sessionId, access]]))),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
    EnvironmentConnections.Service,
  )
  return { directory, files: EnvironmentSession.make(connections, sessionId, (signal) => new Error(signal)).files }
})

const inline = (files: Readonly<Record<string, string>>): SkillMaterialize.Files => ({
  type: "inline",
  files: Object.keys(files).map((path) => ({ path, bytes: encoder.encode(files[path] ?? "") })),
})

const read = (path: string) => Effect.promise(() => Bun.file(path).text())

it.live("puts inline files on the environment once, and a copy that fails leaves nothing behind", () =>
  Effect.gen(function* () {
    const session = yield* sessionFiles()
    const target = join(session.directory, ".ren", "skills", "forms", "r1")
    const failed = yield* SkillMaterialize.ensure(
      session.files,
      target,
      inline({ "SKILL.md": "body", "../escaped.txt": "x" }),
    ).pipe(Effect.flip)
    expect(failed.message).toBe(`Could not put the skill’s files in ${target}: ../escaped.txt is not a path inside it`)
    expect(yield* Effect.promise(() => readdir(join(session.directory, ".ren", "skills", "forms")))).toEqual([])
    yield* SkillMaterialize.ensure(session.files, target, inline({ "scripts/fill.sh": "echo 1\n", "empty.txt": "" }))
    yield* SkillMaterialize.ensure(session.files, target, inline({ "scripts/fill.sh": "echo 2\n" }))
    expect([yield* read(join(target, "scripts/fill.sh")), yield* read(join(target, "empty.txt"))]).toEqual([
      "echo 1\n",
      "",
    ])
  }),
)

it.live("the environment downloads a GitHub skill's folder at its commit itself", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    const first = yield* github.commit({
      "skills/pdf/SKILL.md": "first",
      "skills/pdf/scripts/fill.py": "print('first')\n",
      "README.md": "repository",
    })
    yield* github.commit({ "skills/pdf/scripts/fill.py": "print('second')\n" })
    const source = yield* SkillSource.make(github.hosts).pipe(Effect.provide(FetchHttpClient.layer))
    const pointer = { url: github.url, path: "skills/pdf" }
    const session = yield* sessionFiles()
    const target = join(session.directory, ".ren", "skills", "pdf", first.slice(0, 12))
    yield* SkillMaterialize.ensure(session.files, target, {
      type: "archive",
      url: yield* source.archive(pointer, first),
      folder: pointer.path,
    })
    expect(yield* read(join(target, "scripts/fill.py"))).toBe("print('first')\n")
    expect(yield* Effect.promise(() => readdir(target))).toEqual(expect.arrayContaining(["SKILL.md", "scripts"]))
    expect(yield* Effect.promise(() => Bun.file(join(target, "README.md")).exists())).toBe(false)
  }),
)
