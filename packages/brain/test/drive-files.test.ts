import { expect } from "bun:test"
import { TestEnvironment, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { EnvironmentClient } from "@ren/environment-api/environment-client"
import { EnvironmentConnections } from "../src/environment/connections.js"
import { DriveFiles } from "../src/reference/drive-files.js"
import { TestAccess } from "./lib/access.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const it = testEffect(TestEnvironment.layer({ environmentId, workspace }))

const long = Array.from({ length: 900_000 }, (_, line) => `${String(line).padStart(9, "0")}\n`).join("")

const pdf = (bytes: number) => new Uint8Array([...new TextEncoder().encode("%PDF-1.7\n"), ...new Uint8Array(bytes)])

const driveOf = Effect.fnUntraced(function* (files: Readonly<Record<string, string | Uint8Array>>) {
  const sessionId = Session.ID.create()
  const root = join(workspace, sessionId, "drive")
  yield* Effect.promise(() =>
    Promise.all(
      Object.entries(files).map(async ([path, body]) => {
        await mkdir(dirname(join(root, path)), { recursive: true })
        await Bun.write(join(root, path), body)
      }),
    ),
  )
  const access = yield* Effect.flatMap(TestEnvironment.url, (url) =>
    TestEnvironment.access({
      url,
      environmentId,
      brain: Brain.ofSession(sessionId),
      directory: join(workspace, sessionId),
      generation: 1,
    }),
  )
  const context = yield* Layer.build(TestAccess.memory(new Map([[sessionId, access]])))
  const connections = Context.get(
    yield* Layer.build(
      EnvironmentConnections.layer.pipe(
        Layer.provide(Layer.succeedContext(context)),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
    EnvironmentConnections.Service,
  )
  const connected = <A, E>(use: (client: EnvironmentClient.Client) => Effect.Effect<A, E>) =>
    connections.connect(sessionId).pipe(
      Effect.flatMap((connection) => use(connection.client)),
      Effect.scoped,
    )
  return {
    root,
    sessionId,
    attach: (attached: ReadonlyArray<Session.DriveFile>) =>
      connected((client) => DriveFiles.attach(client, root, attached)),
    show: (source: string) => connected((client) => DriveFiles.show(client, root, sessionId, source)),
  }
})

it.live(
  "an image of at most 10 MB, and a text file or a PDF of at most 5 MB, come with their bytes; a larger file or a zip comes only with its path",
  () =>
    Effect.gen(function* () {
      const folder = "chats/ses_1/uploads/msg_1"
      const photo = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Uint8Array(9_000_000).fill(7)])
      const drive = yield* driveOf({
        [`${folder}/shot.png`]: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]),
        [`${folder}/photo.png`]: photo,
        [`${folder}/page.html`]: "<p>hi</p>",
        [`${folder}/small.pdf`]: pdf(10),
        [`${folder}/large.pdf`]: pdf(6_000_000),
        [`${folder}/report.zip`]: new Uint8Array([80, 75, 3, 4]),
        [`${folder}/big.txt`]: long,
      })
      const attached = yield* drive.attach(
        ["shot.png", "photo.png", "page.html", "small.pdf", "large.pdf", "report.zip", "big.txt"].map((name) => ({
          path: `${folder}/${name}`,
          name,
        })),
      )
      expect(attached.map((each) => [each.file.name, each.file.mime, Option.isSome(each.bytes)])).toEqual([
        ["shot.png", "image/png", true],
        ["photo.png", "image/png", true],
        ["page.html", "text/html", true],
        ["small.pdf", "application/pdf", true],
        ["large.pdf", "application/pdf", false],
        ["report.zip", "application/zip", false],
        ["big.txt", "text/plain", false],
      ])
      expect(attached.map((each) => each.file.size)).toEqual([10, photo.length, 9, 19, 6_000_009, 4, long.length])
      expect(attached.at(1)?.bytes).toEqual(Option.some(photo))
      expect(attached.at(2)?.bytes.pipe(Option.map((bytes) => new TextDecoder().decode(bytes)))).toEqual(
        Option.some("<p>hi</p>"),
      )
    }),
)

it.live("a file that is not in the drive refuses the message, with its name", () =>
  Effect.gen(function* () {
    const drive = yield* driveOf({ "notes.md": "hi" })
    const refused = yield* Effect.flip(
      drive.attach([
        { path: "notes.md", name: "notes.md" },
        { path: "chats/ses_1/uploads/msg_1/gone.pdf", name: "gone.pdf" },
      ]),
    )
    expect(refused).toMatchObject({ _tag: "DriveFiles.Refused" })
    expect(refused.message).toContain("gone.pdf")
  }),
)

it.live(
  "show copies a file into the chat's outputs in the drive and gives its drive path; a file already there stays, a missing one is refused",
  () =>
    Effect.gen(function* () {
      const drive = yield* driveOf({})
      const made = join(workspace, drive.sessionId, "report.pdf")
      yield* Effect.promise(() => Bun.write(made, pdf(10)))
      const shown = yield* drive.show(made)
      const path = `chats/${drive.sessionId}/outputs/report.pdf`
      expect(shown).toEqual({ path, name: "report.pdf", mime: "application/pdf", size: 19 })
      expect(yield* Effect.promise(() => Bun.file(join(drive.root, path)).bytes())).toEqual(pdf(10))
      expect(yield* drive.show(join(drive.root, path))).toEqual(shown)
      const missing = yield* Effect.flip(drive.show(join(workspace, drive.sessionId, "gone.png")))
      expect(missing).toMatchObject({ _tag: "DriveFiles.Refused" })
      expect(missing.message).toContain("gone.png")
    }),
)
