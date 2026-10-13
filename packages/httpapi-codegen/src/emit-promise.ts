export * as EmitPromise from "./emit-promise.js"

import { Schema, SchemaAST } from "effect"
import { HttpMethod } from "effect/http"
import { HttpApiSchema } from "effect/http-api"
import { Errors } from "./errors.js"
import { Names } from "./names.js"
import { Operations } from "./operations.js"
import { PromiseClient } from "./promise-client.js"
import { PromiseTypes } from "./promise-types.js"
import { SchemaShape } from "./schema-shape.js"
import type { Types } from "./types.js"

const clientErrorSource = `export type ClientErrorReason = "Transport" | "UnexpectedStatus" | "UnsupportedContentType" | "MalformedResponse" | "SseEventTooLarge"\n\nexport class ClientError extends Error {\n  override readonly name = "ClientError"\n  constructor(readonly reason: ClientErrorReason, options?: ErrorOptions & { readonly detail?: string | null }) {\n    const detail = options?.detail ?? (options?.cause instanceof Error ? options.cause.message : undefined)\n    super(detail ? \`\${reason}: \${detail}\` : reason, options)\n  }\n}\n`

function assertPayload(endpoint: Types.Endpoint, name: string) {
  const payload = endpoint.payloads[0]
  if (payload === undefined) return
  const encoding =
    SchemaShape.resolveHttpApiEncoding(payload.ast)?._tag ??
    (HttpMethod.hasBody(endpoint.endpoint.method) ? "Json" : "FormUrlEncoded")
  if (encoding !== "Json" && encoding !== "Uint8Array") {
    throw new Errors.GenerationError({ reason: `Unsupported Promise payload encoding: ${name}` })
  }
}

function assertSuccess(endpoint: Types.Endpoint, name: string) {
  const success = endpoint.successes[0]
  if (SchemaShape.isStreamSchema(success)) {
    if (
      success._tag !== "StreamSse" ||
      success.sseMode !== "data" ||
      !SchemaAST.isNever(Schema.toType(success.error).ast)
    ) {
      throw new Errors.GenerationError({ reason: `Unsupported Promise stream: ${name}` })
    }
    return
  }
  if (HttpApiSchema.isNoContent(success.ast)) return
  const encoding = SchemaShape.resolveHttpApiEncoding(success.ast)?._tag ?? "Json"
  if (encoding !== "Json" && encoding !== "Uint8Array") {
    throw new Errors.GenerationError({ reason: `Unsupported Promise success encoding: ${name}` })
  }
}

function assertErrors(endpoint: Types.Endpoint, name: string) {
  for (const error of endpoint.errors) {
    if (SchemaShape.declaredErrorFields(error.schema) === undefined) {
      throw new Errors.GenerationError({ reason: `Promise error must have a literal discriminator: ${name}` })
    }
    if ((SchemaShape.resolveHttpApiEncoding(error.schema.ast)?._tag ?? "Json") !== "Json") {
      throw new Errors.GenerationError({ reason: `Unsupported Promise error encoding: ${name}` })
    }
  }
}

function replaceOne(input: string, search: string, replacement: string) {
  if (!input.includes(search)) {
    throw new Errors.GenerationError({ reason: `Missing Promise client template marker: ${search}` })
  }
  return input.replace(search, replacement)
}

function withoutSse(content: string) {
  const start = content.indexOf("\n  const sse = <A>(")
  const end = content.indexOf("\n\n  return {", start)
  if (start < 0 || end < 0) {
    throw new Errors.GenerationError({ reason: "Missing Promise client template marker: sse" })
  }
  return replaceOne(
    content.slice(0, start) + content.slice(end + 1),
    "const maxSseEventBytes = 16 * 1024 * 1024\n\n",
    "",
  )
}

function normalizeClientContent(content: string, groups: ReadonlyArray<Types.Group>) {
  const endpoints = groups.flatMap((group) => group.endpoints)
  const transforms: Array<(content: string) => string> = [
    (input) =>
      endpoints.some((endpoint) => endpoint.operation.success === "stream")
        ? replaceOne(input, "let next: ReadableStreamReadResult<Uint8Array>", "let next")
        : withoutSse(input),
    ...(endpoints.some((endpoint) => SchemaShape.isBinarySchema(endpoint.successes[0]))
      ? [
          (input: string) =>
            replaceOne(
              replaceOne(input, "readonly empty: boolean\n}", "readonly empty: boolean\n  readonly binary?: true\n}"),
              "if (descriptor.empty) {",
              "if (descriptor.binary) return new Uint8Array(await response.arrayBuffer()) as A\n    if (descriptor.empty) {",
            ),
        ]
      : []),
    ...(endpoints.some(SchemaShape.isBinaryPayload)
      ? [
          (input: string) =>
            replaceOne(
              replaceOne(
                replaceOne(
                  input,
                  "readonly body?: unknown\n",
                  "readonly body?: unknown\n  readonly binaryBody?: true\n",
                ),
                'if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")',
                'if (descriptor.body !== undefined && !headers.has("content-type"))\n      headers.set("content-type", descriptor.binaryBody ? "application/octet-stream" : "application/json")',
              ),
              "body: descriptor.body === undefined ? undefined : JSON.stringify(descriptor.body),",
              'body:\n          descriptor.body === undefined\n            ? undefined\n            : descriptor.binaryBody\n              ? (descriptor.body as RequestInit["body"])\n              : JSON.stringify(descriptor.body),',
            ),
        ]
      : []),
    ...(endpoints.some((endpoint) => Operations.promiseWildcardInput(endpoint) !== undefined)
      ? [
          (input: string) =>
            replaceOne(
              input,
              "function appendQuery(params: URLSearchParams, key: string, value: unknown): void {",
              'function encodePath(value: string): string {\n  return value.split("/").map(encodeURIComponent).join("/")\n}\n\nfunction appendQuery(params: URLSearchParams, key: string, value: unknown): void {',
            ),
        ]
      : []),
  ]
  return transforms.reduce((result, transform) => transform(result), content)
}

export function emitPromise(
  contract: Types.Contract,
  options?: {
    readonly outputTypes?: Readonly<Record<string, { readonly name: string; readonly import: string }>>
    readonly mutableOutputs?: boolean
  },
): Types.Output {
  const groups = contract.groups
  for (const endpoint of groups.flatMap((group) => group.endpoints)) {
    const name = `${endpoint.group}.${endpoint.endpoint.identifier}`
    assertPayload(endpoint, name)
    assertSuccess(endpoint, name)
    assertErrors(endpoint, name)
  }
  return {
    operations: Operations.promiseOperations(groups),
    files: [
      {
        path: "types.ts",
        content: PromiseTypes.renderPromiseTypes(groups, options?.outputTypes, options?.mutableOutputs ?? false),
      },
      { path: "client-error.ts", content: clientErrorSource },
      { path: "client.ts", content: normalizeClientContent(PromiseClient.renderPromiseClient(groups), groups) },
      {
        path: "index.ts",
        content: `export { ClientError, type ClientErrorReason } from "./client-error.js"\n${Names.clientNamespaceExport}export * from "./types.js"\n`,
      },
    ],
  }
}
