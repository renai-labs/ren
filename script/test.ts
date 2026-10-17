import fs from "fs/promises"
import os from "os"
import path from "path"

const home = await fs.mkdtemp(path.join(os.tmpdir(), "ren-test-"))
const temporary = path.join(home, "tmp")
await fs.mkdir(temporary)

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
}

const child = Bun.spawn({
  cmd: [
    process.execPath,
    "test",
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
process.off("SIGINT", interrupt)
process.off("SIGTERM", terminate)
await fs.rm(home, { recursive: true, force: true })

process.exitCode = result
