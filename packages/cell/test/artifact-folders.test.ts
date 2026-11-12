import { expect, setDefaultTimeout } from "bun:test"
import { TestGitHub } from "@ren/brain/testing"
import { TestHand, testEffect } from "@ren/executor/testing"
import { Hand } from "@ren/schema/hand"
import { Effect, Option } from "effect"
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReferenceChat } from "./lib/reference-chat.js"
import { FakeRen } from "./lib/ren.js"

setDefaultTimeout(60_000)

const environmentId = Hand.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const it = testEffect(TestHand.layer({ environmentId, workspace }))

it.live(
  "a chat publishes a folder with binary files from its environment and reads it back byte for byte, and the executor unpacks the cell's own archive of inline files",
  () =>
    Effect.gen(function* () {
      const ren = yield* Effect.acquireRelease(
        Effect.sync(() => FakeRen.start()),
        (fake) => Effect.promise(() => fake.stop()),
      )
      const github = yield* TestGitHub.make({ repo: `docs-${crypto.randomUUID().slice(0, 8)}` })
      const chat = yield* Effect.flatMap(TestHand.url, (url) =>
        ReferenceChat.open(
          { url, environmentId, directoryOf: (sessionId) => join(workspace, sessionId) },
          github,
          [],
          undefined,
          {
            ren: {
              address: Effect.succeed(Option.some(ren.url)),
              token: Effect.promise(() => FakeRen.hostToken()).pipe(Effect.map(Option.some)),
            },
          },
        ),
      )
      const folder = join(workspace, chat.sessionId)
      const logo = crypto.getRandomValues(new Uint8Array(512 * 1024))
      const font = new Uint8Array([0, 1, 0, 0, 0, 255, 254])
      yield* Effect.promise(async () => {
        await mkdir(join(folder, "site/fonts"), { recursive: true })
        await writeFile(join(folder, "site/index.html"), '<img src="logo.png">')
        await writeFile(join(folder, "site/logo.png"), logo)
        await writeFile(join(folder, "site/fonts/inter.woff2"), font)
      })
      yield* chat.tool("execute", {
        code: 'return await tools.opencode.artifact_create({ title: "Site", directory: "site" })',
      })
      const published = [...ren.artifacts.values()]
      expect(published).toHaveLength(1)
      const first = published[0]
      if (!first) throw new Error("The artifact was not published")
      expect(Object.keys(first.files).toSorted()).toEqual(["fonts/inter.woff2", "index.html", "logo.png"])
      expect(first.files["logo.png"]).toEqual(logo)
      expect(first.files["fonts/inter.woff2"]).toEqual(font)
      expect(first.config.entry).toBe("index.html")

      yield* chat.tool("execute", {
        code: `return await tools.opencode.artifact_read({ id: "${first.info.id}", directory: "copy" })`,
      })
      expect(yield* Effect.promise(() => Bun.file(join(folder, "copy/logo.png")).bytes())).toEqual(logo)
      expect(yield* Effect.promise(() => Bun.file(join(folder, "copy/fonts/inter.woff2")).bytes())).toEqual(font)

      const deep = `${"guides/".repeat(16)}résumé.md`
      yield* chat.tool("execute", {
        code: `return await tools.opencode.artifact_create({ title: "Notes", files: { "index.md": "# Notes", "${deep}": "# Résumé" } })`,
      })
      const inline = [...ren.artifacts.values()].find((artifact) => artifact.info.title === "Notes")
      if (!inline) throw new Error("The inline artifact was not published")
      yield* chat.tool("execute", {
        code: `return await tools.opencode.artifact_read({ id: "${inline.info.id}", directory: "notes" })`,
      })
      expect(yield* Effect.promise(() => Bun.file(join(folder, "notes", deep)).text())).toBe("# Résumé")
    }),
)
