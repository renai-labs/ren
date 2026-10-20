import { afterEach, describe, expect, test } from "bun:test"
import { EnvironmentClient } from "@ren/environment-api/environment-client"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { E2BEnvironment } from "../lib/adapters/e2b.js"
import { ExecutorAdapter } from "../lib/adapters/executor.js"
import { ExecutorDriver } from "../lib/drivers/executor.js"
import { Ledger } from "../lib/ledger.js"
import { Platform } from "../lib/platform.js"
import { Wait } from "../lib/wait.js"

const cleanups: Array<() => Promise<unknown>> = []

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
})

const hello = (url: string, authorization?: string) =>
  fetch(`${url}${EnvironmentClient.path}`, {
    method: "POST",
    headers: { "content-type": "application/ndjson", ...(authorization !== undefined && { authorization }) },
    body: `${JSON.stringify({ _tag: "Request", id: "1", tag: "executor.hello", payload: {}, headers: [] })}\n`,
  }).then(
    (response) => response.status,
    () => 0,
  )

const sandbox = async (environmentId = Environment.ID.create(), timeoutSeconds = 300) => {
  const created = await E2BEnvironment.create({ environmentId, timeoutSeconds })
  cleanups.push(() => created.kill())
  await E2BEnvironment.ready(created.url)
  const brain = Brain.ID.create()
  const connect = async (lifetimeMs?: number) => {
    const driver = await ExecutorDriver.connect(
      created.url,
      await ExecutorAdapter.token(created.environmentId, brain, lifetimeMs),
    )
    cleanups.push(driver.dispose)
    return driver
  }
  return { created, connect }
}

describe.skipIf(Platform.e2b !== undefined)("an executor in an E2B sandbox", () => {
  test("a sandbox from the pinned template serves the executor and refuses unauthenticated work", async () => {
    const environment = await sandbox()
    const driver = await environment.connect()
    const greeting = await driver.ok(driver.client["executor.hello"]())
    expect(greeting.environmentId).toBe(environment.created.environmentId)
    expect(await hello(environment.created.url)).toBe(401)
  }, 600_000)

  test("a paused sandbox resumes with fresh access and an earlier command does not run twice", async () => {
    const environment = await sandbox()
    const shortLived = await environment.connect(15_000)
    const marker = Ledger.marker("e2b-pause")
    await shortLived.ok(
      shortLived.client["process.spawn"]({ command: "sh", arguments: ["-c", `${Ledger.append(marker)}; sleep 600`] }),
    )
    await environment.created.pause()
    await Wait.until("the sandbox to report paused", 60_000, async () =>
      (await environment.created.state()) === "paused" ? true : undefined,
    )
    // ast-grep-ignore: no-test-sleep -- the short-lived token must expire while the sandbox is paused
    await Bun.sleep(20_000)
    await environment.created.resume()
    await E2BEnvironment.ready(environment.created.url)
    expect(ExecutorDriver.errorTag(await shortLived.run(shortLived.client["executor.hello"]()))).toBe(
      "UnauthorizedError",
    )
    const fresh = await environment.connect()
    const ledger = await fresh.ok(fresh.client["files.read"]({ path: Ledger.file }))
    expect(
      new TextDecoder()
        .decode(ledger.bytes)
        .split("\n")
        .filter((line) => line === marker),
    ).toHaveLength(1)
  }, 600_000)

  test("racing a timeout extension with a pause settles in a state that matches reachability", async () => {
    const environment = await sandbox(Environment.ID.create(), 60)
    await Promise.allSettled([environment.created.extend(300), environment.created.pause()])
    const state = await Wait.until("E2B to report a settled state", 60_000, async () => {
      const read = await environment.created.state()
      return read === "running" || read === "paused" ? read : undefined
    })
    expect((await hello(environment.created.url)) === 401).toBe(state === "running")
  }, 600_000)

  test("a killed sandbox's endpoint is gone and its replacement for the environment starts empty", async () => {
    const first = await sandbox()
    const driver = await first.connect()
    await driver.ok(driver.client["files.write"]({ path: "generation.txt", bytes: new TextEncoder().encode("one") }))
    await first.created.kill()
    expect(await hello(first.created.url)).not.toBe(401)
    const replacement = await sandbox(first.created.environmentId)
    expect(replacement.created.url).not.toBe(first.created.url)
    const next = await replacement.connect()
    expect(ExecutorDriver.errorTag(await next.run(next.client["files.stat"]({ path: "generation.txt" })))).toBe(
      "FileNotFoundError",
    )
  }, 600_000)
})
