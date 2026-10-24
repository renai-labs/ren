export * as TestGitHub from "./github.js"

import { Effect } from "effect"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { SkillSource } from "../../src/skill/source.js"

// oxlint-disable-next-line ren/no-comments -- A real Git repository served through the three GitHub endpoints a brain reads: smart-HTTP refs, raw files and commit archives.
export const make = Effect.fnUntraced(function* (options: { readonly owner?: string; readonly repo?: string } = {}) {
  const owner = options.owner ?? "acme"
  const repo = options.repo ?? "skills"
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-github-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  const git = (args: ReadonlyArray<string>) =>
    Effect.promise(async () => {
      const run = Bun.spawn(["git", ...args], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Ren",
          GIT_AUTHOR_EMAIL: "ren@example.com",
          GIT_COMMITTER_NAME: "Ren",
          GIT_COMMITTER_EMAIL: "ren@example.com",
        },
      })
      const output = await new Response(run.stdout).text()
      if ((await run.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(run.stderr).text()}`)
      return output.trim()
    })
  yield* git(["init", "--quiet", "--initial-branch=main"])
  const state = { requests: [] as Array<string>, failing: false }
  const spawned = (args: ReadonlyArray<string>, prefix: Uint8Array = new Uint8Array()) => {
    const run = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "ignore" })
    return new Response(run.stdout)
      .arrayBuffer()
      .then(async (bytes) => ((await run.exited) === 0 ? new Uint8Array([...prefix, ...new Uint8Array(bytes)]) : null))
  }
  const bodyOf = (pathname: string) => {
    if (pathname === `/git/${owner}/${repo}.git/info/refs`)
      return spawned(
        ["upload-pack", "--stateless-rpc", "--advertise-refs", "."],
        new TextEncoder().encode("001e# service=git-upload-pack\n0000"),
      )
    const raw = new RegExp(`^/raw/${owner}/${repo}/([^/]+)/(.+)$`, "u").exec(pathname)
    if (raw) return spawned(["show", `${raw[1]}:${raw[2]}`])
    const archive = new RegExp(`^/archive/${owner}/${repo}/tar\\.gz/([^/]+)$`, "u").exec(pathname)
    if (archive) return spawned(["archive", "--format=tar.gz", `--prefix=${repo}-${archive[1]}/`, `${archive[1]}`])
    return Promise.resolve(null)
  }
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          const url = new URL(request.url)
          state.requests.push(`${url.pathname}${url.search}`)
          if (state.failing) return new Response("unavailable", { status: 503 })
          const body = await bodyOf(url.pathname)
          return body ? new Response(body) : new Response("404: Not Found", { status: 404 })
        },
      }),
    ),
    (served) => Effect.promise(() => served.stop(true)),
  )
  const origin = `http://127.0.0.1:${server.port}`
  return {
    url: `https://github.com/${owner}/${repo}`,
    hosts: { git: `${origin}/git`, raw: `${origin}/raw`, archive: `${origin}/archive` } satisfies SkillSource.Hosts,
    requests: Effect.sync(() => [...state.requests]),
    fail: (isFailing: boolean) =>
      Effect.sync(() => {
        state.failing = isFailing
      }),
    commit: Effect.fnUntraced(function* (files: Readonly<Record<string, string | null>>, branch = "main") {
      if (branch !== "main")
        yield* git(
          (yield* git(["branch", "--list", branch])) === ""
            ? ["checkout", "--quiet", "-b", branch]
            : ["checkout", "--quiet", branch],
        )
      yield* Effect.forEach(Object.entries(files), (entry) =>
        entry[1] === null
          ? git(["rm", "--quiet", "-r", entry[0]])
          : Effect.promise(async () => {
              await mkdir(dirname(join(directory, entry[0])), { recursive: true })
              await Bun.write(join(directory, entry[0]), entry[1] ?? "")
            }).pipe(Effect.andThen(git(["add", entry[0]]))),
      )
      yield* git(["commit", "--quiet", "--allow-empty", "-m", "change"])
      const sha = yield* git(["rev-parse", "HEAD"])
      if (branch !== "main") yield* git(["checkout", "--quiet", "main"])
      return sha
    }),
    tag: (name: string, sha: string) => git(["tag", "-a", name, "-m", name, sha]),
  }
})

export type Instance = Effect.Success<ReturnType<typeof make>>
