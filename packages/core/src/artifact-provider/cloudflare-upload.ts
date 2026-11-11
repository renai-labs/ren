export * as ArtifactCloudflareUpload from "./cloudflare-upload.js"

import { Effect, Option, Redacted, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { ArtifactProvider } from "../artifact-provider.js"

const failed = (message: string) => new ArtifactProvider.Failed({ message })

export const stage = Effect.fn("ArtifactCloudflareUpload.stage")(function* (input: {
  readonly account: string
  readonly script: string
  readonly token: Redacted.Redacted
  readonly node: string
  readonly wrangler: string
  readonly directory: string
  readonly guard: Option.Option<string>
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const http = yield* HttpClient.HttpClient
  const prefix = `/${crypto.randomUUID()}`
  const scriptPath = `/accounts/${input.account}/workers/scripts/${input.script}`
  let staged: { body: Uint8Array; contentType: string } | undefined
  const server = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: async (request) => {
            const url = new URL(request.url)
            if (!url.pathname.startsWith(`${prefix}/accounts/${input.account}/`))
              return new Response(null, { status: 403 })
            const path = url.pathname.slice(prefix.length)
            if (request.method === "GET" && path === `/accounts/${input.account}/workers/services/${input.script}`)
              return Response.json(
                { success: false, errors: [{ code: 10007, message: "Staging a new upload" }] },
                { status: 404 },
              )
            if (request.method === "PUT" && path === scriptPath) {
              staged = {
                body: new Uint8Array(await request.arrayBuffer()),
                contentType: request.headers.get("content-type") ?? "",
              }
              return Response.json(
                { success: false, errors: [{ code: 10000, message: "Upload staged; publication is owned by Ren" }] },
                { status: 400 },
              )
            }
            const assets =
              request.method === "POST" &&
              (path === `${scriptPath}/assets-upload-session` ||
                path === `/accounts/${input.account}/workers/assets/upload`)
            if (request.method !== "GET" && !assets)
              return new Response("Wrangler may stage assets, not publish or mutate settings", { status: 403 })
            const headers = new Headers(request.headers)
            headers.delete("host")
            const response = await fetch(`https://api.cloudflare.com/client/v4${path}${url.search}`, {
              method: request.method,
              headers,
              ...(request.body && { body: await request.arrayBuffer() }),
              signal: AbortSignal.timeout(10_000),
            })
            const outputHeaders = new Headers(response.headers)
            outputHeaders.delete("content-encoding")
            outputHeaders.delete("content-length")
            return new Response(await response.arrayBuffer(), { status: response.status, headers: outputHeaders })
          },
        }),
      catch: () => failed("Ren could not open the local upload staging endpoint"),
    }),
    (server) => Effect.promise(() => server.stop(true)),
  )
  const handle = yield* spawner.spawn(
    ChildProcess.make(
      input.node,
      [
        "--import",
        `${input.directory}/parent.mjs`,
        input.wrangler,
        "deploy",
        "--config",
        `${input.directory}/wrangler.json`,
      ],
      {
        cwd: input.directory,
        forceKillAfter: "3 seconds",
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          CLOUDFLARE_ACCOUNT_ID: input.account,
          CLOUDFLARE_API_TOKEN: input.token,
          CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${server.port}${prefix}`,
          WRANGLER_SEND_METRICS: "false",
          CI: "1",
          BROWSER: "none",
        },
      },
    ),
  )
  const result = yield* Effect.all(
    {
      code: handle.exitCode,
      output: handle.all.pipe(
        Stream.decodeText,
        Stream.runFold(
          () => "",
          (text, chunk) => (text + chunk).slice(-4000),
        ),
      ),
    },
    { concurrency: "unbounded" },
  )
  if (!staged)
    return yield* failed(
      `Cloudflare upload staging failed (${result.code}): ${result.output.replaceAll(Redacted.value(input.token), "[redacted]")}`,
    )
  const captured = staged
  const metadata = yield* Effect.tryPromise({
    try: () =>
      new Response(new Uint8Array(captured.body), { headers: { "content-type": captured.contentType } }).formData(),
    catch: () => failed("Wrangler did not stage multipart Worker code"),
  })
  const part = metadata.get("metadata")
  let text = ""
  if (typeof part === "string") text = part
  else if (part) text = yield* Effect.promise(() => part.text())
  yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({
        main_module: Schema.String,
        exports: Schema.optional(
          Schema.Record(
            Schema.String,
            Schema.Struct({ type: Schema.Literal("durable-object"), storage: Schema.Literal("sqlite") }),
          ),
        ),
      }),
    ),
  )(text).pipe(Effect.mapError(() => failed("Invalid staged Worker metadata")))
  const request = HttpClientRequest.put(`https://api.cloudflare.com/client/v4${scriptPath}`).pipe(
    HttpClientRequest.bearerToken(input.token),
    HttpClientRequest.bodyUint8Array(staged.body, staged.contentType),
    HttpClientRequest.setHeader(
      Option.isSome(input.guard) ? "if-match" : "if-none-match",
      Option.getOrElse(input.guard, () => "*"),
    ),
  )
  const response = yield* http.execute(request).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError(() =>
      failed("Conditional Cloudflare publication did not complete; reconcile remote state before retrying"),
    ),
  )
  if (response.status === 412) return yield* failed("Cloudflare publication was fenced by a newer upload (HTTP 412)")
  if (response.status !== 200)
    return yield* failed(
      `Cloudflare conditional publication failed (${response.status}): ${yield* response.text.pipe(
        Effect.map((text) => text.slice(-1500)),
        Effect.timeout("5 seconds"),
        Effect.mapError(() => failed("Could not read Cloudflare upload failure")),
      )}`,
    )
  return yield* response.json.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Struct({ result: Schema.Struct({ etag: Schema.NonEmptyString }) })),
    ),
    Effect.map((body) => body.result.etag),
    Effect.timeout("5 seconds"),
    Effect.mapError(() => failed("Cloudflare upload did not return its ETag")),
  )
}, Effect.scoped)
