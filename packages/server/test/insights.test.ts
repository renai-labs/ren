import { expect } from "bun:test"
import { testEffect } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { Effect } from "effect"
import { ApiFixture } from "@ren/server/testing/api"

const it = testEffect(ApiFixture.layer)

it.live("insights serve a space's usage over HTTP, and refuse a range that ends before it starts", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const owner = yield* ApiFixture.owner()
    yield* database.db.insert(Database.Schema.usage_event).values({
      source: "ren-inference",
      id: "call-1",
      type: "model.call",
      time: new Date("2026-10-01T12:00:00Z"),
      workload: "brain:brn_test",
      organization: owner.organizationId,
      space: owner.spaceId,
      member: owner.memberId,
      payer: "ren",
      provider: "anthropic",
      cost_micro_usd: 5000,
      data: { requested_model: "claude-sonnet-4-5", served_model: "anthropic/claude-sonnet-4-5", input_tokens: 10 },
    })
    const range = `spaceId=${owner.spaceId}&from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z`

    const response = yield* owner.request("GET", `/insights?${range}&groupBy=member&userId=${owner.createdBy}`)
    expect(response.status).toBe(200)
    expect(yield* Effect.promise<unknown>(() => response.json())).toMatchObject({
      rows: [{ key: owner.createdBy, calls: 1, tokens: { input: 10 }, cost: { ren: 5000 } }],
    })
    const reversed = `spaceId=${owner.spaceId}&from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z`
    expect((yield* owner.request("GET", `/insights?${reversed}`)).status).toBe(400)
  }),
)
