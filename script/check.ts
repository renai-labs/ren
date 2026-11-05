import path from "path"
import { Schema } from "effect"
import { Changed } from "./changed.js"

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

const run = await Bun.$`bun turbo run --concurrency=3 --output-logs=errors-only ${[
  ...(await tasks(`...[${base}]`, "typecheck")),
  ...(await tasks(`[${base}]`, "lint")),
  "//#typecheck:root",
  "//#lint:root",
  "//#lint:rules",
  "//#format:check",
]}`.nothrow()
process.exitCode = run.exitCode
