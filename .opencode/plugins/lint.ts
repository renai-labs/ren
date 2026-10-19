import { Plugin } from "@opencode/plugin"
import { Option, Schema } from "effect"

const maxResumes = 2
const maxFindings = 50
const mutating = new Set(["edit", "write", "patch", "shell"])
const astGrepExcludes = ["!**/generated/**", "!**/*.gen.ts", "!packages/db/src/auth.sql.ts"]

type Lines = ReadonlyArray<readonly [number, number]> | "all"

interface Finding {
  readonly file: string
  readonly start: number
  readonly end: number
  readonly column: number
  readonly text: string
}

const Oxlint = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      message: Schema.String,
      code: Schema.optional(Schema.NullOr(Schema.String)),
      help: Schema.optional(Schema.NullOr(Schema.String)),
      filename: Schema.String,
      labels: Schema.optional(
        Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Number, column: Schema.Number }) })),
      ),
    }),
  ),
})

const Position = Schema.Struct({ line: Schema.Number, column: Schema.Number })

const AstGrep = Schema.Array(
  Schema.Struct({
    file: Schema.String,
    ruleId: Schema.String,
    message: Schema.String,
    range: Schema.Struct({ start: Position, end: Position }),
  }),
)

const changes = async (root: string) => {
  const diff = await Bun.$`git diff -U0 --no-color --no-ext-diff --no-renames --diff-filter=AM HEAD`
    .cwd(root)
    .quiet()
    .nothrow()
  const untracked = await Bun.$`git ls-files --others --exclude-standard`.cwd(root).quiet().nothrow()
  const tracked = diff.stdout
    .toString()
    .split(/^diff --git /m)
    .flatMap((chunk) => {
      const file = /^\+\+\+ b\/(.+)$/m.exec(chunk)?.[1]
      const ranges = [...chunk.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)]
        .map((match) => [Number(match[1]), Number(match[1]) + Number(match[2] ?? 1) - 1] as const)
        .filter((range) => range[1] >= range[0])
      return file && ranges.length > 0 ? [[file, ranges] as const] : []
    })
  const added = untracked.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((file) => [file, "all"] as const)
  return new Map<string, Lines>([...tracked, ...added])
}

const oxlint = async (root: string, files: ReadonlyArray<string>) => {
  const result =
    await Bun.$`${root}/node_modules/.bin/oxlint --disable-nested-config --type-aware --format json ${files}`
      .cwd(root)
      .quiet()
      .nothrow()
  const output = result.stdout.toString()
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Oxlint))(output.slice(output.indexOf("{")))
  if (Option.isNone(decoded)) {
    console.error("ren.lint: could not read oxlint output", result.stderr.toString())
    return []
  }
  return decoded.value.diagnostics.map((diagnostic): Finding => {
    const lines = (diagnostic.labels ?? []).map((label) => label.span.line)
    return {
      file: diagnostic.filename,
      start: lines.length > 0 ? Math.min(...lines) : 0,
      end: lines.length > 0 ? Math.max(...lines) : 0,
      column: diagnostic.labels?.[0]?.span.column ?? 0,
      text: [`${diagnostic.code ?? "oxlint"}: ${diagnostic.message}`, diagnostic.help].filter(Boolean).join(" "),
    }
  })
}

const astGrep = async (root: string, files: ReadonlyArray<string>) => {
  const scanned = files.filter((file) => file.startsWith("packages/") || file.startsWith("script/"))
  if (scanned.length === 0) return []
  const globs = [...scanned.map((file) => file.replaceAll(/[[\]{}*?]/g, "\\$&")), ...astGrepExcludes].flatMap(
    (glob) => ["--globs", glob],
  )
  const result =
    await Bun.$`${root}/node_modules/.bin/ast-grep scan -c script/ast-grep/sgconfig.yml --json=compact ${globs} packages script`
      .cwd(root)
      .quiet()
      .nothrow()
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(AstGrep))(result.stdout.toString())
  if (Option.isNone(decoded)) {
    console.error("ren.lint: could not read ast-grep output", result.stderr.toString())
    return []
  }
  return decoded.value.map((match): Finding => ({
    file: match.file,
    start: match.range.start.line + 1,
    end: match.range.end.line + 1,
    column: match.range.start.column + 1,
    text: `ast-grep(${match.ruleId}): ${match.message}`,
  }))
}

const check = async (root: string) => {
  const changed = await changes(root)
  if (changed.size === 0) return []
  const files = [...changed.keys()]
  const findings = (await Promise.all([oxlint(root, files), astGrep(root, files)])).flat()
  return findings
    .filter((finding) => {
      const lines = changed.get(finding.file)
      if (!lines) return false
      if (lines === "all" || finding.start === 0) return true
      return lines.some((range) => range[0] <= finding.end && finding.start <= range[1])
    })
    .toSorted((a, b) => a.file.localeCompare(b.file) || a.start - b.start)
}

const report = (findings: ReadonlyArray<Finding>, resume: boolean) =>
  [
    "<system-reminder>",
    resume
      ? "Lint reports problems on changed lines. Fix them before you finish."
      : `Lint still reports problems on changed lines after ${maxResumes} automatic attempts to fix them.`,
    "",
    ...findings
      .slice(0, maxFindings)
      .map((finding) => `${finding.file}:${finding.start}:${finding.column} ${finding.text}`),
    ...(findings.length > maxFindings
      ? [`...and ${findings.length - maxFindings} more. Run \`bun run lint\` to see all of them.`]
      : []),
    "</system-reminder>",
  ].join("\n")

export default Plugin.define({
  id: "ren.lint",
  async setup(ctx) {
    const root = (await Bun.$`git rev-parse --show-toplevel`.cwd(ctx.location.directory).quiet().nothrow()).stdout
      .toString()
      .trim()
    if (!root) return
    const touched = new Set<string>()
    const resumes = new Map<string, number>()

    await ctx.tool.hook("execute.after", (event) => {
      if (mutating.has(event.tool)) touched.add(event.sessionID)
    })
    await ctx.session.hook("prompt", (event) => {
      resumes.delete(event.sessionID)
    })

    const finished = async (sessionID: string) => {
      if (!touched.delete(sessionID)) return
      const findings = await check(root)
      if (findings.length === 0) return
      const attempts = resumes.get(sessionID) ?? 0
      const resume = attempts < maxResumes
      resumes.set(sessionID, attempts + 1)
      await ctx.session.synthetic({ sessionID, text: report(findings, resume), description: "Lint findings", resume })
    }

    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "session.execution.succeeded") continue
        await finished(event.data.sessionID).catch((error: unknown) => console.error("ren.lint: check failed", error))
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) console.error("ren.lint: event stream ended", error)
    })
    return () => controller.abort()
  },
})
