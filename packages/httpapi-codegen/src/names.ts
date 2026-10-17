export * as Names from "./names.js"

import { Errors } from "./errors.js"
import type { Types } from "./types.js"

const leadingIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*/

export const clientNamespaceExport = 'export * as Ren from "./client.js"\n'

export function withoutNumericSuffix(value: string) {
  return value.replace(/_\d+$/, "")
}

export function identifierPart(value: string) {
  const identifier = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")
  return leadingIdentifier.test(identifier) ? identifier : `_${identifier}`
}

export function groupTypeName(group: Types.Group) {
  return identifierPart(group.identifier)
}

export function endpointTypeName(group: Types.Group, endpoint: Types.Endpoint) {
  return `${groupTypeName(group)}${endpoint.clientPath.map(identifierPart).join("")}`
}

export function endpointAdapterName(group: Types.Group, endpoint: Types.Endpoint) {
  return `Endpoint${endpointTypeName(group, endpoint)}`
}

export function promiseTypePrefix(group: string, path: ReadonlyArray<string>) {
  return `${identifierPart(group)}${path.map(identifierPart).join("")}`
}

export function clientEndpointPath(group: string, name: string) {
  const parts = name.split(".")
  if (parts[0] === "v2") parts.shift()
  const index = parts.lastIndexOf(group.slice(group.lastIndexOf(".") + 1))
  const result = index < 0 ? parts : parts.slice(index + 1)
  const first = result[0]
  if (first === undefined || result.some((part) => part.length === 0)) {
    throw new Errors.GenerationError({ reason: "Client endpoint path must contain non-empty names" })
  }
  if (result.some((part) => part === "__proto__")) {
    throw new Errors.GenerationError({ reason: "Client endpoint path cannot contain __proto__" })
  }
  return [first, ...result.slice(1)] as const
}

export function uniqueTypeName(seed: string, used: ReadonlySet<string>, suffix = 1): string {
  const name = suffix === 1 ? seed : `${seed}${suffix}`
  return used.has(name) ? uniqueTypeName(seed, used, suffix + 1) : name
}
