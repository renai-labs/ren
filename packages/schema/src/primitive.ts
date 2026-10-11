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

export const define = <const D extends Definition>(definition: D & Checked<D>): D => definition
