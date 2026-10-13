import { describe, expect, test } from "bun:test"
import { Context, Option } from "effect"
import { HttpApi, HttpApiGroup, OpenApi } from "effect/http-api"
import { BrainApi } from "../src/brain-api.js"
import { ClientApi } from "../src/client.js"
import { BrainRejectedError, SessionNotStartedError } from "../src/errors.js"
import { Exposure } from "../src/exposure.js"
import { checkContract } from "../script/contract.js"

const groups = () => {
  const found: Array<HttpApiGroup.Top> = []
  HttpApi.reflect(BrainApi, { onGroup: (options) => found.push(options.group), onEndpoint: () => {} })
  return found
}

describe("Brain API", () => {
  test("serves brain.start at POST /ren/sessions and brain.send at POST /ren/sessions/:id/messages", () => {
    expect(
      groups().flatMap((group) =>
        Object.values(group.endpoints).map((endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.identifier}`),
      ),
    ).toEqual(["POST /ren/sessions brain.start", "POST /ren/sessions/:id/messages brain.send"])
  })

  test("each endpoint declares its success, its errors and an internal exposure", () => {
    const paths = OpenApi.fromApi(BrainApi).paths
    expect(Object.keys(paths["/ren/sessions"]?.post?.responses ?? {}).toSorted()).toEqual(["200", "403", "422"])
    expect(Object.keys(paths["/ren/sessions/{id}/messages"]?.post?.responses ?? {}).toSorted()).toEqual([
      "200",
      "403",
      "409",
      "422",
    ])
    expect(groups().map((group) => Context.getOption(group.annotations, Exposure))).toEqual([Option.some("internal")])
  })

  test("is not part of the public Api, so it is not in openapi.json or the generated client", async () => {
    const paths = Object.keys(OpenApi.fromApi(ClientApi).paths)
    expect(paths.filter((path) => path.startsWith("/ren/"))).toEqual([])
    expect(await Bun.file(new URL("../openapi.json", import.meta.url)).text()).not.toContain("/ren/")
  })

  test("the contract check accepts its /ren/ paths as a listed exception", () => {
    expect(checkContract(BrainApi)).toEqual([])
  })

  test("BrainRejectedError answers 422 and SessionNotStartedError 409, each a tagged error", () => {
    const responses = OpenApi.fromApi(BrainApi).paths["/ren/sessions/{id}/messages"]?.post?.responses ?? {}
    expect([responses["422"]?.description, responses["409"]?.description]).toEqual([
      "BrainRejectedError",
      "SessionNotStartedError",
    ])
    expect([
      new BrainRejectedError({ message: "unknown agent" })._tag,
      new SessionNotStartedError({ message: "no session" })._tag,
    ]).toEqual(["BrainRejectedError", "SessionNotStartedError"])
  })
})
