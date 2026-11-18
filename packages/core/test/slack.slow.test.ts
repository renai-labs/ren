import { afterAll, describe, expect } from "bun:test"
import { Effect } from "effect"
import { SlackApp } from "../src/slack-app.js"
import { testEffect } from "./lib/effect.js"
import { SlackProvider } from "./lib/slack-provider.js"
import { SlackServer } from "./lib/slack-server.js"

const slack = SlackServer.start()
afterAll(() => slack.stop())

const it = testEffect(SlackProvider.layer(slack.url))

describe("Slack", () => {
  it.live("files with an underreported size are refused when the response exceeds the byte limit", () =>
    Effect.gen(function* () {
      const slackProvider = yield* SlackProvider.provider
      const found = yield* SlackProvider.installed(slack)
      const file = { url: `${slack.url}/files/F2`, name: "large.log", mime: "text/plain" }
      slack.files.set("F2", "x".repeat(SlackApp.maxFileBytes + 1))
      expect(yield* Effect.flip(slackProvider.fetchFile(found.workspace, { ...file, size: 1 }))).toMatchObject({
        _tag: "ChannelProvider.FileUnavailable",
        message: "Slack file exceeds the 32 MiB limit",
      })
      slack.files.delete("F2")
    }),
  )
})
