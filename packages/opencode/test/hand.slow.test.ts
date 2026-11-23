import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { Binding } from "../src/binding.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

const git = (folder: string, args: ReadonlyArray<string>) =>
  Bun.spawnSync(["git", "-c", "user.name=Ren", "-c", "user.email=ren@example.com", ...args], { cwd: folder })

test("on a real brain with a hand, the panels list and read the file the brain wrote there, show it in the changes, and run a command whose output comes back", () =>
  Effect.gen(function* () {
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
    target.brain = brain
    const folder = brain.hand ?? ""
    mkdirSync(folder, { recursive: true })
    git(folder, ["init", "--quiet", "--initial-branch=main"])
    yield* Effect.promise(() => Bun.write(`${folder}/README.md`, "# Hand\n"))
    git(folder, ["add", "."])
    git(folder, ["commit", "--quiet", "-m", "start"])

    const script = Shared.stub().script({
      tool: { name: "shell", input: { command: "echo 'from the brain' > notes.md" } },
    })
    yield* host.client.session.prompt({ sessionID, text: script.marker }).pipe(Effect.orDie)
    yield* host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)

    const listed = yield* rpc.listFiles({ sessionID }, at)
    expect(listed.entries.map((entry) => entry.path)).toContain("notes.md")
    expect(yield* rpc.readFile({ sessionID, path: "notes.md" }, at)).toMatchObject({
      path: "notes.md",
      binary: false,
      content: "from the brain\n",
      truncated: false,
    })
    const changes = yield* rpc.changes({ sessionID }, at)
    expect(changes).toMatchObject({ repository: true, mode: "working", branch: { current: "main" } })
    expect(changes.files.map((file) => [file.file, file.status, file.additions])).toEqual([["notes.md", "added", 1]])
    expect(changes.files[0]?.patch).toContain("+from the brain")

    const shell = yield* rpc.runShell({ sessionID, command: "echo hello from the hand" }, at)
    expect(shell).toMatchObject({ command: "echo hello from the hand", sessionID })
    const read = (
      cursor: number,
      output: string,
    ): Effect.Effect<{ readonly output: string; readonly status: string; readonly exit?: number }, unknown> =>
      rpc.readShell({ sessionID, shellID: shell.id, cursor }, at).pipe(
        Effect.flatMap((next) =>
          next.shell.status !== "running" && next.cursor >= next.size
            ? Effect.succeed({
                output: output + next.output,
                status: next.shell.status,
                ...(next.shell.exit !== undefined && { exit: next.shell.exit }),
              })
            : read(next.cursor, output + next.output),
        ),
      )
    expect(yield* read(0, "")).toEqual({ output: "hello from the hand\n", status: "exited", exit: 0 })
  }).pipe(Effect.scoped, Effect.runPromise))
