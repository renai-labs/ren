export * as Primitive from "./primitive.js"

import { Primitive } from "@ren/schema/primitive"
import { Context, Schema } from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError } from "./errors.js"
import { Exposure } from "./exposure.js"
import { ActiveOrganization } from "./middleware/active-organization.js"
import { Authentication } from "./middleware/authentication.js"

export class Annotation extends Context.Service<Annotation, Primitive.Definition>()(
  "@ren/protocol/Primitive/Annotation",
) {}

interface Named<Name extends string, Plural extends string> {
  readonly name: Name
  readonly plural: Plural
}

interface Identified<Name extends string, Plural extends string, ID extends Schema.Top> extends Named<Name, Plural> {
  readonly id: ID
}

export const list = <
  const Name extends string,
  const Plural extends string,
  Input extends Schema.Top,
  Page extends Schema.Top,
>(
  definition: Named<Name, Plural> & { readonly list: { readonly input: Input; readonly page: Page } },
) => {
  const identifier = Primitive.action(definition, "list")
  return HttpApiEndpoint.get(identifier, `/${definition.plural}`, {
    query: definition.list.input,
    success: definition.list.page,
  }).annotateMerge(
    OpenApi.annotations({
      identifier,
      summary: `List ${definition.plural}`,
      description: `Return one page of the ${definition.plural} that the caller can see.`,
    }),
  )
}

export const get = <const Name extends string, const Plural extends string, Info extends Schema.Top>(
  definition: Named<Name, Plural> & { readonly info: Info; readonly get: true },
) => {
  const identifier = Primitive.action(definition, "get")
  return HttpApiEndpoint.get(identifier, `/${definition.plural}/:idOrSlug`, {
    params: { idOrSlug: Schema.String },
    success: definition.info,
    error: NotFoundError,
  }).annotateMerge(
    OpenApi.annotations({
      identifier,
      summary: `Get ${definition.name}`,
      description: `Return one ${definition.name} by ID or slug.`,
    }),
  )
}

export const create = <
  const Name extends string,
  const Plural extends string,
  Input extends Schema.Top,
  Result extends Schema.Top,
>(
  definition: Named<Name, Plural> & { readonly create: { readonly input: Input; readonly result: Result } },
) => {
  const identifier = Primitive.action(definition, "create")
  return HttpApiEndpoint.post(identifier, `/${definition.plural}`, {
    payload: definition.create.input,
    success: definition.create.result,
    error: [NotFoundError, ForbiddenError, ConflictError, InvalidRequestError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier,
      summary: `Create ${definition.name}`,
      description: `Create one ${definition.name}.`,
    }),
  )
}

export const update = <
  const Name extends string,
  const Plural extends string,
  ID extends Schema.Top,
  Input extends Schema.Top,
  Result extends Schema.Top,
>(
  definition: Identified<Name, Plural, ID> & { readonly update: { readonly input: Input; readonly result: Result } },
) => {
  const identifier = Primitive.action(definition, "update")
  return HttpApiEndpoint.patch(identifier, `/${definition.plural}/:id`, {
    params: { id: definition.id },
    payload: definition.update.input,
    success: definition.update.result,
    error: [NotFoundError, ForbiddenError, ConflictError, InvalidRequestError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier,
      summary: `Update ${definition.name}`,
      description: `Change one ${definition.name}.`,
    }),
  )
}

export const archive = <
  const Name extends string,
  const Plural extends string,
  ID extends Schema.Top,
  Info extends Schema.Top,
>(
  definition: Identified<Name, Plural, ID> & { readonly info: Info; readonly archive: true },
) => {
  const identifier = Primitive.action(definition, "archive")
  return HttpApiEndpoint.delete(identifier, `/${definition.plural}/:id`, {
    params: { id: definition.id },
    success: definition.info,
    error: [NotFoundError, ForbiddenError, ConflictError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier,
      summary: `Archive ${definition.name}`,
      description: `Archive one ${definition.name} and return it. Archiving an archived ${definition.name} returns it unchanged.`,
    }),
  )
}

export const action = <
  const Name extends string,
  const Plural extends string,
  ID extends Schema.Top,
  const Action extends string,
  Actions extends { readonly [Key in Action]: { readonly input: Schema.Top; readonly result: Schema.Top } },
>(
  definition: Identified<Name, Plural, ID> & { readonly actions: Actions },
  action: Action,
  options?: { readonly invalid: true },
) => {
  const identifier = Primitive.action(definition, action)
  const input: Actions[Action]["input"] = definition.actions[action].input
  const result: Actions[Action]["result"] = definition.actions[action].result
  return HttpApiEndpoint.post(identifier, `/${definition.plural}/:id/${action}`, {
    params: { id: definition.id },
    payload: input,
    success: result,
    error: [NotFoundError, ForbiddenError, ConflictError, ...(options?.invalid ? [InvalidRequestError] : [])],
  }).annotateMerge(
    OpenApi.annotations({
      identifier,
      summary: `${action} ${definition.name}`,
      description: `Run the ${action} action on one ${definition.name}.`,
    }),
  )
}

export const group = <
  const Name extends string,
  const Endpoints extends NonEmptyReadonlyArray<HttpApiEndpoint.Constraint>,
>(
  definition: Primitive.Definition & { readonly name: Name },
  exposure: Exposure["Service"],
  endpoints: Endpoints,
) =>
  HttpApiGroup.make(definition.name)
    .add(...endpoints)
    .middleware(ActiveOrganization)
    .middleware(Authentication)
    .annotate(Annotation, definition)
    .annotate(Exposure, exposure)
    .annotateMerge(OpenApi.annotations({ title: definition.name }))
