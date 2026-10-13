export * as Operations from "./operations.js"

import { Errors } from "./errors.js"
import type { Types } from "./types.js"

export function inputMode(input: ReadonlyArray<{ readonly optional: boolean }>): Types.Operation["inputMode"] {
  if (input.length === 0) return "none"
  return input.every((field) => field.optional) ? "optional" : "required"
}

export function promiseWildcardInput(endpoint: Types.Endpoint): Types.PromiseInputField | undefined {
  const path = endpoint.endpoint.path
  if (!path.includes("*")) return undefined
  if (path.indexOf("*") !== path.lastIndexOf("*") || !path.endsWith("*")) {
    throw new Errors.GenerationError({ reason: `Unsupported Promise path wildcard: ${path}` })
  }
  const name = endpoint.input.some((field) => field.name === "path") ? "wildcard" : "path"
  return { name, source: "wildcard", optional: false }
}

export function promiseInput(endpoint: Types.Endpoint): ReadonlyArray<Types.PromiseInputField> {
  const wildcard = promiseWildcardInput(endpoint)
  if (wildcard === undefined) return endpoint.input
  return [...endpoint.input, wildcard]
}

export function promiseInputMode(endpoint: Types.Endpoint) {
  return inputMode(promiseInput(endpoint))
}

export function operations(groups: ReadonlyArray<Types.Group>) {
  return groups.flatMap((group) => group.endpoints.map((endpoint) => endpoint.operation))
}

export function promiseOperations(groups: ReadonlyArray<Types.Group>) {
  return groups.flatMap((group) =>
    group.endpoints.map((endpoint) => ({
      ...endpoint.operation,
      input: promiseInput(endpoint).map(({ name, source }) => ({ name, source })),
      inputMode: promiseInputMode(endpoint),
    })),
  )
}
