import { expect } from "bun:test"
import { TestEnvironment, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EnvironmentConnections } from "../src/environment/connections.js"
import { EnvironmentCopies } from "../src/environment/copies.js"
import { SkillSource } from "../src/skill/source.js"
import { TestAccess } from "./lib/access.js"
import { TestGitHub } from "./lib/github.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const it = testEffect(TestEnvironment.layer({ environmentId, workspace }))

const encoder = new TextEncoder()

const copiesOf = Effect.fnUntraced(function* () {
  const sessionId = Session.ID.create()
  const directory = join(workspace, sessionId)
  const accessOf = (generation: number) =>
    Effect.flatMap(TestEnvironment.url, (url) =>
      TestEnvironment.access({ url, environmentId, brain: Brain.ofSession(sessionId), directory, generation }),
    )
  const context = yield* Layer.build(TestAccess.memory(new Map([[sessionId, yield* accessOf(1)]])))
  const connections = Context.get(
    yield* Layer.build(
      EnvironmentConnections.layer.pipe(
        Layer.provide(Layer.succeedContext(context)),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
    EnvironmentConnections.Service,
  )
  return {
    directory,
    copies: EnvironmentCopies.make(connections, sessionId),
    replace: (generation: number) =>
      Effect.flatMap(accessOf(generation), (access) =>
        Context.get(context, TestAccess.Memory).set(sessionId, access),
      ).pipe(Effect.andThen(connections.release(sessionId))),
  }
})

const inline = (path: string, files: Readonly<Record<string, string>>): EnvironmentCopies.Item => ({
  path,
  copy: {
    type: "inline",
    files: Object.keys(files).map((file) => ({ path: file, bytes: encoder.encode(files[file] ?? "") })),
  },
})

const read = (path: string) => Effect.promise(() => Bun.file(path).text())

const exists = (path: string) => Effect.promise(() => Bun.file(path).exists())

it.live("puts inline files on the environment once, and a copy that fails leaves nothing behind", () =>
  Effect.gen(function* () {
    const session = yield* copiesOf()
    const target = join(session.directory, ".ren", "skills", "forms", "r1")
    const escaping = inline(target, { "SKILL.md": "body", "../escaped.txt": "x" })
    expect(yield* session.copies.ensure([escaping])).toEqual([
      { item: escaping, message: "../escaped.txt is not a path inside it" },
    ])
    expect(yield* Effect.promise(() => readdir(join(session.directory, ".ren", "skills", "forms")))).toEqual([])
    expect(yield* session.copies.ensure([inline(target, { "scripts/fill.sh": "echo 1\n", "empty.txt": "" })])).toEqual(
      [],
    )
    yield* session.copies.turnStarted
    yield* session.copies.ensure([inline(target, { "scripts/fill.sh": "echo 2\n" })])
    expect([yield* read(join(target, "scripts/fill.sh")), yield* read(join(target, "empty.txt"))]).toEqual([
      "echo 1\n",
      "",
    ])
  }),
)

it.live("the environment downloads a private GitHub skill's folder at its commit itself", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make({ isPrivate: true })
    const first = yield* github.commit({
      "skills/pdf/SKILL.md": "first",
      "skills/pdf/scripts/fill.py": "print('first')\n",
      "README.md": "repository",
    })
    yield* github.commit({ "skills/pdf/scripts/fill.py": "print('second')\n" })
    const source = SkillSource.make(yield* TestGitHub.hostsOf(github))
    const resolved = yield* source.resolve({ url: github.url, path: "skills/pdf", ref: first })
    const session = yield* copiesOf()
    const target = join(session.directory, ".ren", "skills", "pdf", first.slice(0, 12))
    yield* session.copies.ensure([
      { path: target, copy: { type: "archive", unpack: { ...resolved.lookup.archive, folder: "skills/pdf" } } },
    ])
    expect(yield* read(join(target, "scripts/fill.py"))).toBe("print('first')\n")
    expect(yield* Effect.promise(() => readdir(target))).toEqual(expect.arrayContaining(["SKILL.md", "scripts"]))
    expect(yield* exists(join(target, "README.md"))).toBe(false)
  }),
)

it.live(
  "one copy that fails among several returns its failure, the others copy, and the next call tries it again",
  () =>
    Effect.gen(function* () {
      const github = yield* TestGitHub.make()
      const main = yield* github.commit({ "guide.md": "main" })
      const release = yield* github.commit({ "guide.md": "release" }, "release")
      const hosts = yield* TestGitHub.hostsOf(github)
      const session = yield* copiesOf()
      const itemOf = Effect.fnUntraced(function* (ref: string) {
        const lookup = yield* hosts.lookup(github.url, ref)
        return {
          path: join(session.directory, "..", ".ren", "references", ref),
          copy: { type: "archive" as const, unpack: { ...lookup.archive, folder: "." } },
        }
      })
      const first = yield* itemOf(main)
      const second = yield* itemOf(release)
      const items = [first, second]
      yield* github.breakArchive(release)
      const failures = yield* session.copies.ensure(items)
      expect(failures.map((failure) => [failure.item.path, failure.message])).toEqual([
        [second.path, "The archive answered 503"],
      ])
      expect(yield* read(join(first.path, "guide.md"))).toBe("main")
      yield* github.breakArchive(undefined)
      const before = (yield* github.requests).length
      expect(yield* session.copies.ensure(items)).toEqual([])
      expect((yield* github.requests).slice(before).filter((request) => request.includes("/tarball/"))).toHaveLength(1)
      expect(yield* read(join(second.path, "guide.md"))).toBe("release")
    }),
)

it.live("a mount on an environment that cannot mount fails at once, and is tried again at the next turn", () =>
  Effect.gen(function* () {
    const session = yield* copiesOf()
    const item: EnvironmentCopies.Item = {
      path: join(session.directory, ".ren", "drives", "space"),
      copy: {
        type: "mount",
        remote: {
          type: "s3",
          bucket: "drives",
          prefix: "org_1/drives/org/",
          region: "us-east-1",
          endpoint: "http://127.0.0.1:1",
          placeholder: "ren:DRIVE",
        },
      },
    }
    const failure = { item, message: "its environment has no rclone or no usable /dev/fuse" }
    expect(yield* session.copies.ensure([item])).toEqual([failure])
    expect(yield* session.copies.ensure([item])).toEqual([])
    yield* session.copies.turnStarted
    expect(yield* session.copies.ensure([item])).toEqual([failure])
  }),
)

it.live("a copy that a chat deletes comes back after turnStarted and for a new generation, not before", () =>
  Effect.gen(function* () {
    const session = yield* copiesOf()
    const target = join(session.directory, ".ren", "skills", "notes", "r1")
    const item = inline(target, { "notes.md": "notes" })
    yield* session.copies.ensure([item])
    const removed = Effect.promise(() => rm(target, { recursive: true, force: true }))
    yield* removed
    yield* session.copies.ensure([item])
    expect(yield* exists(join(target, "notes.md"))).toBe(false)
    yield* session.copies.turnStarted
    yield* session.copies.ensure([item])
    expect(yield* read(join(target, "notes.md"))).toBe("notes")
    yield* removed
    yield* session.replace(2)
    yield* session.copies.ensure([item])
    expect(yield* read(join(target, "notes.md"))).toBe("notes")
  }),
)
