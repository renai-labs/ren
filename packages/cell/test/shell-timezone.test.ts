import { expect, setDefaultTimeout } from "bun:test"
import { TestGitHub } from "@ren/brain/testing"
import { TestEnvironment, testEffect } from "@ren/executor/testing"
import { Environment } from "@ren/schema/environment"
import { Effect } from "effect"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReferenceChat } from "./lib/reference-chat.js"

setDefaultTimeout(30_000)

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const it = testEffect(TestEnvironment.layer({ environmentId, workspace }))

it.live("a command on the environment runs with TZ set to the organization's timezone", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make({ repo: `docs-${crypto.randomUUID().slice(0, 8)}` })
    const chat = yield* ReferenceChat.open(
      { url: yield* TestEnvironment.url, environmentId, directoryOf: (sessionId) => join(workspace, sessionId) },
      github,
      { timezone: "Asia/Kolkata" },
    )
    const call = yield* chat.tool("shell", { command: 'echo "zone=$TZ"' })
    expect(JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content)).toContain(
      "zone=Asia/Kolkata",
    )
  }),
)
