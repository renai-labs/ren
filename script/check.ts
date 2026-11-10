import path from "path"
import { Budget } from "@ren/test-harness/budget"
import { Schema } from "effect"
import { Changed } from "./changed.js"

await Bun.$`bun ${new URL("./opencode-lock.ts", import.meta.url).pathname}`

const wanted = 3
const reservation = await Budget.acquire({
  purpose: "bun run check",
  unitMiB: 2048,
  units: wanted,
  onWait: console.error,
})
process.once("exit", reservation.release)
if (reservation.units < wanted)
  console.error(`Running ${reservation.units} of ${wanted} checks at a time to fit the memory budget and free memory`)

const base = await Changed.base()
const PackageJson = Schema.Struct({ scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)) })
const tasks = async (filter: string, script: string) =>
  (
    await Promise.all(
      (await Changed.packages(filter)).map(async (pkg) =>
        Schema.decodeUnknownSync(PackageJson)(await Bun.file(path.join(pkg.path, "package.json")).json()).scripts?.[
          script
        ] === undefined
          ? []
          : [`${pkg.name}#${script}`],
      ),
    )
  ).flat()

const run = await Bun.$`bun turbo run --concurrency=${reservation.units} --output-logs=errors-only ${[
  ...(await tasks(`...[${base}]`, "typecheck")),
  ...(await tasks(`[${base}]`, "lint")),
  "//#typecheck:root",
  "//#lint:root",
  "//#lint:rules",
  "//#format:check",
]}`.nothrow()
process.exitCode = run.exitCode
