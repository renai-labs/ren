export * as TestGitHub from "./github.js"

import { Effect } from "effect"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { GitHubReader } from "../../src/github/reader.js"

// oxlint-disable-next-line ren/no-comments -- What GitHub, or the egress before it, answers to the ren:GITHUB placeholder: the egress put a token that reads the repository, the runtime has no egress (401), the space has no credential (403 from the egress) or the token cannot read the repository (404).
export type Placeholder = "accepted" | "no_egress" | "no_credential" | "no_access"

// oxlint-disable-next-line ren/no-comments -- A real Git repository served through the GitHub endpoints a brain reads: smart-HTTP refs, raw files, and the API tarball that redirects to a temporary archive link. A private one answers as GitHub does to a request without a token.
export const make = Effect.fnUntraced(function* (
  options: { readonly owner?: string; readonly repo?: string; readonly isPrivate?: boolean } = {},
) {
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
  const state = {
    requests: [] as Array<{ readonly path: string; readonly authorization: string | null }>,
    failing: false,
    isPrivate: options.isPrivate ?? false,
    placeholder: "accepted" as Placeholder,
  }
  const spawned = (args: ReadonlyArray<string>, prefix: Uint8Array = new Uint8Array()) => {
    const run = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "ignore" })
    return new Response(run.stdout)
      .arrayBuffer()
      .then(async (bytes) => ((await run.exited) === 0 ? new Uint8Array([...prefix, ...new Uint8Array(bytes)]) : null))
  }
  const temporary = crypto.randomUUID()
  const answer = (url: URL) => {
    const pathname = url.pathname
    if (pathname === `/git/${owner}/${repo}.git/info/refs`)
      return spawned(
        ["upload-pack", "--stateless-rpc", "--advertise-refs", "."],
        new TextEncoder().encode("001e# service=git-upload-pack\n0000"),
      )
    const raw = new RegExp(`^/raw/${owner}/${repo}/([^/]+)/(.+)$`, "u").exec(pathname)
    if (raw) return spawned(["show", `${raw[1]}:${raw[2]}`])
    const tarball = new RegExp(`^/api/repos/${owner}/${repo}/tarball/([^/]+)$`, "u").exec(pathname)
    if (tarball)
      return Response.redirect(
        `${url.origin}/codeload/${owner}/${repo}/legacy.tar.gz/${tarball[1]}?token=${temporary}`,
        302,
      )
    const archive = new RegExp(`^/codeload/${owner}/${repo}/legacy\\.tar\\.gz/([^/]+)$`, "u").exec(pathname)
    if (archive && (!state.isPrivate || url.searchParams.get("token") === temporary))
      return spawned([
        "archive",
        "--format=tar.gz",
        `--prefix=${owner}-${repo}-${archive[1]?.slice(0, 7)}/`,
        `${archive[1]}`,
      ])
    return Promise.resolve(null)
  }
  const refused = (pathname: string, authorization: string | null) => {
    if (pathname.startsWith("/codeload/")) return null
    if (authorization === null)
      return state.isPrivate ? new Response("", { status: pathname.startsWith("/git/") ? 401 : 404 }) : null
    if (state.placeholder === "no_egress") return new Response("Bad credentials", { status: 401 })
    if (state.placeholder === "no_credential")
      return new Response(JSON.stringify({ error: "ren_credential_missing", label: "GITHUB" }), {
        status: 403,
        headers: { "x-ren-egress": "credential_missing" },
      })
    if (state.placeholder === "no_access") return new Response("Not Found", { status: 404 })
    return null
  }
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          const url = new URL(request.url)
          const authorization = request.headers.get("authorization")
          state.requests.push({ path: `${url.pathname}${url.search}`, authorization })
          if (state.failing) return new Response("unavailable", { status: 503 })
          const refusal = refused(url.pathname, authorization)
          if (refusal) return refusal
          const body = await answer(url)
          if (body instanceof Response) return body
          return body ? new Response(body) : new Response("404: Not Found", { status: 404 })
        },
      }),
    ),
    (served) => Effect.promise(() => served.stop(true)),
  )
  const origin = `http://127.0.0.1:${server.port}`
  return {
    url: `https://github.com/${owner}/${repo}`,
    hosts: {
      host: "github.com",
      git: `${origin}/git`,
      api: `${origin}/api`,
      raw: `${origin}/raw`,
    } satisfies GitHubReader.Hosts,
    requests: Effect.sync(() => state.requests.map((request) => request.path)),
    authorizations: Effect.sync(() => state.requests.map((request) => [request.path, request.authorization] as const)),
    fail: (isFailing: boolean) =>
      Effect.sync(() => {
        state.failing = isFailing
      }),
    answer: (placeholder: Placeholder) =>
      Effect.sync(() => {
        state.placeholder = placeholder
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
