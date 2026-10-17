import path from "node:path"
import { ExecutorAdapter } from "../../chaos/lib/adapters/executor.js"

const folder = path.resolve(import.meta.dir, "../../chaos/infra/e2b")

const bundled = await Bun.build({
  entrypoints: [ExecutorAdapter.mainPath],
  target: "bun",
  outdir: folder,
  naming: "executor.js",
})
if (!bundled.success) throw new Error(`bundling the executor failed: ${bundled.logs.map(String).join("\n")}`)

const hash = new Bun.CryptoHasher("sha256")
  .update(await Bun.file(path.join(folder, "executor.js")).bytes())
  .digest("hex")
process.stdout.write(`Executor artifact sha256 ${hash}\n`)

const build = Bun.spawn(["e2b", "template", "build", "--path", folder, "--config", path.join(folder, "e2b.toml")], {
  stdio: ["inherit", "inherit", "inherit"],
})
const exit = await build.exited
process.stdout.write(
  exit === 0
    ? "Set CHAOS_E2B_TEMPLATE to the template ID.\n"
    : "The E2B template build failed.\n",
)
process.exit(exit)
