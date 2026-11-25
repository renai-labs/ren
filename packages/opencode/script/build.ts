export * as OpenCodeBuild from "./build.js"

import { rm } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { Schema } from "effect"
import pkg from "../package.json"
import { Support } from "../src/support.js"

const provided = ["effect", "@opencode/plugin", "solid-js", "@opentui/core", "@opentui/solid"]

export const build = async (options: { readonly outdir: string; readonly version: string }) => {
  const version = Schema.decodeUnknownSync(
    Schema.String.check(
      Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u),
    ),
  )(options.version)
  await rm(options.outdir, { recursive: true, force: true })
  const result = await Bun.build({
    entrypoints: ["server.ts", "tui.tsx", "rpc.ts"].map((file) =>
      fileURLToPath(new URL(`../src/${file}`, import.meta.url)),
    ),
    outdir: options.outdir,
    target: "bun",
    format: "esm",
    splitting: true,
    external: provided.flatMap((name) => [name, `${name}/*`]),
    plugins: [createSolidTransformPlugin()],
    metafile: true,
  })
  if (!result.success || !result.metafile) throw new AggregateError(result.logs, "The plugin build failed")
  const inputs = Object.keys(result.metafile.inputs).map((file) => resolve(file))
  const copies = inputs.filter((file) => provided.some((name) => file.includes(`/node_modules/${name}/`)))
  if (copies.length > 0) throw new Error(`The bundle holds a copy of what OpenCode provides: ${copies.join(", ")}`)
  await Bun.write(
    resolve(options.outdir, "package.json"),
    `${JSON.stringify(
      {
        name: pkg.name,
        version,
        description: "Ren in OpenCode: run sessions on Ren brains from the OpenCode TUI.",
        type: "module",
        license: pkg.license,
        exports: { ".": "./server.js", "./tui": "./tui.js", "./rpc": "./rpc.js" },
        files: result.outputs.map((output) => basename(output.path)),
        peerDependencies: {
          "@opencode/plugin": Support.opencode,
          "@opentui/core": "^0.8.1",
          "@opentui/solid": "^0.8.1",
          effect: "^4.1.0",
          "solid-js": "^1.9.17",
        },
        peerDependenciesMeta: Object.fromEntries(provided.map((name) => [name, { optional: true }])),
        publishConfig: { access: "public" },
      },
      null,
      2,
    )}\n`,
  )
  return { inputs, outputs: result.outputs.map((output) => ({ path: output.path, size: output.size })) }
}

if (import.meta.main) {
  const args = parseArgs({
    args: process.argv.slice(2),
    options: {
      version: { type: "string", default: pkg.version },
      outdir: { type: "string", default: fileURLToPath(new URL("../dist", import.meta.url)) },
    },
  })
  const built = await build({ outdir: resolve(args.values.outdir), version: args.values.version })
  for (const output of built.outputs) process.stdout.write(`${output.path} ${(output.size / 1024).toFixed(1)} KiB\n`)
}
