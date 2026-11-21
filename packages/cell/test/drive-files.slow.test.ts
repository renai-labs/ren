import { describe, expect, setDefaultTimeout } from "bun:test"
import { TestGitHub } from "@ren/brain/testing"
import { DriveHand, testEffect } from "@ren/executor/testing"
import type { Drive } from "@ren/schema/drive"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Fiber, Layer, Redacted, Schedule, Schema, Stream } from "effect"
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
      remote: DriveHand.remote(DriveHand.key, "org_1/drives/spaces/spc_1/"),
      access: "write",
    },
    {
      kind: "org",
      alias: "drive:org",
      description: "The organization’s files",
      remote: DriveHand.remote(DriveHand.key),
      access: "read",
    },
  ],
}

const uploads = "chats/ses_1/uploads"

const open = Effect.gen(function* () {
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
  return { environment, chat }
})

describe.skipIf(!DriveHand.hasDocker)("drive files", () => {
  it.live(
    "the first message of a chat connects its environment and mounts the drive, then attaches files that the browser put there a moment before: the model reads a text file and gets the path of every file, and the transcript gives them as uploads",
    () =>
      Effect.gen(function* () {
        const opened = yield* open
        const environment = opened.environment
        const chat = opened.chat
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
        expect(first).toContain(`plan.txt (text/plain, 15 B) at ${space}/${uploads}/msg_1/plan.txt`)
        expect(first).toContain(`report.zip (application/zip, 17 B) at ${space}/${uploads}/msg_1/report.zip`)
        const sent = (yield* chat.transcript).items.find((message) => message.type === "user")
        expect(sent?.type === "user" && sent.uploads).toEqual([
          { path: `${uploads}/msg_1/plan.txt`, name: "plan.txt", mime: "text/plain", size: 15 },
          { path: `${uploads}/msg_1/report.zip`, name: "report.zip", mime: "application/zip", size: 17 },
        ])
        expect(sent?.type === "user" && sent.files).toEqual([])

        put(`${uploads}/msg_2/later.md`, "uploaded just now")
        expect(yield* ask([{ path: `${uploads}/msg_2/later.md`, name: "later.md" }])).toContain("uploaded just now")

        const refused = yield* Effect.flip(chat.prompt([{ path: `${uploads}/msg_3/gone.pdf`, name: "gone.pdf" }]))
        expect(refused).toMatchObject({
          _tag: "Harness.Rejected",
          message: `gone.pdf is not in the space’s drive at ${uploads}/msg_3/gone.pdf`,
        })
      }),
  )

  it.live(
    "show_file puts a native image job's default environment output in the drive and the transcript gives it as a card",
    () =>
      Effect.gen(function* () {
        const opened = yield* open
        const chat = opened.chat
        const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        const gateway = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              fetch: () => Response.json({ created: 1, data: [{ b64_json: png }] }),
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        yield* chat.configure({
          models: [
            ...Shared.access(undefined, stub.url).endpoints,
            {
              id: "image",
              protocol: "openai-chat",
              baseUrl: `${gateway.url.origin}/v1`,
              apiKey: { key: Redacted.make("key") },
              models: [{ id: "painter", type: "image", protocol: "openai-images" }],
            },
          ],
        })
        const notified = yield* chat.events.pipe(
          Stream.filter((event) => event.type === "session.inbox.enqueued" && event.data.item.type === "synthetic"),
          Stream.runHead,
          Effect.forkScoped({ startImmediately: true }),
        )
        yield* chat.tool("experimental_image_generate", { prompt: "A dot" })
        yield* Fiber.join(notified)
        const generated = (yield* chat.transcript).items
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool" && part.name === "experimental_image_generate")
        const stem =
          generated?.type === "tool" && generated.state.status === "completed"
            ? Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }))(generated.state.metadata).path
            : ""
        expect(stem).toStartWith(`/tmp/chats/${chat.sessionId}/.ren/images/`)
        const name = `${stem.split("/").at(-1)}.png`
        const path = `chats/${chat.sessionId}/outputs/${name}`
        const result = JSON.stringify(
          (yield* chat.tool("show_file", { path: `${stem}.png` })).body.messages.findLast(
            (message) => message.role === "tool",
          )?.content ?? "",
        )
        expect(result).toContain(path)
        const shown = (yield* chat.transcript).items
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool" && part.name === SessionMessage.showFileTool)
        expect(shown?.type === "tool" && shown.state.status === "completed" && shown.state.metadata).toMatchObject({
          file: { path, name, mime: "image/png", size: Buffer.from(png, "base64").length },
        })
        const uploaded = Effect.try(() =>
          opened.environment.exec(`base64 -w0 /tmp/s3/drives/org_1/drives/spaces/spc_1/${path}`),
        ).pipe(Effect.retry({ schedule: Schedule.spaced("200 millis"), times: 50 }))
        expect(yield* uploaded).toBe(png)
      }),
  )
})
