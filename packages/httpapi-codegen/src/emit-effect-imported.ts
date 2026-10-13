export * as EmitEffectImported from "./emit-effect-imported.js"

import { ClientTree } from "./client-tree.js"
import { EmitEffect } from "./emit-effect.js"
import { Errors } from "./errors.js"
import { Names } from "./names.js"
import { Operations } from "./operations.js"
import { RenderGroup } from "./render-group.js"
import { SchemaShape } from "./schema-shape.js"
import type { Types } from "./types.js"

export type Options =
  | { readonly module: string; readonly api: string; readonly shapeModule?: string }
  | { readonly module: string; readonly group: string; readonly shapeModule?: string }
  | {
      readonly module: string
      readonly endpoints: Readonly<Record<string, string>>
      readonly shapeModule?: string
    }

function renderImportedGroup(group: string) {
  return {
    imports: [group],
    source: `const Api = HttpApi.make("generated").add(${group})\n\n`,
  }
}

function renderImportedProjection(groups: ReadonlyArray<Types.Group>, endpoints: Readonly<Record<string, string>>) {
  const imports = groups.flatMap((group) =>
    group.endpoints.map((endpoint) => {
      const name = endpoints[`${group.identifier}.${endpoint.endpoint.identifier}`]
      if (name === undefined) {
        throw new Errors.GenerationError({
          reason: `Missing imported endpoint: ${group.identifier}.${endpoint.endpoint.identifier}`,
        })
      }
      return name
    }),
  )
  const source = `const Api = HttpApi.make("generated").${groups
    .map((group) => {
      const options = group.endpoints[0]?.topLevel ? ", { topLevel: true }" : ""
      return `add(HttpApiGroup.make(${JSON.stringify(group.identifier)}${options})${group.endpoints.map((endpoint) => `.add(${endpoints[`${group.identifier}.${endpoint.endpoint.identifier}`]})`).join("")})`
    })
    .join(".")}\n\n`
  return { imports: [...new Set(imports)], source }
}

function renderInputType(item: Types.Endpoint, prefix: string) {
  return item.input
    .map(
      (field) =>
        `readonly ${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ${prefix}Request[${JSON.stringify(field.source)}]${SchemaShape.isOpaquePayload(item) && field.source === "payload" ? "" : `[${JSON.stringify(field.name)}]`}`,
    )
    .join("; ")
}

function renderRequestDeclarations(
  item: Types.Endpoint,
  prefix: string,
  rawGroup: string,
  shapeModule: string | undefined,
) {
  const requestDeclaration = `type ${prefix}Request = Parameters<${rawGroup}[${JSON.stringify(item.endpoint.identifier)}]>[0]\n`
  if (shapeModule === undefined && item.operation.inputMode !== "none") {
    return `${requestDeclaration}type ${prefix}Input = { ${renderInputType(item, prefix)} }\n`
  }
  return SchemaShape.isOpaquePayload(item) ? requestDeclaration : ""
}

function renderEndpointAdapter(
  group: Types.Group,
  item: Types.Endpoint,
  rawGroup: string,
  shapeModule: string | undefined,
) {
  const prefix = Names.endpointTypeName(group, item)
  const inputMode = item.operation.inputMode
  const opaquePayload = SchemaShape.isOpaquePayload(item)
  const identifier = JSON.stringify(item.endpoint.identifier)
  const request = RenderGroup.renderEffectRequest(item, {
    params: item.params,
    query: item.query,
    headers: item.headers,
    payload: item.payloads[0],
  })
  const argument = inputMode === "none" ? "" : `input${inputMode === "optional" ? "?" : ""}: ${prefix}Input`
  // oxlint-disable-next-line ren/no-comments -- HttpApiClient distributes union payloads into union request objects while the flattened input holds one object with a union value; TypeScript cannot correlate the equivalent shapes.
  const rawCall = `raw[${identifier}]({ ${request} }${opaquePayload ? ` as ${prefix}Request` : ""})`
  const isStream = item.operation.success === "stream"
  const result = isStream
    ? `Stream.unwrap(${rawCall}.pipe(Effect.mapError(mapClientError), Effect.map((stream) => stream.pipe(Stream.mapError(mapClientError)))))`
    : `${rawCall}.pipe(Effect.mapError(mapClientError)${item.unwrapData ? ", Effect.map((value) => value.data)" : ""})`
  const output =
    shapeModule === undefined
      ? result
      : `${isStream ? "preserveStream" : "preserveEffect"}<${prefix}Output>()(${result})`
  const declarations = renderRequestDeclarations(item, prefix, rawGroup, shapeModule)
  return `${declarations}const ${Names.endpointAdapterName(group, item)} = (raw: ${rawGroup}) => (${argument}) => ${output}`
}

function renderGroupAdapter(group: Types.Group, shapeModule: string | undefined) {
  const rawGroup = group.endpoints[0]?.topLevel ? "RawClient" : `RawClient[${JSON.stringify(group.sourceIdentifier)}]`
  const methods = group.endpoints.map((item) => renderEndpointAdapter(group, item, rawGroup, shapeModule))
  const fields = ClientTree.renderClientTree(
    group.endpoints,
    (item) => `${Names.endpointAdapterName(group, item)}(raw)`,
    (name, value) => `${JSON.stringify(name)}: ${value}`,
    ", ",
  )
  return `${methods.join("\n\n")}\n\nconst adaptGroup${Names.groupTypeName(group)} = (raw: ${rawGroup}) => ({ ${fields} })`
}

function renderShapeSupport(groups: ReadonlyArray<Types.Group>, shapeModule: string | undefined, usesStream: boolean) {
  if (shapeModule === undefined) return { shapeImport: "", preserve: "" }
  const shapeTypes = groups.flatMap((group) =>
    group.endpoints.flatMap((endpoint) => [
      ...(endpoint.operation.inputMode === "none" ? [] : [`${Names.endpointTypeName(group, endpoint)}Input`]),
      `${Names.endpointTypeName(group, endpoint)}Output`,
    ]),
  )
  return {
    shapeImport: `import type { ${shapeTypes.join(", ")} } from ${JSON.stringify(shapeModule)}\n`,
    preserve: `const preserveEffect = <A>() => <Actual extends A, E, R>(effect: Effect.Effect<Actual, E, R> & ([A] extends [Actual] ? unknown : { readonly __generatedOutputWiderThanContract: [expected: Actual, generated: A] })): Effect.Effect<A, E, R> => effect\n${usesStream ? "const preserveStream = <A>() => <Actual extends A, E, R>(stream: Stream.Stream<Actual, E, R> & ([A] extends [Actual] ? unknown : { readonly __generatedOutputWiderThanContract: [expected: Actual, generated: A] })): Stream.Stream<A, E, R> => stream\n" : ""}\n`,
  }
}

function renderProjection(groups: ReadonlyArray<Types.Group>, options: Options) {
  if ("api" in options) return { api: options.api, projection: undefined }
  const projection =
    "group" in options ? renderImportedGroup(options.group) : renderImportedProjection(groups, options.endpoints)
  return { api: "Api", projection }
}

function renderImportedFiles(groups: ReadonlyArray<Types.Group>, options: Options): Types.Output["files"] {
  const adapters = groups.map((group) => renderGroupAdapter(group, options.shapeModule))
  const fields = groups.flatMap((group) =>
    group.endpoints[0]?.topLevel
      ? [`...adaptGroup${Names.groupTypeName(group)}(raw)`]
      : [
          `${JSON.stringify(group.identifier)}: adaptGroup${Names.groupTypeName(group)}(raw[${JSON.stringify(group.sourceIdentifier)}])`,
        ],
  )
  const usesStream = groups.some((group) => group.endpoints.some((item) => item.operation.success === "stream"))
  const resolved = renderProjection(groups, options)
  const projection = resolved.projection
  const api = resolved.api
  const adapterNames = new Set(
    groups.flatMap((group) => group.endpoints.map((endpoint) => Names.endpointAdapterName(group, endpoint))),
  )
  const adapterCollision = (projection?.imports ?? [api]).find((name) => adapterNames.has(name))
  if (adapterCollision !== undefined) {
    throw new Errors.GenerationError({
      reason: `Generated Effect adapter collides with imported endpoint: ${adapterCollision}`,
    })
  }
  const imports =
    projection === undefined
      ? `import { ${api} } from ${JSON.stringify(options.module)}`
      : `import { HttpApi, HttpApiClient${"endpoints" in options ? ", HttpApiGroup" : ""} } from "effect/http-api"\nimport { ${projection.imports.join(", ")} } from ${JSON.stringify(options.module)}`
  const httpApiImport = projection === undefined ? 'import { HttpApiClient } from "effect/http-api"\n' : ""
  const shape = renderShapeSupport(groups, options.shapeModule, usesStream)
  const client = `// Generated by @ren/httpapi-codegen. Do not edit.\nimport { Effect${usesStream ? ", Stream" : ""}, Schema } from "effect"\nimport { Sse } from "effect/encoding"\nimport { HttpClientError } from "effect/http"\n${httpApiImport}${imports}\n${shape.shapeImport}import { ClientError } from "./client-error.js"\n\n${projection?.source ?? ""}type RawClient = HttpApiClient.ForApi<typeof ${api}>\n\nconst mapClientError = <E>(error: E) => HttpClientError.isHttpClientError(error) || Schema.isSchemaError(error) || Sse.Retry.is(error) ? new ClientError({ cause: error }) : error\n\n${shape.preserve}${adapters.join("\n\n")}\n\nconst adaptClient = (raw: RawClient) => ({ ${fields.join(", ")} })\n\nexport const make = (options?: { readonly baseUrl?: URL | string }) => HttpApiClient.make(${api}, options).pipe(Effect.map(adaptClient))\n`
  return [EmitEffect.clientErrorFile, { path: "client.ts", content: client }, EmitEffect.indexFile]
}

export function emitEffectImported(contract: Types.Contract, options: Options): Types.Output {
  return {
    operations: Operations.operations(contract.groups),
    files: renderImportedFiles(contract.groups, options),
  }
}
