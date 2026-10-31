export * as Image from "./image.js"

import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const built: { tag: Promise<string> | undefined; mounting: Promise<string> | undefined } = {
  tag: undefined,
  mounting: undefined,
}

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

export const buildMounting = () =>
  (built.mounting ??= (async () => {
    const base = await build()
    const context = await mkdtemp(path.join(os.tmpdir(), "ren-executor-mounting-"))
    await Bun.write(
      path.join(context, "Dockerfile"),
      `FROM ${base}
USER root
RUN apt-get update \\
  && apt-get install --yes --no-install-recommends curl fuse3 unzip \\
  && rm -rf /var/lib/apt/lists/*
RUN version=v1.75.2 arch="$(dpkg --print-architecture)" \\
  && case "$arch" in \\
       amd64) sum=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702 ;; \\
       arm64) sum=7e1e8d69654941b7b7df84ee74c5f7fb09cce7d5496947fb7bf16b55ff427d10 ;; \\
       *) echo "no rclone for $arch" >&2; exit 1 ;; \\
     esac \\
  && curl -fsSL -o /tmp/rclone.zip "https://downloads.rclone.org/$version/rclone-$version-linux-$arch.zip" \\
  && echo "$sum  /tmp/rclone.zip" | sha256sum -c - \\
  && unzip -q -j /tmp/rclone.zip "*/rclone" -d /usr/local/bin \\
  && rm /tmp/rclone.zip
USER bun
`,
    )
    const tag = `${base}-mounting`
    await docker(["build", "--quiet", "--tag", tag, context])
    return tag
  })())
