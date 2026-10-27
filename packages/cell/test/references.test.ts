import { expect, setDefaultTimeout } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { TestAccess, TestGitHub } from "@ren/brain/testing"
import { TestEnvironment, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import type { Reference } from "@ren/schema/reference"
import { Session } from "@ren/schema/session"
import { Context, Effect, Fiber, Layer, Option } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ChatSettings } from "../src/chat-settings.js"
import { GitSources } from "../src/git-sources.js"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { RenWorkspaceDriver } from "../src/harness/opencode/workspace-driver.js"
import { ModelsTest } from "./lib/models.js"
import { TestSettings } from "./lib/settings.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"

setDefaultTimeout(30_000)

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const stub = Shared.stub()
const it = testEffect(TestEnvironment.layer({ environmentId, workspace }))
const root = join(workspace, ".ren", "references")

const pathOf = (github: TestGitHub.Instance, commit: string) =>
  join(root, "github.com", new URL(github.url).pathname.slice(1), commit.slice(0, 12))

const fresh = () => TestGitHub.make({ repo: `docs-${crypto.randomUUID().slice(0, 8)}` })

const open = Effect.fnUntraced(function* (github: TestGitHub.Instance, references: ReadonlyArray<Reference.Info>) {
  const context = yield* Layer.build(TestAccess.memory(new Map()))
  const memory = Context.get(context, TestAccess.Memory)
  const environments = Context.get(
    yield* Layer.build(
      EnvironmentConnections.layer.pipe(
        Layer.provide(Layer.succeedContext(context)),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
    EnvironmentConnections.Service,
  )
  const settings = Context.get(
    yield* Layer.build(ChatSettings.layer.pipe(Layer.provide(ModelsTest.storage()))),
    ChatSettings.Service,
  )
  yield* settings.save(TestSettings.layers({ ren: { references } }), [])
  const endpoints = Shared.access(undefined, stub.url).endpoints
  const host = yield* OpenCodeServer.make(
    (replacements) =>
      createEmbeddedRoutes(
        {
          database: { path: ":memory:" },
          config: { project: false, content: Shared.vars(stub.url).OPENCODE_CONFIG },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
        },
        [...replacements, ...RenWorkspaceDriver.replacements(environments)],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    () => Effect.succeedNone,
    Option.some(environments),
    {
      saved: Option.some(settings.saved),
      directoryOf: (sessionId) => join(workspace, sessionId),
      sources: yield* GitSources.make({ github: Effect.succeed(github.hosts), references: { refresh: 0, retry: 0 } }),
    },
  )
  const harness = yield* OpenCodeHarness.make(host, endpoints, Option.some(settings))
  const sessionId = Session.ID.create()
  const accessOf = (generation: number) =>
    Effect.flatMap(TestEnvironment.url, (url) =>
      TestEnvironment.access({
        url,
        environmentId,
        brain: Brain.ofSession(sessionId),
        directory: join(workspace, sessionId),
        generation,
      }),
    )
  yield* memory.set(sessionId, yield* accessOf(1))
  yield* harness.start({ sessionId, harness: "opencode", interactive: false, directory: join(workspace, sessionId) })
  const turn = (script: StubModel.Script, calls = 2) =>
    harness
      .send({
        sessionId,
        messageId: Session.MessageID.create(),
        prompt: { text: `${script.marker} go` },
        delivery: "steer",
        sender: { userId: "user_1" },
      })
      .pipe(
        Effect.andThen(Effect.promise(() => script.called(calls))),
        Effect.tap(() => host.client.session.wait({ sessionID: SessionID.make(sessionId) }).pipe(Effect.orDie)),
      )
  return {
    turn,
    tool: (name: string, input: unknown) => turn(stub.script({ tool: { name, input } })),
    replace: (generation: number) => Effect.flatMap(accessOf(generation), (access) => memory.set(sessionId, access)),
    read: host.client.session.get({ sessionID: SessionID.make(sessionId) }).pipe(Effect.orDie),
    pull: (next: ReadonlyArray<Reference.Info>) =>
      Effect.gen(function* () {
        yield* settings.save(TestSettings.layers({ ren: { references: next } }), [])
        yield* harness.configure({
          settings: { layers: yield* settings.layers, chats: [{ id: sessionId, agent: null, archived: false }] },
        })
        yield* Shared.appsSettled(harness)
      }),
  }
})

const result = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

const docsOf = (github: TestGitHub.Instance): Reference.Info => ({
  alias: "docs",
  repository: github.url,
  description: "Product docs",
})

it.live("a chat reads a file of a public reference with the read tool, at a path with the commit", () =>
  Effect.gen(function* () {
    const github = yield* fresh()
    const commit = yield* github.commit({ "guide.md": "Use the docs." })
    const chat = yield* open(github, [docsOf(github)])
    const call = yield* chat.tool("read", { path: join(pathOf(github, commit), "guide.md") })
    expect(call.system).toContain(pathOf(github, commit))
    expect(call.system).toContain("Product docs")
    expect(call.system).toContain(
      "A reference is a copy of a GitHub archive: it has no submodules, no Git LFS file contents, no symlinks and no files marked export-ignore.",
    )
    expect(result(call)).toContain("Use the docs.")
    expect((yield* github.requests).filter((request) => request.startsWith("/api/repos/"))).toHaveLength(1)
  }),
)

it.live("a private reference without an egress is listed as not available, and a public one still reads", () =>
  Effect.gen(function* () {
    const github = yield* fresh()
    const commit = yield* github.commit({ "guide.md": "Use the docs." })
    yield* github.answer("no_egress")
    const secret = { alias: "secret", repository: "https://github.com/acme/secret", description: "Secret docs" }
    const chat = yield* open(github, [docsOf(github), secret])
    const call = yield* chat.tool("read", { path: join(pathOf(github, commit), "guide.md") })
    expect(call.system).toContain(
      "The reference secret (acme/secret) is not available: this runtime has no egress, so Ren cannot read private repositories here, or acme/secret does not exist.",
    )
    expect(call.system).not.toContain("Secret docs")
    expect(result(call)).toContain("Use the docs.")
  }),
)

it.live("after Ren gives the chat a new environment, the next environment tool unpacks the references again", () =>
  Effect.gen(function* () {
    const github = yield* fresh()
    const commit = yield* github.commit({ "guide.md": "Use the docs." })
    const chat = yield* open(github, [docsOf(github)])
    const file = join(pathOf(github, commit), "guide.md")
    expect(result(yield* chat.tool("read", { path: file }))).toContain("Use the docs.")
    yield* Effect.promise(() => rm(root, { recursive: true, force: true }))
    yield* chat.replace(2)
    expect(result(yield* chat.tool("shell", { command: `cat ${file}` }))).toContain("Use the docs.")
    expect((yield* github.requests).filter((request) => request.startsWith("/api/repos/"))).toHaveLength(2)
  }),
)

it.live("a branch that moves gives a new path at the next turn, and the old path still reads", () =>
  Effect.gen(function* () {
    const github = yield* fresh()
    const first = yield* github.commit({ "guide.md": "first" })
    const chat = yield* open(github, [docsOf(github)])
    expect(result(yield* chat.tool("read", { path: join(pathOf(github, first), "guide.md") }))).toContain("first")
    const second = yield* github.commit({ "guide.md": "second" })
    const call = yield* chat.tool("shell", {
      command: `cat ${join(pathOf(github, second), "guide.md")} ${join(pathOf(github, first), "guide.md")}`,
    })
    expect(JSON.stringify(call.body.messages)).toContain("project references have changed")
    expect(JSON.stringify(call.body.messages)).toContain(pathOf(github, second))
    expect(result(call)).toContain("secondfirst")
  }),
)

it.live("a chat cannot write under the references", () =>
  Effect.gen(function* () {
    const github = yield* fresh()
    const commit = yield* github.commit({ "guide.md": "Use the docs." })
    const chat = yield* open(github, [docsOf(github)])
    const file = join(pathOf(github, commit), "guide.md")
    expect(result(yield* chat.tool("write", { path: file, content: "changed" }))).toContain(
      "is a read-only copy of a reference",
    )
    expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("Use the docs.")
  }),
)

// oxlint-disable-next-line ren/no-comments -- The 10 s limit is below the 15 s limit of a lookup: an update that waited for GitHub would fail it.
it.live(
  "a settings change ends while GitHub holds the lookup of a new reference, and the next turn lists it",
  () =>
    Effect.gen(function* () {
      const github = yield* fresh()
      yield* github.commit({ "guide.md": "main" })
      const release = yield* github.commit({ "guide.md": "release" }, "release")
      const chat = yield* open(github, [docsOf(github)])
      yield* chat.turn(stub.script(), 1)
      yield* github.hold
      yield* chat.pull([
        docsOf(github),
        { alias: "release", repository: github.url, branch: "release", description: "Release docs" },
      ])
      yield* github.arrived
      yield* github.release
      const call = yield* chat.tool("read", { path: join(pathOf(github, release), "guide.md") })
      expect(JSON.stringify(call.body.messages)).toContain(pathOf(github, release))
      expect(result(call)).toContain("release")
    }),
  10_000,
)

// oxlint-disable-next-line ren/no-comments -- The 10 s limit is below the 15 s limit of a lookup: a chat that waited for GitHub at load would fail it.
it.live(
  "a chat opens and answers while GitHub holds the lookup, and the first prompt waits for it",
  () =>
    Effect.gen(function* () {
      const github = yield* fresh()
      const commit = yield* github.commit({ "guide.md": "Use the docs." })
      yield* github.hold
      const chat = yield* open(github, [docsOf(github)])
      yield* github.arrived
      yield* chat.read
      const first = yield* Effect.forkChild(chat.tool("read", { path: join(pathOf(github, commit), "guide.md") }))
      yield* github.release
      const call = yield* Fiber.join(first)
      expect(call.system).toContain(pathOf(github, commit))
      expect(result(call)).toContain("Use the docs.")
    }),
  10_000,
)

it.live("a reference that cannot be copied leaves the tool working with its cause, and the next tool copies it", () =>
  Effect.gen(function* () {
    const github = yield* fresh()
    const commit = yield* github.commit({ "guide.md": "main" })
    const release = yield* github.commit({ "guide.md": "release" }, "release")
    const chat = yield* open(github, [
      docsOf(github),
      { alias: "release", repository: github.url, branch: "release", description: "Release docs" },
    ])
    yield* github.breakArchive(release)
    const call = yield* chat.tool("read", { path: join(pathOf(github, commit), "guide.md") })
    expect(result(call)).toContain("main")
    expect(result(call)).toContain(
      "The reference release is not on the environment: The archive answered 503. The next environment tool copies it again.",
    )
    yield* github.breakArchive(undefined)
    expect(result(yield* chat.tool("read", { path: join(pathOf(github, release), "guide.md") }))).toContain("release")
  }),
)

it.live("files deleted under the root come back at the next turn", () =>
  Effect.gen(function* () {
    const github = yield* fresh()
    const commit = yield* github.commit({ "guide.md": "Use the docs." })
    const chat = yield* open(github, [docsOf(github)])
    const file = join(pathOf(github, commit), "guide.md")
    expect(result(yield* chat.tool("read", { path: file }))).toContain("Use the docs.")
    yield* Effect.promise(() => rm(root, { recursive: true, force: true }))
    expect(result(yield* chat.tool("read", { path: file }))).toContain("Use the docs.")
  }),
)
