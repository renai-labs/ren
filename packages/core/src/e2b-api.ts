export * as E2BApi from "./e2b-api.js"

import { Config, Duration, Effect, Option, Redacted } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import type { SandboxProvider } from "./sandbox-provider.js"

export const envdPort = 49983

export const config = Config.all({
  key: Config.Redacted("E2B_API_KEY"),
  api: Config.String("E2B_API_URL").pipe(Config.withDefault("https://api.e2b.dev")),
  domain: Config.String("E2B_DOMAIN").pipe(Config.withDefault("e2b.app")),
})

// oxlint-disable-next-line ren/no-comments -- What an E2B call answered: the body of a 2xx, a 404 (the sandbox is gone), a 429 with its wait, or another status.
export type Answer =
  | { readonly _tag: "Ok"; readonly text: string }
  | { readonly _tag: "Missing"; readonly status: number; readonly text: string }
  | { readonly _tag: "Busy"; readonly status: number; readonly text: string; readonly retryAfter: Duration.Duration }
  | { readonly _tag: "Refused"; readonly status: number; readonly text: string }

export const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`

// oxlint-disable-next-line ren/no-comments -- E2B sends a host name to the proxy only when a domain entry allows it; `*` with a deny of all IP ranges sends every connection to the proxy by name (e2b-brain README §11a rows 1 and 2). A wildcard does not match its apex, so `*.x.com` also allows `x.com`. An update replaces the whole config, so each one repeats the proxy.
export const networkOf = (network: {
  readonly hosts: Option.Option<ReadonlyArray<string>>
  readonly proxy: Option.Option<SandboxProvider.Proxy>
}) => {
  const allowOut = Option.match(network.hosts, {
    onNone: () => ["*"],
    onSome: (hosts) => [...new Set(hosts.flatMap((host) => (host.startsWith("*.") ? [host, host.slice(2)] : [host])))],
  })
  return Option.match(network.proxy, {
    onNone: () => (Option.isSome(network.hosts) ? { allowOut, denyOut: ["0.0.0.0/0"] } : { allowOut: [], denyOut: [] }),
    onSome: (proxy) => ({
      allowOut,
      denyOut: ["0.0.0.0/0"],
      egressProxy: { address: proxy.address, username: proxy.username, password: Redacted.value(proxy.password) },
    }),
  })
}

export const make = Effect.fnUntraced(function* (settings: Config.Success<typeof config>) {
  const http = yield* HttpClient.HttpClient
  const api = http.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(settings.api),
        HttpClientRequest.setHeader("x-api-key", Redacted.value(settings.key)),
      ),
    ),
  )
  const answer = (response: HttpClientResponse.HttpClientResponse) =>
    response.text.pipe(
      Effect.map((text): Answer => {
        if (response.status >= 200 && response.status < 300) return { _tag: "Ok", text }
        if (response.status === 404) return { _tag: "Missing", status: 404, text }
        if (response.status === 429)
          return {
            _tag: "Busy",
            status: 429,
            text,
            retryAfter: Duration.seconds(Number(response.headers["retry-after"] ?? "10") || 10),
          }
        return { _tag: "Refused", status: response.status, text }
      }),
    )
  const send = (request: HttpClientRequest.HttpClientRequest) =>
    api.execute(request).pipe(Effect.timeout("60 seconds"), Effect.flatMap(answer))
  return {
    domain: settings.domain,
    send,
    // oxlint-disable-next-line ren/no-comments -- Writes a file into a sandbox as its user, through envd; Ren's start scripts wait for the files they need.
    upload: (
      sandbox: { readonly sandboxId: string; readonly domain: string },
      accessToken: Option.Option<string>,
      path: string,
      content: string,
    ) => {
      const form = new FormData()
      form.append("file", new Blob([content]), path.slice(path.lastIndexOf("/") + 1))
      return http
        .execute(
          HttpClientRequest.post(
            `https://${envdPort}-${sandbox.sandboxId}.${sandbox.domain}/files?path=${encodeURIComponent(path)}&username=user`,
          ).pipe(
            HttpClientRequest.setHeaders(
              Option.match(accessToken, { onNone: () => ({}), onSome: (token) => ({ "x-access-token": token }) }),
            ),
            HttpClientRequest.setBody(HttpBody.formData(form)),
          ),
        )
        .pipe(Effect.flatMap(answer))
    },
    create: (body: Readonly<Record<string, unknown>>) =>
      send(HttpClientRequest.post("/sandboxes").pipe(HttpClientRequest.bodyJsonUnsafe(body))),
    connect: (sandboxId: string, timeout: Duration.Duration) =>
      send(
        HttpClientRequest.post(`/sandboxes/${sandboxId}/connect`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ timeout: Math.ceil(Duration.toSeconds(timeout)) }),
        ),
      ),
    keepAlive: (sandboxId: string, timeout: Duration.Duration) =>
      send(
        HttpClientRequest.post(`/sandboxes/${sandboxId}/timeout`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ timeout: Math.ceil(Duration.toSeconds(timeout)) }),
        ),
      ),
    updateNetwork: (sandboxId: string, network: ReturnType<typeof networkOf>) =>
      send(HttpClientRequest.put(`/sandboxes/${sandboxId}/network`).pipe(HttpClientRequest.bodyJsonUnsafe(network))),
    kill: (sandboxId: string) => send(HttpClientRequest.delete(`/sandboxes/${sandboxId}`)),
    info: (sandboxId: string) => send(HttpClientRequest.get(`/sandboxes/${sandboxId}`)),
  }
})

export type Client = Effect.Success<ReturnType<typeof make>>
