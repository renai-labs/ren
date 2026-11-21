const targets = process.argv.slice(2)
const paths = targets.length === 0 ? ["packages", "script"] : targets

const site = paths.some((each) => each === "packages" || each === "packages/site" || each.startsWith("packages/site/"))
if (site && !(await Bun.file("packages/site/.astro/types.d.ts").exists())) {
  const sync = await Bun.$`bun run --cwd packages/site sync`.nothrow()
  if (sync.exitCode !== 0) process.exit(sync.exitCode)
}

const typed = await Bun.$`bun run oxlint --disable-nested-config --type-aware --deny-warnings ${paths}`.nothrow()
const config = await Bun.$`bun run oxlint --disable-nested-config --deny-warnings oxlint.config.ts`.nothrow()
process.exitCode = typed.exitCode !== 0 ? typed.exitCode : config.exitCode
