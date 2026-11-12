import { describe, expect, setDefaultTimeout } from "bun:test"
import { TestGitHub } from "@ren/brain/testing"
import { DriveHand, testEffect } from "@ren/executor/testing"
import type { Drive } from "@ren/schema/drive"
import { Effect, Layer, Option, Schedule } from "effect"
import { FetchHttpClient } from "effect/http"
import { McpPeer } from "./lib/mcp.js"
import { ReferenceChat } from "./lib/reference-chat.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(300_000)

const it = testEffect(FetchHttpClient.layer.pipe(Layer.orDie))

const drives: Drive.Availability = {
  type: "mounts",
  mounts: [
    {
      kind: "space",
      alias: "drive:space",
      description: "The space’s files",
      remote: DriveHand.remote(DriveHand.key, "org_1/drives/spaces/spc_1/"),
      access: "write",
    },
  ],
}

describe.skipIf(!DriveHand.hasDocker)("MCP App views", () => {
  it.live("a tool with a ui:// resource completes with its view in the drive and the part names it", () =>
    Effect.gen(function* () {
      const html = "<!doctype html><title>Linear</title><p>view</p>"
      const peer = yield* McpPeer.make({ view: html })
      const environment = yield* DriveHand.start
      const github = yield* TestGitHub.make({ repo: `docs-${crypto.randomUUID().slice(0, 8)}` })
      const chat = yield* ReferenceChat.open(
        {
          url: environment.url,
          environmentId: environment.environmentId,
          directoryOf: (sessionId) => `/tmp/chats/${sessionId}`,
        },
        github,
        [],
        drives,
      )
      yield* chat.configure({ apps: Option.some(McpPeer.catalog("apps", [{ slug: "linear", url: peer.url }])) })
      yield* Effect.sleep("2 seconds")
      yield* chat.tool("linear_marker", {})
      const part = (yield* chat.transcript).items
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((each) => each.type === "tool" && each.name === "linear_marker")
      const app = part?.type === "tool" && part.state.status === "completed" ? part.state.metadata : undefined
      expect(app).toMatchObject({
        app: { server: "linear", tool: "marker", resourceUri: "ui://test/view", readOnly: true },
      })
      const path = (app as { app: { path: string } }).app.path
      expect(path).toStartWith(`chats/${chat.sessionId}/apps/`)
      const uploaded = Effect.try(() =>
        environment.exec(`cat /tmp/s3/drives/org_1/drives/spaces/spc_1/${path}`),
      ).pipe(Effect.retry({ schedule: Schedule.spaced("200 millis"), times: 50 }))
      expect(yield* uploaded).toBe(html)
    }),
  )
})
