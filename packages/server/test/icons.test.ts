import { expect } from "bun:test"
import { testEffect } from "@ren/core/testing"
import { Effect, Schema } from "effect"
import { ApiFixture } from "@ren/server/testing/api"

const it = testEffect(ApiFixture.layer)

const Upload = Schema.Struct({ url: Schema.String })

const upload = (cookie: string, body: Blob) =>
  Effect.gen(function* () {
    const api = yield* ApiFixture.Service
    return yield* Effect.promise(() =>
      api.handler(
        new Request("http://localhost:4000/icons", {
          method: "POST",
          headers: { cookie, "content-type": "application/octet-stream" },
          body,
        }),
      ),
    )
  })

it.live("a member uploads an image and anyone reads its 256×256 WebP at the URL that comes back", () =>
  Effect.gen(function* () {
    const api = yield* ApiFixture.Service
    const owner = yield* ApiFixture.owner()
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    )
    const response = yield* upload(owner.cookie, new Blob([png]))
    expect(response.status).toBe(200)
    const url = (yield* Schema.decodeUnknownEffect(Upload)(yield* Effect.promise(() => response.json()))).url
    expect(url).toMatch(/^http:\/\/localhost:4000\/icons\/[a-f0-9]{64}\.webp$/u)

    const icon = yield* Effect.promise(() => api.handler(new Request(url)))
    expect([icon.status, icon.headers.get("content-type"), icon.headers.get("cache-control")]).toEqual([
      200,
      "image/webp",
      "public, max-age=31536000, immutable",
    ])
    expect((yield* Effect.promise(() => icon.arrayBuffer())).byteLength).toBeGreaterThan(0)
    expect(
      (yield* Effect.promise(() => api.handler(new Request(`http://localhost:4000/icons/${"0".repeat(64)}.webp`))))
        .status,
    ).toBe(404)
  }),
)

it.live("refuses a file over 512 KB with 400, and a caller who is not signed in with 401", () =>
  Effect.gen(function* () {
    const owner = yield* ApiFixture.owner()
    const large = yield* upload(owner.cookie, new Blob([new Uint8Array(600 * 1024)]))
    expect(large.status).toBe(400)
    expect(yield* Effect.promise(() => large.json())).toMatchObject({ message: "Image must be 512 KB or smaller." })
    expect((yield* upload("", new Blob([new Uint8Array(8)]))).status).toBe(401)
  }),
)
