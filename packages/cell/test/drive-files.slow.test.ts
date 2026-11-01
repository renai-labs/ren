import { describe, expect, setDefaultTimeout } from "bun:test"
import { TestGitHub } from "@ren/brain/testing"
import { DriveEnvironment, testEffect } from "@ren/executor/testing"
import type { Drive } from "@ren/schema/drive"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { ReferenceChat } from "./lib/reference-chat.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(300_000)

const stub = Shared.stub()
const it = testEffect(FetchHttpClient.layer.pipe(Layer.orDie))

const drives: Drive.Availability = {
  type: "mounts",
  mounts: [
    {
      kind: "space",
      alias: "drive:space",
      description: "The space’s files",
      remote: DriveEnvironment.remote(DriveEnvironment.key, "org_1/drives/spaces/spc_1/"),
      access: "write",
    },
    {
      kind: "org",
      alias: "drive:org",
      description: "The organization’s files",
      remote: DriveEnvironment.remote(DriveEnvironment.key),
      access: "read",
    },
  ],
}

const uploads = "chats/ses_1/uploads"

describe.skipIf(!DriveEnvironment.hasDocker)("drive files", () => {
  it.live(
    "the first message of a chat connects its environment and mounts the drive, then attaches files that the browser put there a moment before: the model reads a text file and gets the path of every file",
    () =>
      Effect.gen(function* () {
        const environment = yield* DriveEnvironment.start
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
        const space = "/tmp/chats/.ren/drives/space"
        const put = (path: string, text: string) => environment.put(`org_1/drives/spaces/spc_1/${path}`, text)
        const ask = (files: ReadonlyArray<{ readonly path: string; readonly name: string }>) =>
          Effect.gen(function* () {
            const script = stub.script({ reply: "Read them." })
            yield* chat.prompt(files, `${script.marker} look at these`)
            const call = yield* Effect.promise(() => script.called(1))
            yield* chat.wait
            return JSON.stringify(call.body.messages)
          })

        const onEnvironment = () =>
          environment.exec(
            `test -d /tmp/chats && echo connected || echo untouched; grep -c ' ${space} ' /proc/mounts || true`,
          )
        expect(onEnvironment()).toBe("untouched\n0")
        put(`${uploads}/msg_1/plan.txt`, "ship on friday")
        put(`${uploads}/msg_1/report.zip`, "not really a zip")
        const first = yield* ask([
          { path: `${uploads}/msg_1/plan.txt`, name: "plan.txt" },
          { path: `${uploads}/msg_1/report.zip`, name: "report.zip" },
        ])
        expect(onEnvironment()).toBe("connected\n1")
        expect(first).toContain("ship on friday")
        expect(first).not.toContain("not really a zip")
        expect(first).toContain(`plan.txt (text/plain, 0.0 MB) at ${space}/${uploads}/msg_1/plan.txt`)
        expect(first).toContain(`report.zip (application/zip, 0.0 MB) at ${space}/${uploads}/msg_1/report.zip`)
        const sent = (yield* chat.messages).data.find((message) => message.type === "user")
        expect(sent?.type === "user" && sent.metadata).toMatchObject({
          files: [
            { path: `${uploads}/msg_1/plan.txt`, name: "plan.txt", mime: "text/plain", size: 15 },
            { path: `${uploads}/msg_1/report.zip`, name: "report.zip", mime: "application/zip", size: 17 },
          ],
        })

        put(`${uploads}/msg_2/later.md`, "uploaded just now")
        expect(yield* ask([{ path: `${uploads}/msg_2/later.md`, name: "later.md" }])).toContain("uploaded just now")

        const refused = yield* Effect.flip(chat.prompt([{ path: `${uploads}/msg_3/gone.pdf`, name: "gone.pdf" }]))
        expect(refused).toMatchObject({
          _tag: "Harness.Rejected",
          message: `gone.pdf is not in the space’s drive at ${uploads}/msg_3/gone.pdf`,
        })
      }),
  )
})
