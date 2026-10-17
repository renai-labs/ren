import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Brain } from "@ren/schema/brain"
import { Effect, Stream } from "effect"
import os from "node:os"
import { ExecutorAdapter } from "../lib/adapters/executor.js"
import { ExecutorDriver } from "../lib/drivers/executor.js"
import { Platform } from "../lib/platform.js"
import { Wait } from "../lib/wait.js"

describe.skipIf(Platform.docker !== undefined)("an executor in a container", () => {
  const brain = Brain.ID.create()
  const lane: { container?: ExecutorAdapter.Container; driver?: ExecutorDriver.Driver } = {}

  const current = () => {
    if (!lane.container || !lane.driver) throw new Error("the container did not start")
    return { container: lane.container, driver: lane.driver }
  }

  beforeAll(async () => {
    lane.container = await ExecutorAdapter.dockerContainer({ label: "executor-docker" })
    lane.driver = await ExecutorDriver.connect(
      lane.container.url(),
      await ExecutorAdapter.token(lane.container.environmentId, brain),
    )
  }, 300_000)

  afterAll(async () => {
    await lane.driver?.dispose()
    await lane.container?.dispose()
  })

  const run = async (script: string) => {
    const driver = current().driver
    const spawned = await driver.ok(driver.client["process.spawn"]({ command: "sh", arguments: ["-c", script] }))
    return driver.output(spawned.id, 60_000)
  }

  const serves = async () => {
    const driver = current().driver
    const started = performance.now()
    const hello = await driver.ok(driver.client["executor.hello"]())
    return { protocol: hello.protocol, ms: performance.now() - started }
  }

  test("filling the workspace fails the write visibly and the executor keeps serving", async () => {
    const output = await run("head -c 100000000 /dev/zero > big.bin; echo status=$?; rm -f big.bin")
    expect(output.stdout).not.toContain("status=0")
    const driver = current().driver
    await driver.ok(driver.client["files.write"]({ path: "after.txt", bytes: new TextEncoder().encode("ok") }))
    expect((await serves()).protocol).toBe(1)
  })

  test("a process that exhausts memory is stopped and the executor keeps serving", async () => {
    const output = await run("bun -e 'const kept=[];for(;;)kept.push(new Uint8Array(1<<24).fill(1))'")
    expect(output.exit).not.toEqual({ type: "exit", exitCode: 0, signal: null })
    expect((await serves()).protocol).toBe(1)
  })

  test("hitting the process limit fails new forks visibly and the executor keeps serving", async () => {
    const output = await run(
      `trap "echo stopped" TERM; (i=0; while [ $i -lt 400 ]; do sleep 30 >/dev/null 2>&1 & i=$((i+1)); done) 2>/dev/null; echo status=$?; kill -TERM 0; wait`,
    )
    expect(output.stdout).toMatch(/status=[1-9]/)
    expect((await serves()).protocol).toBe(1)
    expect((await current().container.observe(["pgrep", "-c", "-f", "sleep 30"])).stdout.trim()).toBe("0")
  })

  test("CPU saturation inside the container leaves the executor answering within a bound", async () => {
    const driver = current().driver
    const busy = await driver.ok(
      driver.client["process.spawn"]({
        command: "sh",
        arguments: ["-c", "for i in 1 2 3 4; do (while :; do :; done) & done; wait"],
      }),
    )
    await run("sleep 1")
    expect((await serves()).ms).toBeLessThan(5_000)
    await driver.ok(driver.client["process.kill"]({ id: busy.id, signal: "SIGKILL" }))
  })

  test("the executor has no path confinement, so the container is the boundary: host paths are absent and system paths read-only", async () => {
    const driver = current().driver
    const host = await driver.run(driver.client["files.stat"]({ path: import.meta.dir }))
    expect(ExecutorDriver.errorTag(host)).toBe("FileNotFoundError")
    const outside = await driver.ok(driver.client["files.read"]({ path: "../etc/hostname" }))
    expect(new TextDecoder().decode(outside.bytes).trim()).not.toBe(os.hostname())
    const system = await driver.run(
      driver.client["files.write"]({ path: "/etc/chaos-escape", bytes: new TextEncoder().encode("x") }),
    )
    expect(ExecutorDriver.errorTag(system)).toBe("OperationFailedError")
  })

  test("after a crash the container has stopped the executor's children and the old process is unknown", async () => {
    const lanes = current()
    const spawned = await lanes.driver.ok(
      lanes.driver.client["process.spawn"]({ command: "sh", arguments: ["-c", "sleep 60 & sleep 60"] }),
    )
    const sleeping = async () => (await lanes.container.observe(["pgrep", "-c", "-x", "sleep"])).stdout.trim()
    await Wait.until("both sleeps to start", 10_000, async () => ((await sleeping()) === "2" ? true : undefined))
    await lanes.container.restart()
    const driver = await ExecutorDriver.connect(
      lanes.container.url(),
      await ExecutorAdapter.token(lanes.container.environmentId, brain),
    )
    lane.driver = driver
    await lanes.driver.dispose()
    expect(await sleeping()).toBe("0")
    const lost = await Effect.runPromiseExit(driver.client["process.output"]({ id: spawned.id }).pipe(Stream.runDrain))
    expect(ExecutorDriver.errorTag(lost)).toBe("ProcessNotFoundError")
  })
})
