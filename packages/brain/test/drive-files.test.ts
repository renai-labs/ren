import { expect } from "bun:test"
import { TestHand, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { HandClient } from "@ren/hand-api/hand-client"
import { HandConnections } from "../src/hand/connections.js"
import { DriveFiles } from "../src/reference/drive-files.js"
import { TestAccess } from "./lib/access.js"

const environmentId = Hand.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const it = testEffect(TestHand.layer({ environmentId, workspace }))

const long = Array.from({ length: 1_200_000 }, (_, line) => `${String(line).padStart(9, "0")}\n`).join("")

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
  const access = yield* Effect.flatMap(TestHand.url, (url) =>
    TestHand.access({
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
      HandConnections.layer.pipe(Layer.provide(Layer.succeedContext(context)), Layer.provide(FetchHttpClient.layer)),
    ),
    HandConnections.Service,
  )
  const connected = <A, E>(use: (client: HandClient.Client) => Effect.Effect<A, E>) =>
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
    publishPage: (source: string, title?: string) =>
      connected((client) => DriveFiles.publishPage(client, root, sessionId, source, title)),
  }
})

it.live(
  "an image of at most 20 MiB, and a PDF or a text file of at most 10 MiB, come with their bytes; a larger file or a zip comes only with its path",
  () =>
    Effect.gen(function* () {
      const folder = "chats/ses_1/uploads/msg_1"
      const photo = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Uint8Array(9_000_000).fill(7)])
      const drive = yield* driveOf({
        [`${folder}/shot.png`]: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]),
        [`${folder}/photo.png`]: photo,
        [`${folder}/page.html`]: "<p>hi</p>",
        [`${folder}/small.pdf`]: pdf(10),
        [`${folder}/large.pdf`]: pdf(11_000_000),
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
      expect(attached.map((each) => each.file.size)).toEqual([10, photo.length, 9, 19, 11_000_009, 4, long.length])
      expect(attached.at(1)?.bytes).toEqual(Option.some(photo))
      expect(attached.at(2)?.bytes.pipe(Option.map((bytes) => new TextDecoder().decode(bytes)))).toEqual(
        Option.some("<p>hi</p>"),
      )
    }),
)

it.live("the files of one message come with their bytes up to 20 MiB in all; the rest come only with their path", () =>
  Effect.gen(function* () {
    const folder = "chats/ses_1/uploads/msg_2"
    const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Uint8Array(12_000_000)])
    const drive = yield* driveOf({ [`${folder}/one.png`]: image, [`${folder}/two.png`]: image })
    const attached = yield* drive.attach(["one.png", "two.png"].map((name) => ({ path: `${folder}/${name}`, name })))
    expect(attached.map((each) => [each.file.name, Option.isSome(each.bytes)])).toEqual([
      ["one.png", true],
      ["two.png", false],
    ])
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

it.live("publishPage inlines the page's local images, styles and scripts and writes it to the drive", () =>
  Effect.gen(function* () {
    const drive = yield* driveOf({})
    const folder = join(workspace, drive.sessionId, "report")
    yield* Effect.promise(async () => {
      await mkdir(join(folder, "img"), { recursive: true })
      await Bun.write(join(folder, "img/dot.png"), new Uint8Array([137, 80, 78, 71]))
      await Bun.write(join(folder, "style.css"), "body{color:red}")
      await Bun.write(join(folder, "app.js"), "window.ok=1")
      await Bun.write(
        join(folder, "index.html"),
        '<html><head><title> Q3 </title><link rel="stylesheet" href="style.css"><script src="app.js"></script></head><body><img src="img/dot.png"><img src="https://example.com/x.png"></body></html>',
      )
    })
    const page = yield* drive.publishPage(join(folder, "index.html"))
    expect(page).toMatchObject({ title: "Q3" })
    expect(page.path).toMatch(new RegExp(`^chats/${drive.sessionId}/pages/[^/]+\\.html$`))
    const html = yield* Effect.promise(() => Bun.file(join(drive.root, page.path)).text())
    expect(html).toContain("<style>body{color:red}</style>")
    expect(html).toContain("<script>window.ok=1</script>")
    expect(html).toContain('src="data:image/png;base64,iVBORw=="')
    expect(html).toContain('src="https://example.com/x.png"')
    expect(page.bytes).toBe(new TextEncoder().encode(html).length)
    expect((yield* drive.publishPage(join(folder, "index.html"), "Revenue")).title).toBe("Revenue")
  }),
)

it.live("publishPage refuses a page over 5 MB and a file that is not HTML", () =>
  Effect.gen(function* () {
    const drive = yield* driveOf({})
    const folder = join(workspace, drive.sessionId)
    yield* Effect.promise(async () => {
      await Bun.write(join(folder, "big.html"), `<p>${"x".repeat(5_300_000)}</p>`)
      await Bun.write(join(folder, "small.html"), '<img src="huge.png">')
      await Bun.write(join(folder, "huge.png"), new Uint8Array(4_000_000))
      await Bun.write(join(folder, "notes.txt"), "hi")
    })
    expect((yield* Effect.flip(drive.publishPage(join(folder, "big.html")))).message).toBe(
      "Page is too large (5.1 MB, limit 5 MB)",
    )
    expect((yield* Effect.flip(drive.publishPage(join(folder, "small.html")))).message).toMatch(/^Page is too large/u)
    expect((yield* Effect.flip(drive.publishPage(join(folder, "notes.txt")))).message).toContain("not an HTML file")
  }),
)
