import { expect, setDefaultTimeout } from "bun:test"
import { TestGitHub } from "@ren/brain/testing"
import { TestEnvironment, testEffect } from "@ren/executor/testing"
import { Environment } from "@ren/schema/environment"
import type { Drive } from "@ren/schema/drive"
import type { Reference } from "@ren/schema/reference"
import { Effect, Fiber } from "effect"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReferenceChat } from "./lib/reference-chat.js"
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

const open = (github: TestGitHub.Instance, references: ReadonlyArray<Reference.Info>, drives?: Drive.Availability) =>
  Effect.flatMap(TestEnvironment.url, (url) =>
    ReferenceChat.open(
      { url, environmentId, directoryOf: (sessionId) => join(workspace, sessionId) },
      github,
      { references },
      drives,
    ),
  )

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
      "The reference release is not on the environment: The archive answered 503. The next environment tool tries again.",
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

const drivesRoot = join(workspace, ".ren", "drives")

const remote = { type: "s3", bucket: "ren-drives", region: "us-east-1", placeholder: "ren:DRIVE" } as const

const mounts: Drive.Availability = {
  type: "mounts",
  mounts: [
    {
      kind: "space",
      alias: "drive:space",
      description: "The space’s files",
      remote: { ...remote, prefix: "org_1/drives/spaces/spc_1/" },
      access: "write",
    },
    {
      kind: "org",
      alias: "drive:org",
      description: "The organization’s files",
      remote: { ...remote, prefix: "org_1/drives/org/" },
      access: "read",
    },
  ],
}

it.live("a chat whose environment cannot mount gets a note and no drive reference", () =>
  Effect.gen(function* () {
    const github = yield* fresh()
    const commit = yield* github.commit({ "guide.md": "Use the docs." })
    const chat = yield* open(github, [docsOf(github)], { type: "unavailable", reason: "no_mount" })
    const call = yield* chat.tool("read", { path: join(pathOf(github, commit), "guide.md") })
    expect(call.system).toContain(
      "The drives of this space and organization are not available in this chat: its environment cannot mount them.",
    )
    expect(call.system).not.toContain("drive:space")
    expect(call.tools).not.toContain("show_file")
  }),
)

it.live(
  "a message that attaches a drive file is refused with the reason when the chat has no drives, Ren gives it no environment, or its drive does not mount, and is not sent; with inline copies it goes with them",
  () =>
    Effect.gen(function* () {
      const github = yield* fresh()
      yield* github.commit({ "guide.md": "Use the docs." })
      const file = { path: "chats/ses_1/uploads/msg_1/a.txt", name: "a.txt" }
      const unmounted = yield* open(github, [docsOf(github)], { type: "unavailable", reason: "no_mount" })
      expect(yield* Effect.flip(unmounted.prompt([file]))).toMatchObject({
        _tag: "Harness.Rejected",
        message: "This chat cannot use the space’s drive: its environment cannot mount them.",
      })
      const copied = yield* unmounted.turn(stub.script({ reply: "Read it." }), 1, {
        files: [file, { path: "chats/ses_1/uploads/msg_1/b.zip", name: "b.zip" }],
        fallback: [{ url: "data:text/plain;base64,c2hpcCBvbiBmcmlkYXk=", name: "a.txt" }],
      })
      expect(JSON.stringify(copied.body.messages)).toContain("ship on friday")
      expect(JSON.stringify(copied.body.messages)).toContain(
        "(b.zip is in the space’s drive, which this chat cannot read.)",
      )
      const homeless = yield* open(github, [docsOf(github)], mounts)
      yield* homeless.forget
      const unplaced = yield* Effect.flip(homeless.prompt([file]))
      expect(unplaced._tag).toBe("Harness.Rejected")
      expect(unplaced.message).toContain("The space’s drive is not on the environment: No access to an environment")
      const failing = yield* open(github, [docsOf(github)], mounts)
      const refused = yield* Effect.flip(failing.prompt([file]))
      expect(refused._tag).toBe("Harness.Rejected")
      expect(refused.message).toContain("The space’s drive is not on the environment:")
      expect((yield* failing.messages).data.filter((message) => message.type === "user")).toEqual([])
    }),
)

it.live(
  "a drive is a reference at its root, a mount that fails is a note in the tool result, and writes are denied except under a writable drive",
  () =>
    Effect.gen(function* () {
      const github = yield* fresh()
      yield* github.commit({ "guide.md": "Use the docs." })
      const chat = yield* open(github, [docsOf(github)], mounts)
      const call = yield* chat.tool("shell", { command: "echo hi" })
      expect(call.system).toContain(join(drivesRoot, "space"))
      expect(call.system).toContain("The space’s files")
      expect(call.tools).toContain("show_file")
      expect(result(call)).toContain("The reference drive:space is not on the environment:")
      const write = (path: string) => chat.tool("write", { path, content: "x" }).pipe(Effect.map(result))
      expect(yield* write(join(drivesRoot, "org", "notes.md"))).toContain("is in a read-only drive")
      expect(yield* write(join(drivesRoot, "notes.md"))).toContain("is in a read-only drive")
      expect(yield* write(join(drivesRoot, "space", "notes.md"))).not.toContain("is in a read-only drive")
    }),
)
