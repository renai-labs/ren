export * as McpInspect from "./mcp-inspect.js"

import {
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  type AuthorizationServerMetadata,
  type OAuthServerInfo,
} from "@modelcontextprotocol/client"
import type { AppListing } from "@ren/schema/app-listing"
import type { McpInspection } from "@ren/schema/mcp-inspection"
import { Context, Data, Duration, Effect, Layer, Option, Result, Schema } from "effect"
import { OAuthFetch } from "./oauth-fetch.js"

export interface Interface {
  readonly inspect: (url: string) => Effect.Effect<McpInspection.Result>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/McpInspect") {}

export const protocolVersion = "2025-11-25"

export const maximumPages = 50

export const timeout = Duration.seconds(30)

export interface Discovery {
  readonly challengeScope: Option.Option<string>
  readonly info: OAuthServerInfo
}

// oxlint-disable-next-line ren/no-comments -- credentials §7 rules 2, 3 and 12 (K9, S6): the challenge of an initialize without a token, then protected-resource metadata and the server's metadata in the RFC 8414 and OpenID orders (MCP SDK, which also checks that the metadata names the issuer it was asked for).
export const discover = (fetch: OAuthFetch.Fetch, url: string, challenge: Response) => {
  const params = extractWWWAuthenticateParams(challenge)
  return Effect.tryPromise({
    try: () =>
      discoverOAuthServerInfo(url, {
        ...(params.resourceMetadataUrl && { resourceMetadataUrl: params.resourceMetadataUrl }),
        fetchFn: fetch,
      }),
    catch: String,
  }).pipe(Effect.map((info): Discovery => ({ challengeScope: Option.fromNullishOr(params.scope), info })))
}

// oxlint-disable-next-line ren/no-comments -- credentials §7 rule 4 (A17, A33): Ren's client metadata document, then dynamic registration (deprecated in MCP 2026-07-28, so the last resort), else an org OAuth app.
export const clientOf = (metadata: AuthorizationServerMetadata | undefined): McpInspection.Client => {
  if (
    metadata?.client_id_metadata_document_supported === true &&
    metadata.token_endpoint_auth_methods_supported?.includes("none")
  )
    return "metadata-document"
  return metadata?.registration_endpoint ? "registration" : "oauth-app"
}

const reads = new Set(
  "get list search fetch read find query describe view retrieve lookup show count browse inspect preview check validate verify analyze summarize estimate calculate compare".split(
    " ",
  ),
)

const writes = new Set(
  "create update delete add remove send post put set edit modify write upload move copy insert patch publish schedule execute run start stop cancel archive reply forward import manage invite assign close mark replace upsert save submit trigger apply clear reset rename merge restore pause resume enable disable generate make book purchase buy pay transfer approve reject".split(
    " ",
  ),
)

// oxlint-disable-next-line ren/no-comments -- The first read or write verb among the words of the name decides; a name with neither is not read-only. Running a report only reads.
const isReadOnlyName = (name: string) => {
  const words = name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
  const verb = words.find((word) => reads.has(word) || writes.has(word))
  if (verb === "run" && words.some((word) => word.startsWith("report"))) return true
  return reads.has(verb ?? "")
}

const Tool = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  annotations: Schema.optionalKey(Schema.Struct({ readOnlyHint: Schema.optionalKey(Schema.Boolean) })),
})

const decodeTool = Schema.decodeUnknownOption(Tool)

const toolsOf = (listed: ReadonlyArray<unknown>) => {
  const decoded = listed.flatMap((item) => Option.toArray(decodeTool(item))).filter((tool) => tool.name.trim())
  return {
    tools: decoded
      .map((tool): AppListing.Tool => ({
        name: tool.name.trim(),
        description: tool.description?.trim() ?? "",
        readOnly: tool.annotations?.readOnlyHint ?? isReadOnlyName(tool.name),
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
    readOnlyInferred: decoded.filter((tool) => typeof tool.annotations?.readOnlyHint !== "boolean").length,
  }
}

const Implementation = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  icons: Schema.optionalKey(Schema.Array(Schema.Struct({ src: Schema.String }))),
  websiteUrl: Schema.optionalKey(Schema.String),
})

const serverOf = (
  info: typeof Implementation.Type = {},
  extra: { readonly description?: string; readonly icon?: string } = {},
): McpInspection.Server | null => {
  const server = Object.fromEntries(
    Object.entries({
      name: info.name,
      title: info.title,
      version: info.version,
      description: info.description ?? extra.description,
      icon: info.icons?.at(0)?.src ?? extra.icon,
      websiteUrl: info.websiteUrl,
    }).filter((entry): entry is [string, string] => Boolean(entry.at(1))),
  )
  return Object.keys(server).length > 0 ? server : null
}

const Message = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ code: Schema.Number, message: Schema.String })),
})

const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(Message))

const decodeInitialize = Schema.decodeUnknownOption(Schema.Struct({ serverInfo: Schema.optionalKey(Implementation) }))

const decodeTools = Schema.decodeUnknownOption(
  Schema.Struct({ tools: Schema.Array(Schema.Unknown), nextCursor: Schema.optionalKey(Schema.String) }),
)

const decodeCard = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      serverInfo: Schema.optionalKey(Implementation),
      description: Schema.optionalKey(Schema.String),
      iconUrl: Schema.optionalKey(Schema.String),
      tools: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    }),
  ),
)

const messagesOf = (text: string, contentType: string) =>
  (contentType.includes("text/event-stream")
    ? text
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5))
    : [text]
  ).flatMap((data) => Option.toArray(decodeMessage(data)))

class Refused extends Data.TaggedError("Refused")<{ readonly challenge: Option.Option<Response> }> {}

class Failed extends Data.TaggedError("Failed")<{ readonly reason: string; readonly reachable: boolean }> {}

const unlisted = { tools: null, readOnlyInferred: 0, source: null }

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export const make = (fetch: OAuthFetch.Fetch): Interface => {
  const rpc = Effect.fnUntraced(function* (
    url: string,
    request: { readonly method: string; readonly id?: number; readonly params?: object },
    session: Option.Option<string>,
  ) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...(Option.isSome(session) && { "mcp-session-id": session.value }),
            ...(request.method !== "initialize" && { "mcp-protocol-version": protocolVersion }),
          },
          body: JSON.stringify({ jsonrpc: "2.0", ...request }),
        }),
      catch: (cause) => new Failed({ reason: `Ren could not reach the server: ${reasonOf(cause)}`, reachable: false }),
    })
    if (response.status === 401 || response.status === 403)
      return yield* new Refused({ challenge: Option.some(response) })
    if (!response.ok)
      return yield* new Failed({ reason: `The server answered HTTP ${response.status}.`, reachable: true })
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => new Failed({ reason: `The server's answer broke off: ${reasonOf(cause)}`, reachable: true }),
    })
    const next = Option.orElse(Option.fromNullishOr(response.headers.get("mcp-session-id")), () => session)
    if (!request.id) return { result: undefined, session: next }
    const message = messagesOf(text, response.headers.get("content-type") ?? "").find((each) => each.id === request.id)
    if (!message) return yield* new Failed({ reason: `The server did not answer ${request.method}.`, reachable: true })
    if (message.error) {
      const error = `${message.error.code}: ${message.error.message}`
      if (/auth|unauthori[sz]ed|api.?key|token|credential/iu.test(error))
        return yield* new Refused({ challenge: Option.none() })
      return yield* new Failed({ reason: `The server refused ${request.method}: ${error}`, reachable: true })
    }
    return { result: message.result, session: next }
  })

  const listRemote = Effect.fnUntraced(function* (url: string) {
    const initialized = yield* rpc(
      url,
      {
        method: "initialize",
        id: 1,
        params: { protocolVersion, capabilities: {}, clientInfo: { name: "Ren", version: "1" } },
      },
      Option.none(),
    )
    const session = initialized.session
    yield* rpc(url, { method: "notifications/initialized" }, session).pipe(Effect.ignore)
    const listed: Array<unknown> = []
    let cursor: string | undefined
    for (let page = 0; page < maximumPages; page++) {
      const answer = yield* rpc(url, { method: "tools/list", id: page + 2, params: cursor ? { cursor } : {} }, session)
      const tools = decodeTools(answer.result)
      listed.push(...Option.match(tools, { onNone: () => [], onSome: (found) => found.tools }))
      cursor = Option.getOrUndefined(tools)?.nextCursor
      if (!cursor) break
    }
    return {
      server: serverOf(Option.getOrUndefined(decodeInitialize(initialized.result))?.serverInfo),
      ...toolsOf(listed),
    }
  })

  const serverCard = Effect.fnUntraced(function* (url: string) {
    const origin = new URL(url).origin
    const found = yield* Effect.forEach(
      [`${origin}/.well-known/mcp/server-card.json`, `${origin}/.well-known/mcp`],
      (at) =>
        Effect.tryPromise((signal) => fetch(at, { signal, headers: { accept: "application/json" } })).pipe(
          Effect.flatMap((response) => (response.ok ? Effect.tryPromise(() => response.text()) : Effect.succeed(""))),
          Effect.map(decodeCard),
          Effect.orElseSucceed(() => Option.none()),
        ),
    )
    return Option.match(Option.firstSomeOf(found), {
      onNone: () => ({ server: null, ...unlisted }),
      onSome: (card) => ({
        server: serverOf(card.serverInfo, {
          ...(card.description && { description: card.description }),
          ...(card.iconUrl && { icon: card.iconUrl }),
        }),
        ...(card.tools && card.tools.length > 0
          ? { ...toolsOf(card.tools), source: "server-card" as const }
          : unlisted),
      }),
    })
  })

  const authOf = Effect.fnUntraced(function* (url: string, challenge: Option.Option<Response>) {
    if (Option.isNone(challenge)) return { type: "unknown" } satisfies McpInspection.Auth
    const scheme = challenge.value.headers.get("www-authenticate")?.trim().split(/\s+/u).at(0)?.toLowerCase()
    if (scheme === "basic") return { type: "basic" } satisfies McpInspection.Auth
    const discovery = yield* Effect.option(discover(fetch, url, challenge.value))
    const found = Option.getOrUndefined(discovery)
    const metadata = found?.info.authorizationServerMetadata
    if (found && metadata)
      return {
        type: "oauth",
        scopes: Option.match(found.challengeScope, {
          onNone: () => found.info.resourceMetadata?.scopes_supported ?? [],
          onSome: (scope) => scope.split(" ").filter(Boolean),
        }),
        client: clientOf(metadata),
      } satisfies McpInspection.Auth
    return { type: scheme === "bearer" ? "bearer" : "unknown" } satisfies McpInspection.Auth
  })

  const run = Effect.fnUntraced(function* (url: string) {
    const listed = yield* Effect.result(listRemote(url))
    if (Result.isSuccess(listed))
      return {
        reachable: true,
        server: listed.success.server,
        auth: { type: "none" },
        tools: listed.success.tools,
        readOnlyInferred: listed.success.readOnlyInferred,
        source: "tools-list",
        problem: null,
      } satisfies McpInspection.Result
    const failure = listed.failure
    if (failure._tag === "Failed" && !failure.reachable)
      return {
        reachable: false,
        server: null,
        auth: { type: "unknown" },
        ...unlisted,
        problem: failure.reason,
      } satisfies McpInspection.Result
    return {
      reachable: true,
      ...(yield* serverCard(url)),
      auth: failure._tag === "Refused" ? yield* authOf(url, failure.challenge) : { type: "unknown" },
      problem: failure._tag === "Failed" ? failure.reason : null,
    } satisfies McpInspection.Result
  })

  return {
    inspect: Effect.fn("McpInspect.inspect")(function* (url) {
      return yield* run(url).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.succeed({
              reachable: false,
              server: null,
              auth: { type: "unknown" },
              ...unlisted,
              problem: `The server did not answer within ${Duration.format(timeout)}.`,
            } satisfies McpInspection.Result),
        }),
      )
    }),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* OAuthFetch.Service
    return Service.of(make(http.fetch))
  }),
)
