import path from "path"
import { Schema } from "effect"
import { Changed } from "./changed.js"

await Bun.$`bun ${new URL("./opencode-lock.ts", import.meta.url).pathname}`

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

const mobile = (await Changed.packages(`...[${base}]`)).some((pkg) => pkg.name === "@ren/mobile")

const run = await Bun.$`bun turbo run --continue=dependencies-successful --output-logs=errors-only ${[
  ...(await tasks(`...[${base}]`, "typecheck")),
  ...(await tasks(`[${base}]`, "lint")),
  ...(mobile ? ["@ren/mobile#check:bundle", "@ren/mobile#check:generated", "@ren/mobile#check:doctor"] : []),
  "//#typecheck:root",
  "//#lint:root",
  "//#lint:rules",
  "//#format:check",
]}`.nothrow()
process.exitCode = run.exitCode
