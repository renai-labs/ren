export * as BuildGroups from "./build-groups.js"

import { Errors } from "./errors.js"
import { Names } from "./names.js"
import type { Types } from "./types.js"

function claimClientPath(claimed: Set<string>, path: ReadonlyArray<string>, reason: string) {
  const key = path.join("\0")
  const collides = [...claimed].some(
    (existing) => existing === key || existing.startsWith(`${key}\0`) || key.startsWith(`${existing}\0`),
  )
  if (collides) throw new Errors.GenerationError({ reason })
  claimed.add(key)
}

export function buildGroups(endpoints: ReadonlyArray<Types.Endpoint>): Array<Types.Group> {
  const modules = new Set(["client", "client-error", "index"])
  return Array.from(
    Map.groupBy(endpoints, (endpoint) => endpoint.group),
    ([identifier, groupEndpoints]) => {
      if (new Set(groupEndpoints.map((endpoint) => endpoint.sourceGroup)).size > 1) {
        throw new Errors.GenerationError({ reason: `Client group name collision: ${identifier}` })
      }
      const sanitized = identifier.replaceAll(/[^A-Za-z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "")
      const reserved = /^(aux|client|client-error|con|index|nul|prn|com[1-9]|lpt[1-9])$/i.test(sanitized)
      const module = sanitized === "" || reserved ? `group-${sanitized}` : sanitized
      if (modules.has(module.toLowerCase())) {
        throw new Errors.GenerationError({ reason: `Client module name collision: ${module}` })
      }
      modules.add(module.toLowerCase())
      return {
        identifier,
        sourceIdentifier: groupEndpoints[0]?.sourceGroup ?? identifier,
        module,
        endpoints: groupEndpoints,
      }
    },
  )
}

type Claims = {
  readonly publicNames: Set<string>
  readonly groupTypeNames: Set<string>
  readonly endpointTypeNames: Set<string>
  readonly operationKeys: Set<string>
}

function assertEndpointNames(group: Types.Group, claims: Claims) {
  const typeNames = new Set<string>()
  const groupTypeName = Names.groupTypeName(group)
  for (const endpoint of group.endpoints) {
    const operationKey = Names.clientOperationKey(group, endpoint)
    if (claims.operationKeys.has(operationKey)) {
      throw new Errors.GenerationError({ reason: `Client operation key collision: ${operationKey}` })
    }
    claims.operationKeys.add(operationKey)
    const name = endpoint.clientPath.map(Names.identifierPart).join("")
    const endpointTypeName = `${groupTypeName}${name}`
    if (claims.endpointTypeNames.has(endpointTypeName)) {
      throw new Errors.GenerationError({ reason: `Client endpoint type collision: ${endpointTypeName}` })
    }
    claims.endpointTypeNames.add(endpointTypeName)
    if (typeNames.has(name)) {
      throw new Errors.GenerationError({ reason: `Client endpoint type collision: ${group.identifier}.${name}` })
    }
    typeNames.add(name)
  }
}

function assertGroupNames(group: Types.Group, claims: Claims) {
  if (group.identifier === "__proto__") {
    throw new Errors.GenerationError({ reason: "Client group name cannot be __proto__" })
  }
  const groupTypeName = Names.groupTypeName(group)
  if (claims.groupTypeNames.has(groupTypeName)) {
    throw new Errors.GenerationError({ reason: `Client group type collision: ${groupTypeName}` })
  }
  claims.groupTypeNames.add(groupTypeName)
  const endpointPaths = new Set<string>()
  for (const endpoint of group.endpoints) {
    claimClientPath(
      endpointPaths,
      endpoint.clientPath,
      `Client endpoint name collision: ${group.identifier}.${endpoint.clientPath.join(".")}`,
    )
  }
  assertEndpointNames(group, claims)
  const publicPaths = group.endpoints[0]?.topLevel
    ? [...new Set(group.endpoints.map((item) => item.clientPath[0]))].map((name) => [name])
    : [[group.identifier]]
  for (const path of publicPaths) {
    claimClientPath(claims.publicNames, path, `Client name collision: ${path.join(".")}`)
  }
}

export function assertClientNames(groups: ReadonlyArray<Types.Group>) {
  const claims = {
    publicNames: new Set<string>(),
    groupTypeNames: new Set<string>(),
    endpointTypeNames: new Set<string>(),
    operationKeys: new Set<string>(),
  }
  for (const group of groups) assertGroupNames(group, claims)
}
