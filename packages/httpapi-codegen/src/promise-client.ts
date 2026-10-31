export * as PromiseClient from "./promise-client.js"

import { ClientTree } from "./client-tree.js"
import { Errors } from "./errors.js"
import { Names } from "./names.js"
import { Operations } from "./operations.js"
import { SchemaShape } from "./schema-shape.js"
import type { Types } from "./types.js"

function renderPath(path: string, input: ReadonlyArray<Types.InputField>, wildcard?: Types.PromiseInputField) {
  const fields = new Set(input.filter((field) => field.source === "params").map((field) => field.name))
  const segments = (wildcard === undefined ? path : path.slice(0, -1))
    .split(/(:[A-Za-z_][A-Za-z0-9_]*)/g)
    .filter(Boolean)
  const template = segments
    .map((segment) => {
      if (!segment.startsWith(":")) return segment.replaceAll("`", "\\`")
      const name = segment.slice(1)
      if (!fields.has(name)) throw new Errors.GenerationError({ reason: `Missing path parameter: ${name}` })
      return `\${encodeURIComponent(input.${name})}`
    })
    .join("")
  return `\`${template}${wildcard === undefined ? "" : `\${encodePath(input.${wildcard.name})}`}\``
}

function renderRequestParts(endpoint: Types.Endpoint) {
  const optionalInput = Operations.promiseInputMode(endpoint) === "optional"
  const access = (name: string) => `input${optionalInput ? "?." : ""}[${JSON.stringify(name)}]`
  const part = (source: Types.InputField["source"]) => {
    const inputs = endpoint.input.filter((field) => field.source === source)
    const first = inputs[0]
    if (first === undefined) return source === "payload" && endpoint.payloads.length > 0 ? "{ }" : undefined
    if (SchemaShape.isOpaquePayload(endpoint) && source === "payload") return access(first.name)
    return `{ ${inputs.map((field) => `${JSON.stringify(field.name)}: ${access(field.name)}`).join(", ")} }`
  }
  return [
    endpoint.query === undefined ? undefined : `query: ${part("query")}`,
    endpoint.headers === undefined ? undefined : `headers: ${part("headers")}`,
    endpoint.payloads.length === 0 ? undefined : `body: ${part("payload")}`,
  ].filter((value): value is string => value !== undefined)
}

function renderDescriptor(endpoint: Types.Endpoint) {
  const path = renderPath(endpoint.endpoint.path, endpoint.input, Operations.promiseWildcardInput(endpoint))
  const parts = renderRequestParts(endpoint)
  const declaredStatuses = [...new Set(endpoint.errors.map((error) => error.status))]
  const success = endpoint.successes[0]
  return `{ method: ${JSON.stringify(endpoint.endpoint.method)}, path: ${path}${parts.length === 0 ? "" : `, ${parts.join(", ")}`}, successStatus: ${endpoint.successStatus}, declaredStatuses: [${declaredStatuses.join(", ")}], empty: ${endpoint.operation.success === "void"}${SchemaShape.isBinarySchema(success) ? ", binary: true" : ""}${SchemaShape.isBinaryPayload(endpoint) ? ", binaryBody: true" : ""} }`
}

function renderMethod(group: Types.Group, endpoint: Types.Endpoint) {
  const prefix = Names.promiseTypePrefix(group.identifier, endpoint.clientPath)
  const inputMode = Operations.promiseInputMode(endpoint)
  const argument =
    inputMode === "none"
      ? "requestOptions?: RequestOptions"
      : `input${inputMode === "optional" ? "?" : ""}: ${prefix}Input, requestOptions?: RequestOptions`
  const descriptor = renderDescriptor(endpoint)
  if (endpoint.operation.success === "stream") {
    const success = endpoint.successes[0]
    if (!SchemaShape.isStreamSchema(success) || success._tag !== "StreamSse" || success.sseMode !== "data") {
      throw new Errors.GenerationError({
        reason: `Promise stream emission is not implemented: ${group.identifier}.${endpoint.endpoint.identifier}`,
      })
    }
    return `(${argument}): AsyncIterable<${prefix}Output> => sse<${prefix}Output>(${descriptor}, requestOptions)`
  }
  const unwrap = endpoint.unwrapData ? ".then((value) => value.data)" : ""
  return `(${argument}) => request<${endpoint.unwrapData ? `{ readonly data: ${prefix}Output }` : `${prefix}Output`}>(${descriptor}, requestOptions)${unwrap}`
}

export function renderPromiseClient(groups: ReadonlyArray<Types.Group>) {
  const imports = groups.flatMap((group) =>
    group.endpoints.flatMap((endpoint) => {
      const prefix = Names.promiseTypePrefix(group.identifier, endpoint.clientPath)
      return [...(Operations.promiseInputMode(endpoint) === "none" ? [] : [`${prefix}Input`]), `${prefix}Output`]
    }),
  )
  const fields = groups.map((group) => {
    const methods = group.endpoints.map((endpoint) => renderMethod(group, endpoint))
    const tree = ClientTree.renderClientTree(
      group.endpoints,
      (_endpoint, index) => {
        const method = methods[index]
        if (method === undefined) throw new Error(`Missing client method: ${group.identifier}`)
        return method
      },
      (name, value) => `${JSON.stringify(name)}: ${value}`,
      ", ",
    )
    return group.endpoints[0]?.topLevel ? tree : `${JSON.stringify(group.identifier)}: { ${tree} }`
  })
  return `import type { ${imports.join(", ")} } from "./types.js"\nimport { ClientError } from "./client-error.js"\n\nexport interface ClientOptions {\n  readonly baseUrl: string\n  readonly fetch?: typeof globalThis.fetch | undefined\n  readonly headers?: RequestInit["headers"]\n}\n\nexport interface RequestOptions {\n  readonly signal?: AbortSignal\n  readonly headers?: RequestInit["headers"]\n  /** Reports every chunk a streaming response receives, including keepalive comments that yield no event. */\n  readonly onActivity?: () => void\n}\n\ninterface RequestDescriptor {\n  readonly method: string\n  readonly path: string\n  readonly query?: Record<string, unknown>\n  readonly headers?: Record<string, unknown>\n  readonly body?: unknown\n  readonly successStatus: number\n  readonly declaredStatuses: ReadonlyArray<number>\n  readonly empty: boolean\n}\n\nconst maxSseEventBytes = 16 * 1024 * 1024\n\nexport function make(options: ClientOptions) {\n  const fetch = options.fetch ?? globalThis.fetch\n\n  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {\n    // A leading slash would replace any path prefix on baseUrl, so join relative to it.\n    const baseUrl = new URL(options.baseUrl)\n    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/"\n    const url = new URL(descriptor.path.slice(1), baseUrl)\n    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)\n    const headers = new Headers(options.headers)\n    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {\n      if (value !== undefined && value !== null) headers.set(key, String(value))\n    }\n    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)\n    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")\n    return {\n      url,\n      init: {\n        method: descriptor.method,\n        headers,\n        ...(requestOptions?.signal !== undefined && { signal: requestOptions.signal }),\n        ...(descriptor.body !== undefined && { body: JSON.stringify(descriptor.body) }),\n      } satisfies RequestInit,\n    }\n  }\n\n  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {\n    try {\n      const prepared = prepare(descriptor, requestOptions)\n      return await fetch(prepared.url, prepared.init)\n    } catch (cause) {\n      throw new ClientError("Transport", { cause })\n    }\n  }\n\n  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {\n    if (descriptor.declaredStatuses.includes(response.status)) throw declared(await json(response) as DeclaredErrorBody)\n    try {\n      await response.body?.cancel()\n    } catch {}\n    throw new ClientError("UnexpectedStatus", { cause: { status: response.status }, detail: String(response.status) })\n  }\n\n  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {\n    const response = await execute(descriptor, requestOptions)\n    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)\n    if (descriptor.empty) {\n      try {\n        await response.body?.cancel()\n      } catch {}\n      return undefined as A\n    }\n    return await json(response) as A\n  }\n\n  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({\n    async *[Symbol.asyncIterator]() {\n      const response = await execute(descriptor, requestOptions)\n      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)\n      if (!isContentType(response, "text/event-stream")) {\n        try {\n          await response.body?.cancel()\n        } catch {}\n        throw new ClientError("UnsupportedContentType", { detail: response.headers.get("content-type") })\n      }\n      if (response.body === null) throw new ClientError("MalformedResponse")\n      const reader = response.body.getReader()\n      const decoder = new TextDecoder()\n      let buffer = ""\n      try {\n        while (true) {\n          let next: ReadableStreamReadResult<Uint8Array>\n          try {\n            next = await reader.read()\n          } catch (cause) {\n            throw new ClientError("Transport", { cause })\n          }\n          if (!next.done) requestOptions?.onActivity?.()\n          buffer += decoder.decode(next.value, { stream: !next.done })\n          if (buffer.length > maxSseEventBytes) throw new ClientError("SseEventTooLarge")\n          const trailingCarriageReturn = !next.done && buffer.endsWith("\\r")\n          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)\n          buffer = buffer.replaceAll("\\r\\n", "\\n").replaceAll("\\r", "\\n")\n          if (trailingCarriageReturn) buffer += "\\r"\n          if (next.done && buffer !== "") buffer += "\\n\\n"\n          let boundary = buffer.indexOf("\\n\\n")\n          while (boundary >= 0) {\n            const block = buffer.slice(0, boundary)\n            buffer = buffer.slice(boundary + 2)\n            const data = block.split("\\n").flatMap((line) => line.startsWith("data:") ? [line.slice(5).trimStart()] : []).join("\\n")\n            if (data !== "") {\n              try {\n                yield JSON.parse(data) as A\n              } catch (cause) {\n                throw new ClientError("MalformedResponse", { cause })\n              }\n            }\n            boundary = buffer.indexOf("\\n\\n")\n          }\n          if (next.done) return\n        }\n      } finally {\n        try {\n          await reader.cancel()\n        } catch {}\n        reader.releaseLock()\n      }\n    },\n  })\n\n  return { ${fields.join(", ")} }\n}\n\nfunction appendQuery(params: URLSearchParams, key: string, value: unknown): void {\n  if (value === undefined) return\n  if (value === null) {\n    params.append(key, "null")\n    return\n  }\n  if (Array.isArray(value)) {\n    for (const item of value) appendQuery(params, key, item)\n    return\n  }\n  if (typeof value === "object") {\n    for (const [child, item] of Object.entries(value)) appendQuery(params, \`\${key}[\${child}]\`, item)\n    return\n  }\n  params.append(key, String(value))\n}\n\nasync function json(response: Response): Promise<unknown> {\n  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {\n    try {\n      await response.body?.cancel()\n    } catch {}\n    throw new ClientError("UnsupportedContentType", { detail: response.headers.get("content-type") })\n  }\n  let text: string\n  try {\n    text = await response.text()\n  } catch (cause) {\n    throw new ClientError("Transport", { cause })\n  }\n  if (text === "") throw new ClientError("MalformedResponse")\n  try {\n    return JSON.parse(text)\n  } catch (cause) {\n    throw new ClientError("MalformedResponse", { cause })\n  }\n}\n\ntype DeclaredErrorBody = { readonly _tag?: string; readonly message?: string; readonly data?: { readonly message?: string } }\n\n/** Throw declared error bodies as Errors. The body's fields stay on the error, so narrowing on \`_tag\` or \`name\` still works. */\nfunction declared(body: DeclaredErrorBody) {\n  const error = Object.assign(new Error(body.message ?? body.data?.message), body)\n  if (body._tag) error.name = body._tag\n  return error\n}\n\nfunction isContentType(response: Response, expected: string) {\n  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected\n}\n`
}
