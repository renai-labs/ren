export * as Primitive from "./primitive.js"

import { Schema } from "effect"
import { Pagination } from "./pagination.js"
import { WriteResult } from "./write-result.js"

export interface List {
  readonly input: Schema.Top
  readonly page: Schema.Top
}

export interface Write {
  readonly input: Schema.Top
  readonly result: Schema.Top
}

export interface Definition {
  readonly name: string
  readonly plural: string
  readonly id: Schema.Top
  readonly info: Schema.Top
  readonly list?: List
  readonly get?: true
  readonly create?: Write
  readonly update?: Write
  readonly archive?: true
  readonly actions?: Readonly<Record<string, Write>>
}

type Result<Info extends Schema.Top> =
  Info | typeof WriteResult.Redirect | typeof WriteResult.Upload | ReturnType<typeof WriteResult.Secret<Info>>

interface Checked<D extends Definition> {
  readonly info: { readonly Type: { readonly id: D["id"]["Type"] } }
  readonly list?: {
    readonly input: { readonly Type: Pick<Pagination.Page<D["info"]["Type"]>, "page" | "pageSize"> }
    readonly page: { readonly Type: Pagination.Page<D["info"]["Type"]> }
  }
  readonly create?: { readonly result: Result<D["info"]> }
  readonly update?: { readonly result: Result<D["info"]> }
  readonly actions?: { readonly [Name in keyof D["actions"]]: { readonly result: Result<D["info"]> } }
}

type Operation<D extends { readonly name: string }> =
  | Extract<keyof D, "list" | "get" | "create" | "update" | "archive">
  | ("actions" extends keyof D ? keyof D["actions" & keyof D] & string : never)

export type Action<D extends Definition> = `${D["name"]}.${Operation<D>}`

export const action = <
  const Name extends string,
  const D extends { readonly name: Name },
  const O extends Operation<D>,
>(
  definition: D & { readonly name: Name },
  operation: O,
) => `${definition.name}.${operation}` as const

export const define = <const D extends Definition>(definition: D & Checked<D>): D => definition
