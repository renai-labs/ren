import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunFileSystem } from "@effect/platform-bun"
import { Effect } from "effect"
import { Write, type Types } from "../src/index.js"

async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "ren-httpapi-codegen-write-"))
  return { path, [Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }) }
}

const write = (files: Types.Output["files"], directory: string) =>
  Effect.runPromise(Write.write({ operations: [], files }, directory).pipe(Effect.provide(BunFileSystem.layer)))

describe("HttpApiCodegen.write", () => {
  test("removes only stale files the manifest owns", async () => {
    await using directory = await temporary()
    await Bun.write(join(directory.path, "notes.md"), "kept")
    await write(
      [
        { path: "old.ts", content: "export const old = 1" },
        { path: "session.ts", content: "export const session = 1" },
      ],
      directory.path,
    )

    await write([{ path: "session.ts", content: "export const session = {}" }], directory.path)

    expect((await readdir(directory.path)).toSorted()).toEqual([".httpapi-codegen.json", "notes.md", "session.ts"])
    expect(await Bun.file(join(directory.path, "session.ts")).text()).toBe("export const session = {}\n")
    expect(await Bun.file(join(directory.path, ".httpapi-codegen.json")).text()).toBe('["session.ts"]\n')
  })

  test.each(["../outside.ts", "/absolute.ts", "nested/session.ts", ".httpapi-codegen.json"])(
    "rejects the unsafe output path %s before writing",
    async (path) => {
      await using directory = await temporary()
      const output = join(directory.path, "generated")

      const error = await Effect.runPromise(
        Write.write({ operations: [], files: [{ path, content: "" }] }, output).pipe(
          Effect.flip,
          Effect.provide(BunFileSystem.layer),
        ),
      )

      expect(error.message).toBe(`Unsafe output path: ${path}`)
      expect(await readdir(directory.path)).toEqual([])
    },
  )
})
