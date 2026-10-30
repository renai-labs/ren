import path from "path"
import { Signoff } from "./signoff.js"

const command = process.argv.slice(2)
const script = process.env.npm_lifecycle_event
const name = process.env.npm_package_name
const runAsWritten =
  script !== undefined &&
  name !== undefined &&
  process.env.npm_lifecycle_script?.split(" ").slice(2).join(" ") === command.join(" ")
    ? { package: name, script }
    : undefined
const before = runAsWritten === undefined ? undefined : await Signoff.fingerprint()
const started = performance.now()

const child = Bun.spawn({
  cmd: command,
  env: process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env,
  stdin: "inherit",
  stdout: "pipe",
  stderr: "pipe",
})
process.once("SIGINT", () => child.kill("SIGINT"))
process.once("SIGTERM", () => child.kill("SIGTERM"))
const capture = async (stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream) => {
  const decoder = new TextDecoder()
  let text = ""
  for await (const chunk of stream) {
    sink.write(chunk)
    text += decoder.decode(chunk, { stream: true })
  }
  return text
}
const output = Bun.stripANSI(
  (await Promise.all([capture(child.stdout, process.stdout), capture(child.stderr, process.stderr)])).join("\n"),
)
const code = await child.exited
const durationMs = Math.round(performance.now() - started)

if (
  runAsWritten !== undefined &&
  before !== undefined &&
  child.signalCode === null &&
  code < 128 &&
  (await Signoff.fingerprint()) === before
) {
  const tests = /^\s*(\d+) pass$/m.exec(output)?.[1]
  const run: Signoff.Run = {
    ...runAsWritten,
    passed: code === 0,
    ...(tests === undefined ? {} : { tests: Number(tests) }),
    durationMs,
  }
  await Bun.write(
    path.join(await Signoff.runsDirectory(before), `${encodeURIComponent(`${run.package}#${run.script}`)}.json`),
    JSON.stringify(run),
  )
}

process.exitCode = code
