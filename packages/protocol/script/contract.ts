import { Context, Option } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Exposure } from "../src/exposure.js"
import { ActiveOrganization } from "../src/middleware/active-organization.js"
import { Authentication } from "../src/middleware/authentication.js"
import { Primitive } from "../src/primitive.js"

const publicExceptions = new Map([
  ["server.health", "Server status for clients and load balancers."],
  ["server.invitation", "Invitation preview before the invitee signs in."],
])

const authenticatedExceptions = new Map([["server.me", "The signed-in user and their active organization."]])

const operations = [
  { name: "list", method: "GET", suffix: "" },
  { name: "get", method: "GET", suffix: "/:idOrSlug" },
  { name: "create", method: "POST", suffix: "" },
  { name: "update", method: "PATCH", suffix: "/:id" },
  { name: "archive", method: "DELETE", suffix: "/:id" },
]

const failures = (checks: ReadonlyArray<readonly [failed: boolean, message: string]>) =>
  checks.filter((check) => check[0]).map((check) => check[1])

const route = (endpoint: HttpApiEndpoint.Top) => `${endpoint.method} ${endpoint.path} ${endpoint.identifier}`

const checkPrimitive = (group: HttpApiGroup.Top, domain: string) => {
  const definition = Context.getOption(group.annotations, Primitive.Definition)
  if (Option.isNone(definition)) {
    return [`${group.identifier} is not built with Primitive.group and is not an allowed exception`]
  }
  const plural = definition.value.plural
  const expected = [
    ...operations
      .filter((operation) => operation.name in definition.value)
      .map((operation) => `${operation.method} /api/${plural}${operation.suffix} ${domain}.${operation.name}`),
    ...Object.keys(definition.value.actions ?? {}).map(
      (action) => `POST /api/${plural}/:id/${action} ${domain}.${action}`,
    ),
  ]
  const actual = Object.values(group.endpoints).map(route)
  return [
    ...expected.filter((each) => !actual.includes(each)).map((each) => `${group.identifier} is missing ${each}`),
    ...actual.filter((each) => !expected.includes(each)).map((each) => `${group.identifier} has undeclared ${each}`),
    ...Object.values(group.endpoints)
      .filter((endpoint) => !endpoint.middlewares.has(Authentication) || !endpoint.middlewares.has(ActiveOrganization))
      .map((endpoint) => `${endpoint.identifier} requires Authentication and ActiveOrganization`),
  ]
}

const checkGroup = (group: HttpApiGroup.Top) => {
  const domain = group.identifier.replace(/^server\./, "")
  const endpoints = Object.values(group.endpoints)
  const shared = failures([
    [!group.identifier.startsWith("server."), `${group.identifier} is not named server.<domain>`],
    [Option.isNone(Context.getOption(group.annotations, Exposure)), `${group.identifier} has no Exposure annotation`],
    ...endpoints.flatMap((endpoint) => [
      [
        !endpoint.identifier.startsWith(`${domain}.`),
        `${endpoint.identifier} is not named ${domain}.<operation>`,
      ] as const,
      [!endpoint.path.startsWith("/api/"), `${endpoint.identifier} is not served under /api/`] as const,
      [
        !Option.contains(Context.getOption(endpoint.annotations, OpenApi.Identifier), endpoint.identifier),
        `${endpoint.identifier} has no matching OpenAPI identifier`,
      ] as const,
    ]),
  ])
  if (publicExceptions.has(group.identifier)) return shared
  if (authenticatedExceptions.has(group.identifier)) {
    return [
      ...shared,
      ...endpoints
        .filter((endpoint) => !endpoint.middlewares.has(Authentication))
        .map((endpoint) => `${endpoint.identifier} requires Authentication`),
    ]
  }
  return [...shared, ...checkPrimitive(group, domain)]
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
  const identifiers = groups.flatMap((group) => Object.values(group.endpoints).map((endpoint) => endpoint.identifier))
  return [
    ...identifiers
      .filter((identifier, index) => identifiers.indexOf(identifier) !== index)
      .map((identifier) => `${identifier} is declared more than once`),
    ...groups.flatMap(checkGroup),
  ]
}
