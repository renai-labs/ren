import { ResourceIcon } from "@ren/schema/resource-icon"
import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import sharp from "sharp"
import { Icons } from "../src/icons.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Icons.layer.pipe(Layer.provide(TestDrives.layer)))

const image = (format: "png" | "gif", width: number, height: number) =>
  Effect.promise(() =>
    sharp({ create: { width, height, channels: 3, background: "#7c3aed" } })
      .toFormat(format)
      .toBuffer(),
  )

describe("Icons", () => {
  it.live("stores an image as a 256×256 WebP under the hash of its bytes, and reads it back", () =>
    Effect.gen(function* () {
      const icons = yield* Icons.Service
      const hash = yield* icons.store(yield* image("png", 600, 300))
      expect(hash).toMatch(/^[a-f0-9]{64}$/u)
      expect(yield* icons.store(yield* image("png", 600, 300))).toBe(hash)
      const stored = yield* icons.read(hash)
      const metadata = yield* Effect.promise(() => sharp(Option.getOrThrow(stored)).metadata())
      expect([metadata.format, metadata.width, metadata.height]).toEqual(["webp", 256, 256])
    }),
  )

  it.live("refuses a file over 512 KB, a GIF and a file that is not an image", () =>
    Effect.gen(function* () {
      const icons = yield* Icons.Service
      const refusal = (source: Uint8Array) =>
        Effect.flip(icons.store(source)).pipe(Effect.map((error) => error.message))
      expect(yield* refusal(new Uint8Array(ResourceIcon.maximumUploadBytes + 1))).toBe(ResourceIcon.uploadTooLarge)
      expect(yield* refusal(yield* image("gif", 32, 32))).toBe("Choose a PNG, JPEG or WebP image.")
      expect(yield* refusal(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(
        "Choose a PNG, JPEG or WebP image.",
      )
    }),
  )

  it.live("reads nothing for a hash it never stored or a name that is not a hash", () =>
    Effect.gen(function* () {
      const icons = yield* Icons.Service
      expect(yield* icons.read("0".repeat(64))).toEqual(Option.none())
      expect(yield* icons.read("../drives")).toEqual(Option.none())
    }),
  )
})
