export * as Types from "./types.js"

import type { Schema } from "effect"
import type { HttpApiEndpoint } from "effect/http-api"

export type InputField = {
  readonly name: string
  readonly source: "params" | "query" | "headers" | "payload"
}

export type OperationInputField = {
  readonly name: string
  readonly source: InputField["source"] | "wildcard"
}

export type Operation = {
  readonly group: string
  readonly name: string
  readonly input: ReadonlyArray<OperationInputField>
  readonly inputMode: "none" | "optional" | "required"
  readonly success: "value" | "void" | "stream"
  readonly errors: ReadonlyArray<string>
}

export type Output = {
  readonly operations: ReadonlyArray<Operation>
  readonly files: ReadonlyArray<{
    readonly path: string
    readonly content: string
  }>
}

export type Contract = {
  readonly groups: ReadonlyArray<Group>
}

export type EffectTypeReference = {
  readonly schema: Schema.Top
  readonly name: string
  readonly import: string
}

export type EffectOutputType = {
  readonly name: string
  readonly import: string
}

export type Endpoint = {
  readonly group: string
  readonly sourceGroup: string
  readonly topLevel: boolean
  readonly endpoint: HttpApiEndpoint.Top
  readonly params: Schema.Top | undefined
  readonly query: Schema.Top | undefined
  readonly headers: Schema.Top | undefined
  readonly payloads: ReadonlyArray<Schema.Top>
  readonly operation: Operation
  readonly clientPath: readonly [string, ...Array<string>]
  readonly input: ReadonlyArray<InputField & { readonly optional: boolean }>
  readonly unwrapData: boolean
  readonly errors: ReadonlyArray<{ readonly status: number; readonly schema: Schema.Top }>
  readonly successes: readonly [Schema.Top]
  readonly effectPortable: boolean
}

export type Group = {
  readonly identifier: string
  readonly sourceIdentifier: string
  readonly module: string
  readonly endpoints: ReadonlyArray<Endpoint>
}

export type PromiseInputField =
  | (InputField & { readonly optional: boolean })
  | { readonly name: string; readonly source: "wildcard"; readonly optional: false }
