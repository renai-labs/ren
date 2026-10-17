import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Environments } from "@ren/brain/environments"
import { Duration } from "effect"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { RealStack } from "../lib/real-stack.js"
import { Wait } from "../lib/wait.js"

const savedTo = (result: string) =>
  /(?:full output saved to|Output is streaming to:) ([^\]\s]+)/.exec(result)?.[1] ?? ""

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined)(
  "the real Ren server, a Wrangler cell and Docker sandboxes",
  () => {
    const lane: { stack?: RealStack.Instance } = {}
    const stack = () => {
      if (!lane.stack) throw new Error("the stack did not start")
      return lane.stack
    }
    const full = () => stack().sandbox("full")

    const pidOf = (session: RealStack.Driver, file: string) =>
      Wait.until(`the process ID in ${file}`, 60_000, async () => {
        const read = await full().container.observe(["cat", `${full().folder(session.sessionId)}/${file}`])
        return read.exitCode === 0 && read.stdout.trim() !== "" ? read.stdout.trim() : undefined
      })
    const stops = (pid: string, ms: number) =>
      Wait.until(`process ${pid} to stop in the container`, ms, async () =>
        (await full().container.observe(["kill", "-0", pid])).exitCode === 0 ? undefined : true,
      )

    beforeAll(async () => {
      lane.stack = await RealStack.start({
        environments: [{ label: "full" }, { label: "second" }, { label: "files", capabilities: ["files"] }],
        tokenLifetime: "20 seconds",
      })
    }, 600_000)

    afterAll(() => lane.stack?.dispose(), 120_000)

    test("a shell call runs in the session's folder in the container, with a token that the server issued", async () => {
      const before = stack().issued()
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo $((40 + 2)); pwd" })).toBe(
        `42\n/workspace/${session.sessionId}\n`,
      )
      expect(stack().issued() - before).toBe(1)
    }, 600_000)

    test("write, read, edit, glob and grep work on the container's files", async () => {
      const session = await stack().session()
      await session.tool("write", { path: "notes.txt", content: "one\ntwo\n" })
      expect(await session.tool("read", { path: "notes.txt" })).toContain("2: two")
      expect(await session.tool("edit", { path: "notes.txt", oldString: "two", newString: "three" })).toContain(
        "Edited",
      )
      expect(await session.tool("glob", { pattern: "**/*.txt" })).toContain("notes.txt")
      expect(await session.tool("grep", { pattern: "three" })).toContain("notes.txt")
      expect((await full().container.observe(["cat", `${full().folder(session.sessionId)}/notes.txt`])).stdout).toBe(
        "one\nthree\n",
      )
    }, 600_000)

    test("the full output of a long command is in the container at the path OpenCode names", async () => {
      const session = await stack().session()
      const saved = savedTo(await session.tool("shell", { command: "seq 1 30000" }))
      expect(saved).toStartWith("/tmp/opencode/data/shell/")
      expect(await session.tool("shell", { command: `tail -n 1 ${saved}; grep -c . ${saved}` })).toBe("30000\n30000\n")
      expect(await session.tool("read", { path: saved, offset: 15000, limit: 1 })).toContain("15000")
    }, 600_000)

    test("the full output of a session's long command is only in its own container", async () => {
      const one = await stack().session()
      const two = await stack().session({ environment: stack().sandbox("second") })
      const savedOne = savedTo(await one.tool("shell", { command: "seq 1 30000" }))
      const savedTwo = savedTo(await two.tool("shell", { command: "seq 1 40000" }))
      const has = async (label: string, file: string) =>
        (await stack().sandbox(label).container.observe(["test", "-f", file])).exitCode === 0
      expect([
        await has("full", savedOne),
        await has("second", savedOne),
        await has("second", savedTwo),
        await has("full", savedTwo),
      ]).toEqual([true, false, true, false])
    }, 600_000)

    test("an environment with only files offers no shell, and a session with no environment has no tools", async () => {
      const files = await stack().session({ environment: stack().sandbox("files") })
      const onFiles = stack().provider.script([ModelProvider.text("ok")])
      await files.send(`work ${onFiles.marker}`)
      const offered = (await onFiles.called(1, 60_000)).tools
      expect([offered.includes("read"), offered.includes("edit"), offered.includes("shell")]).toEqual([
        true,
        true,
        false,
      ])
      const none = await stack().session({ environment: false })
      const onNone = stack().provider.script([ModelProvider.text("ok")])
      await none.send(`work ${onNone.marker}`)
      const tools = (await onNone.called(1, 60_000)).tools
      expect(tools.filter((name) => ["read", "edit", "write", "glob", "grep", "shell"].includes(name))).toEqual([])
    }, 600_000)

    test("two sessions on one container each see only their own folder", async () => {
      const one = await stack().session()
      const two = await stack().session()
      expect(await one.tool("shell", { command: "echo mine > mine.txt; ls" })).toBe("mine.txt\n")
      expect(await two.tool("shell", { command: "ls; pwd" })).toBe(`/workspace/${two.sessionId}\n`)
    }, 600_000)

    test("interrupting a turn stops its command in the container", async () => {
      const session = await stack().session()
      await session.turn([ModelProvider.tool("shell", { command: "echo $$ > run.pid; exec sleep 120" })])
      const pid = await pidOf(session, "run.pid")
      expect((await session.opencode.session.interrupt({ sessionID: session.sessionId })).interrupted).toBe(true)
      await stops(pid, 15_000)
    }, 600_000)

    test("a command after the environment token expired gets a new token from the server", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo first" })).toBe("first\n")
      const before = stack().issued()
      // ast-grep-ignore: no-test-sleep -- the server's 20 second token must expire in real time
      await Bun.sleep(25_000)
      expect(await session.tool("shell", { command: "echo refreshed" })).toBe("refreshed\n")
      expect(stack().issued() - before).toBeGreaterThanOrEqual(1)
    }, 600_000)

    test("a container restarted during a command ends the call with a disconnect notice, and the next call works", async () => {
      const session = await stack().session()
      const started = Date.now()
      const turn = await session.turn([
        ModelProvider.tool("shell", { command: "echo $$ > restart.pid; sleep 20; echo finished" }),
        ModelProvider.text("ok"),
      ])
      await pidOf(session, "restart.pid")
      await full().container.restart()
      full().retarget()
      const result = (await turn.called(2, 120_000)).toolResults
      expect([result.includes("environment disconnected"), result.includes("finished")]).toEqual([true, false])
      expect(Date.now() - started).toBeLessThan(60_000)
      await session.settled()
      expect(await session.tool("shell", { command: "echo back" })).toBe("back\n")
    }, 600_000)

    test("a network cut between the cell and the container during a command does not lose the command", async () => {
      const session = await stack().session()
      const turn = await session.turn([
        ModelProvider.tool("shell", { command: "echo $$ > cut.pid; sleep 4; echo $((40 + 2))" }),
        ModelProvider.text("ok"),
      ])
      await pidOf(session, "cut.pid")
      full().proxy().partition(true)
      full().proxy().cutAll()
      // ast-grep-ignore: no-test-sleep -- the network stays cut for a real time
      await Bun.sleep(5_000)
      full().proxy().partition(false)
      const got = await turn
        .called(2, 120_000)
        .then((call) => call.toolResults)
        .catch(async (error: unknown) => {
          await Bun.write(
            "/private/var/folders/cj/cqbh8v8d00x_rkcsjs_tqn380000gn/T/opencode/cell-cut.log",
            await stack().cell.logs(),
          )
          throw error
        })
      expect(got).toBe("42\n")
      await session.settled()
      expect(await session.tool("shell", { command: "echo $((1 + 2))" })).toBe("3\n")
    }, 600_000)

    test("a call to a paused container fails in its time limit with a clear cause, and works after the thaw", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo ready" })).toBe("ready\n")
      await full().container.freeze()
      const started = Date.now()
      const frozen = await session.tool("shell", { command: "echo frozen" }, 180_000)
      await full().container.thaw()
      expect([frozen.includes("does not answer"), Date.now() - started < 120_000]).toEqual([true, true])
      expect(await session.tool("shell", { command: "echo thawed" })).toBe("thawed\n")
    }, 600_000)

    test("a command works while the server is down, fails after the token expires, and works 30 seconds after the failure when the server is back", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo up" })).toBe("up\n")
      await stack().stopServer()
      const down = await session.tool("shell", { command: "echo cached" })
      // ast-grep-ignore: no-test-sleep -- the server's 20 second token must expire in real time
      await Bun.sleep(25_000)
      const expired = await session.tool("shell", { command: "echo expired" })
      await stack().startServer()
      expect([down, expired.includes("Ren does not answer")]).toEqual(["cached\n", true])
      // ast-grep-ignore: no-test-sleep -- the brain asks Ren again 30 seconds after a failure, in real time
      await Bun.sleep(Duration.toMillis(Environments.retryRenAfter) + 1_000)
      expect(await session.tool("shell", { command: "echo back" })).toBe("back\n")
    }, 600_000)

    test("a server restarted between a token and its refresh gives the refresh", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo before" })).toBe("before\n")
      await stack().restartServer()
      const before = stack().issued()
      // ast-grep-ignore: no-test-sleep -- the server's 20 second token must expire in real time
      await Bun.sleep(25_000)
      expect(await session.tool("shell", { command: "echo after" })).toBe("after\n")
      expect(stack().issued() - before).toBeGreaterThanOrEqual(1)
    }, 600_000)

    test("a cell that crashes during a command: the command stops within the orphan time, and a start without the environment keeps it", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo kept > kept.txt" })).toBe("(no output)")
      await session.turn([ModelProvider.tool("shell", { command: "echo $$ > crash.pid; exec sleep 120" })])
      const pid = await pidOf(session, "crash.pid")
      const crashedAt = Date.now()
      await stack().restartCell()
      await stops(pid, 45_000)
      expect(Date.now() - crashedAt).toBeLessThan(35_000)
      await session.start({ withoutEnvironment: true })
      expect(await session.tool("shell", { command: "cat kept.txt; pwd" })).toBe(
        `kept\n/workspace/${session.sessionId}\n`,
      )
    }, 600_000)

    test("a container replaced at a new URL: the first call finds the old one gone, and the next runs in the new, empty workspace", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo old > old.txt; ls" })).toBe("old.txt\n")
      await full().replaceAtNewUrl()
      const first = await session.tool("shell", { command: "echo first" })
      expect(first === "first\n" || first.includes("does not answer")).toBe(true)
      expect(await session.tool("shell", { command: "ls -a; echo listed" })).toBe(".\n..\nlisted\n")
    }, 600_000)

    // oxlint-disable-next-line ren/no-comments -- D48 finds a replaced sandbox only when the old one stops answering; one at the same URL answers, so the folder is missing until the next refresh.
    test.todo("a container replaced at the same URL runs the next call in the new, empty workspace", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo old > old.txt; ls" })).toBe("old.txt\n")
      await full().replaceAtSameUrl()
      expect(await session.tool("shell", { command: "ls -a; echo listed" })).toBe(".\n..\nlisted\n")
    })

    test("a refused token request names the cause, the brain does not ask again for 30 seconds, and then the call works", async () => {
      const session = await stack().session()
      const rule = stack().renProxy.inject(
        { operation: "POST /brain/environment/access" },
        { type: "status", status: 403 },
        1,
      )
      const refused = await session.tool("shell", { command: "echo refused" })
      expect([rule.applied(), refused.includes("Unable to execute"), refused.includes("refused\n")]).toEqual([
        true,
        true,
        false,
      ])
      const asked = stack().issued()
      expect(await session.tool("shell", { command: "echo soon" })).toContain("StatusCode error (403 POST")
      expect(stack().issued()).toBe(asked)
      // ast-grep-ignore: no-test-sleep -- the brain asks Ren again 30 seconds after a failure, in real time
      await Bun.sleep(Duration.toMillis(Environments.retryRenAfter) + 1_000)
      expect(await session.tool("shell", { command: "echo allowed" })).toBe("allowed\n")
    }, 600_000)
  },
)
