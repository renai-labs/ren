export * as CliBuild from "./build.js"

import { Schema } from "effect"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import pkg from "../package.json"

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    version: { type: "string", default: pkg.version },
    target: { type: "string", default: `${process.platform}-${process.arch}` },
    outdir: { type: "string", default: "dist" },
  },
})
const version = Schema.decodeUnknownSync(
  Schema.String.check(
    Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u),
  ),
)(args.values.version)
const target = Schema.decodeUnknownSync(Schema.Literals(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]))(
  args.values.target,
)
const name = `ren2-${target}`
const host = new URL(process.env.REN2_HOST_URL ?? "https://v2.useren.ai")
if (
  !["http:", "https:"].includes(host.protocol) ||
  host.pathname !== "/" ||
  host.search ||
  host.hash ||
  host.username ||
  host.password
)
  throw new Error("REN2_HOST_URL must be an HTTP or HTTPS origin")
const api = new URL(process.env.REN2_API_URL ?? "http://localhost:4000")
if (!["http:", "https:"].includes(api.protocol)) throw new Error("REN2_API_URL must be an HTTP or HTTPS URL")
const folder = resolve(args.values.outdir, "releases", version)
const outfile = resolve(folder, name)
await mkdir(folder, { recursive: true })
const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  target: "bun",
  minify: true,
  define: { REN2_VERSION: JSON.stringify(version), REN2_API_URL: JSON.stringify(api.origin) },
  compile: {
    target: target === "linux-x64" ? "bun-linux-x64-baseline" : `bun-${target}`,
    outfile,
    autoloadDotenv: false,
    autoloadBunfig: false,
    autoloadTsconfig: false,
    autoloadPackageJson: false,
  },
})
if (!result.success) throw new AggregateError(result.logs, "CLI build failed")
const digest = new Bun.CryptoHasher("sha256").update(await Bun.file(outfile).arrayBuffer()).digest("hex")
await Bun.write(`${outfile}.sha256`, `${digest}  ${name}\n`)
await Bun.write(
  resolve(args.values.outdir, "install.sh"),
  (await Bun.file(new URL("../install.sh", import.meta.url)).text()).replace(
    "__REN2_HOST_URL__",
    host.origin.replaceAll("'", "'\\''"),
  ),
)
process.stdout.write(`${outfile}\n`)
