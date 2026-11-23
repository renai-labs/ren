import { afterEach, beforeEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const bot = "ren-test[bot] <9001+ren-test[bot]@users.noreply.github.com>"
const ada = "ada-gh <42+ada-gh@users.noreply.github.com>"

let root = ""

const git = (args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) => {
  const run = Bun.spawnSync(["git", ...args], {
    cwd: join(root, "repo"),
    env: {
      PATH: Bun.env.PATH ?? "",
      HOME: root,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_PARAMETERS: `'core.hooksPath'='${join(root, "hooks")}'`,
      GIT_AUTHOR_NAME: "ren-test[bot]",
      GIT_AUTHOR_EMAIL: "9001+ren-test[bot]@users.noreply.github.com",
      GIT_COMMITTER_NAME: "ren-test[bot]",
      GIT_COMMITTER_EMAIL: "9001+ren-test[bot]@users.noreply.github.com",
      REN_CO_AUTHORS: `${ada}\n${bot}`,
      ...env,
    },
  })
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`)
  return { stdout: run.stdout.toString(), stderr: run.stderr.toString() }
}

const message = () => git(["log", "-1", "--format=%B"]).stdout.trim()

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ren-git-hook-"))
  await mkdir(join(root, "hooks"))
  await Promise.all(
    ["prepare-commit-msg", "commit-msg"].map((name) =>
      symlink(join(import.meta.dir, "../machine/git-hook.sh"), join(root, "hooks", name)),
    ),
  )
  await mkdir(join(root, "repo"))
  git(["init", "--quiet"])
  git(["remote", "add", "origin", "https://github.com/acme/app.git"])
})

afterEach(() => rm(root, { recursive: true, force: true }))

test("a commit by the bot credits the chat's person once, and not the bot again, also on an amend", () => {
  git(["commit", "--quiet", "--allow-empty", "-m", "feat: one"])
  git(["commit", "--quiet", "--allow-empty", "--amend", "--no-verify", "-m", `feat: one\n\nCo-authored-by: ${ada}`])
  expect(message()).toBe(`feat: one\n\nCo-authored-by: ${ada}`)
})

test("a commit by the person credits the bot", () => {
  git(["commit", "--quiet", "--allow-empty", "-m", "feat: one"], {
    GIT_AUTHOR_NAME: "ada-gh",
    GIT_AUTHOR_EMAIL: "42+ada-gh@users.noreply.github.com",
  })
  expect(message()).toBe(`feat: one\n\nCo-authored-by: ${bot}`)
})

test("the repository's own hook still runs, from its core.hooksPath", async () => {
  await mkdir(join(root, "repo", ".husky"))
  await Bun.write(join(root, "repo", ".husky", "commit-msg"), "#!/bin/sh\necho 'own hook' >&2\n")
  await chmod(join(root, "repo", ".husky", "commit-msg"), 0o755)
  git(["config", "core.hooksPath", ".husky"])
  expect(git(["commit", "--quiet", "--allow-empty", "-m", "feat: one"]).stderr).toContain("own hook")
  expect(message()).toBe(`feat: one\n\nCo-authored-by: ${ada}`)
})

test("a repository whose remotes are on another host gets no trailer", () => {
  git(["remote", "set-url", "origin", "https://gitlab.com/acme/app.git"])
  git(["commit", "--quiet", "--allow-empty", "-m", "feat: one"])
  expect(message()).toBe("feat: one")
})
