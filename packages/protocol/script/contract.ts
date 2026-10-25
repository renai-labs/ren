import { Context, Option } from "effect"
import { HttpApi, HttpApiGroup } from "effect/http-api"
import { Primitive } from "../src/primitive.js"

const exceptions = new Map([
  ["health", "Server status for clients and load balancers."],
  ["me", "The signed-in user and their active organization."],
  ["invitation", "Invitation preview before the invitee signs in."],
  [
    "environmentProvider",
    "The environment providers of the deployment and the config schema of each, for the environment template form.",
  ],
  [
    "channel-connect",
    "Lists the providers this server can install, and starts an install: a write that returns a redirect, which no primitive operation is.",
  ],
  [
    "channel-reply",
    "The agent of a chat that a channel started answers in its thread: a write on the caller's chat, with no record of its own, which no primitive operation is.",
  ],
  [
    "credential-connect",
    "Starts a sign-in for one MCP of a profile: a write that returns a redirect, which no primitive operation is.",
  ],
  [
    "app-profile-reach",
    "Deletes a profile, and lists the profiles a chat or a new chat reaches with their gaps: a hard delete and two computed reads, which no primitive operation is.",
  ],
  [
    "ren-inference",
    "Proxies the Ren Inference Service, which stores the provider connections: a sign-in redirect, and reads and writes of records Ren does not hold, which no primitive operation is.",
  ],
  [
    "chat",
    "Short-lived access to a session's brain for the Chat API, the session's saved messages while the brain is not ready, and the models a new session may use.",
  ],
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
