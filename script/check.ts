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
const dependencies =
  (
    await Bun.$`git diff --name-only ${base} -- bun.lock package.json packages/mobile/package.json packages/mobile/app.config.ts packages/mobile/eas.json packages/mobile/metro.config.ts`.text()
  ).trim() !== ""

const run = await Bun.$`bun turbo run --continue=dependencies-successful --output-logs=errors-only ${[
  ...(await tasks(`...[${base}]`, "typecheck")),
  ...(mobile ? ["@ren/mobile#check:bundle:fast", "@ren/mobile#check:generated"] : []),
  ...(dependencies ? ["@ren/mobile#check:doctor"] : []),
  "//#typecheck:root",
  "//#lint:rules",
  "//#format:check",
]}`.nothrow()

const changed = [
  ...(await Bun.$`git diff --name-only ${base}`.text()).split("\n"),
  ...(await Bun.$`git ls-files --others --exclude-standard`.text()).split("\n"),
].filter((file) => file !== "")
const everything = changed.some(
  (file) =>
    file === "oxlint.config.ts" ||
    file === "tsconfig.base.json" ||
    file === "bun.lock" ||
    file.startsWith("script/oxlint/"),
)
const lintPaths = everything
  ? []
  : [
      ...(await Changed.packages(`[${base}]`)).map((pkg) => pkg.path).filter((each) => each.startsWith("packages/")),
      ...(changed.some((file) => file.startsWith("script/")) ? ["script"] : []),
    ]
const lint = everything || lintPaths.length > 0 ? await Bun.$`bun script/lint.ts ${lintPaths}`.nothrow() : undefined
process.exitCode = run.exitCode === 0 ? (lint?.exitCode ?? 0) : run.exitCode
