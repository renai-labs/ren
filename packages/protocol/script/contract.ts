import { Context, Option } from "effect"
import { HttpApi, HttpApiGroup } from "effect/http-api"
import { Primitive } from "../src/primitive.js"

const exceptions = new Map([
  ["health", "Server status for clients and load balancers."],
  ["me", "The signed-in user and their active organization."],
  ["invitation", "Invitation preview before the invitee signs in."],
  ["handProvider", "The hand providers of the deployment and the config schema of each, for the environment form."],
])

const operations = [
  { name: "list", method: "GET", suffix: "" },
  { name: "get", method: "GET", suffix: "/:idOrSlug" },
  { name: "create", method: "POST", suffix: "" },
  { name: "update", method: "PATCH", suffix: "/:id" },
  { name: "archive", method: "DELETE", suffix: "/:id" },
]

const route = (method: string, path: string, identifier: string) => `${method} ${path} ${identifier}`

const checkGroup = (group: HttpApiGroup.Top) => {
  if (exceptions.has(group.identifier)) return []
  const annotation = Context.getOption(group.annotations, Primitive.Annotation)
  if (Option.isNone(annotation)) return [`${group.identifier} is neither a primitive nor a listed exception`]
  const definition = annotation.value
  const path = `/${definition.plural}`
  const expected = [
    ...operations
      .filter((operation) => operation.name in definition)
      .map((operation) =>
        route(operation.method, `${path}${operation.suffix}`, `${definition.name}.${operation.name}`),
      ),
    ...Object.keys({ ...definition.actions }).map((action) =>
      route("POST", `${path}/:id/${action}`, `${definition.name}.${action}`),
    ),
  ]
  const actual = Object.values(group.endpoints).map((endpoint) =>
    route(endpoint.method, endpoint.path, endpoint.identifier),
  )
  return [
    ...expected.filter((each) => !actual.includes(each)).map((each) => `${group.identifier} is missing ${each}`),
    ...actual.filter((each) => !expected.includes(each)).map((each) => `${group.identifier} has undeclared ${each}`),
  ]
}

export function checkContract<Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
) {
  const groups: Array<HttpApiGroup.Top> = []
  HttpApi.reflect(api, {
    onGroup: (options) => {
      groups.push(options.group)
    },
    onEndpoint: () => {},
  })
  return groups.flatMap(checkGroup)
}
