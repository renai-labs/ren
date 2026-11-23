import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { Effect, Fiber, Schedule, type Scope } from "effect"
import { Binding } from "../src/binding.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const setup = Effect.fnUntraced(function* () {
  const target: { brain?: Effect.Success<ReturnType<typeof BrainTest.make>> } = {}
  const ren = yield* RenServer.make({
    chat: (path, request) =>
      target.brain ? target.brain.chatFetch(path, request) : Promise.resolve(new Response(null, { status: 503 })),
    created: () => (target.brain ? Effect.runPromise(target.brain.start().pipe(Effect.asVoid)) : Promise.resolve()),
  })
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }],
  })
  const at = { location: host.location }
  const rpc = host.client.rpc(RenRpc.Definition)
  const created = yield* rpc.createSession({}, at)
  const sessionID = Binding.LocalID.make(created.sessionID)
  const brain = yield* BrainTest.make({ id: Session.ID.make(sessionID), hand: true })
  mkdirSync(brain.hand ?? "", { recursive: true })
  Bun.spawnSync(["git", "init", "--quiet"], { cwd: brain.hand ?? "" })
  yield* Effect.promise(() => Bun.write(`${brain.hand}/README.md`, "# Hand\n"))
  Bun.spawnSync(["git", "-c", "user.name=Ren", "-c", "user.email=ren@example.com", "add", "."], {
    cwd: brain.hand ?? "",
  })
  Bun.spawnSync(
    ["git", "-c", "user.name=Ren", "-c", "user.email=ren@example.com", "commit", "--quiet", "-m", "start"],
    { cwd: brain.hand ?? "" },
  )
  target.brain = brain
  const turn = (text: string) =>
    host.client.session
      .prompt({ sessionID, text })
      .pipe(Effect.andThen(host.client.experimental.session.wait({ sessionID })), Effect.orDie, Effect.forkChild)
  const activity = (until: (items: ReadonlyArray<RenRpc.Work>) => boolean) =>
    rpc.activity({ sessionID }, at).pipe(
      Effect.map((listed) => listed.items),
      Effect.orElseSucceed((): ReadonlyArray<RenRpc.Work> => []),
      Effect.repeat({ until, schedule: Schedule.spaced("100 millis") }),
    )
  const answer = host.client.session.context({ sessionID }).pipe(
    Effect.orDie,
    Effect.map((messages) =>
      messages
        .findLast((message) => message.type === "assistant")
        ?.content.flatMap((part) => {
          if (part.type === "text") return [part.text]
          if (part.type !== "tool") return []
          if (part.state.status !== "completed" && part.state.status !== "error")
            return [`${part.name}: ${part.state.status}`]
          const result =
            part.state.status === "error"
              ? `failed: ${part.state.error.message}`
              : part.state.content.map((item) => (item.type === "text" ? item.text : "")).join("")
          return [`${part.name}: ${result.split(/ \(|\n/u)[0] ?? ""}`]
        }),
    ),
  )
  return { rpc, at, sessionID, turn, activity, answer }
})

test("on a real brain, a turn blocked on a shell command goes on in the local session after /ren:background, and the command then shows in the activity and stops", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const script = Shared.stub().script({
        tool: { name: "shell", input: { command: "exec sleep 300", description: "Wait" } },
      })
      const turn = yield* opened.turn(script.marker)
      const blocked = yield* opened.activity((items) => items.some((item) => item.blocking && item.id))
      expect(blocked).toMatchObject([{ type: "shell", label: "exec sleep 300", blocking: true }])
      const shellID = blocked[0]?.id ?? ""
      expect(shellID).not.toBe("")
      const moved = yield* opened.rpc.background({ sessionID: opened.sessionID }, opened.at)
      expect(moved.moved).toMatchObject([{ type: "shell", label: "exec sleep 300", blocking: true }])
      yield* Fiber.join(turn)
      expect(yield* opened.answer).toEqual(["shell: Command moved to the background", "stub reply"])
      expect(yield* opened.activity(() => true)).toEqual([
        { type: "shell", id: shellID, sessionID: opened.sessionID, label: "exec sleep 300", blocking: false },
      ])
      yield* opened.rpc.stopShell({ sessionID: opened.sessionID, shellID }, opened.at)
      expect(yield* opened.activity((items) => items.length === 0)).toEqual([])
      expect((yield* opened.rpc.background({ sessionID: opened.sessionID }, opened.at)).moved).toEqual([])
    }),
  ))

test("on a real brain, a turn blocked on a subagent lists it in the activity, and stopping the subagent there lets the local turn finish", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const child = Shared.stub().script({ hold: true, reply: "Half done." })
      yield* Effect.addFinalizer(() => Effect.sync(child.release))
      const script = Shared.stub().script({
        tool: { name: "subagent", input: { agent: "general", description: "Look", prompt: `${child.marker} look` } },
        reply: "The subagent stopped.",
      })
      const turn = yield* opened.turn(script.marker)
      yield* Effect.promise(() => child.called())
      const blocked = yield* opened.activity((items) => items.some((item) => item.blocking && item.id))
      expect(blocked).toMatchObject([{ type: "subagent", label: "Look", blocking: true }])
      const childID = blocked[0]?.id ?? ""
      yield* opened.rpc.stopSubagent({ sessionID: opened.sessionID, childID }, opened.at)
      yield* Fiber.join(turn)
      expect(yield* opened.answer).toEqual(["subagent: failed: Subagent cancelled", "The subagent stopped."])
      expect(yield* opened.activity(() => true)).toEqual([])
    }),
  ))
