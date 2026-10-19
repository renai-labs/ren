export * as Image from "./image.js"

import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const built: { tag: Promise<string> | undefined } = { tag: undefined }

const docker = async (args: ReadonlyArray<string>) => {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" })
  const output = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (output[2] !== 0) throw new Error(`docker ${args[0] ?? ""} exited with ${output[2]}: ${output[1]}`)
  return output[0].trim()
}

export const build = () =>
  (built.tag ??= (async () => {
    const artifact = await mkdtemp(path.join(os.tmpdir(), "ren-executor-image-"))
    const bundled = await Bun.build({
      entrypoints: [path.resolve(import.meta.dir, "../../src/main.ts")],
      target: "bun",
      outdir: artifact,
      naming: "executor.js",
    })
    if (!bundled.success) throw new Error(`bundling the executor failed: ${bundled.logs.map(String).join("\n")}`)
    await Bun.write(path.join(artifact, "Dockerfile"), Bun.file(path.resolve(import.meta.dir, "../../Dockerfile")))
    const hash = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(path.join(artifact, "executor.js")).bytes())
      .digest("hex")
    const tag = `ren-executor:${hash.slice(0, 16)}`
    await docker(["build", "--quiet", "--tag", tag, artifact])
    return tag
  })())
