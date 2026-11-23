import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Model, Provider, Skill } from "@opencode/plugin/effect"
import { OpenCodeHost } from "@ren/cell/testing"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, type Scope } from "effect"
import { Binding } from "../src/binding.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))
const model = { providerID: Provider.ID.make("ren"), id: Model.ID.make("stub/stub-model") }
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

process.env["REN_TOKEN"] = "user-token"

const setup = Effect.fnUntraced(function* () {
  const files = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-outgoing-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  yield* Effect.promise(async () => {
    await mkdir(join(files, "skills", "review"), { recursive: true })
    await mkdir(join(files, "skills", "house-style"), { recursive: true })
    await writeFile(
      join(files, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review code\n---\nReview the code carefully.\n",
    )
    await writeFile(
      join(files, "skills", "house-style", "SKILL.md"),
      "---\nname: house-style\ndescription: Our style\n---\nWrite in the house style.\n",
    )
  })
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: plugin, options: { url: ren.url, space: ren.state.spaceId } }],
    skills: [join(files, "skills")],
  })
  const session = yield* host.client.session.create({ location: host.location, model }).pipe(Effect.orDie)
  const sessionID = Binding.LocalID.make(session.id)
  ren.state.answer = (prompt) => {
    ren.state.delivered.add(prompt.id)
    const step = { sessionID: prompt.sessionID, assistantMessageID: SessionMessage.ID.create() }
    ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
    ren.send(RenServer.frame("session.text.started", { ...step, ordinal: 0 }))
    ren.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text: "done" }))
    ren.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
  }
  const prompt = (input: Omit<Parameters<typeof host.client.session.prompt>[0], "sessionID">) =>
    host.client.session.prompt({ sessionID, ...input }).pipe(
      Effect.orDie,
      Effect.tap(() => host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)),
    )
  const messages = host.client.session.context({ sessionID }).pipe(Effect.orDie)
  const errors = messages.pipe(
    Effect.map((all) =>
      all.flatMap((message) => (message.type === "assistant" && message.error ? [message.error.message] : [])),
    ),
  )
  return { ren, host, sessionID, files, prompt, messages, errors }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

test("a file attachment, a range of a file, a folder and a pasted image upload to the message's folder in the space's drive, and the prompt refers to them", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const notes = join(opened.files, "notes.txt")
      yield* Effect.promise(async () => {
        await writeFile(notes, "one\ntwo\nthree\nfour\n")
        await mkdir(join(opened.files, "src"))
        await writeFile(join(opened.files, "src", "a.ts"), "export {}\n")
      })
      const uri = pathToFileURL(notes).href
      const sent = yield* opened.prompt({
        text: "look at @notes.txt and this",
        files: [
          { uri, mention: { start: 8, end: 18, text: "@notes.txt" } },
          { uri: `${uri}?start=2&end=3` },
          { uri: pathToFileURL(join(opened.files, "src")).href },
          { uri: `data:image/png;base64,${png}`, name: "Pasted image" },
        ],
      })
      const folder = `chats/${opened.sessionID}/uploads/${sent.id}`
      expect(opened.ren.state.prompts).toEqual([
        {
          sessionID: opened.sessionID,
          id: sent.id,
          text: "look at @notes.txt and this",
          delivery: "steer",
          files: [
            { path: `${folder}/notes.txt`, name: "notes.txt" },
            { path: `${folder}/notes (2).txt`, name: "notes (2).txt" },
            { path: `${folder}/src.listing.txt`, name: "src.listing.txt" },
            { path: `${folder}/Pasted image.png`, name: "Pasted image.png" },
          ],
        },
      ])
      const stored = (yield* opened.messages).find((message) => message.id === sent.id)
      const image = stored?.type === "user" ? stored.files?.at(3)?.data : undefined
      expect(opened.ren.state.uploads.every((upload) => upload.spaceId === opened.ren.state.spaceId)).toBe(true)
      expect(
        Object.fromEntries(
          opened.ren.state.uploads.map((upload) => [
            upload.path,
            upload.path.endsWith(".png") ? Buffer.from(upload.bytes).toString("base64") : text(upload.bytes),
          ]),
        ),
      ).toEqual({
        [`${folder}/notes.txt`]: "one\ntwo\nthree\nfour\n",
        [`${folder}/notes (2).txt`]: "two\nthree",
        [`${folder}/src.listing.txt`]: "a.ts",
        [`${folder}/Pasted image.png`]: String(image),
      })
      expect(yield* opened.errors).toEqual([])
    }),
  ))

test("a message the brain already has is neither uploaded nor sent again", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = (prompt) => {
        opened.ren.state.delivered.add(prompt.id)
        opened.ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
        opened.ren.send(
          RenServer.frame("session.execution.failed", {
            sessionID: prompt.sessionID,
            error: { type: "unknown", message: "the model failed" },
          }),
        )
      }
      yield* opened.prompt({ text: "first", files: [{ uri: "data:text/plain;base64,aGVsbG8=", name: "a.txt" }] })
      yield* opened.prompt({ text: "second" })
      expect(opened.ren.state.prompts.map((prompt) => prompt.text)).toEqual(["first", "second"])
      expect(opened.ren.state.uploads).toHaveLength(1)
    }),
  ))

test("more files than Ren takes in one message fail the turn and send nothing", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.prompt({
        text: "many",
        files: Array.from({ length: 11 }, (_, index) => ({
          uri: "data:text/plain;base64,aGVsbG8=",
          name: `file-${index}.txt`,
        })),
      })
      expect(yield* opened.errors).toEqual([
        "This message attaches 11 files, and Ren takes at most 10 in one message. Send it again with fewer files.",
      ])
      expect(opened.ren.state.uploads).toEqual([])
      expect(opened.ren.state.prompts).toEqual([])
    }),
  ))

test("a file larger than Ren's drive takes fails the turn with Ren's reason and sends nothing", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.maxUploadBytes = 3
      yield* opened.prompt({ text: "big", files: [{ uri: "data:text/plain;base64,aGVsbG8=", name: "big.txt" }] })
      expect(yield* opened.errors).toEqual([
        "Ren did not take big.txt: A file in the drive is at most 3 bytes. Send the message again without it.",
      ])
      expect(opened.ren.state.prompts).toEqual([])
    }),
  ))

test("agents and skills the brain has pass through; a skill only the local OpenCode has goes as a file with its text", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.agents = [{ id: "explore", name: "explore", mode: "subagent", hidden: false }]
      opened.ren.state.skills = [{ id: "review", name: "review" }]
      const sent = yield* opened.prompt({
        text: "@explore @helper @review @house-style go",
        agents: [
          { name: "explore", mention: { start: 0, end: 8, text: "@explore" } },
          { name: "helper", mention: { start: 9, end: 16, text: "@helper" } },
        ],
        skills: [
          { id: Skill.ID.make("review"), mention: { start: 17, end: 24, text: "@review" } },
          { id: Skill.ID.make("house-style"), mention: { start: 25, end: 37, text: "@house-style" } },
        ],
      })
      const folder = `chats/${opened.sessionID}/uploads/${sent.id}`
      expect(opened.ren.state.prompts).toEqual([
        {
          sessionID: opened.sessionID,
          id: sent.id,
          text: "@explore @helper @review @house-style go",
          delivery: "steer",
          agents: [{ name: "explore", mention: { start: 0, end: 8, text: "@explore" } }],
          skills: [{ id: "review", mention: { start: 17, end: 24, text: "@review" } }],
          files: [{ path: `${folder}/house-style.skill.md`, name: "house-style.skill.md" }],
        },
      ])
      expect(text(opened.ren.state.uploads.at(0)?.bytes ?? new Uint8Array())).toContain("Write in the house style.")
    }),
  ))
