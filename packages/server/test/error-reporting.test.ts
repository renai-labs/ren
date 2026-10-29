import { describe, expect } from "bun:test"
import { Space } from "@ren/schema/space"
import { Effect, ErrorReporter } from "effect"
import { testEffect } from "@ren/core/testing"
import { ApiFixture } from "@ren/server/testing/api"

const reported: Array<string> = []

const it = testEffect(
  ApiFixture.layerWith({
    observability: ErrorReporter.layer([ErrorReporter.make((report) => reported.push(report.error.message))]),
  }),
)

describe("error reporting", () => {
  it.live("an error that the caller caused reports nothing", () =>
    Effect.gen(function* () {
      const owner = yield* ApiFixture.owner()
      const api = yield* ApiFixture.Service
      reported.length = 0

      const missing = yield* owner.request("GET", `/spaces/${Space.ID.create()}`)
      const anonymous = yield* Effect.promise(() => api.handler(new Request("http://localhost:4000/me")))

      expect([missing.status, anonymous.status]).toEqual([404, 401])
      expect(reported).toEqual([])
    }),
  )
})
