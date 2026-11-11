export * as CloudflareBrain from "./cloudflare.js"

import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Process } from "../process.js"

const cell = path.resolve(path.dirname(Bun.resolveSync("@ren/cell/testing", import.meta.dir)), "../..")

const wrangler = async (args: ReadonlyArray<string>, cwd: string, input?: string) => {
  const child = Bun.spawn(["node", path.join(cell, "node_modules/wrangler/wrangler-dist/cli.js"), ...args], {
    cwd,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (output[2] !== 0)
    throw new Error(`wrangler ${args[0] ?? ""} exited with ${output[2]}: ${`${output[0]}\n${output[1]}`.slice(-2000)}`)
}

export const deploy = async (options: {
  readonly label: string
  readonly vars: Readonly<Record<string, string>>
  readonly secrets: Readonly<Record<string, string>>
}) => {
  const name = `ren-chaos-${options.label}-${crypto.randomUUID().slice(0, 6)}`
  const project = await mkdtemp(path.join(os.tmpdir(), "ren-chaos-cloudflare-"))
  const config = path.join(project, "wrangler.jsonc")
  await Bun.write(
    config,
    (await Bun.file(path.join(cell, "wrangler.jsonc")).text())
      .replace('"name": "ren-cell-opencode"', `"name": ${JSON.stringify(name)}`)
      .replace('"src/worker.ts"', JSON.stringify(path.join(cell, "src/worker.ts")))
      .replace(/\}\s*$/, `, "vars": ${JSON.stringify(options.vars)} }`),
  )
  const push = async () => {
    await wrangler(["deploy", "--config", config], project)
    await wrangler(["secret", "bulk", "--config", config], project, JSON.stringify(options.secrets))
  }
  const remove = () => wrangler(["delete", "--config", config, "--force"], project)
  await push()
  const forget = Process.onInterrupt(remove)
  const base = process.env.CHAOS_CLOUDFLARE_URL ?? ""
  return {
    url: base.replace("{name}", name),
    redeploy: push,
    remove: async () => {
      forget()
      await remove()
    },
  }
}
