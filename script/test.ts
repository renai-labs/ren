import fs from "fs/promises"
import os from "os"
import path from "path"
import { Budget } from "@ren/test-harness/budget"
import { Homes } from "@ren/test-harness/homes"

const started = performance.now()
const requested = Number(process.env.REN_TEST_WORKERS ?? 2)
if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("REN_TEST_WORKERS must be a positive integer")
if (
  process.argv.slice(2).some((arg) => arg === "--parallel" || arg.startsWith("--parallel=") || arg === "--no-isolate")
) {
  throw new Error("Set REN_TEST_WORKERS to select the worker count; test files must remain isolated")
}
const memory = Number(process.env.REN_TEST_MEMORY_MIB ?? 1536)
if (!Number.isSafeInteger(memory) || memory < 1) throw new Error("REN_TEST_MEMORY_MIB must be a positive integer")
const wanted = Math.min(requested, os.availableParallelism())
const reservation = await Budget.acquire({
  purpose: `tests in ${process.env.npm_package_name ?? path.basename(process.cwd())}`,
  unitMiB: memory,
  units: wanted,
  onWait: console.error,
})
process.once("exit", reservation.release)
const workers = reservation.units
if (workers < wanted)
  console.error(`Running ${workers} of ${wanted} test workers to fit the memory budget and free memory`)
const admitted = performance.now()
const home = await Homes.create(Budget.directory)
const temporary = path.join(home, "tmp")
await fs.mkdir(temporary)
const timings = path.join(process.cwd(), ".cache", "test-timings.json")
await fs.mkdir(path.dirname(timings), { recursive: true })

const environment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => {
      if (
        /^(?:AWS|AZURE|GOOGLE|GCP|OPENAI|ANTHROPIC|GEMINI|XAI|CLOUDFLARE|E2B|SLACK|LINEAR|GITHUB|NPM_CONFIG)_/i.test(
          name,
        )
      ) {
        return false
      }
      return !/(?:^|_)(?:API_KEY|AUTHORIZATION|TOKEN|SECRET|PASSWORD|CREDENTIALS?)$/i.test(name)
    }),
  ),
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  XDG_STATE_HOME: path.join(home, ".local", "state"),
  TMPDIR: temporary,
  REN_TEST_HOME_ROOT: home,
}

const ready = performance.now()
const child = Bun.spawn({
  cmd: [
    process.execPath,
    "test",
    "--no-orphans",
    `--parallel=${workers}`,
    "--preload",
    new URL(import.meta.resolve("@ren/test-harness/isolate")).pathname,
    "--timings",
    timings,
    "--update-timings",
    "--only-failures",
    ...(process.env.REN_SLOW ? [] : ["--path-ignore-patterns", "**/*.slow.test.ts"]),
    ...process.argv.slice(2),
  ],
  env: environment,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
const interrupt = () => child.kill("SIGINT")
const terminate = () => child.kill("SIGTERM")
process.once("SIGINT", interrupt)
process.once("SIGTERM", terminate)
const result = await child.exited
const exited = performance.now()
process.off("SIGINT", interrupt)
process.off("SIGTERM", terminate)
await fs.rm(home, { recursive: true, force: true })
if (process.env.REN_TEST_PROFILE) {
  const ended = performance.now()
  console.error(
    JSON.stringify({
      harness: "runner",
      workers,
      waitMs: Math.round(admitted - started),
      setupMs: Math.round(ready - admitted),
      childMs: Math.round(exited - ready),
      cleanupMs: Math.round(ended - exited),
      totalMs: Math.round(ended - started),
      exitCode: result,
    }),
  )
}

process.exitCode = result
